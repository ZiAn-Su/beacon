// Tests for 1:1 ask/reply semantics: createAsk, reply with askId, getAsk, waitForAsk.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const tmpDir = join(tmpdir(), 'beacon-test-asks-' + randomUUID());
mkdirSync(tmpDir, { recursive: true });
const dbPath = join(tmpDir, 'test.db');
const settingsPath = join(tmpDir, 'settings.json');
writeFileSync(settingsPath, JSON.stringify({ permissions: { register_agent: 'allow', contact_agent: 'ask', spawn_agent: 'ask' } }));
process.env.BEACON_DB = dbPath;
process.env.BEACON_SETTINGS = settingsPath;

const store = await import('../src/core/store.js');

after(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

function makeSession() {
  return store.createSession({ runtime: 'test', workPath: '/tmp/ask-test', task: 'ask-test', admitted: true });
}

test('createAsk creates a pending ask and sets session to waiting', () => {
  const s = makeSession();
  store.setStatus(s.id, 'working');
  const ask = store.createAsk({ sessionId: s.id, question: 'Are you there?', options: null });
  assert.equal(ask.status, 'pending');
  assert.equal(ask.sessionId, s.id);
  assert.equal(ask.question, 'Are you there?');
  assert.equal(ask.answer, null);
  // session must be waiting
  const fetched = store.getSession(s.id);
  assert.equal(fetched?.status, 'waiting');
});

test('getAsk returns the created ask', () => {
  const s = makeSession();
  const ask = store.createAsk({ sessionId: s.id, question: 'Hello?', options: null });
  const fetched = store.getAsk(ask.id);
  assert.ok(fetched);
  assert.equal(fetched.id, ask.id);
  assert.equal(fetched.status, 'pending');
});

test('getAsk returns undefined for unknown id', () => {
  const result = store.getAsk(randomUUID());
  assert.equal(result, undefined);
});

test('reply with askId answers the ask and sets session back to working', () => {
  const s = makeSession();
  store.setStatus(s.id, 'working');
  const ask = store.createAsk({ sessionId: s.id, question: 'What time is it?', options: null });
  // session should be waiting now
  assert.equal(store.getSession(s.id)?.status, 'waiting');
  const msg = store.reply(s.id, 'Noon', ask.id);
  assert.equal(msg.kind, 'answer');
  // ask should be answered
  const answered = store.getAsk(ask.id);
  assert.ok(answered);
  assert.equal(answered.status, 'answered');
  assert.equal(answered.answer, 'Noon');
  assert.ok(answered.answeredAt != null);
  // session should be back to working
  const session = store.getSession(s.id);
  assert.equal(session?.status, 'working');
});

test('reply without askId is free-form chat (does not answer any ask)', () => {
  const s = makeSession();
  const ask = store.createAsk({ sessionId: s.id, question: 'Pending?', options: null });
  // send chat without askId
  const msg = store.reply(s.id, 'Just chatting');
  assert.equal(msg.kind, 'chat');
  assert.equal(msg.askId, null);
  // ask still pending
  const still = store.getAsk(ask.id);
  assert.equal(still?.status, 'pending');
});

test('createAsk with options stores them on the ask', () => {
  const s = makeSession();
  const opts = ['yes', 'no', 'maybe'];
  const ask = store.createAsk({ sessionId: s.id, question: 'Choose?', options: opts });
  const fetched = store.getAsk(ask.id);
  assert.deepEqual(fetched?.options, opts);
});

test('cancelAsk cancels a pending ask', () => {
  const s = makeSession();
  const ask = store.createAsk({ sessionId: s.id, question: 'Cancel me', options: null });
  assert.equal(ask.status, 'pending');
  const cancelled = store.cancelAsk(ask.id);
  assert.ok(cancelled);
  assert.equal(cancelled.status, 'cancelled');
});

test('waitForAsk resolves immediately when ask is already answered', async () => {
  const s = makeSession();
  store.setStatus(s.id, 'working');
  const ask = store.createAsk({ sessionId: s.id, question: 'Quick?', options: null });
  store.reply(s.id, 'yes', ask.id);
  const resolved = await store.waitForAsk(ask.id, 5000);
  assert.equal(resolved.status, 'answered');
});

test('waitForAsk resolves when a reply comes in', async () => {
  const s = makeSession();
  store.setStatus(s.id, 'working');
  const ask = store.createAsk({ sessionId: s.id, question: 'Async?', options: null });
  // reply after a tiny delay
  const replyPromise = new Promise<void>((res) => {
    setTimeout(() => { store.reply(s.id, 'async-answer', ask.id); res(); }, 20);
  });
  const [resolved] = await Promise.all([store.waitForAsk(ask.id, 5000), replyPromise]);
  assert.equal(resolved.status, 'answered');
  assert.equal(resolved.answer, 'async-answer');
});

test('waitForAsk times out and returns still-pending ask', async () => {
  const s = makeSession();
  store.setStatus(s.id, 'working');
  const ask = store.createAsk({ sessionId: s.id, question: 'Timeout?', options: null });
  const result = await store.waitForAsk(ask.id, 50);
  assert.equal(result.status, 'pending'); // timed out, still pending
});

test('inbox returns human chat messages after cursor', () => {
  const s = makeSession();
  // Send a chat message
  const before = Date.now();
  store.reply(s.id, 'hi agent');
  const msgs = store.inbox(s.id, before - 1);
  assert.ok(msgs.some((m) => m.text === 'hi agent' && m.kind === 'chat'));
});
