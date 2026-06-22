// Tests for channel read receipts (channel_member_state):
// markChannelDelivered, markChannelRead, channelMemberStates, readChannelDetail.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const tmpDir = join(tmpdir(), 'beacon-test-receipts-' + randomUUID());
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
  return store.createSession({ runtime: 'test', workPath: '/tmp/rcpt-' + tag, task: tag, admitted: true });
}

test('markChannelDelivered sets deliveredAt only, not readAt', () => {
  const ch = store.createChannel('delivered-only');
  const s = makeSession('delivered-only-s');
  store.addParticipant(ch.id, s.id);

  store.markChannelDelivered(ch.id, s.id);
  const states = store.channelMemberStates(ch.id);
  const row = states.find((r) => r.sessionId === s.id);
  assert.ok(row, 'member state row should exist');
  assert.ok(row.deliveredAt != null, 'deliveredAt should be set');
  assert.equal(row.readAt, null, 'readAt should still be null after delivered-only');
});

test('markChannelRead sets both deliveredAt and readAt', () => {
  const ch = store.createChannel('read-both');
  const s = makeSession('read-both-s');
  store.addParticipant(ch.id, s.id);

  store.markChannelRead(ch.id, s.id);
  const states = store.channelMemberStates(ch.id);
  const row = states.find((r) => r.sessionId === s.id);
  assert.ok(row);
  assert.ok(row.deliveredAt != null, 'deliveredAt set by markChannelRead');
  assert.ok(row.readAt != null, 'readAt set by markChannelRead');
});

test('markChannelDelivered after markChannelRead does not clear readAt', () => {
  const ch = store.createChannel('delivered-after-read');
  const s = makeSession('dar-s');
  store.addParticipant(ch.id, s.id);

  store.markChannelRead(ch.id, s.id);
  // Another delivered call should not reset readAt
  store.markChannelDelivered(ch.id, s.id);
  const states = store.channelMemberStates(ch.id);
  const row = states.find((r) => r.sessionId === s.id);
  assert.ok(row);
  assert.ok(row.readAt != null, 'readAt should survive a later markChannelDelivered');
});

test('channelMemberStates returns all member rows for a channel', () => {
  const ch = store.createChannel('member-states');
  const s1 = makeSession('ms-s1');
  const s2 = makeSession('ms-s2');
  store.addParticipant(ch.id, s1.id);
  store.addParticipant(ch.id, s2.id);

  store.markChannelDelivered(ch.id, s1.id);
  store.markChannelRead(ch.id, s2.id);

  const states = store.channelMemberStates(ch.id);
  const ids = states.map((r) => r.sessionId);
  assert.ok(ids.includes(s1.id));
  assert.ok(ids.includes(s2.id));
});

test('readChannelDetail with readerId advances that member read receipt', () => {
  const ch = store.createChannel('rcd-reader');
  const reader = makeSession('rcd-reader-s');
  const other = makeSession('rcd-other-s');
  store.addParticipant(ch.id, reader.id);
  store.addParticipant(ch.id, other.id);
  store.postChannelMessage(ch.id, other.id, 'some msg');

  store.readChannelDetail(ch.id, 50, reader.id);
  const states = store.channelMemberStates(ch.id);
  const row = states.find((r) => r.sessionId === reader.id);
  assert.ok(row, 'row should exist after readChannelDetail');
  assert.ok(row.readAt != null, 'readAt should be set');
});

test('readChannelDetail without readerId does not create a receipt', () => {
  const ch = store.createChannel('rcd-no-reader');
  const s = makeSession('rcd-no-reader-s');
  store.addParticipant(ch.id, s.id);
  store.postChannelMessage(ch.id, s.id, 'msg');

  store.readChannelDetail(ch.id, 50); // no readerId
  const states = store.channelMemberStates(ch.id);
  // the poster's own state should not be set (they posted, not read via readChannelDetail)
  const row = states.find((r) => r.sessionId === s.id);
  assert.ok(!row || row.readAt == null);
});

test('removeParticipant clears channel_member_state for that member', () => {
  const ch = store.createChannel('rm-state-rcpt');
  const s = makeSession('rm-state-rcpt-s');
  store.addParticipant(ch.id, s.id);
  store.markChannelRead(ch.id, s.id);

  let states = store.channelMemberStates(ch.id);
  assert.ok(states.some((r) => r.sessionId === s.id));

  store.removeParticipant(ch.id, s.id);
  states = store.channelMemberStates(ch.id);
  assert.ok(!states.some((r) => r.sessionId === s.id));
});
