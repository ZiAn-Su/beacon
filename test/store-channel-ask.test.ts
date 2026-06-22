// Tests for group ask: createChannelAsk, answerChannelAsk (first-answer-wins),
// late answer becomes plain chat.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const tmpDir = join(tmpdir(), 'beacon-test-channel-ask-' + randomUUID());
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

function makeSession(tag: string) {
  const s = store.createSession({ runtime: 'test', workPath: '/tmp/ca-' + tag, task: tag, admitted: true });
  store.setStatus(s.id, 'working');
  return store.getSession(s.id)!;
}

// --- createChannelAsk ---

test('createChannelAsk creates a pending ask and posts kind=ask message', () => {
  const ch = store.createChannel('ch-ask-basic');
  const asker = makeSession('asker-basic');
  store.addParticipant(ch.id, asker.id);

  const { ask, message } = store.createChannelAsk(ch.id, asker.id, 'Who knows?', null);
  assert.equal(ask.status, 'pending');
  assert.equal(ask.sessionId, asker.id);
  assert.equal(message.kind, 'ask');
  assert.equal(message.askId, ask.id);
  // asker should be waiting
  assert.equal(store.getSession(asker.id)?.status, 'waiting');
});

test('createChannelAsk throws when caller is not a participant', () => {
  const ch = store.createChannel('ch-ask-nonpart');
  const nonpart = makeSession('nonpart');
  assert.throws(
    () => store.createChannelAsk(ch.id, nonpart.id, 'Am I in here?', null),
    /not a participant/
  );
});

// --- answerChannelAsk (first-answer-wins) ---

test('answerChannelAsk by another member resolves the ask and returns asker to working', () => {
  const ch = store.createChannel('ch-ask-answer');
  const asker = makeSession('asker-answer');
  const responder = makeSession('responder-answer');
  store.addParticipant(ch.id, asker.id);
  store.addParticipant(ch.id, responder.id);

  const { ask } = store.createChannelAsk(ch.id, asker.id, 'Is anyone there?', null);
  assert.equal(ask.status, 'pending');

  const answerMsg = store.answerChannelAsk(ch.id, ask.id, responder.id, 'Yes, here!');
  assert.equal(answerMsg.kind, 'answer');
  assert.equal(answerMsg.askId, ask.id);

  const resolved = store.getAsk(ask.id);
  assert.ok(resolved);
  assert.equal(resolved.status, 'answered');
  assert.equal(resolved.answer, 'Yes, here!');

  // asker should be back to working
  assert.equal(store.getSession(asker.id)?.status, 'working');
});

test('answerChannelAsk by the human (owner, null fromSessionId) resolves the ask', () => {
  const ch = store.createChannel('ch-ask-owner');
  const asker = makeSession('asker-owner');
  store.addParticipant(ch.id, asker.id);

  const { ask } = store.createChannelAsk(ch.id, asker.id, 'Owner help?', null);
  const answerMsg = store.answerChannelAsk(ch.id, ask.id, null, 'Got it');
  assert.equal(answerMsg.kind, 'answer');

  const resolved = store.getAsk(ask.id);
  assert.equal(resolved?.status, 'answered');
  assert.equal(store.getSession(asker.id)?.status, 'working');
});

test('a second/late answer becomes plain chat (not a second answer)', () => {
  const ch = store.createChannel('ch-ask-late');
  const asker = makeSession('asker-late');
  const r1 = makeSession('responder-late-1');
  const r2 = makeSession('responder-late-2');
  store.addParticipant(ch.id, asker.id);
  store.addParticipant(ch.id, r1.id);
  store.addParticipant(ch.id, r2.id);

  const { ask } = store.createChannelAsk(ch.id, asker.id, 'First wins?', null);
  // first answer resolves it
  store.answerChannelAsk(ch.id, ask.id, r1.id, 'I am first');
  // second answer must be plain chat
  const lateMsg = store.answerChannelAsk(ch.id, ask.id, r2.id, 'I am late');
  assert.equal(lateMsg.kind, 'chat');
  assert.equal(lateMsg.askId, null);

  // ask must remain answered (not double-answered)
  const resolved = store.getAsk(ask.id);
  assert.equal(resolved?.answer, 'I am first');
});

test('createChannelAsk with toSessionId carries the directed target on the message', () => {
  const ch = store.createChannel('ch-ask-directed');
  const asker = makeSession('asker-directed');
  const target = makeSession('target-directed');
  store.addParticipant(ch.id, asker.id);
  store.addParticipant(ch.id, target.id);

  const { message } = store.createChannelAsk(ch.id, asker.id, 'Hey target?', null, target.id);
  assert.equal(message.toSessionId, target.id);
});
