// Tests for 1:1 delivery state: undeliveredFor (messages an agent hasn't received
// yet) + markDelivered (stamp on actual push), which back the replay-on-reconnect
// that stops a restart / idle gap from silently dropping a guardian message.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const tmpDir = join(tmpdir(), 'beacon-test-delivery-' + randomUUID());
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
  return store.createSession({ runtime: 'test', workPath: '/tmp/dl-' + tag + '-' + randomUUID(), task: tag, admitted: true });
}

test('a fresh human message is undelivered until marked', () => {
  const s = makeSession('d1');
  const m = store.reply(s.id, 'hello');
  assert.ok(store.undeliveredFor(s.id).some((x) => x.id === m.id));
  store.markDelivered(m.id);
  assert.ok(!store.undeliveredFor(s.id).some((x) => x.id === m.id));
});

test('inbox() pull marks messages delivered (drops them from undeliveredFor)', () => {
  const s = makeSession('d2');
  const m = store.reply(s.id, 'pull me');
  assert.ok(store.undeliveredFor(s.id).some((x) => x.id === m.id));
  store.inbox(s.id, 0);
  assert.ok(!store.undeliveredFor(s.id).some((x) => x.id === m.id));
});

test('undeliveredFor returns oldest-first and only this agent / only chat', () => {
  const s = makeSession('d3');
  const other = makeSession('d3-other');
  const m1 = store.reply(s.id, 'first');
  const m2 = store.reply(s.id, 'second');
  store.reply(other.id, 'not mine');
  const pending = store.undeliveredFor(s.id);
  assert.deepEqual(pending.map((x) => x.id), [m1.id, m2.id]);
  assert.ok(!pending.some((x) => x.text === 'not mine'));
});

test('markDelivered is idempotent and ignores unknown ids', () => {
  const s = makeSession('d4');
  const m = store.reply(s.id, 'x');
  store.markDelivered(m.id);
  store.markDelivered(m.id); // already delivered — no-op
  store.markDelivered(randomUUID()); // unknown — no-op
  assert.ok(!store.undeliveredFor(s.id).some((x) => x.id === m.id));
});
