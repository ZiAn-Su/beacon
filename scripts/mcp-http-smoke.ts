// Smoke test for the hosted HTTP MCP endpoint: connect a real MCP client over
// Streamable HTTP, list tools, register, notify, then ask + answer end-to-end.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const BASE = process.env.PLATFORM_URL ?? 'http://127.0.0.1:4319';

function log(ok: boolean, label: string, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ' :: ' + extra : ''}`);
  if (!ok) process.exitCode = 1;
}

const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`));
const client = new Client({ name: 'smoke', version: '0.0.0' });
await client.connect(transport);

const { tools } = await client.listTools();
const names = tools.map((t) => t.name).sort();
const expectedTools = [
  'answer_agent', 'ask_agent', 'ask_human', 'check_inbox', 'list_agents',
  'notify_agent', 'notify_human', 'register_session', 'update_status',
];
log(
  expectedTools.every((n) => names.includes(n)),
  'tools listed',
  names.join(','),
);

const reg = await client.callTool({
  name: 'register_session',
  arguments: { task: 'HTTP smoke test', work_path: '/tmp/smoke', runtime: 'claude-code' },
});
const regText = (reg.content as { type: string; text: string }[])[0]?.text ?? '';
log(/Registered as session/.test(regText), 'register_session', regText);

const noti = await client.callTool({ name: 'notify_human', arguments: { message: 'hello from http' } });
log(
  /Delivered/.test((noti.content as { text: string }[])[0]?.text ?? ''),
  'notify_human',
);

// ask_human blocks; answer it from the north side after a beat.
const askPromise = client.callTool({
  name: 'ask_human',
  arguments: { question: 'Proceed?', options: ['Yes', 'No'] },
});

// Find the pending session + ask via the REST API and answer it.
await new Promise((r) => setTimeout(r, 500));
const sessions = (await (await fetch(`${BASE}/api/sessions`)).json()).sessions as {
  id: string;
  status: string;
  workPath: string;
}[];
const mine = sessions.find((s) => s.workPath === '/tmp/smoke');
const msgs = (await (await fetch(`${BASE}/api/sessions/${mine!.id}/messages`)).json()).messages as {
  kind: string;
  askId: string | null;
}[];
const pendingAsk = [...msgs].reverse().find((m) => m.kind === 'ask' && m.askId);
await fetch(`${BASE}/api/sessions/${mine!.id}/reply`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ text: 'Yes', askId: pendingAsk!.askId }),
});

const askRes = await askPromise;
const askText = (askRes.content as { text: string }[])[0]?.text ?? '';
log(askText === 'Yes', 'ask_human round-trip', askText);

await client.close();
console.log('done');
