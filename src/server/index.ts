// Platform gateway: REST + WebSocket over the core store.
//
//   south (agents)  --HTTP-->  [ /api/sessions/* , /api/asks/* ]
//   north (humans)  --HTTP-->  [ /api/sessions , .../messages , .../reply ]
//                   --WS---->  [ /ws  live session + message events ]
//
// The MCP server (and any other agent adapter) talks to the south API. The web
// UI talks to the north API + WS. Both are thin layers over ../core/store.
import express, { type Request, type Response } from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { bus } from '../core/bus';
import * as store from '../core/store';
import { mountMcpHttp } from './mcp-http';
import { mountPtyWs, hasLivePty, writeToPty } from './pty';
import { startAgent, isOnline } from './wake';
import { getSettings, setSettings } from '../core/settings';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4319);
const REPO_ROOT = join(__dirname, '../..');
const WEB_DIST = join(REPO_ROOT, 'web/dist');
// Single source of truth for the running version (from package.json), surfaced
// via /api/health and the connect panel so an in-use install can tell whether
// it is up to date.
const VERSION = (() => {
  try {
    return (JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).version as string) ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();
// Resolved launch paths for the bundled MCP server, so the UI's "Connect an
// agent" panel can hand out copy-paste config with correct absolute paths.
const MCP_SERVER = join(REPO_ROOT, 'src/mcp/server.ts');
const TSX_CLI = join(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');
const SKILL_DIR = join(REPO_ROOT, 'skill/beacon');
const BEACON_CLI = join(SKILL_DIR, 'beacon.mjs');

const app = express();
app.use(express.json({ limit: '1mb' }));

const ok = (res: Response, body: unknown) => res.json(body);
const notFound = (res: Response) =>
  res.status(404).json({ error: 'session not found' });
// Express 5 types route params as string | string[]; we only use single values.
const param = (req: Request, key: string): string => String(req.params[key] ?? '');

// Optional agent-ingress auth. When PLATFORM_TOKEN is set, the south (agent) API
// requires it — so a random local process can't post as an agent. The north
// (human UI) is left open for same-origin local use; full human auth is roadmap.
const PLATFORM_TOKEN = process.env.PLATFORM_TOKEN ?? '';
function agentAuthOk(req: Request, res: Response): boolean {
  if (!PLATFORM_TOKEN) return true;
  const tok =
    req.header('x-platform-token') ??
    (req.header('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (tok === PLATFORM_TOKEN) return true;
  res.status(401).json({ error: 'unauthorized' });
  return false;
}

// ----------------------------------------------------------------------------
// South API — consumed by the MCP server / any agent adapter
// ----------------------------------------------------------------------------
app.post('/api/sessions/register', (req: Request, res: Response) => {
  if (!agentAuthOk(req, res)) return;
  const { runtime, workPath, task } = req.body ?? {};
  const session = store.createSession({
    runtime: String(runtime ?? 'unknown'),
    workPath: String(workPath ?? ''),
    task: String(task ?? ''),
  });
  ok(res, { session });
});

app.post('/api/sessions/:id/notify', (req: Request, res: Response) => {
  if (!agentAuthOk(req, res)) return;
  if (!store.getSession(param(req,'id'))) return notFound(res);
  store.touchSeen(param(req,'id'));
  const message = store.addMessage({
    sessionId: param(req,'id'),
    direction: 'agent',
    kind: 'notify',
    text: String(req.body?.text ?? ''),
  });
  ok(res, { message });
});

app.post('/api/sessions/:id/ask', (req: Request, res: Response) => {
  if (!agentAuthOk(req, res)) return;
  if (!store.getSession(param(req,'id'))) return notFound(res);
  store.touchSeen(param(req,'id'));
  const options = Array.isArray(req.body?.options)
    ? req.body.options.map(String)
    : null;
  const ask = store.createAsk({
    sessionId: param(req,'id'),
    question: String(req.body?.question ?? ''),
    options,
  });
  ok(res, { askId: ask.id, ask });
});

// Long-poll: resolves when answered/cancelled, or returns the pending ask after
// `timeoutMs` so the caller can re-poll cheaply.
app.get('/api/asks/:askId/wait', async (req: Request, res: Response) => {
  if (!agentAuthOk(req, res)) return;
  const timeoutMs = Math.min(Number(req.query.timeoutMs ?? 25000) || 25000, 60000);
  const waitingAsk = store.getAsk(param(req,'askId'));
  if (waitingAsk) store.touchSeen(waitingAsk.sessionId);
  try {
    const ask = await store.waitForAsk(param(req,'askId'), timeoutMs);
    ok(res, { ask });
  } catch (e) {
    res.status(404).json({ error: (e as Error).message });
  }
});

app.get('/api/asks/:askId', (req: Request, res: Response) => {
  const ask = store.getAsk(param(req,'askId'));
  if (!ask) return res.status(404).json({ error: 'ask not found' });
  ok(res, { ask });
});

app.post('/api/sessions/:id/status', (req: Request, res: Response) => {
  if (!agentAuthOk(req, res)) return;
  store.touchSeen(param(req,'id'));
  const session = store.setStatus(param(req,'id'), String(req.body?.status ?? ''));
  if (!session) return notFound(res);
  ok(res, { session });
});

app.get('/api/sessions/:id/inbox', (req: Request, res: Response) => {
  if (!agentAuthOk(req, res)) return;
  if (!store.getSession(param(req,'id'))) return notFound(res);
  store.touchSeen(param(req,'id'));
  const after = Number(req.query.after ?? 0) || 0;
  ok(res, { messages: store.inbox(param(req,'id'), after) });
});

// ----------------------------------------------------------------------------
// North API — consumed by the human-facing UI
// ----------------------------------------------------------------------------
app.get('/api/sessions', (_req: Request, res: Response) => {
  ok(res, { sessions: store.listSessions() });
});

app.get('/api/sessions/:id', (req: Request, res: Response) => {
  const session = store.getSession(param(req,'id'));
  if (!session) return notFound(res);
  ok(res, { session });
});

app.get('/api/sessions/:id/messages', (req: Request, res: Response) => {
  const session = store.getSession(param(req,'id'));
  if (!session) return notFound(res);
  ok(res, { session, messages: store.messages(param(req,'id')) });
});

app.post('/api/sessions/:id/reply', (req: Request, res: Response) => {
  if (!store.getSession(param(req,'id'))) return notFound(res);
  const text = String(req.body?.text ?? '');
  const message = store.reply(
    param(req,'id'),
    text,
    req.body?.askId ? String(req.body.askId) : null
  );
  // Deliver the message to the agent. The terminal IS the agent: if one is
  // running we type into it; if not, we spawn it on demand. Either way the
  // message reaches a real agent — no "offline"/"queued" dead-ends. The only
  // exceptions: an ask answer (resolved via the long-poll channel), and a
  // genuinely-autonomous agent already polling its own inbox.
  const session = store.getSession(param(req,'id'))!;
  let agent: 'online' | 'starting' | 'offline' | 'queued' = 'online';
  const isAskAnswer = !!req.body?.askId;

  if (isAskAnswer) {
    // store.reply already resolved the pending ask + unblocked the agent.
  } else if (hasLivePty(session.id)) {
    writeToPty(session.id, text); // existing live terminal
  } else if (isOnline(session)) {
    // An autonomous agent (MCP/skill) is actively polling its inbox; leave the
    // message for it to pick up rather than spawning a duplicate terminal.
  } else if (writeToPty(session.id, text)) {
    // No agent anywhere — start an interactive terminal on demand and type into
    // it. Output is buffered until the user opens the Terminal view.
  } else {
    agent = 'queued'; // runtime we can't launch (rare)
  }
  ok(res, { message, agent });
});

// Start an offline agent now (the UI's one-click "start it" action).
app.post('/api/sessions/:id/start', (req: Request, res: Response) => {
  const session = store.getSession(param(req, 'id'));
  if (!session) return notFound(res);
  const text = String(req.body?.text ?? '');
  const result = startAgent(session, text, getSettings().startPermission);
  ok(res, { result });
});

// In-app settings (no env vars).
app.get('/api/settings', (_req: Request, res: Response) => ok(res, { settings: getSettings() }));
app.put('/api/settings', (req: Request, res: Response) => {
  const body = req.body ?? {};
  const patch: Record<string, unknown> = {};
  if (typeof body.autoStart === 'string') patch.autoStart = body.autoStart;
  if (typeof body.startPermission === 'string') patch.startPermission = body.startPermission;
  ok(res, { settings: setSettings(patch) });
});

app.post('/api/asks/:askId/cancel', (req: Request, res: Response) => {
  const ask = store.cancelAsk(param(req,'askId'));
  if (!ask) return res.status(404).json({ error: 'ask not found' });
  ok(res, { ask });
});

// Chat management — rename and/or archive a conversation. Both fields optional;
// title:'' (or null) reverts to the agent's original task; archived toggles
// whether the session is hidden from the active list.
app.patch('/api/sessions/:id', (req: Request, res: Response) => {
  const id = param(req, 'id');
  if (!store.getSession(id)) return notFound(res);
  let session = store.getSession(id)!;
  if ('title' in (req.body ?? {})) {
    const t = req.body.title;
    session = store.renameSession(id, t == null ? null : String(t)) ?? session;
  }
  if (typeof req.body?.archived === 'boolean') {
    session = store.setArchived(id, req.body.archived) ?? session;
  }
  ok(res, { session });
});

app.get('/api/health', (_req: Request, res: Response) =>
  res.json({ ok: true, version: VERSION, ts: Date.now() })
);

// Everything the "Connect an agent" UI needs: resolved launch command + ready
// copy-paste snippets per runtime. Paths are resolved server-side so the user
// never hand-wrangles them.
app.get('/api/connect-info', (req: Request, res: Response) => {
  const host = req.get('host') ?? `127.0.0.1:${PORT}`;
  const proto = (req.get('x-forwarded-proto') ?? req.protocol) || 'http';
  const platformUrl = `${proto}://${host}`;
  const mcpUrl = `${platformUrl}/mcp`;
  const q = (s: string) => (s.includes(' ') ? `"${s}"` : s);
  const env: Record<string, string> = { PLATFORM_URL: platformUrl, AGENT_RUNTIME: 'claude-code' };
  const tokenHeader = PLATFORM_TOKEN ? ` --header "x-platform-token: <YOUR_TOKEN>"` : '';
  res.json({
    platformUrl,
    version: VERSION,
    requiresToken: !!PLATFORM_TOKEN,
    serverPath: MCP_SERVER,
    command: 'node',
    args: [TSX_CLI, MCP_SERVER],
    tools: ['register_session', 'notify_human', 'ask_human', 'update_status', 'check_inbox'],
    // Recommended MCP onboarding — hosted HTTP transport. One global, path-free
    // command; never changes when the platform is updated (the URL is the
    // contract). `-s user` registers it for every project at once.
    mcpUrl,
    claudeMcpHttp:
      `claude mcp add --transport http -s user beacon ${mcpUrl}${tokenHeader}`,
    codexMcpHttp: `codex mcp add beacon --url ${mcpUrl}`,
    // Method 1 — the zero-config skill (recommended for Claude Code). No MCP,
    // no restart; install once, then the agent runs the bundled CLI.
    skill: {
      sourceDir: SKILL_DIR,
      cliPath: BEACON_CLI,
      install: `cp -r ${q(SKILL_DIR)} ~/.claude/skills/beacon`,
      installWindows: `xcopy /E /I "${SKILL_DIR}" "%USERPROFILE%\\.claude\\skills\\beacon"`,
      usage: [
        `node ${q(BEACON_CLI)} register "What I am doing"`,
        `node ${q(BEACON_CLI)} notify "progress update"`,
        `node ${q(BEACON_CLI)} ask "Proceed?" "Yes" "No"`,
        `node ${q(BEACON_CLI)} status done`,
      ],
    },
    // Method 2 — MCP. One-time command: persists into the Claude Code MCP list.
    claudeMcpAdd:
      `claude mcp add beacon -e PLATFORM_URL=${platformUrl} -e AGENT_RUNTIME=claude-code ` +
      `-- node ${q(TSX_CLI)} ${q(MCP_SERVER)}`,
    // Drop-in .mcp.json for a project.
    mcpJson: {
      mcpServers: { beacon: { command: 'node', args: [TSX_CLI, MCP_SERVER], env },
      },
    },
    codexMcpAdd:
      `codex mcp add beacon --env PLATFORM_URL=${platformUrl} --env AGENT_RUNTIME=codex ` +
      `-- node ${q(TSX_CLI)} ${q(MCP_SERVER)}`,
    httpExample:
      `curl -X POST ${platformUrl}/api/sessions/register ` +
      `-H "content-type: application/json" ` +
      `-d '{"runtime":"my-agent","workPath":"/path/to/work","task":"What I am doing"}'`,
  });
});

// ----------------------------------------------------------------------------
// Hosted MCP endpoint (Streamable HTTP at /mcp) — registered before the static
// SPA fallback so it isn't swallowed by it.
// ----------------------------------------------------------------------------
mountMcpHttp(app, { token: PLATFORM_TOKEN });

// ----------------------------------------------------------------------------
// Static frontend (production build) with SPA fallback
// ----------------------------------------------------------------------------
if (existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get(/^(?!\/api\/).*/, (_req: Request, res: Response) =>
    res.sendFile(join(WEB_DIST, 'index.html'))
  );
}

// ----------------------------------------------------------------------------
// WebSocket: push live session + message events to all connected clients
// ----------------------------------------------------------------------------
const server = createServer(app);
// Both WS endpoints share one HTTP server. We must use noServer mode and route
// the `upgrade` event by path ourselves — if two WebSocketServer instances each
// bind via the `server` option, the first one rejects upgrades for the other's
// path with a 400 before the right one can handle them.
const wss = new WebSocketServer({ noServer: true });
const ptyWss = mountPtyWs(PLATFORM_TOKEN);

server.on('upgrade', (req, socket, head) => {
  let pathname = '/';
  try {
    pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  } catch { /* keep default */ }
  if (pathname === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } else if (pathname === '/pty') {
    ptyWss.handleUpgrade(req, socket, head, (ws) => ptyWss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'hello', sessions: store.listSessions() }));
});

function broadcast(payload: unknown) {
  const data = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(data);
  }
}
bus.on('session', (session) => broadcast({ type: 'session', session }));
bus.on('message', (message) => broadcast({ type: 'message', message }));

server.requestTimeout = 0; // allow long-poll /wait without being killed
server.listen(PORT, () => {
  console.log(`[platform] listening on http://127.0.0.1:${PORT}`);
  console.log(`[platform] web build: ${existsSync(WEB_DIST) ? WEB_DIST : '(dev mode — run Vite separately)'}`);
});
