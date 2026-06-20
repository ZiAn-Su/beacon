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
} from './types';
import { SESSION_STATUSES, TRUST_TIERS } from './types';
import { getSettings } from './settings';

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
// Identity Phase 3 — agent->agent peer messages. NULL on pre-existing rows and
// on human/agent messages; only set for kind 'peer'. Defaulted at read time.
ensureColumn('messages', 'fromSessionId', 'TEXT');

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
  `INSERT INTO sessions (id, runtime, workPath, task, status, title, description, archivedAt, lastSeenAt, bindKey, nativeSessionId, origin, guardianId, trustTier, createdAt, updatedAt)
   VALUES (@id, @runtime, @workPath, @task, @status, @title, @description, @archivedAt, @lastSeenAt, @bindKey, @nativeSessionId, @origin, @guardianId, @trustTier, @createdAt, @updatedAt)`
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

  // 4. brand new
  return createSession({ ...input, nativeSessionId: native });
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

const updateSessionTrustTier = db.prepare(
  `UPDATE sessions SET trustTier = @trustTier, updatedAt = @updatedAt WHERE id = @id`
);

/**
 * Set a session's trust tier (authorization graduation). Rejects an unknown
 * tier by returning the session unchanged. Emits a session event on success.
 */
export function setTrustTier(id: string, tier: string): Session | undefined {
  const s = getSession(id);
  if (!s) return undefined;
  if (!(TRUST_TIERS as string[]).includes(tier)) return s;
  updateSessionTrustTier.run({ id, trustTier: tier, updatedAt: now() });
  const updated = getSession(id)!;
  bus.emit('session', updated);
  return updated;
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
  askId?: string | null
): Message {
  const ask = askId ? getAsk(askId) : undefined;
  const isAnswer = !!(ask && ask.status === 'pending');
  const msg = addMessage({
    sessionId,
    direction: 'human',
    kind: isAnswer ? 'answer' : 'chat',
    text,
    askId: isAnswer ? askId : null,
  });
  if (isAnswer) {
    updateAskAnswer.run({ id: askId, answer: text, answeredAt: now() });
    // If this ask backs an agent-initiated contact request, record the decision
    // and mint the allow grant before unblocking the requester.
    settleContactRequestForAsk(askId!, text);
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
export function peerNotify(fromId: string, toId: string, text: string): Message {
  if (!getSession(fromId)) throw new Error('session not found');
  if (!getSession(toId)) throw new Error('session not found');
  return addMessage({
    sessionId: toId,
    fromSessionId: fromId,
    direction: 'agent',
    kind: 'peer',
    text,
  });
}

/**
 * Blocking agent->agent question. The ask belongs to the *asker* (fromId) — it
 * is the one that blocks and long-polls. We INSERT the ask row directly rather
 * than via createAsk(), because createAsk surfaces the question as an
 * agent->human ask on the asker's own thread; here the question must instead be
 * delivered as a peer message to the recipient.
 */
export function peerAsk(
  fromId: string,
  toId: string,
  question: string,
  options: string[] | null
): Ask {
  if (!getSession(fromId)) throw new Error('session not found');
  if (!getSession(toId)) throw new Error('session not found');
  const ask: Ask = {
    id: randomUUID(),
    sessionId: fromId,
    question,
    options,
    status: 'pending',
    answer: null,
    createdAt: now(),
    answeredAt: null,
  };
  insertAsk.run({
    ...ask,
    options: ask.options ? JSON.stringify(ask.options) : null,
  });
  setStatus(fromId, 'waiting');
  // Deliver the question to the recipient as a peer message carrying the askId.
  addMessage({
    sessionId: toId,
    fromSessionId: fromId,
    direction: 'agent',
    kind: 'peer',
    text: question,
    askId: ask.id,
    meta: options ? { options } : null,
  });
  return ask;
}

/**
 * The recipient answers a peer-ask, unblocking the asker's long-poll. If the
 * ask is missing or no longer pending, returns it unchanged (gateway maps to
 * 404/409). The answer is posted back as a peer message on the asker's thread.
 */
export function agentAnswer(
  askId: string,
  text: string,
  fromId?: string | null
): Ask | undefined {
  const ask = getAsk(askId);
  if (!ask || ask.status !== 'pending') return ask;
  // The answer is carried on the asker's thread (ask.sessionId = asker). Its
  // fromSessionId points back at the answerer (the recipient of the question),
  // so the asker's messages() shows the answer attributed to that peer.
  addMessage({
    sessionId: ask.sessionId,
    fromSessionId: fromId ?? null,
    direction: 'agent',
    kind: 'peer',
    text,
    askId,
  });
  updateAskAnswer.run({ id: askId, answer: text, answeredAt: now() });
  const askerId = ask.sessionId;
  const session = getSession(askerId);
  if (session && session.status === 'waiting') setStatus(askerId, 'working');
  flushWaiters(getAsk(askId)!);
  return getAsk(askId);
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
      (isVisibleScope(self.workPath, s.workPath) || granted.has(s.id)),
  );
}

/**
 * Decide whether `fromId` may initiate peer messaging to `toId`. Most-specific
 * wins, pure (no side effects). Three outcomes:
 *   - 'allow'    : deliver directly.
 *   - 'deny'     : refuse.
 *   - 'approval' : not yet authorized, but eligible — the caller should raise a
 *                  guardian approval (agent-initiated contact request).
 * Order:
 *   1. global master switch off            -> deny.
 *   2. an exact-pair grant                 -> its effect (allow/deny).
 *   3. sender tier autonomous              -> allow; restricted -> deny.
 *   4. standard|trusted need the target in the sender's visible scope
 *      (reach outside it only via an explicit allow grant, handled at step 2);
 *      not visible -> deny.
 *   5. visible: trusted -> allow; standard -> approval.
 */
export function resolvePeerPermission(
  fromId: string,
  toId: string,
): 'allow' | 'deny' | 'approval' {
  if (getSettings().agentComm === 'off') return 'deny';
  const grant = getGrantForPair(fromId, toId);
  if (grant) return grant.effect;
  const from = getSession(fromId);
  const to = getSession(toId);
  if (!from || !to) return 'deny';
  const tier = from.trustTier ?? 'standard';
  if (tier === 'autonomous') return 'allow';
  if (tier === 'restricted') return 'deny';
  if (!isVisibleScope(from.workPath, to.workPath)) return 'deny';
  return tier === 'trusted' ? 'allow' : 'approval';
}
