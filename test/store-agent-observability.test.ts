// Tests for sub-agent observability: lastAgentActivity (latest across 1:1 and
// channel messages) and agentProfile presence (lastSeenAt always; lastActivity
// only for an authorized viewer, so content isn't leaked to mere observers).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const tmpDir = join(tmpdir(), 'beacon-test-observ-' + randomUUID());
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function makeSession(tag: string) {
  return store.createSession({ runtime: 'test', workPath: '/tmp/ob-' + tag + '-' + randomUUID(), task: tag, admitted: true });
}

// --- lastAgentActivity ---

test('lastAgentActivity is null when the agent has surfaced nothing', () => {
  const s = makeSession('ob-empty');
  assert.equal(store.lastAgentActivity(s.id), null);
});

test('lastAgentActivity returns a direct outbound message', () => {
  const s = makeSession('ob-direct');
  store.addMessage({ sessionId: s.id, direction: 'agent', kind: 'notify', text: 'step 1 done' });
  const a = store.lastAgentActivity(s.id);
  assert.ok(a);
  assert.equal(a.text, 'step 1 done');
  assert.equal(a.kind, 'notify');
  assert.equal(a.channel, null);
});

test('lastAgentActivity prefers the more recent channel post', async () => {
  const s = makeSession('ob-chan');
  const ch = store.createChannel('ob-team');
  store.addParticipant(ch.id, s.id);
  store.addMessage({ sessionId: s.id, direction: 'agent', kind: 'notify', text: 'older direct' });
  await sleep(3);
  store.postChannelMessage(ch.id, s.id, 'newer channel post');
  const a = store.lastAgentActivity(s.id);
  assert.ok(a);
  assert.equal(a.text, 'newer channel post');
  assert.equal(a.channel, 'ob-team');
});

test('lastAgentActivity prefers the more recent direct message', async () => {
  const s = makeSession('ob-direct-newer');
  const ch = store.createChannel('ob-team-2');
  store.addParticipant(ch.id, s.id);
  store.postChannelMessage(ch.id, s.id, 'older channel post');
  await sleep(3);
  store.addMessage({ sessionId: s.id, direction: 'agent', kind: 'notify', text: 'newer direct' });
  const a = store.lastAgentActivity(s.id);
  assert.ok(a);
  assert.equal(a.text, 'newer direct');
  assert.equal(a.channel, null);
});

// --- agentProfile presence + gating ---

test('agentProfile always includes lastSeenAt and omits activity for no viewer', () => {
  const s = makeSession('ob-presence');
  store.addMessage({ sessionId: s.id, direction: 'agent', kind: 'notify', text: 'secret progress' });
  const p = store.agentProfile(s.id);
  assert.ok(p);
  assert.ok(typeof p.lastSeenAt === 'number'); // set at creation
  assert.equal(p.lastActivity, null); // no viewer => content withheld
});

test('agentProfile withholds activity from an unauthorized viewer', () => {
  const target = makeSession('ob-target');
  const viewer = makeSession('ob-viewer'); // out-of-scope, no grant
  store.addMessage({ sessionId: target.id, direction: 'agent', kind: 'notify', text: 'private' });
  const p = store.agentProfile(target.id, viewer.id);
  assert.ok(p);
  assert.equal(p.lastActivity, null);
});

test('agentProfile reveals activity to an authorized viewer', () => {
  const target = makeSession('ob-target-2');
  const viewer = makeSession('ob-viewer-2');
  store.grantMutualContact(viewer.id, target.id); // e.g. spawner <-> child
  store.addMessage({ sessionId: target.id, direction: 'agent', kind: 'notify', text: 'visible progress' });
  const p = store.agentProfile(target.id, viewer.id);
  assert.ok(p);
  assert.ok(p.lastActivity);
  assert.equal(p.lastActivity.text, 'visible progress');
});
