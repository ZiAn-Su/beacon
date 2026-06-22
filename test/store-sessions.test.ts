// Tests for session lifecycle: createSession, registerOrClaim, setStatus, getSession.
// Each test file sets BEACON_DB (and BEACON_SETTINGS) before the first import of
// store so the module opens an isolated temp database.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// --- isolated temp db setup ---
const tmpDir = join(tmpdir(), 'beacon-test-sessions-' + randomUUID());
mkdirSync(tmpDir, { recursive: true });
const dbPath = join(tmpDir, 'test.db');
const settingsPath = join(tmpDir, 'settings.json');
// settings: register_agent=allow so new sessions are admitted immediately
writeFileSync(settingsPath, JSON.stringify({ permissions: { register_agent: 'allow', contact_agent: 'ask', spawn_agent: 'ask' } }));
process.env.BEACON_DB = dbPath;
process.env.BEACON_SETTINGS = settingsPath;

// Dynamic import AFTER setting env so the store module picks up the temp path.
const store = await import('../src/core/store.js');

after(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

// --- helpers ---
function makeSession(extra?: Partial<Parameters<typeof store.createSession>[0]>) {
  return store.createSession({
    runtime: 'test',
    workPath: '/tmp/test',
    task: 'run tests',
    admitted: true,
    ...extra,
  });
}

// --- tests ---

test('createSession returns a session with status registered', () => {
  const s = makeSession();
  assert.equal(s.status, 'registered');
  assert.ok(s.id);
  assert.equal(s.runtime, 'test');
  assert.equal(s.task, 'run tests');
});

test('getSession returns the created session', () => {
  const s = makeSession();
  const fetched = store.getSession(s.id);
  assert.ok(fetched);
  assert.equal(fetched.id, s.id);
  assert.equal(fetched.status, 'registered');
});

test('getSession returns undefined for unknown id', () => {
  const result = store.getSession(randomUUID());
  assert.equal(result, undefined);
});

test('setStatus transitions session to working', () => {
  const s = makeSession();
  const updated = store.setStatus(s.id, 'working');
  assert.ok(updated);
  assert.equal(updated.status, 'working');
  const fetched = store.getSession(s.id);
  assert.equal(fetched?.status, 'working');
});

test('setStatus transitions session to idle then done', () => {
  const s = makeSession();
  store.setStatus(s.id, 'working');
  store.setStatus(s.id, 'idle');
  const idle = store.getSession(s.id);
  assert.equal(idle?.status, 'idle');
  store.setStatus(s.id, 'done');
  const done = store.getSession(s.id);
  assert.equal(done?.status, 'done');
});

test('setStatus rejects invalid status string', () => {
  const s = makeSession();
  const result = store.setStatus(s.id, 'flying');
  // Returns unchanged session when status is invalid
  assert.ok(result);
  assert.equal(result.status, 'registered');
});

test('setStatus returns undefined for unknown session', () => {
  const result = store.setStatus(randomUUID(), 'working');
  assert.equal(result, undefined);
});

test('listSessions includes the created sessions', () => {
  const s1 = makeSession({ task: 'list-test-1' });
  const s2 = makeSession({ task: 'list-test-2' });
  const all = store.listSessions();
  const ids = all.map((s) => s.id);
  assert.ok(ids.includes(s1.id));
  assert.ok(ids.includes(s2.id));
});

test('registerOrClaim creates a fresh session when no bindKey matches', () => {
  const s = store.registerOrClaim({
    runtime: 'test',
    workPath: '/tmp/register-test-' + randomUUID(),
    task: 'register-fresh',
  });
  assert.ok(s.id);
  // With register_agent=allow the session is admitted
  assert.ok(s.admittedAt != null);
});

test('registerOrClaim continues an existing session by bindKey', () => {
  const bindKey = 'bk-' + randomUUID();
  // First call: creates
  const first = store.registerOrClaim({
    runtime: 'test',
    workPath: '/tmp/bk-test-' + randomUUID(),
    task: 'bindkey-task',
    bindKey,
  });
  assert.ok(first.id);
  // Second call with same bindKey: continues (returns same id, status=working)
  const second = store.registerOrClaim({
    runtime: 'test',
    workPath: '/tmp/bk-test-' + randomUUID(),
    task: 'bindkey-task-resumed',
    bindKey,
  });
  assert.equal(second.id, first.id);
  assert.equal(second.status, 'working');
});

test('registerOrClaim continues via nativeSessionId', () => {
  const nativeId = 'native-' + randomUUID();
  const first = store.registerOrClaim({
    runtime: 'test',
    workPath: '/tmp/native-' + randomUUID(),
    task: 'native-task',
    nativeSessionId: nativeId,
  });
  const second = store.registerOrClaim({
    runtime: 'test',
    workPath: '/tmp/native-' + randomUUID(),
    task: 'native-task-resumed',
    resolvedNativeId: nativeId,
  });
  assert.equal(second.id, first.id);
  assert.equal(second.status, 'working');
});

test('renameSession updates the title', () => {
  const s = makeSession({ task: 'rename-me' });
  const renamed = store.renameSession(s.id, 'My Agent');
  assert.ok(renamed);
  assert.equal(renamed.title, 'My Agent');
});

test('renameSession with empty string clears the title', () => {
  const s = makeSession({ task: 'clear-title' });
  store.renameSession(s.id, 'HasTitle');
  const cleared = store.renameSession(s.id, '');
  assert.ok(cleared);
  assert.equal(cleared.title, null);
});

test('deleteSession removes the session', () => {
  const s = makeSession({ task: 'to-delete' });
  const deleted = store.deleteSession(s.id);
  assert.ok(deleted);
  const fetched = store.getSession(s.id);
  assert.equal(fetched, undefined);
});

test('deleteSession returns false for unknown id', () => {
  const result = store.deleteSession(randomUUID());
  assert.equal(result, false);
});
