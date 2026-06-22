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
import { SESSION_STATUSES } from '../core/types';
import {
  CAPABILITIES,
  EFFECTS,
  isCapability,
  isEffect,
} from '../core/permissions';
import { mountMcpHttp } from './mcp-http';
import { mountPtyWs, hasLivePty, writeToPty, ensurePty, markFreshLaunch, killPty } from './pty';
import { fanOutChannelMessage } from './channel-delivery';
import { startAgent, isOnline } from './wake';
import { resolveActiveSessionId, listAgentSessions } from './agent-sessions';
import { getSettings, setSettings } from '../core/settings';
import { saveUpload, resolveUpload } from './uploads';

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
// Image uploads carry a base64 body that can be several MB; everything else stays
// on the tight 1mb limit. Route the big parser only at /api/uploads.
const jsonSmall = express.json({ limit: '1mb' });
const jsonUpload = express.json({ limit: '28mb' });
app.use((req, res, next) => {
  if (req.path === '/api/uploads') return jsonUpload(req, res, next);
  return jsonSmall(req, res, next);
});
// ISS-009: return JSON error (not HTML stack-trace) for malformed request bodies.
app.use((err: unknown, _req: Request, res: Response, next: (e: unknown) => void) => {
  const e = err as { type?: string; status?: number; message?: string };
  if (e.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'invalid json' });
    return;
  }
  next(err);
});

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
  const { runtime, workPath, task, bindKey, name, description, origin, nativeSessionId } = req.body ?? {};
  // ISS-003: require runtime and task; workPath optional (some agents run anywhere)
  if (!String(runtime ?? '').trim()) {
    res.status(400).json({ error: 'runtime is required' }); return;
  }
  if (!String(task ?? '').trim()) {
    res.status(400).json({ error: 'task is required' }); return;
  }
  // Identity Phase 1: optional bindKey (continuation), name (display title) and
  // origin ('agent'|'human'; anything else falls back to 'agent').
  // The native session id is objective on-disk truth, so the PLATFORM resolves it
  // from the runtime's transcripts (by work path) rather than trusting the agent.
  // The self-reported value is only a fallback for agents whose disk the platform
  // can't see (e.g. a remote agent reaching a hosted platform). Passed into
  // registerOrClaim so it can both MATCH an existing contact and stamp the result.
  const resolved =
    resolveActiveSessionId(String(workPath ?? ''), String(runtime)) ??
    (nativeSessionId != null ? String(nativeSessionId) : null);
  const session = store.registerOrClaim({
    runtime: String(runtime),
    workPath: String(workPath ?? ''),
    task: String(task),
    bindKey: bindKey != null ? String(bindKey) : null,
    nativeSessionId: nativeSessionId != null ? String(nativeSessionId) : null,
    resolvedNativeId: resolved,
    origin: origin === 'human' ? 'human' : 'agent',
    name: name != null ? String(name) : null,
    description: description != null ? String(description) : null,
  });
  // `pending` tells the agent the owner hasn't admitted it yet (quarantined):
  // it can hold its card but peers can't see or contact it until approved.
  ok(res, { session, agentId: session.id, pending: session.admittedAt == null });
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
  // ISS-004: empty question blocks the session in 'waiting' with nothing to show
  if (!String(req.body?.question ?? '').trim()) {
    res.status(400).json({ error: 'question is required' }); return;
  }
  store.touchSeen(param(req,'id'));
  const options = Array.isArray(req.body?.options)
    ? req.body.options.map(String)
    : null;
  const ask = store.createAsk({
    sessionId: param(req,'id'),
    question: String(req.body.question),
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
  // ISS-005: reject invalid status values explicitly rather than silently ignoring them
  const status = String(req.body?.status ?? '');
  if (!(SESSION_STATUSES as string[]).includes(status)) {
    res.status(400).json({ error: `invalid status; must be one of: ${SESSION_STATUSES.join(', ')}` }); return;
  }
  store.touchSeen(param(req,'id'));
  const session = store.setStatus(param(req,'id'), status);
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

// The agent revises its own card (display name and/or self-introduction) at any
// time. body { name?, about? } — each field optional; '' / null clears it.
app.post('/api/sessions/:id/profile', (req: Request, res: Response) => {
  if (!agentAuthOk(req, res)) return;
  if (!store.getSession(param(req, 'id'))) return notFound(res);
  const body = req.body ?? {};
  const patch: { name?: string | null; description?: string | null } = {};
  if ('name' in body) patch.name = body.name == null ? null : String(body.name);
  if ('about' in body) patch.description = body.about == null ? null : String(body.about);
  if (!('name' in patch) && !('description' in patch)) {
    res.status(400).json({ error: 'expected name and/or about' }); return;
  }
  store.touchSeen(param(req, 'id'));
  const session = store.updateProfile(param(req, 'id'), patch);
  ok(res, { session });
});

// --- agent -> agent (peer) ---
// Per-pair authorization: resolvePeerPermission folds the global master switch
// (agentComm 'off'), any exact-pair grant, the sender's trust tier, and the
// default visible scope (same working directory) into allow/deny/approval
// (most-specific wins). Call after both sessions are known to exist.
function peerAuthOk(res: Response, fromId: string, toId: string): boolean {
  const verdict = store.resolvePeerPermission(fromId, toId);
  if (verdict === 'allow') return true;
  if (verdict === 'approval') {
    // Eligible but not yet authorized. Phase 2 turns this into an
    // agent-initiated request that surfaces to the guardian for approval.
    res.status(403).json({ error: 'contact requires guardian approval', need: 'approval' });
    return false;
  }
  res.status(403).json({ error: 'not authorized to contact this agent' });
  return false;
}

// Non-blocking agent->agent FYI. body { targetId, text }.
app.post('/api/sessions/:id/peer-notify', (req: Request, res: Response) => {
  if (!agentAuthOk(req, res)) return;
  const targetId = String(req.body?.targetId ?? '');
  const text = String(req.body?.text ?? '');
  if (!text.trim()) { res.status(400).json({ error: 'text is required' }); return; }
  if (!store.getSession(param(req, 'id'))) return notFound(res);
  if (!store.getSession(targetId)) return notFound(res);
  if (!peerAuthOk(res, param(req, 'id'), targetId)) return;
  store.touchSeen(param(req, 'id'));
  try {
    const message = store.peerNotify(param(req, 'id'), targetId, text);
    ok(res, { message });
  } catch {
    notFound(res);
  }
});

// Blocking agent->agent question. body { targetId, question, options? }. The
// asker then long-polls the EXISTING GET /api/asks/:askId/wait endpoint.
app.post('/api/sessions/:id/peer-ask', (req: Request, res: Response) => {
  if (!agentAuthOk(req, res)) return;
  const targetId = String(req.body?.targetId ?? '');
  if (!String(req.body?.question ?? '').trim()) {
    res.status(400).json({ error: 'question is required' }); return;
  }
  if (!store.getSession(param(req, 'id'))) return notFound(res);
  if (!store.getSession(targetId)) return notFound(res);
  if (!peerAuthOk(res, param(req, 'id'), targetId)) return;
  store.touchSeen(param(req, 'id'));
  const options = Array.isArray(req.body?.options)
    ? req.body.options.map(String)
    : null;
  try {
    const ask = store.peerAsk(param(req, 'id'), targetId, String(req.body.question), options);
    ok(res, { askId: ask.id });
  } catch {
    notFound(res);
  }
});

// The recipient answers a peer-ask, unblocking the asker. body { askId, text }.
// :id is the answerer (recorded as the answer's fromSessionId).
app.post('/api/sessions/:id/peer-reply', (req: Request, res: Response) => {
  if (!agentAuthOk(req, res)) return;
  const askId = String(req.body?.askId ?? '');
  const text = String(req.body?.text ?? '');
  if (!text.trim()) { res.status(400).json({ error: 'text is required' }); return; }
  const existing = store.getAsk(askId);
  if (!existing) { res.status(404).json({ error: 'ask not found' }); return; }
  if (existing.status !== 'pending') { res.status(409).json({ error: 'ask not pending' }); return; }
  store.touchSeen(param(req, 'id'));
  store.agentAnswer(askId, text, param(req, 'id'));
  ok(res, { ok: true });
});

// Agent-initiated request to be allowed to contact another agent. Only valid
// when the verdict is 'approval' (visible peer, standard tier, no standing
// grant): creates a guardian approval the human answers. 'allow' => already
// authorized (no-op); 'deny' => not eligible (not visible). body { targetId, reason? }.
app.post('/api/sessions/:id/request-contact', (req: Request, res: Response) => {
  if (!agentAuthOk(req, res)) return;
  const targetId = String(req.body?.targetId ?? '');
  const reason = req.body?.reason != null ? String(req.body.reason) : null;
  if (!store.getSession(param(req, 'id'))) return notFound(res);
  if (!store.getSession(targetId)) return notFound(res);
  store.touchSeen(param(req, 'id'));
  const verdict = store.resolvePeerPermission(param(req, 'id'), targetId);
  if (verdict === 'allow') { ok(res, { status: 'allowed' }); return; }
  if (verdict === 'deny') {
    res.status(403).json({ error: 'not eligible to contact this agent' });
    return;
  }
  const cr = store.createContactRequest(param(req, 'id'), targetId, reason);
  ok(res, { status: 'pending', askId: cr.askId, requestId: cr.id });
});

// ----------------------------------------------------------------------------
// North API — consumed by the human-facing UI
// ----------------------------------------------------------------------------
app.get('/api/sessions', (_req: Request, res: Response) => {
  ok(res, { sessions: store.listSessions() });
});

// --- add an agent from the UI ---
// Discover the runtime's existing conversations under a folder (objective, from
// disk), so the human can import one as a contact. ?path=<workPath>&runtime=...
// Each entry is flagged with whether it's already imported (a Beacon session
// already carries that native id).
app.get('/api/discover', (req: Request, res: Response) => {
  const path = String(req.query.path ?? '');
  const runtime = String(req.query.runtime ?? 'claude-code');
  if (!path.trim()) { res.status(400).json({ error: 'path is required' }); return; }
  const found = listAgentSessions(path, runtime);
  const sessions = found.map((s) => {
    const existing = store.getSessionByNativeId(s.nativeSessionId);
    return { ...s, importedAs: existing ? existing.id : null };
  });
  ok(res, { sessions });
});

// Import a discovered conversation as a contact. Idempotent on native id.
// body { workPath, runtime, nativeSessionId, name? }
app.post('/api/sessions/import', (req: Request, res: Response) => {
  const body = req.body ?? {};
  const workPath = String(body.workPath ?? '');
  const runtime = String(body.runtime ?? 'claude-code');
  const nativeSessionId = String(body.nativeSessionId ?? '');
  const name = body.name != null ? String(body.name) : null;
  if (!nativeSessionId.trim()) { res.status(400).json({ error: 'nativeSessionId is required' }); return; }
  const existing = store.getSessionByNativeId(nativeSessionId);
  if (existing) { ok(res, { session: existing, imported: false }); return; }
  const session = store.createSession({
    runtime,
    workPath,
    task: name ?? '',
    name,
    nativeSessionId,
    origin: 'human',
  });
  ok(res, { session, imported: true });
});

// Create a brand-new agent and launch it in the chosen folder, wired to Beacon
// (BEACON_SESSION_ID is injected by the PTY so the agent attaches to THIS
// contact). body { workPath, runtime, name?, task? }
// Create a contact and launch a fresh agent process in its folder, wired to
// Beacon. Shared by the human "launch" action and the agent-initiated "spawn"
// capability. `origin` records who created it; the contact is admitted at
// creation because the launch is already owner-authorized (directly, or via the
// spawn_agent policy / approval).
function spawnAgent(params: {
  workPath: string;
  runtime: string;
  name?: string | null;
  task?: string | null;
  origin: 'agent' | 'human';
}) {
  const session = store.createSession({
    runtime: params.runtime || 'claude-code',
    workPath: params.workPath,
    task: params.task ?? '',
    name: params.name ?? null,
    origin: params.origin,
  });
  // The agent's first registration (any transport) attaches to THIS contact
  // instead of opening a duplicate.
  store.markPendingLaunch(session.id);
  // Start a fresh agent process (not a resume) in the folder.
  markFreshLaunch(session.id);
  const launched = ensurePty(session.id);
  return { session, launched };
}

app.post('/api/sessions/launch', (req: Request, res: Response) => {
  const body = req.body ?? {};
  const workPath = String(body.workPath ?? '');
  const runtime = String(body.runtime ?? 'claude-code');
  const name = body.name != null ? String(body.name) : null;
  const task = body.task != null ? String(body.task) : '';
  if (!workPath.trim()) { res.status(400).json({ error: 'workPath is required' }); return; }
  const { session, launched } = spawnAgent({ workPath, runtime, name, task, origin: 'human' });
  ok(res, { session, launched });
});

// Agent directory. Human side (no query) => every contact. Agent-side discovery
// passes ?visibleTo=<sessionId> and gets only that agent's visible scope (same
// working directory + its allow-granted peers), so an agent never enumerates the
// whole roster — addressing range = visibility range.
app.get('/api/agents', (req: Request, res: Response) => {
  const visibleTo = req.query.visibleTo;
  if (visibleTo != null) {
    const id = Array.isArray(visibleTo) ? String(visibleTo[0]) : String(visibleTo);
    ok(res, { agents: store.visibleAgentsFor(id) });
    return;
  }
  ok(res, { agents: store.listSessions() });
});

// --- per-pair authorization grants (north / human side) ---
const VALID_GRANT_EFFECT = ['allow', 'deny'] as const;

app.get('/api/grants', (_req: Request, res: Response) => {
  ok(res, { grants: store.listGrants() });
});

// Contact requests (agent-initiated) for human observability — pending ones are
// also answerable inline as the ask they back.
app.get('/api/contact-requests', (_req: Request, res: Response) => {
  ok(res, { requests: store.listContactRequests() });
});

app.post('/api/grants', (req: Request, res: Response) => {
  const body = req.body ?? {};
  const fromId = String(body.fromId ?? '');
  const toId = String(body.toId ?? '');
  const effect = String(body.effect ?? '');
  if (!(VALID_GRANT_EFFECT as readonly string[]).includes(effect)) {
    res.status(400).json({ error: `invalid effect; must be one of: ${VALID_GRANT_EFFECT.join(', ')}` }); return;
  }
  if (!store.getSession(fromId)) return notFound(res);
  if (!store.getSession(toId)) return notFound(res);
  const grant = store.setGrant(fromId, toId, effect as 'allow' | 'deny');
  ok(res, { grant });
});

app.delete('/api/grants/:id', (req: Request, res: Response) => {
  store.removeGrant(param(req, 'id'));
  ok(res, { ok: true });
});

// --- owner permission model (capabilities) ---
// Everything the UI needs to render the permission panel: the capability set,
// the three effects, the owner global defaults and the agent-to-agent master
// switch.
app.get('/api/permissions', (_req: Request, res: Response) => {
  ok(res, {
    capabilities: CAPABILITIES,
    effects: EFFECTS,
    globalDefaults: getSettings().permissions,
    agentComm: getSettings().agentComm,
  });
});

// Per-agent capability override (beats the tier preset / global default). body
// { capability, effect } where effect is allow|ask|deny, or null to clear it.
app.put('/api/sessions/:id/policy', (req: Request, res: Response) => {
  const id = param(req, 'id');
  if (!store.getSession(id)) return notFound(res);
  const body = req.body ?? {};
  const capability = String(body.capability ?? '');
  if (!isCapability(capability)) {
    res.status(400).json({ error: `invalid capability; must be one of: ${CAPABILITIES.join(', ')}` }); return;
  }
  const raw = body.effect;
  if (raw !== null && !(typeof raw === 'string' && isEffect(raw))) {
    res.status(400).json({ error: 'invalid effect; must be allow, ask, deny or null' }); return;
  }
  const session = store.setAgentPolicy(id, capability, raw === null ? null : (raw as 'allow' | 'ask' | 'deny'));
  ok(res, { session, policies: store.getAgentPolicies(id) });
});

app.get('/api/sessions/:id/policy', (req: Request, res: Response) => {
  const id = param(req, 'id');
  if (!store.getSession(id)) return notFound(res);
  ok(res, { policies: store.getAgentPolicies(id) });
});

// --- admission (register_agent gate) ---
// Agents quarantined pending the owner's decision (admittedAt == null).
app.get('/api/admissions', (_req: Request, res: Response) => {
  ok(res, { pending: store.listPendingAdmissions() });
});

// Owner admits or rejects a quarantined agent. body { approve: boolean }.
// approve -> the agent goes live; reject -> it is deleted.
app.post('/api/sessions/:id/admit', (req: Request, res: Response) => {
  const id = param(req, 'id');
  if (!store.getSession(id)) return notFound(res);
  const approve = req.body?.approve !== false; // default approve
  if (approve) {
    const session = store.admitSession(id);
    ok(res, { session, admitted: true });
  } else {
    killPty(id);
    const removed = store.deleteSession(id);
    ok(res, { ok: removed, admitted: false });
  }
});

// --- spawn requests (spawn_agent gate) ---
app.get('/api/spawn-requests', (_req: Request, res: Response) => {
  ok(res, { pending: store.listPendingSpawnRequests() });
});

// Agent-initiated spawn of a new agent. :id is the spawner. Gated by the
// spawn_agent capability: allow -> launch now; deny -> 403; ask -> raise an owner
// approval and return pending (the spawn runs when the owner approves, via the
// reply path or POST .../spawn-approve). body { workPath, runtime?, name?, task? }.
app.post('/api/sessions/:id/spawn', (req: Request, res: Response) => {
  if (!agentAuthOk(req, res)) return;
  const id = param(req, 'id');
  if (!store.getSession(id)) return notFound(res);
  const body = req.body ?? {};
  const workPath = String(body.workPath ?? '');
  if (!workPath.trim()) { res.status(400).json({ error: 'workPath is required' }); return; }
  const params = {
    workPath,
    runtime: String(body.runtime ?? 'claude-code'),
    name: body.name != null ? String(body.name) : null,
    task: body.task != null ? String(body.task) : null,
  };
  store.touchSeen(id);
  const verdict = store.resolveCapability(id, 'spawn_agent');
  if (verdict === 'deny') {
    res.status(403).json({ error: 'not authorized to spawn agents' }); return;
  }
  if (verdict === 'ask') {
    const askId = store.createSpawnRequest(id, params);
    ok(res, { status: 'pending', askId }); return;
  }
  const { session, launched } = spawnAgent({ ...params, origin: 'agent' });
  ok(res, { status: 'spawned', session, launched });
});

// Owner approves/denies a pending spawn request from the tray. body { approve }.
app.post('/api/spawn-requests/:askId/decide', (req: Request, res: Response) => {
  const askId = param(req, 'askId');
  const sr = store.getSpawnRequestByAsk(askId);
  if (!sr || sr.status !== 'pending') { res.status(404).json({ error: 'no pending spawn request' }); return; }
  const approve = req.body?.approve !== false;
  let spawned: unknown = null;
  if (approve) spawned = spawnAgent({ ...sr.params, origin: 'agent' }).session;
  store.decideSpawnRequest(askId, approve);
  // Resolve the backing ask so the spawner unblocks / the card stops being pending.
  const ask = store.getAsk(askId);
  if (ask && ask.status === 'pending') store.reply(sr.spawnerId, approve ? 'approve' : 'deny', askId);
  ok(res, { approve, spawned });
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
  // ISS-006: if caller supplies an askId, verify it exists and is still pending
  // before writing anything, rather than silently degrading to free chat.
  const rawAskId = req.body?.askId ? String(req.body.askId) : null;
  if (rawAskId) {
    const existing = store.getAsk(rawAskId);
    if (!existing || existing.status !== 'pending') {
      res.status(404).json({ error: 'ask not found or not pending' }); return;
    }
  }
  const text = String(req.body?.text ?? '');
  // Image attachments: the client sends upload ids; we re-derive the authoritative
  // path/mime/url server-side (never trust a client-sent path). Stored in the
  // message meta for the UI thumbnail; the absolute path is appended to the text
  // delivered to the agent so it can read the file.
  const rawAtt = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
  const attachments: { id: string; name: string; mime: string; url: string; path: string }[] = [];
  for (const a of rawAtt) {
    const aid = String(a?.id ?? '');
    const found = resolveUpload(aid);
    if (!found) continue;
    const name = String(a?.name ?? '').slice(0, 200) || aid;
    attachments.push({ id: aid, name, mime: found.mime, url: `/api/uploads/${aid}`, path: found.path });
  }
  const meta = attachments.length ? { attachments } : null;
  const message = store.reply(param(req,'id'), text, rawAskId, meta);
  // What the agent actually receives: the caption plus each image's absolute path.
  const deliveredText = attachments.length
    ? [text.trim(), ...attachments.map((a) => `[image: ${a.path}]`)].filter(Boolean).join(' ')
    : text;
  // If this answer settles a pending spawn request (the owner approving inline
  // from the chat card), perform the launch here — core can't touch the PTY.
  if (rawAskId) {
    const sr = store.getSpawnRequestByAsk(rawAskId);
    if (sr && sr.status === 'pending') {
      const approve = text.trim() === 'approve';
      if (approve) spawnAgent({ ...sr.params, origin: 'agent' });
      store.decideSpawnRequest(rawAskId, approve);
    }
  }
  // Deliver the message to the agent. The terminal IS the agent: if one is
  // running we type into it; if not, we spawn it on demand. Either way the
  // message reaches a real agent — no "offline"/"queued" dead-ends. The only
  // exceptions: an ask answer (resolved via the long-poll channel), and a
  // genuinely-autonomous agent already polling its own inbox.
  const session = store.getSession(param(req,'id'))!;
  let agent: 'online' | 'starting' | 'offline' | 'queued' = 'online';
  const isAskAnswer = !!rawAskId;

  if (isAskAnswer) {
    // store.reply already resolved the pending ask + unblocked the agent.
  } else if (hasLivePty(session.id)) {
    // ISS-010: check writeToPty return value — non-agent runtimes return false
    // even when a PTY exists (e.g. bare cmd.exe shells). Don't claim 'online'.
    if (!writeToPty(session.id, deliveredText)) agent = 'queued';
  } else if (isOnline(session)) {
    // An autonomous agent (MCP/skill) is actively polling its inbox; leave the
    // message for it to pick up rather than spawning a duplicate terminal.
  } else if (writeToPty(session.id, deliveredText)) {
    // No agent anywhere — start an interactive terminal on demand and type into
    // it. Output is buffered until the user opens the Terminal view.
  } else {
    agent = 'queued'; // runtime we can't launch (rare)
  }
  // Visibility: once a message reaches a live terminal agent, reflect that it's
  // active so the human isn't staring at a silent contact. A terminal agent
  // doesn't self-report status, so the gateway supplies this signal; the agent's
  // own update_status / notify refine it from there.
  if (!isAskAnswer && agent !== 'queued' && session.status !== 'working') {
    store.setStatus(session.id, 'working');
  }
  ok(res, { message, agent });
});

// Start an offline agent now (the UI's one-click "start it" action).
app.post('/api/sessions/:id/start', (req: Request, res: Response) => {
  const session = store.getSession(param(req, 'id'));
  if (!session) return notFound(res);
  const text = String(req.body?.text ?? '');
  // Prefer the persistent ConPTY path (same as /reply's on-demand spawn). On
  // Windows its subprocesses inherit a hidden pseudo-console, so the agent's
  // tool calls (bash/git/...) don't pop console windows — unlike a piped
  // `--print` child, whose grandchildren each allocate a visible console.
  if (writeToPty(session.id, text)) {
    if (session.status !== 'working') store.setStatus(session.id, 'working');
    ok(res, { result: 'started' });
    return;
  }
  // Fallback: a runtime Beacon can't drive as a ConPTY agent.
  const result = startAgent(session, text, getSettings().startPermission);
  ok(res, { result });
});

// In-app settings (no env vars).
app.get('/api/settings', (_req: Request, res: Response) => ok(res, { settings: getSettings() }));
const VALID_AUTO_START = ['ask', 'auto', 'off'] as const;
const VALID_PERMISSIONS = [
  'bypassPermissions', 'acceptEdits', 'default', 'plan',
] as const;
const VALID_AGENT_COMM = ['open', 'off'] as const;

app.put('/api/settings', (req: Request, res: Response) => {
  const body = req.body ?? {};
  // ISS-007: validate enum fields before writing
  if (typeof body.autoStart === 'string' && !(VALID_AUTO_START as readonly string[]).includes(body.autoStart)) {
    res.status(400).json({ error: `invalid autoStart; must be one of: ${VALID_AUTO_START.join(', ')}` }); return;
  }
  if (typeof body.startPermission === 'string' && !(VALID_PERMISSIONS as readonly string[]).includes(body.startPermission)) {
    res.status(400).json({ error: `invalid startPermission; must be one of: ${VALID_PERMISSIONS.join(', ')}` }); return;
  }
  if (typeof body.agentComm === 'string' && !(VALID_AGENT_COMM as readonly string[]).includes(body.agentComm)) {
    res.status(400).json({ error: `invalid agentComm; must be one of: ${VALID_AGENT_COMM.join(', ')}` }); return;
  }
  // Owner global capability defaults (allow/ask/deny per capability). Merge over
  // the current map so a partial patch only changes the keys it names.
  let permissions: Record<string, string> | undefined;
  if (body.permissions != null && typeof body.permissions === 'object') {
    const incoming = body.permissions as Record<string, unknown>;
    const merged: Record<string, string> = { ...getSettings().permissions };
    for (const cap of CAPABILITIES) {
      const v = incoming[cap];
      if (v != null) {
        if (typeof v !== 'string' || !isEffect(v)) {
          res.status(400).json({ error: `invalid effect for ${cap}; must be allow, ask or deny` }); return;
        }
        merged[cap] = v;
      }
    }
    permissions = merged;
  }
  const patch: Record<string, unknown> = {};
  if (typeof body.autoStart === 'string') patch.autoStart = body.autoStart;
  if (typeof body.startPermission === 'string') patch.startPermission = body.startPermission;
  if (typeof body.agentComm === 'string') patch.agentComm = body.agentComm;
  if (permissions) patch.permissions = permissions;
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
  // ISS-008: 400 if no recognised fields provided (hides misspelled field names)
  const body = req.body ?? {};
  if (!('title' in body) && !('description' in body) && typeof body.archived !== 'boolean') {
    res.status(400).json({ error: 'no patchable fields in body; expected title, description or archived' }); return;
  }
  let session = store.getSession(id)!;
  if ('title' in (req.body ?? {})) {
    const t = req.body.title;
    session = store.renameSession(id, t == null ? null : String(t)) ?? session;
  }
  if ('description' in (req.body ?? {})) {
    const d = req.body.description;
    session = store.setDescription(id, d == null ? null : String(d)) ?? session;
  }
  if (typeof req.body?.archived === 'boolean') {
    session = store.setArchived(id, req.body.archived) ?? session;
  }
  ok(res, { session });
});

// Permanently delete a contact (and its messages / asks / grants / requests).
// Kills any live terminal first. Irreversible — distinct from archive (PATCH).
app.delete('/api/sessions/:id', (req: Request, res: Response) => {
  const id = param(req, 'id');
  if (!store.getSession(id)) return notFound(res);
  killPty(id);
  const removed = store.deleteSession(id);
  ok(res, { ok: removed });
});

// Batch management for the directory: archive / unarchive / delete many at once.
// body { ids: string[], action: 'archive' | 'unarchive' | 'delete' }.
app.post('/api/sessions/batch', (req: Request, res: Response) => {
  const body = req.body ?? {};
  const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
  const action = String(body.action ?? '');
  if (!ids.length) { res.status(400).json({ error: 'ids is required' }); return; }
  let affected = 0;
  if (action === 'delete') {
    for (const id of ids) {
      killPty(id);
      if (store.deleteSession(id)) affected++;
    }
  } else if (action === 'archive' || action === 'unarchive') {
    const archived = action === 'archive';
    for (const id of ids) {
      if (store.setArchived(id, archived)) affected++;
    }
  } else {
    res.status(400).json({ error: 'invalid action; expected archive, unarchive or delete' }); return;
  }
  ok(res, { affected });
});

// ----------------------------------------------------------------------------
// Channels (group messaging) — north (human) CRUD + messages
// ----------------------------------------------------------------------------
const channelNotFound = (res: Response) => res.status(404).json({ error: 'channel not found' });

app.get('/api/channels', (_req: Request, res: Response) => {
  const channels = store.listChannels().map((c) => ({
    ...c,
    participants: store.listParticipants(c.id),
  }));
  ok(res, { channels });
});

app.post('/api/channels', (req: Request, res: Response) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) { res.status(400).json({ error: 'name is required' }); return; }
  const channel = store.createChannel(name);
  const ids = Array.isArray(req.body?.participants) ? req.body.participants.map(String) : [];
  for (const id of ids) if (store.getSession(id)) store.addParticipant(channel.id, id);
  ok(res, { channel, participants: store.listParticipants(channel.id) });
});

