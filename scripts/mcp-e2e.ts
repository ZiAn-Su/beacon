// REAL agent-chain end-to-end test.
//
// Spins up the actual MCP server (src/mcp/server.ts) over stdio via the MCP SDK
// Client — exactly how Claude Code / Codex would drive it — and exercises the
// full south->core->north->core->south round-trip:
//
//   register_session -> notify_human -> update_status -> ask_human (BLOCKS)
//        ...human answers via the north REST API...
//   ask_human returns the human's answer  -> check_inbox picks up free chat
//
// Requires the platform running (npm run platform). Run: npm run e2e
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const BASE = process.env.PLATFORM_URL ?? 'http://127.0.0.1:4319';
const TASK = `E2E real-agent chain ${Date.now()}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function rest<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

function textOf(result: any): string {
  return (result?.content ?? [])
    .filter((c: any) => c.type === 'text')
    .map((c: any) => c.text)
    .join('\n');
}

let failures = 0;
function check(label: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

async function main() {
  // Launch the real MCP server as a subprocess over stdio (the agent link).
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['--import', 'tsx', 'src/mcp/server.ts'],
    env: { ...process.env, PLATFORM_URL: BASE, AGENT_RUNTIME: 'claude-code' } as Record<string, string>,
  });
  const client = new Client({ name: 'e2e-test', version: '1.0.0' });
  await client.connect(transport);

  // The agent advertises its tools.
  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name).sort();
  check('MCP exposes the 5 tools', names.join(',') === 'ask_human,check_inbox,notify_human,register_session,update_status', names.join(','));

  // 1. register_session
  const reg = await client.callTool({ name: 'register_session', arguments: { task: TASK, work_path: 'F:/Project/demo' } });
  check('register_session returns confirmation', /Registered as session/.test(textOf(reg)), textOf(reg));

  // 2. notify_human (non-blocking)
  await client.callTool({ name: 'notify_human', arguments: { message: 'Starting the deploy pipeline.' } });

  // 3. update_status -> working
  await client.callTool({ name: 'update_status', arguments: { status: 'working' } });

  // Find the session the agent just created.
  await sleep(400);
  const { sessions } = await rest<{ sessions: any[] }>('/api/sessions');
  const session = sessions.find((s) => s.task === TASK);
  check('session visible to the human side', !!session, session ? session.id : 'not found');
  if (!session) throw new Error('session not found — aborting');
  check('status reflects working', session.status === 'working', session.status);

  // 4. ask_human — BLOCKS. Kick it off without awaiting.
  const askPromise = client.callTool({ name: 'ask_human', arguments: { question: 'E2E: approve production deploy?', options: ['Approve', 'Reject'] } });

  // Give the ask time to register, then confirm the session flipped to waiting.
  await sleep(1200);
  const waitingSession = (await rest<{ session: any }>(`/api/sessions/${session.id}`)).session;
  check('ask flips session to waiting', waitingSession.status === 'waiting', waitingSession.status);

  // The human answers via the north REST API (what the UI's reply button does).
  const { messages } = await rest<{ messages: any[] }>(`/api/sessions/${session.id}/messages`);
  const askMsg = messages.find((m) => m.kind === 'ask' && m.askId);
  check('ask surfaced as a message with options', !!askMsg && !!askMsg.meta?.options, askMsg ? JSON.stringify(askMsg.meta) : 'none');
  await rest(`/api/sessions/${session.id}/reply`, {
    method: 'POST',
    body: JSON.stringify({ text: 'Approve', askId: askMsg.askId }),
  });

  // 5. ask_human must now unblock and return the human's answer.
  const askResult = await Promise.race([
    askPromise,
    sleep(8000).then(() => ({ __timeout: true } as any)),
  ]);
  check('ask_human unblocked (no timeout)', !askResult?.__timeout);
  check('ask_human returned the human answer', textOf(askResult) === 'Approve', textOf(askResult));

  // session should be back to working
  const afterAnswer = (await rest<{ session: any }>(`/api/sessions/${session.id}`)).session;
  check('session back to working after answer', afterAnswer.status === 'working', afterAnswer.status);

  // 6. check_inbox — human sends free chat, agent picks it up.
  await rest(`/api/sessions/${session.id}/reply`, {
    method: 'POST',
    body: JSON.stringify({ text: 'Also: skip the changelog step.' }),
  });
  await sleep(300);
  const inbox = await client.callTool({ name: 'check_inbox', arguments: {} });
  check('check_inbox receives the free chat', /skip the changelog/.test(textOf(inbox)), textOf(inbox));

  await client.close();

  console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('[e2e] error:', e);
  process.exit(1);
});
