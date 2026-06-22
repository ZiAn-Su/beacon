// Tests for channel CRUD: createChannel, addParticipant, removeParticipant,
// listParticipants, isParticipant, postChannelMessage, channelsForSession.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const tmpDir = join(tmpdir(), 'beacon-test-channels-' + randomUUID());
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
  return store.createSession({ runtime: 'test', workPath: '/tmp/ch-' + tag, task: tag, admitted: true });
}

// --- createChannel ---

test('createChannel creates a channel with the given name', () => {
  const ch = store.createChannel('general');
  assert.ok(ch.id);
  assert.equal(ch.name, 'general');
});

test('createChannel with empty name defaults to "channel"', () => {
  const ch = store.createChannel('');
  assert.equal(ch.name, 'channel');
});

test('getChannel returns the channel', () => {
  const ch = store.createChannel('test-get');
  const fetched = store.getChannel(ch.id);
  assert.ok(fetched);
  assert.equal(fetched.id, ch.id);
  assert.equal(fetched.name, 'test-get');
});

test('getChannel returns undefined for unknown id', () => {
  assert.equal(store.getChannel(randomUUID()), undefined);
});

test('listChannels includes created channels', () => {
  const ch = store.createChannel('list-me');
  const all = store.listChannels();
  assert.ok(all.some((c) => c.id === ch.id));
});

// --- participants ---

test('addParticipant adds a session to a channel', () => {
  const ch = store.createChannel('add-part');
  const s = makeSession('add-part-session');
  const result = store.addParticipant(ch.id, s.id);
  assert.ok(result);
  assert.ok(store.isParticipant(ch.id, s.id));
});

test('isParticipant returns false for non-member', () => {
  const ch = store.createChannel('non-member');
  const s = makeSession('non-member-session');
  assert.equal(store.isParticipant(ch.id, s.id), false);
});

test('addParticipant is idempotent', () => {
  const ch = store.createChannel('idem');
  const s = makeSession('idem-session');
  store.addParticipant(ch.id, s.id);
  store.addParticipant(ch.id, s.id); // second call must not throw
  const parts = store.listParticipants(ch.id);
  assert.equal(parts.filter((id) => id === s.id).length, 1);
});

test('listParticipants returns the session ids in the channel', () => {
  const ch = store.createChannel('list-parts');
  const s1 = makeSession('lp-s1');
  const s2 = makeSession('lp-s2');
  store.addParticipant(ch.id, s1.id);
  store.addParticipant(ch.id, s2.id);
  const parts = store.listParticipants(ch.id);
  assert.ok(parts.includes(s1.id));
  assert.ok(parts.includes(s2.id));
});

test('removeParticipant removes the session from the channel', () => {
  const ch = store.createChannel('remove-part');
  const s = makeSession('remove-part-session');
  store.addParticipant(ch.id, s.id);
  assert.ok(store.isParticipant(ch.id, s.id));
  store.removeParticipant(ch.id, s.id);
  assert.equal(store.isParticipant(ch.id, s.id), false);
});

test('removeParticipant clears the member state row', () => {
  const ch = store.createChannel('rm-state');
  const s = makeSession('rm-state-session');
  store.addParticipant(ch.id, s.id);
  store.markChannelDelivered(ch.id, s.id);
  let states = store.channelMemberStates(ch.id);
  assert.ok(states.some((st) => st.sessionId === s.id));
  store.removeParticipant(ch.id, s.id);
  states = store.channelMemberStates(ch.id);
  assert.ok(!states.some((st) => st.sessionId === s.id));
});

test('channelsForSession returns the channels an agent is in', () => {
  const ch1 = store.createChannel('for-session-1');
  const ch2 = store.createChannel('for-session-2');
  const s = makeSession('for-session-agent');
  store.addParticipant(ch1.id, s.id);
  store.addParticipant(ch2.id, s.id);
  const chans = store.channelsForSession(s.id);
  const ids = chans.map((c) => c.id);
  assert.ok(ids.includes(ch1.id));
  assert.ok(ids.includes(ch2.id));
});

// --- postChannelMessage ---

test('postChannelMessage posts a chat message', () => {
  const ch = store.createChannel('post-msg');
  const s = makeSession('post-msg-session');
  store.addParticipant(ch.id, s.id);
  const m = store.postChannelMessage(ch.id, s.id, 'hello channel');
  assert.ok(m.id);
  assert.equal(m.channelId, ch.id);
  assert.equal(m.fromSessionId, s.id);
  assert.equal(m.text, 'hello channel');
  assert.equal(m.kind, 'chat');
});

test('postChannelMessage with null fromSessionId (human post)', () => {
  const ch = store.createChannel('human-post');
  const m = store.postChannelMessage(ch.id, null, 'hello from human');
  assert.equal(m.fromSessionId, null);
  assert.equal(m.kind, 'chat');
});

test('postChannelMessage throws for unknown channel', () => {
  assert.throws(() => store.postChannelMessage(randomUUID(), null, 'oops'), /channel not found/);
});

test('channelMessages returns all messages in the channel', () => {
  const ch = store.createChannel('list-msgs');
  const s = makeSession('list-msgs-session');
  store.addParticipant(ch.id, s.id);
  store.postChannelMessage(ch.id, s.id, 'first');
  store.postChannelMessage(ch.id, null, 'second');
  const msgs = store.channelMessages(ch.id);
  assert.ok(msgs.length >= 2);
  assert.ok(msgs.some((m) => m.text === 'first'));
  assert.ok(msgs.some((m) => m.text === 'second'));
});

// --- deleteChannel ---

test('deleteChannel removes the channel and its messages', () => {
  const ch = store.createChannel('delete-ch');
  const s = makeSession('delete-ch-session');
  store.addParticipant(ch.id, s.id);
  store.postChannelMessage(ch.id, s.id, 'msg in deleted channel');
  assert.ok(store.deleteChannel(ch.id));
  assert.equal(store.getChannel(ch.id), undefined);
  assert.equal(store.channelMessages(ch.id).length, 0);
});