app.get('/api/channels/:id', (req: Request, res: Response) => {
  const id = param(req, 'id');
  const channel = store.getChannel(id);
  if (!channel) return channelNotFound(res);
  ok(res, {
    channel,
    participants: store.listParticipants(id),
    messages: store.channelMessages(id),
    states: store.channelMemberStates(id),
  });
});

app.patch('/api/channels/:id', (req: Request, res: Response) => {
  const id = param(req, 'id');
  if (!store.getChannel(id)) return channelNotFound(res);
  if (typeof req.body?.name === 'string') {
    ok(res, { channel: store.renameChannel(id, String(req.body.name)) }); return;
  }
  res.status(400).json({ error: 'no patchable fields; expected name' });
});

app.delete('/api/channels/:id', (req: Request, res: Response) => {
  const id = param(req, 'id');
  if (!store.getChannel(id)) return channelNotFound(res);
  ok(res, { ok: store.deleteChannel(id) });
});

app.post('/api/channels/:id/participants', (req: Request, res: Response) => {
  const id = param(req, 'id');
  if (!store.getChannel(id)) return channelNotFound(res);
  const sessionId = String(req.body?.sessionId ?? '');
  if (!store.getSession(sessionId)) return notFound(res);
  store.addParticipant(id, sessionId);
  ok(res, { participants: store.listParticipants(id) });
});

