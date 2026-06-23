// Tests for agent<->agent comms routed through a pair channel (not 1:1 DMs):
// peerNotify / peerAsk / agentAnswer now flow through ensurePairChannel, so the
// exchange is a supervised 3-party group (the two agents + the guardian) instead
// of muddled into each agent's DM thread. The blocking ask contract must hold.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const tmpDir = join(tmpdir(), 'beacon-test-pairchan-' + randomUUID());
mkdirSync(tmpDir, { recursive: true });
writeFileSync(
  join(tmpDir, 'settings.json'),
  JSON.stringify({ permissions: { register_agent: 'allow', contact_agent: 'ask', spawn_agent: 'ask' } }),
);
process.env.BEACON_DB = join(tmpDir, 'test.db');
process.env.BEACON_SETTINGS = join(tmpDir, 'settings.json');

const store = await import('../src/core/store.js');

after(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

function makeSession(tag: string) {
  return store.createSession({ runtime: 'test', workPath: '/tmp/pc-' + tag + '-' + randomUUID(), task: tag, admitted: true });
}

// --- ensurePairChannel ---

test('ensurePairChannel creates a 2-member channel and reuses it (order-independent)', () => {
  const a = makeSession('ep-a');
  const b = makeSession('ep-b');
  const c1 = store.ensurePairChannel(a.id, b.id);
  const parts = store.listParticipants(c1.id);
  assert.equal(parts.length, 2);
  assert.ok(parts.includes(a.id) && parts.includes(b.id));
  const c2 = store.ensurePairChannel(b.id, a.id); // reverse order -> same channel
  assert.equal(c1.id, c2.id);
});

// --- peerNotify ---

test('peerNotify posts into the pair channel, not onto a 1:1 DM thread', () => {
  const a = makeSession('pn-a');
  const b = makeSession('pn-b');
  const msg = store.peerNotify(a.id, b.id, 'hello b');
  assert.ok(msg.channelId);
  assert.equal(msg.text, 'hello b');
  assert.equal(msg.toSessionId, b.id); // directed at the recipient
  const parts = store.listParticipants(msg.channelId);
  assert.equal(parts.length, 2);
  // NOT delivered as a 1:1 peer message on b's DM inbox...
  assert.ok(!store.inbox(b.id, 0).some((m) => m.text === 'hello b'));
  // ...but visible to b through the channel inbox.
  assert.ok(store.channelInbox(b.id, 0).some((m) => m.text === 'hello b'));
});

test('peerNotify reuses the same pair channel for later traffic (either direction)', () => {
  const a = makeSession('reuse-a');
  const b = makeSession('reuse-b');
  const m1 = store.peerNotify(a.id, b.id, 'first');
  const m2 = store.peerNotify(b.id, a.id, 'second');
  assert.equal(m1.channelId, m2.channelId);
});

// --- peerAsk + agentAnswer (blocking contract preserved) ---

test('peerAsk blocks the asker and agentAnswer unblocks it via the pair channel', () => {
  const a = makeSession('pa-a');
  const b = makeSession('pa-b');
  const { ask, message } = store.peerAsk(a.id, b.id, 'proceed?', ['yes', 'no']);
  assert.equal(ask.sessionId, a.id); // the ASKER owns/blocks on the ask
  assert.equal(message.kind, 'ask');
  assert.equal(message.toSessionId, b.id);
  assert.equal(store.getSession(a.id)?.status, 'waiting'); // asker is blocked

  const answerMsg = store.agentAnswer(ask.id, 'yes', b.id);
  assert.ok(answerMsg);
  const resolved = store.getAsk(ask.id);
  assert.equal(resolved?.status, 'answered');
  assert.equal(resolved?.answer, 'yes');
  assert.equal(store.getSession(a.id)?.status, 'working'); // unblocked
});

test('agentAnswer returns undefined for an unknown ask', () => {
  assert.equal(store.agentAnswer(randomUUID(), 'whatever', null), undefined);
});

test('peerAsk and a following peerNotify share one pair channel', () => {
  const a = makeSession('share-a');
  const b = makeSession('share-b');
  const { message } = store.peerAsk(a.id, b.id, 'q?', null);
  const notif = store.peerNotify(a.id, b.id, 'fyi');
  assert.equal(message.channelId, notif.channelId);
});
