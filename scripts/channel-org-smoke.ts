// Smoke test for agent-side channel organization over the hosted HTTP MCP:
// two agents connect, A creates a channel, A fails to add B without authorization,
// the owner grants A<->B, then A adds B successfully. Exercises the new
// create_channel + add_to_channel tools end-to-end (MCP -> gateway -> store).
//
// Run against an ISOLATED platform (temp BEACON_DB, alternate PORT) — never the
// production instance. The accompanying runner sets that up.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const BASE = process.env.PLATFORM_URL ?? 'http://127.0.0.1:4399';

function log(ok: boolean, label: string, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ' :: ' + extra : ''}`);
  if (!ok) process.exitCode = 1;
}
function textOf(r: unknown): string {
  const c = (r as { content?: { type: string; text: string }[] }).content;
  return c?.[0]?.text ?? '';
}
async function connect() {
  const c = new Client({ name: 'org-smoke', version: '0.0.0' });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`)));
  return c;
}

// Two independent MCP connections = two distinct Beacon sessions.
const A = await connect();
const B = await connect();

const ra = await A.callTool({ name: 'register_session', arguments: { task: 'org-smoke A', work_path: '/tmp/org-a', runtime: 'claude-code' } });
const rb = await B.callTool({ name: 'register_session', arguments: { task: 'org-smoke B', work_path: '/tmp/org-b', runtime: 'claude-code' } });
log(/Registered as session/.test(textOf(ra)), 'A registered');
log(/Registered as session/.test(textOf(rb)), 'B registered');

// Resolve ids from the north API.
const sessions = (await (await fetch(`${BASE}/api/sessions`)).json()).sessions as { id: string; workPath: string }[];
const aId = sessions.find((s) => s.workPath === '/tmp/org-a')!.id;
const bId = sessions.find((s) => s.workPath === '/tmp/org-b')!.id;

// A creates a channel and tries to add B (out-of-scope, no grant => refused).
const created = await A.callTool({ name: 'create_channel', arguments: { name: 'org-smoke-team' } });
log(/Created channel/.test(textOf(created)), 'create_channel', textOf(created));
const chId = (textOf(created).match(/id=([0-9a-f-]+)\)/) ?? [])[1];
log(!!chId, 'channel id parsed', chId ?? '(none)');

const addUnauth = await A.callTool({ name: 'add_to_channel', arguments: { channel_id: chId, agent_id: bId } });
log(/Could not add/.test(textOf(addUnauth)), 'add_to_channel refused without authorization', textOf(addUnauth));

// Owner grants A<->B (mirrors what spawning would do automatically).
for (const [from, to] of [[aId, bId], [bId, aId]]) {
  await fetch(`${BASE}/api/grants`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fromId: from, toId: to, effect: 'allow' }),
  });
}

const addOk = await A.callTool({ name: 'add_to_channel', arguments: { channel_id: chId, agent_id: bId } });
log(/Added to channel/.test(textOf(addOk)), 'add_to_channel succeeds after grant', textOf(addOk));

// Confirm membership via the north API.
const detail = await (await fetch(`${BASE}/api/channels/${chId}`)).json();
const parts = detail.participants as string[];
log(parts.includes(aId) && parts.includes(bId), 'both agents are participants', parts.join(','));

await A.close();
await B.close();
console.log('done');
