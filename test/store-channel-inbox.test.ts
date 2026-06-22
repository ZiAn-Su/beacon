// Tests for channelInbox: after-cursor filtering, excludes own posts,
// toSessionId carried through, read receipts advanced.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const tmpDir = join(tmpdir(), 'beacon-test-inbox-' + randomUUID());
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
  return store.createSession({ runtime: 'test', workPath: '/tmp/inbox-' + tag, task: tag, admitted: true });
}

test('channelInbox returns messages after the cursor', () => {
  const ch = store.createChannel('inbox-cursor');
  const reader = makeSession('inbox-reader');
  const poster = makeSession('inbox-poster');
  store.addParticipant(ch.id, reader.id);
  store.addParticipant(ch.id, poster.id);

  const before = Date.now();
  store.postChannelMessage(ch.id, poster.id, 'after cursor');

  const items = store.channelInbox(reader.id, before - 1);
  assert.ok(items.some((i) => i.text === 'after cursor'));
});

test('channelInbox excludes messages before the cursor', async () => {
  const ch = store.createChannel('inbox-before');
  const reader = makeSession('ib-reader');
  const poster = makeSession('ib-poster');
  store.addParticipant(ch.id, reader.id);
  store.addParticipant(ch.id, poster.id);

  const oldMsg = store.postChannelMessage(ch.id, poster.id, 'old message');
  // cursor is strictly after the old message
  const after = oldMsg.createdAt;
  // wait a tick so the next message lands at a strictly later timestamp
  await new Promise((res) => setTimeout(res, 2));
  store.postChannelMessage(ch.id, poster.id, 'new message');

  const items = store.channelInbox(reader.id, after);
  // only the new message should appear (createdAt > after)
  assert.ok(!items.some((i) => i.text === 'old message'));
  assert.ok(items.some((i) => i.text === 'new message'));
});

test('channelInbox excludes the reader own posts', () => {
  const ch = store.createChannel('inbox-own');
  const reader = makeSession('own-reader');
  const other = makeSession('own-other');
  store.addParticipant(ch.id, reader.id);
  store.addParticipant(ch.id, other.id);

  const before = Date.now();
  store.postChannelMessage(ch.id, reader.id, 'my own post');
  store.postChannelMessage(ch.id, other.id, 'other post');

  const items = store.channelInbox(reader.id, before - 1);
  assert.ok(!items.some((i) => i.text === 'my own post'));
  assert.ok(items.some((i) => i.text === 'other post'));
});

test('channelInbox carries toSessionId on directed messages', () => {
  const ch = store.createChannel('inbox-directed');
  const reader = makeSession('dir-reader');
  const sender = makeSession('dir-sender');
  store.addParticipant(ch.id, reader.id);
  store.addParticipant(ch.id, sender.id);

  const before = Date.now();
  store.postChannelMessage(ch.id, sender.id, 'hey reader', { toSessionId: reader.id });

  const items = store.channelInbox(reader.id, before - 1);
  const directed = items.find((i) => i.text === 'hey reader');
  assert.ok(directed);
  assert.equal(directed.toSessionId, reader.id);
});

test('channelInbox advances read receipts for channels with new messages', () => {
  const ch = store.createChannel('inbox-read-receipt');
  const reader = makeSession('rr-reader');
  const poster = makeSession('rr-poster');
  store.addParticipant(ch.id, reader.id);
  store.addParticipant(ch.id, poster.id);

  // before any read
  let states = store.channelMemberStates(ch.id);
  const before = states.find((s) => s.sessionId === reader.id);
  // may not have a row yet

  store.postChannelMessage(ch.id, poster.id, 'trigger read');
  const t0 = Date.now();
  store.channelInbox(reader.id, t0 - 9999);

  states = store.channelMemberStates(ch.id);
  const readerState = states.find((s) => s.sessionId === reader.id);
  assert.ok(readerState, 'member state should exist after channelInbox');
  assert.ok(readerState.readAt != null, 'readAt should be set after channelInbox');
});

test('channelInbox does NOT advance receipts when no new messages', () => {
  const ch = store.createChannel('inbox-no-receipt');
  const reader = makeSession('nr-reader');
  store.addParticipant(ch.id, reader.id);

  const futureTs = Date.now() + 99999;
  store.channelInbox(reader.id, futureTs);
  // No messages after futureTs, so no receipt update
  const states = store.channelMemberStates(ch.id);
  const readerState = states.find((s) => s.sessionId === reader.id);
  // Either no row or readAt not set
  assert.ok(!readerState || readerState.readAt == null);
});