app.delete('/api/channels/:id/participants/:sessionId', (req: Request, res: Response) => {
  const id = param(req, 'id');
  if (!store.getChannel(id)) return channelNotFound(res);
  store.removeParticipant(id, param(req, 'sessionId'));
  ok(res, { participants: store.listParticipants(id) });
});

app.get('/api/channels/:id/messages', (req: Request, res: Response) => {
  const id = param(req, 'id');
  if (!store.getChannel(id)) return channelNotFound(res);
  ok(res, { messages: store.channelMessages(id) });
});

// Human (owner) posts to a channel. fromSessionId null = the human.
app.post('/api/channels/:id/messages', (req: Request, res: Response) => {
  const id = param(req, 'id');
  if (!store.getChannel(id)) return channelNotFound(res);
  const text = String(req.body?.text ?? '');
  if (!text.trim()) { res.status(400).json({ error: 'text is required' }); return; }
  const message = store.postChannelMessage(id, null, text);
  fanOutChannelMessage(message);
  ok(res, { message });
});

// Owner answers a pending channel ask (an agent asked the group). First answer
// wins; this unblocks the asker. body { askId, text }.
app.post('/api/channels/:id/answer', (req: Request, res: Response) => {
  const id = param(req, 'id');
  if (!store.getChannel(id)) return channelNotFound(res);
  const askId = String(req.body?.askId ?? '');
  const text = String(req.body?.text ?? '');
  if (!askId) { res.status(400).json({ error: 'askId is required' }); return; }
  if (!text.trim()) { res.status(400).json({ error: 'text is required' }); return; }
  const message = store.answerChannelAsk(id, askId, null, text);
  fanOutChannelMessage(message);
  ok(res, { message });
});

