// SQLite-backed store + the agent-native semantics: session lifecycle, message
// log, and blocking "asks". This is the single source of truth; the HTTP/WS
// gateway and the MCP server are thin layers over these functions.
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { bus } from './bus';
import type {
  Session,
  SessionStatus,
  Message,
  MsgDirection,
  MsgKind,
  Ask,
  AskStatus,
  Owner,
  TrustTier,
  Grant,
  GrantEffect,
  ContactRequest,
  Channel,
  ChannelMessage,
  ChannelMsgKind,
} from './types';
import { SESSION_STATUSES } from './types';
import { getSettings } from './settings';
import {
  resolveEffect,
  isCapability,
  isEffect,
  type Capability,
  type Effect,
} from './permissions';

const DB_PATH = process.env.BEACON_DB ?? 'data/beacon.db';
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  runtime TEXT NOT NULL,
  workPath TEXT NOT NULL,
  task TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT,
  archivedAt INTEGER,
  lastSeenAt INTEGER,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  sessionId TEXT NOT NULL,
  direction TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  askId TEXT,
  meta TEXT,
  createdAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(sessionId, createdAt);
CREATE TABLE IF NOT EXISTS asks (
  id TEXT PRIMARY KEY,
  sessionId TEXT NOT NULL,
  question TEXT NOT NULL,
  options TEXT,
  status TEXT NOT NULL,
  answer TEXT,
  createdAt INTEGER NOT NULL,
  answeredAt INTEGER
);
CREATE TABLE IF NOT EXISTS owner (
  id TEXT PRIMARY KEY,
  name TEXT,
  token TEXT,
  createdAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS grants (
  id TEXT PRIMARY KEY,
  fromId TEXT NOT NULL,
  toId TEXT NOT NULL,
  effect TEXT NOT NULL,
  createdAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_grants_pair ON grants(fromId, toId);
CREATE TABLE IF NOT EXISTS contact_requests (
  id TEXT PRIMARY KEY,
  fromId TEXT NOT NULL,
  toId TEXT NOT NULL,
  askId TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  decidedAt INTEGER
);
CREATE INDEX IF NOT EXISTS idx_cr_ask ON contact_requests(askId);
CREATE TABLE IF NOT EXISTS agent_policies (
  agentId TEXT NOT NULL,
  capability TEXT NOT NULL,
  effect TEXT NOT NULL,
  PRIMARY KEY (agentId, capability)
);
CREATE TABLE IF NOT EXISTS admission_requests (
  id TEXT PRIMARY KEY,
  agentId TEXT NOT NULL,
  askId TEXT NOT NULL,
  status TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  decidedAt INTEGER
);
CREATE INDEX IF NOT EXISTS idx_admission_ask ON admission_requests(askId);
CREATE TABLE IF NOT EXISTS spawn_requests (
  id TEXT PRIMARY KEY,
  spawnerId TEXT NOT NULL,
  askId TEXT NOT NULL,
  params TEXT NOT NULL,
  status TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  decidedAt INTEGER
);
CREATE INDEX IF NOT EXISTS idx_spawn_ask ON spawn_requests(askId);
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  createdAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS channel_participants (
  channelId TEXT NOT NULL,
  sessionId TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  PRIMARY KEY (channelId, sessionId)
);
CREATE INDEX IF NOT EXISTS idx_cp_session ON channel_participants(sessionId);
CREATE TABLE IF NOT EXISTS channel_messages (
  id TEXT PRIMARY KEY,
  channelId TEXT NOT NULL,
  fromSessionId TEXT,
  text TEXT NOT NULL,
  createdAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cm_channel ON channel_messages(channelId, createdAt);
-- Per-member receipts: how far each agent member has been DELIVERED (a channel
-- message was typed into its live terminal) and READ (it pulled the channel via
-- check_inbox / read_channel). Two-tier so the owner can see who got vs who saw.
CREATE TABLE IF NOT EXISTS channel_member_state (
  channelId TEXT NOT NULL,
  sessionId TEXT NOT NULL,
  deliveredAt INTEGER,
  readAt INTEGER,
  PRIMARY KEY (channelId, sessionId)
);
`);

// Additive migrations: bring older databases (created before a column existed)
// up to the current schema without touching data. Always additive — never drop
// or rewrite — so the platform can be updated in place while in active use.
function ensureColumn(table: string, column: string, decl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}
ensureColumn('sessions', 'title', 'TEXT');
ensureColumn('sessions', 'archivedAt', 'INTEGER');
ensureColumn('sessions', 'lastSeenAt', 'INTEGER');
ensureColumn('messages', 'deliveredAt', 'INTEGER');
// Identity Phase 1 — additive session columns. Null on pre-existing rows; the
// read-time mapper (mapSession) supplies sane defaults, so no backfill UPDATE.
ensureColumn('sessions', 'bindKey', 'TEXT');
ensureColumn('sessions', 'origin', 'TEXT');
ensureColumn('sessions', 'guardianId', 'TEXT');
ensureColumn('sessions', 'trustTier', 'TEXT');
ensureColumn('sessions', 'nativeSessionId', 'TEXT');
// Agent self-introduction (bio). NULL on old rows; defaulted at read time.
ensureColumn('sessions', 'description', 'TEXT');
// Group-ask (P6 v2): channel messages gain a kind + askId so a question posted
// to a channel can block the asker until a member answers. Old rows are plain
// 'chat' with no ask.
ensureColumn('channel_messages', 'kind', "TEXT NOT NULL DEFAULT 'chat'");
ensureColumn('channel_messages', 'askId', 'TEXT');
// @directed channel messages: an optional target member the message is addressed
// at (still broadcast to all). NULL on old rows / plain broadcasts.
ensureColumn('channel_messages', 'toSessionId', 'TEXT');
// Admission timestamp. NULL means "pending the owner's decision" (quarantined).
// When this column is first added, existing rows predate admission and must be
// treated as already admitted, so backfill them once at migration time —
// otherwise the new quarantine would retroactively hide every current contact.
{
  const cols = db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === 'admittedAt')) {
    db.exec(`ALTER TABLE sessions ADD COLUMN admittedAt INTEGER`);
    db.exec(`UPDATE sessions SET admittedAt = createdAt WHERE admittedAt IS NULL`);
  }
}
// Identity Phase 3 — agent->agent peer messages. NULL on pre-existing rows and
// on human/agent messages; only set for kind 'peer'. Defaulted at read time.
ensureColumn('messages', 'fromSessionId', 'TEXT');

// One-time backfill (user_version gate): before 0.10.2, deliveredAt was only set
// when an agent PULLED its inbox, so messages it received via terminal push were
// never stamped. The new replay-on-reconnect would otherwise treat that whole
// historical backlog as "undelivered" and re-send already-handled messages (the
// "old messages washed through again" bug). Mark all existing 1:1 human messages
// as already delivered — they were, under the old push semantics. Runs exactly
// once; user_version then pins it so later restarts never re-backfill (which would
// wrongly mask genuinely-undelivered messages going forward).
{
  const ver = db.pragma('user_version', { simple: true }) as number;
  if (ver < 1) {
    db.exec(
      `UPDATE messages SET deliveredAt = createdAt
       WHERE deliveredAt IS NULL AND direction = 'human' AND kind = 'chat'`,
    );
    db.pragma('user_version = 1');
  }
}

const now = () => Date.now();

// ---------- owner (guardian) ----------
const selectOwner = db.prepare(`SELECT * FROM owner LIMIT 1`);
const insertOwner = db.prepare(
  `INSERT INTO owner (id, name, token, createdAt) VALUES (@id, @name, @token, @createdAt)`
);

/**
 * Ensures exactly one Owner row exists and returns it. Called once at module
 * load; seeds an owner whose token defaults to PLATFORM_TOKEN when set.
 */
export function ensureOwner(): Owner {
  const existing = selectOwner.get() as Owner | undefined;
  if (existing) return existing;
  const o: Owner = {
    id: randomUUID(),
    name: null,
    token: process.env.PLATFORM_TOKEN ?? null,
    createdAt: now(),
  };
  insertOwner.run(o);
  return o;
}

let owner = ensureOwner();

/** The single platform owner / guardian. */
export function getOwner(): Owner {
  return owner;
}

// ---------- row mappers ----------
// Raw shape as stored: the identity columns are nullable on rows written before
// the migration, so they come back possibly-null and get defaulted in mapSession.
interface SessionRow {
  id: string;
  runtime: string;
  workPath: string;
  task: string;
  status: SessionStatus;
  title: string | null;
  description: string | null;
  archivedAt: number | null;
  lastSeenAt: number | null;
  bindKey: string | null;
  nativeSessionId: string | null;
  origin: string | null;
  guardianId: string | null;
  trustTier: string | null;
  admittedAt: number | null;
  createdAt: number;
  updatedAt: number;
}
interface MessageRow {
  id: string;
  sessionId: string;
  direction: MsgDirection;
  kind: MsgKind;
  text: string;
  fromSessionId: string | null;
  askId: string | null;
  meta: string | null;
  createdAt: number;
  deliveredAt: number | null;
}
interface AskRow {
  id: string;
  sessionId: string;
  question: string;
  options: string | null;
  status: AskStatus;
  answer: string | null;
  createdAt: number;
  answeredAt: number | null;
}

// Defaults the additive identity columns at read time: old rows have them NULL.
function mapSession(r: SessionRow): Session {
  return {
    id: r.id,
    runtime: r.runtime,
    workPath: r.workPath,
    task: r.task,
    status: r.status,
    title: r.title ?? null,
    description: r.description ?? null,
    archivedAt: r.archivedAt ?? null,
    lastSeenAt: r.lastSeenAt ?? null,
    bindKey: r.bindKey ?? null,
    nativeSessionId: r.nativeSessionId ?? null,
    origin: r.origin === 'human' ? 'human' : 'agent',
    guardianId: r.guardianId ?? null,
    trustTier: (r.trustTier ?? 'standard') as TrustTier,
    admittedAt: r.admittedAt ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function mapMessage(r: MessageRow): Message {
  return {
    id: r.id,
    sessionId: r.sessionId,
    direction: r.direction,
    kind: r.kind,
    text: r.text,
    fromSessionId: r.fromSessionId ?? null,
    askId: r.askId,
    meta: r.meta ? (JSON.parse(r.meta) as Record<string, unknown>) : null,
    createdAt: r.createdAt,
    deliveredAt: r.deliveredAt ?? null,
  };
}
function mapAsk(r: AskRow): Ask {
  return {
    id: r.id,
    sessionId: r.sessionId,
    question: r.question,
    options: r.options ? (JSON.parse(r.options) as string[]) : null,
    status: r.status,
    answer: r.answer,
    createdAt: r.createdAt,
    answeredAt: r.answeredAt,
  };
}

// ---------- sessions ----------
const insertSession = db.prepare(
  `INSERT INTO sessions (id, runtime, workPath, task, status, title, description, archivedAt, lastSeenAt, bindKey, nativeSessionId, origin, guardianId, trustTier, admittedAt, createdAt, updatedAt)
   VALUES (@id, @runtime, @workPath, @task, @status, @title, @description, @archivedAt, @lastSeenAt, @bindKey, @nativeSessionId, @origin, @guardianId, @trustTier, @admittedAt, @createdAt, @updatedAt)`
);
const selectSession = db.prepare(`SELECT * FROM sessions WHERE id = ?`);
const selectSessions = db.prepare(`SELECT * FROM sessions ORDER BY updatedAt DESC`);
const selectSessionByBindKey = db.prepare(
  `SELECT * FROM sessions WHERE bindKey = ? ORDER BY updatedAt DESC LIMIT 1`
);
const updateSessionStatus = db.prepare(
  `UPDATE sessions SET status = @status, updatedAt = @updatedAt WHERE id = @id`
);
const updateSessionTitle = db.prepare(
  `UPDATE sessions SET title = @title WHERE id = @id`
);
const updateSessionTask = db.prepare(
  `UPDATE sessions SET task = @task WHERE id = @id`
);
const updateSessionArchived = db.prepare(
  `UPDATE sessions SET archivedAt = @archivedAt WHERE id = @id`
);
const updateSessionDescription = db.prepare(
  `UPDATE sessions SET description = @description WHERE id = @id`
);
const updateNativeSessionId = db.prepare(
  `UPDATE sessions SET nativeSessionId = @nativeSessionId WHERE id = @id`
);
const selectSessionByNativeId = db.prepare(
  `SELECT * FROM sessions WHERE nativeSessionId = ? ORDER BY updatedAt DESC LIMIT 1`
);
const touchSession = db.prepare(
  `UPDATE sessions SET updatedAt = @updatedAt WHERE id = @id`
);

export function createSession(input: {
  runtime: string;
  workPath: string;
  task: string;
  bindKey?: string | null;
  nativeSessionId?: string | null;
  origin?: 'agent' | 'human';
  name?: string | null;
  description?: string | null;
  // Whether the agent is admitted (a live contact) immediately. Defaults true.
  // The register path passes false when register_agent resolves to 'ask', so the
  // session lands quarantined in the admission tray until the owner approves.
  admitted?: boolean;
}): Session {
  const ts = now();
  const title = input.name && input.name.trim() ? input.name.trim() : null;
  const description = input.description && input.description.trim() ? input.description.trim() : null;
  const s: Session = {
    id: randomUUID(),
    runtime: input.runtime || 'unknown',
    workPath: input.workPath || '',
    task: input.task || '',
    status: 'registered',
    title,
    description,
    archivedAt: null,
    lastSeenAt: ts,
    bindKey: input.bindKey ?? null,
    nativeSessionId: input.nativeSessionId ?? null,
    origin: input.origin === 'human' ? 'human' : 'agent',
    guardianId: getOwner().id,
    trustTier: 'standard',
    admittedAt: input.admitted === false ? null : ts,
    createdAt: ts,
    updatedAt: ts,
  };
  insertSession.run(s);
  bus.emit('session', s);
  return s;
}

export function getSession(id: string): Session | undefined {
  const r = selectSession.get(id) as SessionRow | undefined;
  return r ? mapSession(r) : undefined;
}

export function getSessionByNativeId(nativeSessionId: string): Session | undefined {
  if (!nativeSessionId) return undefined;
  const r = selectSessionByNativeId.get(nativeSessionId) as SessionRow | undefined;
  return r ? mapSession(r) : undefined;
}

/**
 * Stamp the runtime's native session id, resolved objectively by the platform
 * (from on-disk transcripts), not self-reported by the agent. No-op when unchanged.
 */
export function setNativeSessionId(id: string, nativeSessionId: string | null): Session | undefined {
  const s = getSession(id);
  if (!s) return undefined;
  const clean = nativeSessionId && nativeSessionId.trim() ? nativeSessionId.trim() : null;
  if (clean === s.nativeSessionId) return s;
  updateNativeSessionId.run({ id, nativeSessionId: clean });
  const updated = getSession(id)!;
  bus.emit('session', updated);
  return updated;
}

export function listSessions(): Session[] {
  return (selectSessions.all() as SessionRow[]).map(mapSession);
}

// Sessions the human created via "launch" (and the platform spawned) but whose
// agent process hasn't attached yet. Keyed by normalized work path, with a TTL,
// so the FIRST registration arriving from that folder attaches to the waiting
// contact instead of opening a duplicate — regardless of transport (skill /
// stdio MCP attach via injected BEACON_SESSION_ID; hosted HTTP MCP attaches via
// this work-path claim, as long as it reports its work_path).
const pendingLaunch = new Map<string, { sessionId: string; ts: number }>();
const LAUNCH_CLAIM_TTL_MS = 10 * 60_000;

/** Mark a freshly-launched session as awaiting its agent's first registration. */
export function markPendingLaunch(sessionId: string): void {
  const s = getSession(sessionId);
  if (!s || !s.workPath) return;
  pendingLaunch.set(normWorkPath(s.workPath), { sessionId, ts: now() });
}

function takePendingLaunch(workPath: string): string | null {
  const key = normWorkPath(workPath);
  if (!key) return null;
  const pend = pendingLaunch.get(key);
  if (!pend) return null;
  pendingLaunch.delete(key);
  if (now() - pend.ts > LAUNCH_CLAIM_TTL_MS) return null;
  return pend.sessionId;
}

// Attach a registering agent to an EXISTING contact: bump presence, mark working,
// and refresh the card from anything the agent reported on (re)connect.
function continueSession(
  id: string,
  input: { task?: string; name?: string | null; description?: string | null },
  native: string | null,
): Session {
  const ts = now();
  updateSeen.run({ id, lastSeenAt: ts });
  updateSessionStatus.run({ id, status: 'working', updatedAt: ts });
  if (input.name != null && input.name.trim()) {
    updateSessionTitle.run({ id, title: input.name.trim() });
  }
  if (input.description != null && input.description.trim()) {
    updateSessionDescription.run({ id, description: input.description.trim() });
  }
  if (input.task != null && input.task.trim()) {
    updateSessionTask.run({ id, task: input.task.trim() });
  }
  if (native) updateNativeSessionId.run({ id, nativeSessionId: native });
  const continued = getSession(id)!;
  bus.emit('session', continued);
  return continued;
}

/**
 * The register "find-or-attach-or-create". Tries, in order:
 *   1. bindKey continuation (an agent resuming the exact context it asserted),
 *   2. native-session-id match (the same runtime conversation is already a
 *      contact — e.g. an imported session being resumed),
 *   3. a pending launched session in the same work dir,
 *   4. otherwise a fresh session.
 * `resolvedNativeId` is the platform-resolved on-disk id (preferred over any
 * self-reported one) and is used both to match (2) and to stamp the result.
 */
export function registerOrClaim(input: {
  runtime: string;
  workPath: string;
  task: string;
  bindKey?: string | null;
  nativeSessionId?: string | null;
  resolvedNativeId?: string | null;
  origin?: 'agent' | 'human';
  name?: string | null;
  description?: string | null;
}): Session {
  const native = input.resolvedNativeId ?? input.nativeSessionId ?? null;

  // 1. bindKey continuation
  const key = input.bindKey && input.bindKey.trim() ? input.bindKey : null;
  if (key) {
    const existing = selectSessionByBindKey.get(key) as SessionRow | undefined;
    if (existing) return continueSession(existing.id, input, native);
  }
  // 2. same runtime conversation already tracked as a contact
  if (native) {
    const ex = getSessionByNativeId(native);
    if (ex) return continueSession(ex.id, input, native);
  }
  // 3. a launched session waiting for its agent in this work dir
  const pendId = takePendingLaunch(input.workPath);
  if (pendId && getSession(pendId)) return continueSession(pendId, input, native);

  // 4. brand new — gate admission through the owner's register_agent policy.
  // 'allow' admits immediately; 'ask' quarantines and raises an owner approval;
  // 'deny' quarantines silently (owner can still admit or delete from the tray).
  // Either way nothing is admitted without the owner, and peers can't see or be
  // contacted by a quarantined agent until then.
  const admission = getSettings().permissions.register_agent;
  const created = createSession({
    ...input,
    nativeSessionId: native,
    admitted: admission === 'allow',
  });
  if (admission === 'ask') createAdmissionRequest(created.id);
  return created;
}

export function setStatus(id: string, status: string): Session | undefined {
  const s = getSession(id);
  if (!s) return undefined;
  if (!SESSION_STATUSES.includes(status as SessionStatus)) return s;
  updateSessionStatus.run({ id, status, updatedAt: now() });
  const updated = getSession(id)!;
  bus.emit('session', updated);
  return updated;
}

/**
 * Human-set display title for a conversation. Empty/blank reverts to the
 * agent's original task. Does not bump updatedAt (renaming shouldn't reorder).
 */
export function renameSession(id: string, title: string | null): Session | undefined {
  const s = getSession(id);
  if (!s) return undefined;
  const clean = title && title.trim() ? title.trim() : null;
  updateSessionTitle.run({ id, title: clean });
  const updated = getSession(id)!;
  bus.emit('session', updated);
  return updated;
}

/**
 * Human-set self-introduction for an agent. Empty/blank clears it. Does not bump
 * updatedAt (editing the bio shouldn't reorder the roster).
 */
export function setDescription(id: string, description: string | null): Session | undefined {
  const s = getSession(id);
  if (!s) return undefined;
  const clean = description && description.trim() ? description.trim() : null;
  updateSessionDescription.run({ id, description: clean });
  const updated = getSession(id)!;
  bus.emit('session', updated);
  return updated;
}

/**
 * Update the agent's own name and/or self-introduction. Each field is optional:
 * `undefined` leaves it untouched, `''`/null clears it. Used by the agent-facing
 * update_profile tool so an agent can revise its card at any time (not just at
 * register), and by the human PATCH path.
 */
export function updateProfile(
  id: string,
  patch: { name?: string | null; description?: string | null },
): Session | undefined {
  const s = getSession(id);
  if (!s) return undefined;
  if (patch.name !== undefined) {
    const clean = patch.name && patch.name.trim() ? patch.name.trim() : null;
    updateSessionTitle.run({ id, title: clean });
  }
  if (patch.description !== undefined) {
    const clean = patch.description && patch.description.trim() ? patch.description.trim() : null;
    updateSessionDescription.run({ id, description: clean });
  }
  const updated = getSession(id)!;
  bus.emit('session', updated);
  return updated;
}

/** Archive (hide from the active list) or restore a conversation. */
export function setArchived(id: string, archived: boolean): Session | undefined {
  const s = getSession(id);
  if (!s) return undefined;
  updateSessionArchived.run({ id, archivedAt: archived ? now() : null });
  const updated = getSession(id)!;
  bus.emit('session', updated);
  return updated;
}

/**
 * Retire an agent: remove it from every channel and archive it (hidden from the
 * active roster + channel rosters). The complement of spawn — lets a CEO agent
 * clean up a one-off worker that finished, instead of leaving it idle in the list
 * forever. Archive, not delete: history is kept. The caller stops the terminal
 * (killPty) since core can't touch the PTY.
 */
export function retireAgent(sessionId: string): Session | undefined {
  const s = getSession(sessionId);
  if (!s) return undefined;
  for (const c of channelsForSession(sessionId)) removeParticipant(c.id, sessionId);
  return setArchived(sessionId, true);
}

const deleteSessionRow = db.prepare(`DELETE FROM sessions WHERE id = ?`);
const deleteSessionMessages = db.prepare(
  `DELETE FROM messages WHERE sessionId = ? OR fromSessionId = ?`,
);
const deleteSessionAsks = db.prepare(`DELETE FROM asks WHERE sessionId = ?`);
const deleteSessionGrants = db.prepare(`DELETE FROM grants WHERE fromId = ? OR toId = ?`);
const deleteSessionContactRequests = db.prepare(
  `DELETE FROM contact_requests WHERE fromId = ? OR toId = ?`,
);

/**
 * Permanently remove a contact and everything attached to it: its messages
 * (incoming and the peer messages it sent), asks, authorization grants on either
 * side, and contact requests. Irreversible (unlike archive). Emits
 * 'sessionRemoved' so any connected client drops it live.
 */
export function deleteSession(id: string): boolean {
  const s = getSession(id);
  if (!s) return false;
  const tx = db.transaction(() => {
    deleteSessionMessages.run(id, id);
    deleteSessionAsks.run(id);
    deleteSessionGrants.run(id, id);
    deleteSessionContactRequests.run(id, id);
    deleteAgentPoliciesFor.run(id);
    deleteAdmissionsFor.run(id);
    deleteParticipantsForSession.run(id);
    deleteChannelStateForSession.run(id);
    deleteSessionRow.run(id);
  });
  tx();
  // Drop any pending-launch slot pointing at this session.
  if (s.workPath) {
    const key = normWorkPath(s.workPath);
    if (pendingLaunch.get(key)?.sessionId === id) pendingLaunch.delete(key);
  }
  bus.emit('sessionRemoved', id);
  return true;
}

// ---------- presence ----------
const updateSeen = db.prepare(`UPDATE sessions SET lastSeenAt = @lastSeenAt WHERE id = @id`);
const lastSeenEmit = new Map<string, number>();

/**
 * Mark that the agent just interacted with Beacon (any south API call). Drives
 * the online/offline presence indicator. WS re-broadcasts are throttled to at
 * most once per 10s per session so a chatty poller doesn't flood clients; the
 * UI also recomputes presence on its own clock, so a session that goes quiet
 * flips to offline without needing an event.
 */
export function touchSeen(id: string): void {
  const ts = now();
  updateSeen.run({ id, lastSeenAt: ts });
  const prev = lastSeenEmit.get(id) ?? 0;
  if (ts - prev > 10_000) {
    lastSeenEmit.set(id, ts);
    const s = getSession(id);
    if (s) bus.emit('session', s);
  }
}

// ---------- messages ----------
const insertMessage = db.prepare(
  `INSERT INTO messages (id, sessionId, direction, kind, text, fromSessionId, askId, meta, createdAt, deliveredAt)
   VALUES (@id, @sessionId, @direction, @kind, @text, @fromSessionId, @askId, @meta, @createdAt, @deliveredAt)`
);
const markMessageDelivered = db.prepare(
  `UPDATE messages SET deliveredAt = @deliveredAt WHERE id = @id AND deliveredAt IS NULL`
);
const selectMessageById = db.prepare(`SELECT * FROM messages WHERE id = ?`);
// 1:1 human chat to this agent that has NOT reached it yet (deliveredAt null).
// Used to replay missed messages when the agent's terminal (re)establishes or it
// reconnects — so a platform restart / idle gap can't silently drop a message.
const selectUndelivered = db.prepare(
  `SELECT * FROM messages
   WHERE sessionId = ? AND direction = 'human' AND kind = 'chat' AND deliveredAt IS NULL
   ORDER BY createdAt ASC`
);
// A session's full thread also includes peer messages it sent (matched by
// fromSessionId), so the sender can see its own outgoing agent->agent lines.
const selectMessages = db.prepare(
  `SELECT * FROM messages WHERE sessionId = ? OR fromSessionId = ? ORDER BY createdAt ASC`
);
// Inbox = human chat addressed to me, OR a peer message another agent sent me
// (kind 'peer' carried on my session with a non-null fromSessionId).
const selectInbox = db.prepare(
  `SELECT * FROM messages
   WHERE createdAt > ?
     AND (
       (sessionId = ? AND direction = 'human' AND kind = 'chat')
       OR (sessionId = ? AND kind = 'peer' AND fromSessionId IS NOT NULL)
     )
   ORDER BY createdAt ASC`
);

export function addMessage(input: {
  sessionId: string;
  direction: MsgDirection;
  kind: MsgKind;
  text: string;
  fromSessionId?: string | null;
  askId?: string | null;
  meta?: Record<string, unknown> | null;
}): Message {
  const m: Message = {
    id: randomUUID(),
    sessionId: input.sessionId,
    direction: input.direction,
    kind: input.kind,
    text: input.text,
    fromSessionId: input.fromSessionId ?? null,
    askId: input.askId ?? null,
    meta: input.meta ?? null,
    createdAt: now(),
    deliveredAt: null,
  };
  insertMessage.run({
    ...m,
    meta: m.meta ? JSON.stringify(m.meta) : null,
  });
  touchSession.run({ id: input.sessionId, updatedAt: m.createdAt });
  bus.emit('message', m);
  return m;
}

export function messages(sessionId: string): Message[] {
  return (selectMessages.all(sessionId, sessionId) as MessageRow[]).map(mapMessage);
}

/** Human chat messages newer than `afterTs` — for an agent's check_inbox poll.
 *  Marks returned messages as delivered (first read) and pushes WS events. */
export function inbox(sessionId: string, afterTs: number): Message[] {
  const msgs = (selectInbox.all(afterTs, sessionId, sessionId) as MessageRow[]).map(mapMessage);
  const ts = now();
  for (const m of msgs) {
    if (m.deliveredAt == null) {
      markMessageDelivered.run({ id: m.id, deliveredAt: ts });
      m.deliveredAt = ts;
      bus.emit('message', m);
    }
  }
  return msgs;
}

/** Mark one message reached the agent (pushed to its terminal). Idempotent; emits
 *  the updated row so the human UI shows the delivery receipt. */
export function markDelivered(messageId: string): void {
  const r = selectMessageById.get(messageId) as MessageRow | undefined;
  if (!r || r.deliveredAt != null) return;
  const ts = now();
  markMessageDelivered.run({ id: messageId, deliveredAt: ts });
  bus.emit('message', mapMessage({ ...r, deliveredAt: ts }));
}

/** 1:1 human messages this agent has not yet received (deliveredAt null), oldest
 *  first — replayed into its terminal when it (re)connects so a restart or idle
 *  gap never silently drops a message. */
export function undeliveredFor(sessionId: string): Message[] {
  return (selectUndelivered.all(sessionId) as MessageRow[]).map(mapMessage);
}

// ---------- asks (blocking questions) ----------
const insertAsk = db.prepare(
  `INSERT INTO asks (id, sessionId, question, options, status, answer, createdAt, answeredAt)
   VALUES (@id, @sessionId, @question, @options, @status, @answer, @createdAt, @answeredAt)`
);
const selectAsk = db.prepare(`SELECT * FROM asks WHERE id = ?`);
const updateAskAnswer = db.prepare(
  `UPDATE asks SET status = 'answered', answer = @answer, answeredAt = @answeredAt WHERE id = @id`
);
const updateAskCancel = db.prepare(
  `UPDATE asks SET status = 'cancelled', answeredAt = @answeredAt WHERE id = @id`
);

export function createAsk(input: {
  sessionId: string;
  question: string;
  options: string[] | null;
}): Ask {
  const ask: Ask = {
    id: randomUUID(),
    sessionId: input.sessionId,
    question: input.question,
    options: input.options,
    status: 'pending',
    answer: null,
    createdAt: now(),
    answeredAt: null,
  };
  insertAsk.run({
    ...ask,
    options: ask.options ? JSON.stringify(ask.options) : null,
  });
  // Surface the question as a message in the thread and flip status to waiting.
  addMessage({
    sessionId: input.sessionId,
    direction: 'agent',
    kind: 'ask',
    text: input.question,
    askId: ask.id,
    meta: input.options ? { options: input.options } : null,
  });
  setStatus(input.sessionId, 'waiting');
  return ask;
}

export function getAsk(id: string): Ask | undefined {
  const r = selectAsk.get(id) as AskRow | undefined;
  return r ? mapAsk(r) : undefined;
}

// ---------- ask waiters (blocking long-poll support) ----------
const askWaiters = new Map<string, Set<(a: Ask) => void>>();

function flushWaiters(ask: Ask) {
  const set = askWaiters.get(ask.id);
  if (!set) return;
  for (const fn of set) fn(ask);
  askWaiters.delete(ask.id);
}

/**
 * Resolves when the ask leaves 'pending', or with the still-pending ask when
 * `timeoutMs` elapses (caller re-polls). This lets the MCP `ask_human` tool
 * block cheaply without holding a socket open indefinitely.
 */
export function waitForAsk(askId: string, timeoutMs: number): Promise<Ask> {
  const current = getAsk(askId);
  if (!current) return Promise.reject(new Error('ask not found'));
  if (current.status !== 'pending') return Promise.resolve(current);
  return new Promise<Ask>((resolve) => {
    const fn = (a: Ask) => {
      clearTimeout(timer);
      resolve(a);
    };
    const timer = setTimeout(() => {
      askWaiters.get(askId)?.delete(fn);
      resolve(getAsk(askId)!);
    }, timeoutMs);
    let set = askWaiters.get(askId);
    if (!set) {
      set = new Set();
      askWaiters.set(askId, set);
    }
    set.add(fn);
  });
}

// ---------- human reply ----------
/**
 * Human -> agent. If `askId` is given and that ask is pending, this resolves it
 * (unblocking the agent) and flips the session back to 'working'. Otherwise it
 * is free-form chat the agent can pick up via check_inbox.
 */
export function reply(
  sessionId: string,
  text: string,
  askId?: string | null,
  meta?: Record<string, unknown> | null,
): Message {
  const ask = askId ? getAsk(askId) : undefined;
  const isAnswer = !!(ask && ask.status === 'pending');
  const msg = addMessage({
    sessionId,
    direction: 'human',
    kind: isAnswer ? 'answer' : 'chat',
    text,
    askId: isAnswer ? askId : null,
    meta: meta ?? null,
  });
  if (isAnswer) {
    updateAskAnswer.run({ id: askId, answer: text, answeredAt: now() });
    // If this ask backs an agent-initiated contact request, record the decision
    // and mint the allow grant before unblocking the requester.
    settleContactRequestForAsk(askId!, text);
    // If it backs an admission request, admit or remove the quarantined agent.
    settleAdmissionForAsk(askId!, text);
    const session = getSession(sessionId);
    if (session && session.status === 'waiting') setStatus(sessionId, 'working');
    flushWaiters(getAsk(askId!)!);
  }
  return msg;
}

export function cancelAsk(askId: string): Ask | undefined {
  const ask = getAsk(askId);
  if (!ask || ask.status !== 'pending') return ask;
  updateAskCancel.run({ id: askId, answeredAt: now() });
  const cancelled = getAsk(askId)!;
  flushWaiters(cancelled);
  return cancelled;
}

// ---------- agent -> agent (peer) ----------
// Peer messaging reuses the existing message log + ask/waiter/long-poll infra.
// A peer message is one row carried on the *recipient's* thread, with
// fromSessionId pointing back at the sender (so the sender's thread includes it
// via messages()'s `OR fromSessionId = ?`).

/**
 * Non-blocking agent->agent FYI. Both sessions must exist (else throws, gateway
 * maps to 404). Returns the message (addMessage already emits + touches toId).
 */
export function peerNotify(fromId: string, toId: string, text: string): ChannelMessage {
  if (!getSession(fromId)) throw new Error('session not found');
  if (!getSession(toId)) throw new Error('session not found');
  // Agent<->agent is a supervised 3-party exchange, so it lives in the pair
  // channel (guardian present) rather than muddled into each agent's 1:1 DM.
  // Directed at the recipient so it is still clearly "for them" in the group.
  const ch = ensurePairChannel(fromId, toId);
  return postChannelMessage(ch.id, fromId, text, { toSessionId: toId });
}

/**
 * Blocking agent->agent question, in the pair channel and directed at the
 * recipient. Reuses the channel-ask machinery, so the asker blocks/long-polls on
 * the returned ask exactly as before (createChannelAsk inserts the ask with
 * sessionId=asker, sets it waiting, and flushWaiters unblocks it on answer). The
 * exchange surfaces as a supervised 3-party group, not in either agent's DM.
 */
export function peerAsk(
  fromId: string,
  toId: string,
  question: string,
  options: string[] | null
): { ask: Ask; message: ChannelMessage } {
  if (!getSession(fromId)) throw new Error('session not found');
  if (!getSession(toId)) throw new Error('session not found');
  const ch = ensurePairChannel(fromId, toId);
  return createChannelAsk(ch.id, fromId, question, options, toId);
}

/**
 * The recipient answers a peer-ask, unblocking the asker's long-poll. The peer
 * ask now lives as a channel ask in the pair channel, so route the answer there
 * (answerChannelAsk resolves the ask, posts the answer, and flushWaiters unblocks
 * the asker). Returns the posted channel message (for fan-out), or undefined when
 * the ask can't be located.
 */
export function agentAnswer(
  askId: string,
  text: string,
  fromId?: string | null
): ChannelMessage | undefined {
  const channelId = getChannelIdForAsk(askId);
  if (!channelId) return undefined;
  return answerChannelAsk(channelId, askId, fromId ?? null, text);
}

// ---------- grants (per-pair authorization) ----------
// A grant is an explicit allow/deny on a single (fromId -> toId) edge. It
// overrides the sender's trust tier in resolvePeerPermission. At most one grant
// per pair: setGrant updates an existing row rather than inserting a duplicate.
const insertGrant = db.prepare(
  `INSERT INTO grants (id, fromId, toId, effect, createdAt)
   VALUES (@id, @fromId, @toId, @effect, @createdAt)`
);
const updateGrantEffect = db.prepare(
  `UPDATE grants SET effect = @effect WHERE id = @id`
);
const deleteGrant = db.prepare(`DELETE FROM grants WHERE id = ?`);
const selectGrants = db.prepare(`SELECT * FROM grants ORDER BY createdAt ASC`);
const selectGrantByPair = db.prepare(
  `SELECT * FROM grants WHERE fromId = ? AND toId = ? LIMIT 1`
);

/** Upsert the grant for a pair: update its effect if one exists, else insert. */
export function setGrant(fromId: string, toId: string, effect: GrantEffect): Grant {
  const existing = selectGrantByPair.get(fromId, toId) as Grant | undefined;
  if (existing) {
    updateGrantEffect.run({ id: existing.id, effect });
    return { ...existing, effect };
  }
  const grant: Grant = {
    id: randomUUID(),
    fromId,
    toId,
    effect,
    createdAt: now(),
  };
  insertGrant.run(grant);
  return grant;
}

export function removeGrant(id: string): void {
  deleteGrant.run(id);
}

/**
 * Authorize two agents to contact each other (both directions). Used when a
 * spawner brings a child agent online: the guardian already approved the spawn,
 * so the spawner may directly message — and group into channels — the agent it
 * created, without an extra contact approval round-trip.
 */
export function grantMutualContact(a: string, b: string): void {
  if (a === b) return;
  setGrant(a, b, 'allow');
  setGrant(b, a, 'allow');
}

export function listGrants(): Grant[] {
  return selectGrants.all() as Grant[];
}

export function getGrantForPair(fromId: string, toId: string): Grant | undefined {
  return selectGrantByPair.get(fromId, toId) as Grant | undefined;
}

// ---------- contact requests (agent-initiated, guardian-approved) ----------
const insertCR = db.prepare(
  `INSERT INTO contact_requests (id, fromId, toId, askId, reason, status, createdAt, decidedAt)
   VALUES (@id, @fromId, @toId, @askId, @reason, @status, @createdAt, @decidedAt)`
);
const selectCRByAsk = db.prepare(`SELECT * FROM contact_requests WHERE askId = ?`);
const selectPendingCRByPair = db.prepare(
  `SELECT * FROM contact_requests WHERE fromId = ? AND toId = ? AND status = 'pending' LIMIT 1`
);
const selectCRs = db.prepare(`SELECT * FROM contact_requests ORDER BY createdAt DESC`);
const updateCRDecision = db.prepare(
  `UPDATE contact_requests SET status = @status, decidedAt = @decidedAt WHERE id = @id`
);

const CONTACT_APPROVE = 'approve';
const CONTACT_DENY = 'deny';

/**
 * Agent-initiated request to contact `toId`. Surfaces to the guardian as an Ask
 * on the requester's own thread (options approve/deny); the requester goes
 * 'waiting' until the human answers. Idempotent per pending pair. The Ask's
 * question/options are stable ASCII tokens — the UI renders a localized card off
 * the message's `contactRequest` meta. Returns the request (with its askId).
 */
export function createContactRequest(
  fromId: string,
  toId: string,
  reason: string | null,
): ContactRequest {
  const from = getSession(fromId);
  const to = getSession(toId);
  if (!from || !to) throw new Error('session not found');
  const existing = selectPendingCRByPair.get(fromId, toId) as ContactRequest | undefined;
  if (existing) return existing;

  const askId = randomUUID();
  const ask: Ask = {
    id: askId,
    sessionId: fromId,
    question: `${from.title ?? from.task} -> ${to.title ?? to.task}`,
    options: [CONTACT_APPROVE, CONTACT_DENY],
    status: 'pending',
    answer: null,
    createdAt: now(),
    answeredAt: null,
  };
  insertAsk.run({ ...ask, options: JSON.stringify(ask.options) });
  addMessage({
    sessionId: fromId,
    direction: 'agent',
    kind: 'ask',
    text: ask.question,
    askId,
    meta: { options: ask.options, contactRequest: { fromId, toId, reason } },
  });

  const cr: ContactRequest = {
    id: randomUUID(),
    fromId,
    toId,
    askId,
    reason,
    status: 'pending',
    createdAt: now(),
    decidedAt: null,
  };
  insertCR.run(cr);
  setStatus(fromId, 'waiting'); // blocked on the guardian's decision
  return cr;
}

export function listContactRequests(): ContactRequest[] {
  return selectCRs.all() as ContactRequest[];
}

// Called from reply() when a guardian answers an Ask that backs a contact
// request: record the decision and, on approval, mint the allow Grant.
function settleContactRequestForAsk(askId: string, answerText: string): void {
  const cr = selectCRByAsk.get(askId) as ContactRequest | undefined;
  if (!cr || cr.status !== 'pending') return;
  const approved = answerText.trim() === CONTACT_APPROVE;
  updateCRDecision.run({
    id: cr.id,
    status: approved ? 'approved' : 'denied',
    decidedAt: now(),
  });
  if (approved) setGrant(cr.fromId, cr.toId, 'allow');
}

// ---------- agent policies (per-agent capability overrides) ----------
// An override pins one capability for one agent to allow/ask/deny, beating the
// trust-tier preset and the owner global default. Most specific after a per-pair
// grant. Upserted by capability; clearing removes the row (back to tier/global).
const upsertAgentPolicy = db.prepare(
  `INSERT INTO agent_policies (agentId, capability, effect) VALUES (@agentId, @capability, @effect)
   ON CONFLICT(agentId, capability) DO UPDATE SET effect = @effect`,
);
const deleteAgentPolicy = db.prepare(
  `DELETE FROM agent_policies WHERE agentId = ? AND capability = ?`,
);
const deleteAgentPoliciesFor = db.prepare(`DELETE FROM agent_policies WHERE agentId = ?`);
const selectAgentPolicy = db.prepare(
  `SELECT effect FROM agent_policies WHERE agentId = ? AND capability = ?`,
);
const selectAgentPoliciesFor = db.prepare(
  `SELECT capability, effect FROM agent_policies WHERE agentId = ?`,
);

/** Read one agent's override for a capability, or null if none. */
export function getAgentPolicy(agentId: string, capability: Capability): Effect | null {
  const r = selectAgentPolicy.get(agentId, capability) as { effect: string } | undefined;
  return r && isEffect(r.effect) ? r.effect : null;
}

/** All overrides set on one agent, as a capability->effect map. */
export function getAgentPolicies(agentId: string): Partial<Record<Capability, Effect>> {
  const rows = selectAgentPoliciesFor.all(agentId) as { capability: string; effect: string }[];
  const out: Partial<Record<Capability, Effect>> = {};
  for (const r of rows) {
    if (isCapability(r.capability) && isEffect(r.effect)) out[r.capability] = r.effect;
  }
  return out;
}

/**
 * Set or clear one agent's capability override. `effect === null` clears it
 * (falling back to the tier preset / global default). Emits a session event so
 * connected clients refresh the agent's permission view.
 */
export function setAgentPolicy(
  agentId: string,
  capability: Capability,
  effect: Effect | null,
): Session | undefined {
  const s = getSession(agentId);
  if (!s) return undefined;
  if (effect === null) deleteAgentPolicy.run(agentId, capability);
  else upsertAgentPolicy.run({ agentId, capability, effect });
  bus.emit('session', s);
  return s;
}

// ---------- admission (register_agent gate) ----------
const updateAdmitted = db.prepare(
  `UPDATE sessions SET admittedAt = @admittedAt, updatedAt = @updatedAt WHERE id = @id`,
);
const insertAdmission = db.prepare(
  `INSERT INTO admission_requests (id, agentId, askId, status, createdAt, decidedAt)
   VALUES (@id, @agentId, @askId, @status, @createdAt, @decidedAt)`,
);
const selectAdmissionByAsk = db.prepare(
  `SELECT * FROM admission_requests WHERE askId = ?`,
);
const selectPendingAdmissionForAgent = db.prepare(
  `SELECT * FROM admission_requests WHERE agentId = ? AND status = 'pending' LIMIT 1`,
);
const updateAdmissionDecision = db.prepare(
  `UPDATE admission_requests SET status = @status, decidedAt = @decidedAt WHERE id = @id`,
);
const deleteAdmissionsFor = db.prepare(`DELETE FROM admission_requests WHERE agentId = ?`);

interface AdmissionRow {
  id: string;
  agentId: string;
  askId: string;
  status: 'pending' | 'approved' | 'denied';
  createdAt: number;
  decidedAt: number | null;
}

const ADMIT_APPROVE = 'approve';
const ADMIT_DENY = 'deny';

/** Mark an agent admitted (a live contact). No-op if already admitted. */
export function admitSession(id: string): Session | undefined {
  const s = getSession(id);
  if (!s) return undefined;
  if (s.admittedAt == null) {
    const ts = now();
    updateAdmitted.run({ id, admittedAt: ts, updatedAt: ts });
  }
  const pend = selectPendingAdmissionForAgent.get(id) as AdmissionRow | undefined;
  if (pend) updateAdmissionDecision.run({ id: pend.id, status: 'approved', decidedAt: now() });
  const updated = getSession(id)!;
  bus.emit('session', updated);
  return updated;
}

/** Sessions awaiting the owner's admission decision (quarantined). */
export function listPendingAdmissions(): Session[] {
  return listSessions().filter((s) => s.admittedAt == null);
}

/** True once the owner has admitted this agent as a live contact. */
export function isAdmitted(id: string): boolean {
  const s = getSession(id);
  return !!s && s.admittedAt != null;
}

/**
 * Raise an owner-facing admission approval for a freshly-registered agent. The
 * ask lands on the agent's own thread (options approve/deny) with a meta card so
 * the UI renders a localized "admit this agent?" prompt. Idempotent per agent.
 */
export function createAdmissionRequest(agentId: string): void {
  const agent = getSession(agentId);
  if (!agent) return;
  if (selectPendingAdmissionForAgent.get(agentId)) return; // already pending
  const askId = randomUUID();
  const ask: Ask = {
    id: askId,
    sessionId: agentId,
    question: agent.title ?? agent.task ?? agentId,
    options: [ADMIT_APPROVE, ADMIT_DENY],
    status: 'pending',
    answer: null,
    createdAt: now(),
    answeredAt: null,
  };
  insertAsk.run({ ...ask, options: JSON.stringify(ask.options) });
  addMessage({
    sessionId: agentId,
    direction: 'agent',
    kind: 'ask',
    text: ask.question,
    askId,
    meta: { options: ask.options, admissionRequest: { agentId } },
  });
  insertAdmission.run({
    id: randomUUID(),
    agentId,
    askId,
    status: 'pending',
    createdAt: now(),
    decidedAt: null,
  });
}

// Called from reply() when the owner answers an admission ask: approve -> admit;
// deny -> remove the quarantined agent entirely.
function settleAdmissionForAsk(askId: string, answerText: string): void {
  const req = selectAdmissionByAsk.get(askId) as AdmissionRow | undefined;
  if (!req || req.status !== 'pending') return;
  if (answerText.trim() === ADMIT_APPROVE) {
    admitSession(req.agentId);
  } else {
    updateAdmissionDecision.run({ id: req.id, status: 'denied', decidedAt: now() });
    deleteSession(req.agentId);
  }
}

// ---------- spawn requests (spawn_agent gate, owner-approved) ----------
// An agent asking to launch a new agent when spawn_agent resolves to 'ask'. The
// approval surfaces as an owner ask; the LAUNCH side effect lives in the server
// (it owns the PTY), so core only tracks the request and its decision. The
// server performs the spawn when the owner approves.
export interface SpawnParams {
  workPath: string;
  runtime: string;
  name?: string | null;
  task?: string | null;
  // Optional channel the new agent should auto-join on launch (the spawner must
  // be a member of it). Persisted so an approved-later spawn still joins.
  channelId?: string | null;
  // Optional permission mode + pre-approved / denied tools, persisted so an
  // approved-later spawn launches with the same flags the spawner requested.
  permissionMode?: string | null;
  allowedTools?: string[] | null;
  disallowedTools?: string[] | null;
}
interface SpawnRow {
  id: string;
  spawnerId: string;
  askId: string;
  params: string;
  status: 'pending' | 'approved' | 'denied';
  createdAt: number;
  decidedAt: number | null;
}
const insertSpawn = db.prepare(
  `INSERT INTO spawn_requests (id, spawnerId, askId, params, status, createdAt, decidedAt)
   VALUES (@id, @spawnerId, @askId, @params, @status, @createdAt, @decidedAt)`,
);
const selectSpawnByAsk = db.prepare(`SELECT * FROM spawn_requests WHERE askId = ?`);
const selectPendingSpawns = db.prepare(
  `SELECT * FROM spawn_requests WHERE status = 'pending' ORDER BY createdAt DESC`,
);
const updateSpawnDecision = db.prepare(
  `UPDATE spawn_requests SET status = @status, decidedAt = @decidedAt WHERE id = @id`,
);

const SPAWN_APPROVE = 'approve';

export interface SpawnRequest {
  id: string;
  spawnerId: string;
  askId: string;
  params: SpawnParams;
  status: 'pending' | 'approved' | 'denied';
  createdAt: number;
  decidedAt: number | null;
}

function mapSpawn(r: SpawnRow): SpawnRequest {
  return { ...r, params: JSON.parse(r.params) as SpawnParams };
}

/**
 * Record an agent's request to spawn a new agent and raise the owner approval.
 * The ask lands on the spawner's own thread (options approve/deny) with a meta
 * card carrying the requested params. Returns the askId to long-poll/observe.
 */
export function createSpawnRequest(spawnerId: string, params: SpawnParams): string {
  const askId = randomUUID();
  const ask: Ask = {
    id: askId,
    sessionId: spawnerId,
    question: params.name?.trim() || params.task?.trim() || params.workPath,
    options: [SPAWN_APPROVE, ADMIT_DENY],
    status: 'pending',
    answer: null,
    createdAt: now(),
    answeredAt: null,
  };
  insertAsk.run({ ...ask, options: JSON.stringify(ask.options) });
  addMessage({
    sessionId: spawnerId,
    direction: 'agent',
    kind: 'ask',
    text: ask.question,
    askId,
    meta: { options: ask.options, spawnRequest: { spawnerId, ...params } },
  });
  insertSpawn.run({
    id: randomUUID(),
    spawnerId,
    askId,
    params: JSON.stringify(params),
    status: 'pending',
    createdAt: now(),
    decidedAt: null,
  });
  return askId;
}

export function getSpawnRequestByAsk(askId: string): SpawnRequest | undefined {
  const r = selectSpawnByAsk.get(askId) as SpawnRow | undefined;
  return r ? mapSpawn(r) : undefined;
}

export function listPendingSpawnRequests(): SpawnRequest[] {
  return (selectPendingSpawns.all() as SpawnRow[]).map(mapSpawn);
}

/** Mark a spawn request approved/denied. The server calls this after launching. */
export function decideSpawnRequest(askId: string, approve: boolean): void {
  const r = selectSpawnByAsk.get(askId) as SpawnRow | undefined;
  if (!r || r.status !== 'pending') return;
  updateSpawnDecision.run({
    id: r.id,
    status: approve ? 'approved' : 'denied',
    decidedAt: now(),
  });
}

// ---------- capability resolution ----------
/**
 * The owner-controlled answer to "may this agent do X?". Pure, no side effects.
 * Returns allow / ask / deny. Layered most-specific-first:
 *   0. acting agent not admitted (and not asking to register) -> deny.
 *   1. contact_agent: per-pair grant, then the visible-scope rule (see below).
 *   2. per-agent override.
 *   3. owner global default.
 * For contact_agent, an in-scope target (same work directory) uses the
 * override/global effect, while an out-of-scope target is denied unless an
 * explicit per-pair grant (or override) opens that edge.
 */
export function resolveCapability(
  agentId: string,
  capability: Capability,
  targetId?: string | null,
): Effect {
  const agent = getSession(agentId);
  if (!agent) return 'deny';
  // A quarantined agent can do nothing until admitted.
  if (agent.admittedAt == null) return 'deny';

  const override = getAgentPolicy(agentId, capability);
  const globalDefault = getSettings().permissions[capability] ?? 'ask';

  if (capability === 'contact_agent') {
    if (getSettings().agentComm === 'off') return 'deny'; // master kill switch
    if (targetId) {
      const grant = getGrantForPair(agentId, targetId); // most specific edge
      if (grant) return grant.effect; // allow | deny
      const to = getSession(targetId);
      if (!to || to.admittedAt == null) return 'deny';
      // Out-of-scope targets need an explicit grant or override; deny otherwise.
      if (!override && !isVisibleScope(agent.workPath, to.workPath)) return 'deny';
    }
  }

  return resolveEffect({ agentOverride: override, globalDefault });
}

// Normalize a work path for scope comparison: unify slashes, drop trailing
// slash, lowercase (paths are case-insensitive on Windows; harmless elsewhere).
function normWorkPath(p: string): string {
  return (p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/**
 * Default visibility scope: two agents see each other when they share a working
 * directory — identical path, or one nested under the other. Empty paths never
 * match (an agent with no workPath has no default peers). workPath is a
 * discovery attribute here, never an identity key.
 */
export function isVisibleScope(aPath: string, bPath: string): boolean {
  const a = normWorkPath(aPath);
  const b = normWorkPath(bPath);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.startsWith(b + '/') || b.startsWith(a + '/');
}

/**
 * The agents `sessionId` may discover (its address book): those in its default
 * visible scope (same working directory) plus any it holds an explicit
 * allow-grant toward. Excludes itself and archived contacts.
 */
export function visibleAgentsFor(sessionId: string): Session[] {
  const self = getSession(sessionId);
  if (!self) return [];
  const granted = new Set(
    listGrants()
      .filter((g) => g.fromId === sessionId && g.effect === 'allow')
      .map((g) => g.toId),
  );
  return listSessions().filter(
    (s) =>
      s.id !== sessionId &&
      s.archivedAt == null &&
      s.admittedAt != null && // quarantined agents are invisible to peers
      (isVisibleScope(self.workPath, s.workPath) || granted.has(s.id)),
  );
}

/**
 * Decide whether `fromId` may initiate peer messaging to `toId`. Thin adapter
 * over resolveCapability('contact_agent'): the contact subsystem speaks
 * 'approval' where the generic resolver says 'ask'. Outcomes:
 *   - 'allow'    : deliver directly.
 *   - 'deny'     : refuse.
 *   - 'approval' : eligible but not yet authorized — the caller should raise a
 *                  guardian approval (agent-initiated contact request).
 */
export function resolvePeerPermission(
  fromId: string,
  toId: string,
): 'allow' | 'deny' | 'approval' {
  const effect = resolveCapability(fromId, 'contact_agent', toId);
  return effect === 'ask' ? 'approval' : effect;
}

// ---------- channels (group messaging) ----------
// A channel fans a message out to all its participants. The human (owner) is
// implicitly in every channel; agents are explicit participants. v1 is broadcast
// chat: anyone in the channel posts, everyone sees. The human reads the channel
// thread directly; agents pick messages up via check_inbox (channelInbox).
const insertChannel = db.prepare(
  `INSERT INTO channels (id, name, createdAt) VALUES (@id, @name, @createdAt)`,
);
const selectChannels = db.prepare(`SELECT * FROM channels ORDER BY createdAt ASC`);
const selectChannel = db.prepare(`SELECT * FROM channels WHERE id = ?`);
const updateChannelName = db.prepare(`UPDATE channels SET name = @name WHERE id = @id`);
const deleteChannelRow = db.prepare(`DELETE FROM channels WHERE id = ?`);
const insertParticipant = db.prepare(
  `INSERT OR IGNORE INTO channel_participants (channelId, sessionId, createdAt)
   VALUES (@channelId, @sessionId, @createdAt)`,
);
const deleteParticipant = db.prepare(
  `DELETE FROM channel_participants WHERE channelId = ? AND sessionId = ?`,
);
const selectParticipants = db.prepare(
  `SELECT sessionId FROM channel_participants WHERE channelId = ? ORDER BY createdAt ASC`,
);
const selectChannelsForSession = db.prepare(
  `SELECT channelId FROM channel_participants WHERE sessionId = ?`,
);
const isParticipantStmt = db.prepare(
  `SELECT 1 FROM channel_participants WHERE channelId = ? AND sessionId = ? LIMIT 1`,
);
const deleteParticipantsForChannel = db.prepare(
  `DELETE FROM channel_participants WHERE channelId = ?`,
);
const deleteParticipantsForSession = db.prepare(
  `DELETE FROM channel_participants WHERE sessionId = ?`,
);
const insertChannelMessage = db.prepare(
  `INSERT INTO channel_messages (id, channelId, fromSessionId, text, kind, askId, toSessionId, createdAt)
   VALUES (@id, @channelId, @fromSessionId, @text, @kind, @askId, @toSessionId, @createdAt)`,
);
const selectChannelMessages = db.prepare(
  `SELECT * FROM channel_messages WHERE channelId = ? ORDER BY createdAt ASC`,
);
const deleteChannelMessages = db.prepare(
  `DELETE FROM channel_messages WHERE channelId = ?`,
);
const upsertChannelDelivered = db.prepare(
  `INSERT INTO channel_member_state (channelId, sessionId, deliveredAt, readAt)
   VALUES (@channelId, @sessionId, @at, NULL)
   ON CONFLICT(channelId, sessionId) DO UPDATE SET
     deliveredAt = MAX(COALESCE(deliveredAt, 0), @at)`,
);
const upsertChannelRead = db.prepare(
  `INSERT INTO channel_member_state (channelId, sessionId, deliveredAt, readAt)
   VALUES (@channelId, @sessionId, @at, @at)
   ON CONFLICT(channelId, sessionId) DO UPDATE SET
     deliveredAt = MAX(COALESCE(deliveredAt, 0), @at),
     readAt = MAX(COALESCE(readAt, 0), @at)`,
);
const selectChannelMemberState = db.prepare(
  `SELECT sessionId, deliveredAt, readAt FROM channel_member_state WHERE channelId = ?`,
);
const deleteChannelStateForChannel = db.prepare(
  `DELETE FROM channel_member_state WHERE channelId = ?`,
);
const deleteChannelStateForSession = db.prepare(
  `DELETE FROM channel_member_state WHERE sessionId = ?`,
);
const deleteChannelStatePair = db.prepare(
  `DELETE FROM channel_member_state WHERE channelId = ? AND sessionId = ?`,
);

export function createChannel(name: string): Channel {
  const c: Channel = { id: randomUUID(), name: name.trim() || 'channel', createdAt: now() };
  insertChannel.run(c);
  bus.emit('channel', c);
  return c;
}

export function listChannels(): Channel[] {
  return selectChannels.all() as Channel[];
}

export function getChannel(id: string): Channel | undefined {
  return selectChannel.get(id) as Channel | undefined;
}

export function renameChannel(id: string, name: string): Channel | undefined {
  const c = getChannel(id);
  if (!c) return undefined;
  updateChannelName.run({ id, name: name.trim() || c.name });
  const updated = getChannel(id)!;
  bus.emit('channel', updated);
  return updated;
}

export function deleteChannel(id: string): boolean {
  const c = getChannel(id);
  if (!c) return false;
  const tx = db.transaction(() => {
    deleteChannelMessages.run(id);
    deleteParticipantsForChannel.run(id);
    deleteChannelStateForChannel.run(id);
    deleteChannelRow.run(id);
  });
  tx();
  bus.emit('channelRemoved', id);
  return true;
}

/** Add an agent (session) to a channel. Idempotent. */
export function addParticipant(channelId: string, sessionId: string): Channel | undefined {
  const c = getChannel(channelId);
  if (!c || !getSession(sessionId)) return undefined;
  insertParticipant.run({ channelId, sessionId, createdAt: now() });
  bus.emit('channel', c);
  return c;
}

export function removeParticipant(channelId: string, sessionId: string): Channel | undefined {
  const c = getChannel(channelId);
  if (!c) return undefined;
  deleteParticipant.run(channelId, sessionId);
  deleteChannelStatePair.run(channelId, sessionId);
  bus.emit('channel', c);
  return c;
}

/** The agent session ids in a channel (the human/owner is implicit, not listed). */
export function listParticipants(channelId: string): string[] {
  return (selectParticipants.all(channelId) as { sessionId: string }[]).map((r) => r.sessionId);
}

export function isParticipant(channelId: string, sessionId: string): boolean {
  return !!isParticipantStmt.get(channelId, sessionId);
}

/** Channels an agent belongs to. */
export function channelsForSession(sessionId: string): Channel[] {
  const ids = (selectChannelsForSession.all(sessionId) as { channelId: string }[]).map(
    (r) => r.channelId,
  );
  return ids.map((id) => getChannel(id)).filter((c): c is Channel => !!c);
}

/**
 * The pair channel for two agents: the channel whose agent participants are
 * EXACTLY those two. Agent<->agent is a supervised 3-party exchange (the two
 * agents + the guardian, who is present in every channel), so it belongs in a
 * group, not muddled into either agent's 1:1 DM. Found by exact participant set,
 * else created (named after the two agents). Reused for all their later traffic.
 */
export function ensurePairChannel(a: string, b: string): Channel {
  for (const c of channelsForSession(a)) {
    const parts = listParticipants(c.id);
    if (parts.length === 2 && parts.includes(a) && parts.includes(b)) return c;
  }
  const label = (s: ReturnType<typeof getSession>, id: string) =>
    (s?.title || s?.task || id.slice(0, 6)).trim() || id.slice(0, 6);
  const ch = createChannel(`${label(getSession(a), a)} & ${label(getSession(b), b)}`);
  addParticipant(ch.id, a);
  addParticipant(ch.id, b);
  return ch;
}

const selectChannelIdForAsk = db.prepare(
  `SELECT channelId FROM channel_messages WHERE askId = ? AND kind = 'ask' LIMIT 1`,
);
/** The channel a channel-ask was posted in, so its answer can be routed there. */
function getChannelIdForAsk(askId: string): string | null {
  const r = selectChannelIdForAsk.get(askId) as { channelId: string } | undefined;
  return r?.channelId ?? null;
}

/**
 * An agent adds another agent to a channel it belongs to. Membership lets the
 * target be broadcast at, so it is gated by the SAME contact authorization as
 * direct peer messaging: the actor must be a participant of the channel and be
 * ALLOW-authorized to contact the target. This keeps the invariant that you
 * cannot pull a stranger agent into a group to message it. The human owner is
 * always present in every channel, so the addition stays supervised. Idempotent.
 */
export function addAgentToChannel(
  actorId: string,
  channelId: string,
  targetId: string,
): { ok: true } | { ok: false; reason: string } {
  if (!getChannel(channelId)) return { ok: false, reason: 'channel not found' };
  if (!isParticipant(channelId, actorId)) {
    return { ok: false, reason: 'not a participant of this channel' };
  }
  if (!getSession(targetId)) return { ok: false, reason: 'no such agent' };
  if (isParticipant(channelId, targetId)) return { ok: true }; // already in — no-op
  const verdict = resolvePeerPermission(actorId, targetId);
  if (verdict !== 'allow') {
    return {
      ok: false,
      reason:
        verdict === 'approval'
          ? 'contact requires guardian approval'
          : 'not authorized to contact this agent',
    };
  }
  addParticipant(channelId, targetId);
  return { ok: true };
}

/**
 * An agent creates a channel (the human owner is implicitly present, as in every
 * channel) and becomes its first member. Optional initial members are added only
 * if the creator is allow-authorized to contact each one (see addAgentToChannel);
 * the rest come back as `skipped` with a reason so the caller can request access.
 */
export function createChannelForAgent(
  creatorId: string,
  name: string,
  memberIds: string[] = [],
): { channel: Channel; added: string[]; skipped: { id: string; reason: string }[] } {
  const channel = createChannel(name);
  addParticipant(channel.id, creatorId);
  const added: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const m of memberIds) {
    if (m === creatorId || added.includes(m)) continue;
    const r = addAgentToChannel(creatorId, channel.id, m);
    if (r.ok) added.push(m);
    else skipped.push({ id: m, reason: r.reason });
  }
  return { channel, added, skipped };
}

/**
 * Post a message to a channel. `fromSessionId` is the posting agent, or null for
 * the human (owner). Fans out via the bus; agents read it through channelInbox.
 */
export function postChannelMessage(
  channelId: string,
  fromSessionId: string | null,
  text: string,
  opts?: { kind?: ChannelMsgKind; askId?: string | null; toSessionId?: string | null },
): ChannelMessage {
  if (!getChannel(channelId)) throw new Error('channel not found');
  // A @directed target must itself be a member of the channel; ignore otherwise.
  const to = opts?.toSessionId && isParticipant(channelId, opts.toSessionId) ? opts.toSessionId : null;
  const m: ChannelMessage = {
    id: randomUUID(),
    channelId,
    fromSessionId: fromSessionId ?? null,
    text,
    kind: opts?.kind ?? 'chat',
    askId: opts?.askId ?? null,
    toSessionId: to,
    createdAt: now(),
  };
  insertChannelMessage.run(m);
  if (fromSessionId) touchSeen(fromSessionId);
  bus.emit('channelMessage', m);
  return m;
}

/**
 * An agent posts a BLOCKING question to a channel. Reuses the ask machinery: the
 * asker waits on the returned ask (waitForAsk) until any other member answers.
 * The question is fanned out as a channel message tagged kind='ask' + askId.
 */
export function createChannelAsk(
  channelId: string,
  fromSessionId: string,
  question: string,
  options: string[] | null,
  toSessionId?: string | null,
): { ask: Ask; message: ChannelMessage } {
  if (!getChannel(channelId)) throw new Error('channel not found');
  if (!isParticipant(channelId, fromSessionId)) throw new Error('not a participant of this channel');
  const ask: Ask = {
    id: randomUUID(),
    sessionId: fromSessionId,
    question,
    options,
    status: 'pending',
    answer: null,
    createdAt: now(),
    answeredAt: null,
  };
  insertAsk.run({ ...ask, options: ask.options ? JSON.stringify(ask.options) : null });
  setStatus(fromSessionId, 'waiting');
  const message = postChannelMessage(channelId, fromSessionId, question, {
    kind: 'ask',
    askId: ask.id,
    toSessionId: toSessionId ?? null,
  });
  return { ask, message };
}

/**
 * Answer a pending channel ask. First answer wins: it resolves the ask, unblocks
 * the asker (waitForAsk), and is posted to the channel tagged kind='answer'. A
 * late answer (already resolved) is posted as plain chat so it still shows.
 * `fromSessionId` is the answering agent, or null for the human (owner).
 */
export function answerChannelAsk(
  channelId: string,
  askId: string,
  fromSessionId: string | null,
  text: string,
): ChannelMessage {
  const ask = getAsk(askId);
  if (!ask || ask.status !== 'pending') {
    // Lost the race (or unknown ask): keep the words as a normal group post.
    return postChannelMessage(channelId, fromSessionId, text);
  }
  const message = postChannelMessage(channelId, fromSessionId, text, { kind: 'answer', askId });
  updateAskAnswer.run({ id: askId, answer: text, answeredAt: now() });
  const asker = getSession(ask.sessionId);
  if (asker && asker.status === 'waiting') setStatus(ask.sessionId, 'working');
  flushWaiters(getAsk(askId)!);
  return message;
}

export function channelMessages(channelId: string): ChannelMessage[] {
  return selectChannelMessages.all(channelId) as ChannelMessage[];
}

/**
 * Channel messages an agent should receive: those in its channels, created after
 * `after`, excluding its own posts. Used by the agent-facing check_inbox so a
 * polling agent picks up group traffic alongside 1:1 chat.
 */
export interface ChannelInboxItem {
  channelId: string;
  channelName: string;
  fromSessionId: string | null;
  text: string;
  kind: ChannelMsgKind;
  askId: string | null;
  toSessionId: string | null;
  createdAt: number;
}

export function channelInbox(sessionId: string, after: number): ChannelInboxItem[] {
  const channels = channelsForSession(sessionId);
  const out: ChannelInboxItem[] = [];
  const touched = new Set<string>();
  for (const c of channels) {
    for (const m of channelMessages(c.id)) {
      if (m.createdAt > after && m.fromSessionId !== sessionId) {
        out.push({
          channelId: c.id,
          channelName: c.name,
          fromSessionId: m.fromSessionId,
          text: m.text,
          kind: m.kind,
          askId: m.askId,
          toSessionId: m.toSessionId,
          createdAt: m.createdAt,
        });
        touched.add(c.id);
      }
    }
  }
  // Pulling a channel's new traffic is an acknowledgement — advance the reader's
  // read receipt for every channel that produced something this poll.
  for (const channelId of touched) markChannelRead(channelId, sessionId);
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

// ---- per-member receipts (delivered / read) ----

export interface ChannelMemberState {
  sessionId: string;
  deliveredAt: number | null;
  readAt: number | null;
}

export function channelMemberStates(channelId: string): ChannelMemberState[] {
  return selectChannelMemberState.all(channelId) as ChannelMemberState[];
}

/** A channel message reached this member's live terminal (fan-out succeeded). */
export function markChannelDelivered(channelId: string, sessionId: string): void {
  upsertChannelDelivered.run({ channelId, sessionId, at: now() });
  bus.emit('channelState', { channelId, states: channelMemberStates(channelId) });
}

/** This member pulled the channel (check_inbox / read_channel) — it has now seen
 *  everything up to this moment. Read implies delivered. */
export function markChannelRead(channelId: string, sessionId: string): void {
  upsertChannelRead.run({ channelId, sessionId, at: now() });
  bus.emit('channelState', { channelId, states: channelMemberStates(channelId) });
}

// ---- agent-facing read aggregations (the "pull" tools) ----
// Beacon's south surface was push/react only (notify, ask, inbox). These let an
// agent PULL the context it needs: a channel's roster + history, a peer's
// profile, and its own orientation. Pure reads; the caller enforces membership.

export interface ChannelMember {
  id: string;
  name: string | null;
  task: string;
  about: string | null;
  status: SessionStatus;
  runtime: string;
}
export interface ChannelHistoryItem {
  fromSessionId: string | null;
  text: string;
  kind: ChannelMsgKind;
  askId: string | null;
  toSessionId: string | null;
  createdAt: number;
}
export interface ChannelDetail {
  channel: { id: string; name: string };
  members: ChannelMember[];
  messages: ChannelHistoryItem[];
}

/** Roster (with bios + status) and the last `limit` messages of a channel, so an
 *  agent dropped into a group can orient: what is this, who is here, what was said.
 *  When `readerId` is given (an agent reading its own channel), advances that
 *  member's read receipt. */
export function readChannelDetail(channelId: string, limit = 50, readerId?: string): ChannelDetail | undefined {
  const c = getChannel(channelId);
  if (!c) return undefined;
  if (readerId && isParticipant(channelId, readerId)) markChannelRead(channelId, readerId);
  const members: ChannelMember[] = listParticipants(channelId).map((sid) => {
    const s = getSession(sid);
    return {
      id: sid,
      name: s?.title ?? null,
      task: s?.task ?? '',
      about: s?.description ?? null,
      status: (s?.status ?? 'registered') as SessionStatus,
      runtime: s?.runtime ?? 'unknown',
    };
  });
  const cap = Math.max(1, Math.min(limit, 200));
  const messages: ChannelHistoryItem[] = channelMessages(channelId)
    .slice(-cap)
    .map((m) => ({
      fromSessionId: m.fromSessionId,
      text: m.text,
      kind: m.kind,
      askId: m.askId,
      toSessionId: m.toSessionId,
      createdAt: m.createdAt,
    }));
  return { channel: { id: c.id, name: c.name }, members, messages };
}

const selectLastOutboundMessage = db.prepare(
  `SELECT * FROM messages
   WHERE (sessionId = ? AND direction = 'agent') OR fromSessionId = ?
   ORDER BY createdAt DESC LIMIT 1`,
);
const selectLastChannelMessageFrom = db.prepare(
  `SELECT * FROM channel_messages WHERE fromSessionId = ? ORDER BY createdAt DESC LIMIT 1`,
);

export interface AgentActivity {
  kind: string;
  text: string;
  createdAt: number;
  channel: string | null; // channel name when the activity was a channel post
}

/**
 * The single most recent thing an agent surfaced — its latest 1:1 message to the
 * human, peer message, or channel post — so an orchestrating agent can tell a
 * quiet `idle` ("done, paused; last said X 3m ago") apart from a stalled or
 * never-started one. Picks the more recent across direct messages and channels.
 */
export function lastAgentActivity(targetId: string): AgentActivity | null {
  const direct = selectLastOutboundMessage.get(targetId, targetId) as MessageRow | undefined;
  const chan = selectLastChannelMessageFrom.get(targetId) as ChannelMessage | undefined;
  const directAt = direct?.createdAt ?? -1;
  const chanAt = chan?.createdAt ?? -1;
  if (directAt < 0 && chanAt < 0) return null;
  if (chan && chanAt >= directAt) {
    const c = getChannel(chan.channelId);
    return { kind: chan.kind, text: chan.text, createdAt: chan.createdAt, channel: c?.name ?? null };
  }
  const m = mapMessage(direct!);
  return { kind: m.kind, text: m.text, createdAt: m.createdAt, channel: null };
}

export interface AgentProfile {
  id: string;
  name: string | null;
  task: string;
  about: string | null;
  status: SessionStatus;
  runtime: string;
  origin: string;
  // Presence: when the agent last touched the platform (any API call). Always
  // included — a timestamp is not sensitive and disambiguates a quiet `idle`.
  lastSeenAt: number | null;
  // The agent's most recent surfaced activity. Included only when the viewer is
  // authorized to contact it, so presence is public but message content is not
  // leaked to peers that can merely see the agent.
  lastActivity: AgentActivity | null;
}
/** A peer's public profile so an agent can decide who to ask before spending an
 *  ask. When `viewerId` is an allow-authorized peer (e.g. an agent it spawned),
 *  the profile also carries the target's last activity for orchestration. */
export function agentProfile(id: string, viewerId?: string): AgentProfile | undefined {
  const s = getSession(id);
  if (!s) return undefined;
  const maySeeActivity = viewerId != null && resolvePeerPermission(viewerId, id) === 'allow';
  return {
    id: s.id,
    name: s.title ?? null,
    task: s.task,
    about: s.description ?? null,
    status: s.status,
    runtime: s.runtime,
    origin: s.origin,
    lastSeenAt: s.lastSeenAt,
    lastActivity: maySeeActivity ? lastAgentActivity(id) : null,
  };
}

export interface WhoamiPendingAsk {
  channelId: string;
  channelName: string;
  askId: string;
  question: string;
  fromSessionId: string | null;
}
export interface WhoamiState {
  id: string;
  name: string | null;
  task: string;
  status: SessionStatus;
  runtime: string;
  channels: { id: string; name: string }[];
  pendingAsks: WhoamiPendingAsk[];
}
/** An agent's own orientation: identity, the channels it is in, and group asks
 *  still awaiting an answer it could field (pending, posted by someone else). */
export function whoamiState(id: string): WhoamiState | undefined {
  const s = getSession(id);
  if (!s) return undefined;
  const channels = channelsForSession(id);
  const pendingAsks: WhoamiPendingAsk[] = [];
  for (const c of channels) {
    for (const m of channelMessages(c.id)) {
      if (m.kind !== 'ask' || !m.askId) continue;
      if (m.fromSessionId === id) continue; // my own ask — I'm the one waiting
      const ask = getAsk(m.askId);
      if (ask && ask.status === 'pending') {
        pendingAsks.push({
          channelId: c.id,
          channelName: c.name,
          askId: m.askId,
          question: m.text,
          fromSessionId: m.fromSessionId,
        });
      }
    }
  }
  return {
    id: s.id,
    name: s.title ?? null,
    task: s.task,
    status: s.status,
    runtime: s.runtime,
    channels: channels.map((c) => ({ id: c.id, name: c.name })),
    pendingAsks,
  };
}
