// Tests for @directed channel messages (toSessionId).
// A valid member target keeps toSessionId; a non-member target is dropped to null.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const tmpDir = join(tmpdir(), 'beacon-test-directed-' + randomUUID());
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
  return store.createSession({ runtime: 'test', workPath: '/tmp/dir-' + tag, task: tag, admitted: true });
}

test('postChannelMessage with valid member toSessionId keeps the target', () => {
  const ch = store.createChannel('directed-valid');
  const sender = makeSession('dv-sender');
  const target = makeSession('dv-target');
  store.addParticipant(ch.id, sender.id);
  store.addParticipant(ch.id, target.id);

  const m = store.postChannelMessage(ch.id, sender.id, 'hey', { toSessionId: target.id });
  assert.equal(m.toSessionId, target.id);
});

test('postChannelMessage with non-member toSessionId drops to null (broadcast)', () => {
  const ch = store.createChannel('directed-nonmember');
  const sender = makeSession('dn-sender');
  const nonMember = makeSession('dn-nonmember');
  store.addParticipant(ch.id, sender.id);
  // nonMember is NOT added to the channel

  const m = store.postChannelMessage(ch.id, sender.id, 'hey outsider', { toSessionId: nonMember.id });
  assert.equal(m.toSessionId, null, 'non-member target should be dropped to null');
});

test('postChannelMessage with null toSessionId is a plain broadcast', () => {
  const ch = store.createChannel('directed-null');
  const sender = makeSession('dn2-sender');
  store.addParticipant(ch.id, sender.id);

  const m = store.postChannelMessage(ch.id, sender.id, 'broadcast', { toSessionId: null });
  assert.equal(m.toSessionId, null);
});

test('createChannelAsk with member toSessionId carries it on the message', () => {
  const ch = store.createChannel('ask-directed-member');
  const asker = makeSession('adm-asker');
  const target = makeSession('adm-target');
  store.addParticipant(ch.id, asker.id);
  store.addParticipant(ch.id, target.id);
  store.setStatus(asker.id, 'working');

  const { message } = store.createChannelAsk(ch.id, asker.id, 'Hey target?', null, target.id);
  assert.equal(message.toSessionId, target.id);
});

test('createChannelAsk with non-member toSessionId drops to null', () => {
  const ch = store.createChannel('ask-directed-nonmember');
  const asker = makeSession('adn-asker');
  const outsider = makeSession('adn-outsider');
  store.addParticipant(ch.id, asker.id);
  store.setStatus(asker.id, 'working');
  // outsider is NOT in the channel

  const { message } = store.createChannelAsk(ch.id, asker.id, 'Hey outsider?', null, outsider.id);
  assert.equal(message.toSessionId, null, 'non-member toSessionId should drop to null');
});

test('channelInbox carries toSessionId to reader', () => {
  const ch = store.createChannel('inbox-directed-carry');
  const reader = makeSession('idc-reader');
  const sender = makeSession('idc-sender');
  store.addParticipant(ch.id, reader.id);
  store.addParticipant(ch.id, sender.id);

  const before = Date.now();
  store.postChannelMessage(ch.id, sender.id, 'directed msg', { toSessionId: reader.id });

  const items = store.channelInbox(reader.id, before - 1);
  const item = items.find((i) => i.text === 'directed msg');
  assert.ok(item, 'directed message must appear in inbox');
  assert.equal(item.toSessionId, reader.id);
});