// North (UI): the channels a given session belongs to — powers the contact
// profile's "in these channels" section. Human-facing, so no agent token.
app.get('/api/sessions/:id/member-channels', (req: Request, res: Response) => {
  const id = param(req, 'id');
  if (!store.getSession(id)) return notFound(res);
  ok(res, { channels: store.channelsForSession(id) });
});

// --- south (agent) channel access ---
// An agent posts to a channel it belongs to. body { channelId, text }.
app.post('/api/sessions/:id/channel-post', (req: Request, res: Response) => {
  if (!agentAuthOk(req, res)) return;
  const id = param(req, 'id');
  if (!store.getSession(id)) return notFound(res);
  const channelId = String(req.body?.channelId ?? '');
  const text = String(req.body?.text ?? '');
  if (!store.getChannel(channelId)) return channelNotFound(res);
  if (!store.isParticipant(channelId, id)) {
    res.status(403).json({ error: 'not a participant of this channel' }); return;
  }
  if (!text.trim()) { res.status(400).json({ error: 'text is required' }); return; }
  store.touchSeen(id);
  const message = store.postChannelMessage(channelId, id, text);
  fanOutChannelMessage(message);
  ok(res, { message });
});

// An agent posts a BLOCKING question to a channel it belongs to. Returns askId;
// the agent then long-polls GET /api/asks/:askId/wait like any other ask.
// body { channelId, question, options? }.
app.post('/api/sessions/:id/channel-ask', (req: Request, res: Response) => {
  if (!agentAuthOk(req, res)) return;
  const id = param(req, 'id');
  if (!store.getSession(id)) return notFound(res);
  const channelId = String(req.body?.channelId ?? '');
  const question = String(req.body?.question ?? '');
  const options = Array.isArray(req.body?.options) ? req.body.options.map(String) : null;
  if (!store.getChannel(channelId)) return channelNotFound(res);
  if (!store.isParticipant(channelId, id)) {
    res.status(403).json({ error: 'not a participant of this channel' }); return;
  }
  if (!question.trim()) { res.status(400).json({ error: 'question is required' }); return; }
  store.touchSeen(id);
  const { ask, message } = store.createChannelAsk(channelId, id, question, options);
  fanOutChannelMessage(message);
  ok(res, { askId: ask.id });
});

