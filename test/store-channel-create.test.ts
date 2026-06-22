// Tests for agent-side channel organization: grantMutualContact,
// addAgentToChannel, createChannelForAgent. Verifies the authorization invariant
// (you can only add agents you are allowed to contact) and that spawning's mutual
// grant unblocks grouping a child agent.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const tmpDir = join(tmpdir(), 'beacon-test-ch-create-' + randomUUID());
mkdirSync(tmpDir, { recursive: true });
const dbPath = join(tmpDir, 'test.db');
const settingsPath = join(tmpDir, 'settings.json');
// contact_agent defaults to 'ask' so an in-scope peer resolves to 'approval' and
// an out-of-scope peer resolves to 'deny' — both must be skipped unless granted.
writeFileSync(
  settingsPath,
  JSON.stringify({ permissions: { register_agent: 'allow', contact_agent: 'ask', spawn_agent: 'ask' } }),
);
process.env.BEACON_DB = dbPath;
process.env.BEACON_SETTINGS = settingsPath;

const store = await import('../src/core/store.js');

after(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

// Distinct work paths => the two agents are out-of-scope from each other by
// default (no same-directory visibility), so contact needs an explicit grant.
function makeSession(tag: string) {
  return store.createSession({ runtime: 'test', workPath: '/tmp/cc-' + tag + '-' + randomUUID(), task: tag, admitted: true });
}

// --- grantMutualContact ---

test('grantMutualContact authorizes both directions', () => {
  const a = makeSession('gm-a');
  const b = makeSession('gm-b');
  assert.notEqual(store.resolvePeerPermission(a.id, b.id), 'allow'); // out-of-scope: not allowed yet
  store.grantMutualContact(a.id, b.id);
  assert.equal(store.resolvePeerPermission(a.id, b.id), 'allow');
  assert.equal(store.resolvePeerPermission(b.id, a.id), 'allow');
});

test('grantMutualContact is a no-op for self', () => {
  const a = makeSession('gm-self');
  store.grantMutualContact(a.id, a.id); // must not throw
  assert.ok(true);
});

// --- createChannelForAgent ---

test('createChannelForAgent makes the creator a participant', () => {
  const a = makeSession('cc-creator');
  const { channel } = store.createChannelForAgent(a.id, 'my-team');
  assert.equal(channel.name, 'my-team');
  assert.ok(store.isParticipant(channel.id, a.id));
});

test('createChannelForAgent skips members the creator cannot contact', () => {
  const a = makeSession('cc-a');
  const b = makeSession('cc-b'); // out-of-scope, no grant
  const { channel, added, skipped } = store.createChannelForAgent(a.id, 'skip-team', [b.id]);
  assert.deepEqual(added, []);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].id, b.id);
  assert.match(skipped[0].reason, /not authorized to contact/);
  assert.equal(store.isParticipant(channel.id, b.id), false);
});

test('createChannelForAgent adds members the creator is granted to contact', () => {
  const a = makeSession('cc-grant-a');
  const b = makeSession('cc-grant-b');
  store.grantMutualContact(a.id, b.id);
  const { channel, added, skipped } = store.createChannelForAgent(a.id, 'grant-team', [b.id]);
  assert.deepEqual(added, [b.id]);
  assert.deepEqual(skipped, []);
  assert.ok(store.isParticipant(channel.id, b.id));
});

// --- addAgentToChannel ---

test('addAgentToChannel requires the actor to be a participant', () => {
  const owner = makeSession('add-owner');
  const outsider = makeSession('add-outsider');
  const target = makeSession('add-target');
  store.grantMutualContact(outsider.id, target.id);
  const { channel } = store.createChannelForAgent(owner.id, 'guarded'); // outsider is NOT in it
  const r = store.addAgentToChannel(outsider.id, channel.id, target.id);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /not a participant/);
});

test('addAgentToChannel refuses an unauthorized target', () => {
  const a = makeSession('add-a');
  const b = makeSession('add-b'); // no grant
  const { channel } = store.createChannelForAgent(a.id, 'unauth');
  const r = store.addAgentToChannel(a.id, channel.id, b.id);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /not authorized to contact/);
  assert.equal(store.isParticipant(channel.id, b.id), false);
});

test('addAgentToChannel adds an authorized target', () => {
  const a = makeSession('add-ok-a');
  const b = makeSession('add-ok-b');
  store.grantMutualContact(a.id, b.id);
  const { channel } = store.createChannelForAgent(a.id, 'authd');
  const r = store.addAgentToChannel(a.id, channel.id, b.id);
  assert.equal(r.ok, true);
  assert.ok(store.isParticipant(channel.id, b.id));
});

test('addAgentToChannel is idempotent for an existing member', () => {
  const a = makeSession('add-idem-a');
  const b = makeSession('add-idem-b');
  store.grantMutualContact(a.id, b.id);
  const { channel } = store.createChannelForAgent(a.id, 'idem', [b.id]);
  const r = store.addAgentToChannel(a.id, channel.id, b.id);
  assert.equal(r.ok, true);
  assert.equal(store.listParticipants(channel.id).filter((id) => id === b.id).length, 1);
});

test('addAgentToChannel reports unknown channel and unknown target', () => {
  const a = makeSession('add-unknown');
  const { channel } = store.createChannelForAgent(a.id, 'unknown-probe');
  const noChan = store.addAgentToChannel(a.id, randomUUID(), a.id);
  assert.equal(noChan.ok, false);
  if (!noChan.ok) assert.match(noChan.reason, /channel not found/);
  const noTarget = store.addAgentToChannel(a.id, channel.id, randomUUID());
  assert.equal(noTarget.ok, false);
  if (!noTarget.ok) assert.match(noTarget.reason, /no such agent/);
});
