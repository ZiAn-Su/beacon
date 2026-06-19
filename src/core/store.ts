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
} from './types';
import { SESSION_STATUSES } from './types';

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

const now = () => Date.now();

// ---------- row mappers ----------
type SessionRow = Omit<Session, never>;
interface MessageRow {
  id: string;
  sessionId: string;
  direction: MsgDirection;
  kind: MsgKind;
  text: string;
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

function mapMessage(r: MessageRow): Message {
  return {
    id: r.id,
    sessionId: r.sessionId,
    direction: r.direction,
    kind: r.kind,
    text: r.text,
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
  `INSERT INTO sessions (id, runtime, workPath, task, status, title, archivedAt, lastSeenAt, createdAt, updatedAt)
   VALUES (@id, @runtime, @workPath, @task, @status, @title, @archivedAt, @lastSeenAt, @createdAt, @updatedAt)`
);
const selectSession = db.prepare(`SELECT * FROM sessions WHERE id = ?`);
const selectSessions = db.prepare(`SELECT * FROM sessions ORDER BY updatedAt DESC`);
const updateSessionStatus = db.prepare(
  `UPDATE sessions SET status = @status, updatedAt = @updatedAt WHERE id = @id`
);
const updateSessionTitle = db.prepare(
  `UPDATE sessions SET title = @title WHERE id = @id`
);
const updateSessionArchived = db.prepare(
  `UPDATE sessions SET archivedAt = @archivedAt WHERE id = @id`
);
const touchSession = db.prepare(
  `UPDATE sessions SET updatedAt = @updatedAt WHERE id = @id`
);

export function createSession(input: {
  runtime: string;
  workPath: string;
  task: string;
}): Session {
  const ts = now();
  const s: Session = {
    id: randomUUID(),
    runtime: input.runtime || 'unknown',
    workPath: input.workPath || '',
    task: input.task || '',
    status: 'registered',
    title: null,
    archivedAt: null,
    lastSeenAt: ts,
    createdAt: ts,
    updatedAt: ts,
  };
  insertSession.run(s);
  bus.emit('session', s);
  return s;
}

export function getSession(id: string): Session | undefined {
  return selectSession.get(id) as SessionRow | undefined;
}

export function listSessions(): Session[] {
  return selectSessions.all() as SessionRow[];
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

/** Archive (hide from the active list) or restore a conversation. */
export function setArchived(id: string, archived: boolean): Session | undefined {
  const s = getSession(id);
  if (!s) return undefined;
  updateSessionArchived.run({ id, archivedAt: archived ? now() : null });
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
  `INSERT INTO messages (id, sessionId, direction, kind, text, askId, meta, createdAt, deliveredAt)
   VALUES (@id, @sessionId, @direction, @kind, @text, @askId, @meta, @createdAt, @deliveredAt)`
);
const markMessageDelivered = db.prepare(
  `UPDATE messages SET deliveredAt = @deliveredAt WHERE id = @id AND deliveredAt IS NULL`
);
const selectMessages = db.prepare(
  `SELECT * FROM messages WHERE sessionId = ? ORDER BY createdAt ASC`
);
const selectInbox = db.prepare(
  `SELECT * FROM messages
   WHERE sessionId = ? AND direction = 'human' AND kind = 'chat' AND createdAt > ?
   ORDER BY createdAt ASC`
);

export function addMessage(input: {
  sessionId: string;
  direction: MsgDirection;
  kind: MsgKind;
  text: string;
  askId?: string | null;
  meta?: Record<string, unknown> | null;
}): Message {
  const m: Message = {
    id: randomUUID(),
    sessionId: input.sessionId,
    direction: input.direction,
    kind: input.kind,
    text: input.text,
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
  return (selectMessages.all(sessionId) as MessageRow[]).map(mapMessage);
}

/** Human chat messages newer than `afterTs` — for an agent's check_inbox poll.
 *  Marks returned messages as delivered (first read) and pushes WS events. */
export function inbox(sessionId: string, afterTs: number): Message[] {
  const msgs = (selectInbox.all(sessionId, afterTs) as MessageRow[]).map(mapMessage);
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