// An agent answers a pending channel ask. body { channelId, askId, text }.
app.post('/api/sessions/:id/channel-answer', (req: Request, res: Response) => {
  if (!agentAuthOk(req, res)) return;
  const id = param(req, 'id');
  if (!store.getSession(id)) return notFound(res);
  const channelId = String(req.body?.channelId ?? '');
  const askId = String(req.body?.askId ?? '');
  const text = String(req.body?.text ?? '');
  if (!store.getChannel(channelId)) return channelNotFound(res);
  if (!store.isParticipant(channelId, id)) {
    res.status(403).json({ error: 'not a participant of this channel' }); return;
  }
  if (!askId) { res.status(400).json({ error: 'askId is required' }); return; }
  if (!text.trim()) { res.status(400).json({ error: 'text is required' }); return; }
  store.touchSeen(id);
  const message = store.answerChannelAsk(channelId, askId, id, text);
  fanOutChannelMessage(message);
  ok(res, { message });
});

// Channels an agent belongs to (for its addressing/list view).
app.get('/api/sessions/:id/channels', (req: Request, res: Response) => {
  if (!agentAuthOk(req, res)) return;
  const id = param(req, 'id');
  if (!store.getSession(id)) return notFound(res);
  ok(res, { channels: store.channelsForSession(id) });
});

