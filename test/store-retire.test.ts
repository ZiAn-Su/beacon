// Tests for retireAgent: the complement of spawn — removes an agent from its
// channels and archives it (out of the active roster), so finished one-off
// workers don't pile up as idle contacts. Archive, not delete (history kept).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const tmpDir = join(tmpdir(), 'beacon-test-retire-' + randomUUID());
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
  return store.createSession({ runtime: 'test', workPath: '/tmp/rt-' + tag + '-' + randomUUID(), task: tag, admitted: true });
}

test('retireAgent archives the agent and removes it from its channels', () => {
  const a = makeSession('owner');
  const b = makeSession('worker');
  store.grantMutualContact(a.id, b.id);
  const { channel } = store.createChannelForAgent(a.id, 'team', [b.id]);
  assert.ok(store.isParticipant(channel.id, b.id));

  const retired = store.retireAgent(b.id);
  assert.ok(retired);
  assert.ok(retired.archivedAt != null);                 // archived
  assert.equal(store.isParticipant(channel.id, b.id), false); // out of the channel
  // History kept (not deleted): the session still resolves by id.
  assert.ok(store.getSession(b.id));
  // And it drops out of a peer's active visible roster.
  assert.ok(!store.visibleAgentsFor(a.id).some((s) => s.id === b.id));
});

test('retireAgent returns undefined for an unknown agent', () => {
  assert.equal(store.retireAgent(randomUUID()), undefined);
});