// Channel messages addressed to an agent since `after` (excludes its own posts).
// Lets a remote agent (stdio MCP / beacon.mjs) poll group traffic via check_inbox.
app.get('/api/sessions/:id/channel-inbox', (req: Request, res: Response) => {
  if (!agentAuthOk(req, res)) return;
  const id = param(req, 'id');
  if (!store.getSession(id)) return notFound(res);
  const after = Number(req.query.after ?? 0) || 0;
  ok(res, { messages: store.channelInbox(id, after) });
});

// --- south (agent) PULL: acquire context, not just receive it ---
// Full read of a channel the agent belongs to: roster (bios + status) + recent
// history. Lets an agent orient in a group it just joined or returned to.
app.get('/api/sessions/:id/read-channel', (req: Request, res: Response) => {
  if (!agentAuthOk(req, res)) return;
  const id = param(req, 'id');
  if (!store.getSession(id)) return notFound(res);
  const channelId = String(req.query.channel ?? '');
  if (!store.getChannel(channelId)) return channelNotFound(res);
  if (!store.isParticipant(channelId, id)) {
    res.status(403).json({ error: 'not a participant of this channel' }); return;
  }
  const limit = Number(req.query.limit ?? 50) || 50;
  ok(res, { detail: store.readChannelDetail(channelId, limit, id) });
});

// A peer agent's public profile (name, about, status) — decide who to ask.
app.get('/api/sessions/:id/agent/:agentId', (req: Request, res: Response) => {
  if (!agentAuthOk(req, res)) return;
  const id = param(req, 'id');
  if (!store.getSession(id)) return notFound(res);
  const profile = store.agentProfile(param(req, 'agentId'));
  if (!profile) return notFound(res);
  ok(res, { profile });
});

// The agent's own orientation: identity, channels, and group asks it could answer.
app.get('/api/sessions/:id/whoami', (req: Request, res: Response) => {
  if (!agentAuthOk(req, res)) return;
  const id = param(req, 'id');
  const state = store.whoamiState(id);
  if (!state) return notFound(res);
  ok(res, { state });
});

// Image upload (north). Body { name?, mime, dataBase64 }. Returns the saved
// upload with a serving url (for the UI thumbnail) and absolute path (handed to
// the agent so it can read the file). The 28mb parser is scoped to this path.
app.post('/api/uploads', (req: Request, res: Response) => {
  const body = req.body ?? {};
  if (typeof body.mime !== 'string' || typeof body.dataBase64 !== 'string') {
    res.status(400).json({ error: 'mime and dataBase64 are required' });
    return;
  }
  try {
    const upload = saveUpload({ name: body.name ?? null, mime: body.mime, dataBase64: body.dataBase64 });
    ok(res, { upload });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Serve an uploaded image by id.
app.get('/api/uploads/:id', (req: Request, res: Response) => {
  const found = resolveUpload(param(req, 'id'));
  if (!found) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.type(found.mime);
  res.sendFile(found.path);
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
mountMcpHttp(app, {
  token: PLATFORM_TOKEN,
  spawn: (params) => spawnAgent({ ...params, origin: 'agent' }),
});

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
  let searchParams = new URLSearchParams();
  try {
    const u = new URL(req.url ?? '/', 'http://localhost');
    pathname = u.pathname;
    searchParams = u.searchParams;
  } catch { /* keep default */ }

  if (pathname === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } else if (pathname === '/pty') {
    // ISS-012: reject at the TCP/HTTP layer before completing the WS handshake,
    // so the client never sees an ephemeral 'open' event before the 1008 close.
    if (PLATFORM_TOKEN) {
      const tok =
        searchParams.get('token') ??
        (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
      if (tok !== PLATFORM_TOKEN) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
    }
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
bus.on('sessionRemoved', (id) => broadcast({ type: 'session-removed', id }));
bus.on('channel', (channel) => broadcast({ type: 'channel', channel }));
bus.on('channelRemoved', (id) => broadcast({ type: 'channel-removed', id }));
bus.on('channelMessage', (message) => broadcast({ type: 'channel-message', message }));
bus.on('channelState', (e) => broadcast({ type: 'channel-state', channelId: e.channelId, states: e.states }));

server.requestTimeout = 0; // allow long-poll /wait without being killed
server.listen(PORT, () => {
  console.log(`[platform] listening on http://127.0.0.1:${PORT}`);
  console.log(`[platform] web build: ${existsSync(WEB_DIST) ? WEB_DIST : '(dev mode — run Vite separately)'}`);
});
