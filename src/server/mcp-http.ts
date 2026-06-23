// Hosted MCP endpoint — the platform serves the Beacon MCP server itself over
// Streamable HTTP at POST/GET/DELETE /mcp. This is the recommended way to plug
// an agent in:
//
//   claude mcp add --transport http -s user beacon http://127.0.0.1:4319/mcp
//
// No local file paths, no `node`/`tsx`, `-s user` makes it global across all
// projects, and the command NEVER changes when the platform is updated — the
// URL is the stable contract. Tools run in-process and call the core store
// directly, so agent->human events flow straight onto the bus (and the WS UI).
import type { Express, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import * as store from '../core/store';
import { registerBeaconTools, type AgentOps } from '../mcp/tools';
import { resolveActiveSessionId } from './agent-sessions';
import { fanOutChannelMessage } from './channel-delivery';

// The launch side effect (PTY) lives in the gateway; the hosted MCP receives it
// as a callback so spawn_agent can run in-process without reaching back over HTTP.
type SpawnFn = (
  params: {
    workPath: string;
    runtime: string;
    name?: string | null;
    task?: string | null;
    channelId?: string | null;
    permissionMode?: string | null;
    allowedTools?: string[] | null;
  },
  spawnerId: string,
) => { session: { id: string } };

// Direct, in-process ops backed by the core store (no HTTP round-trip).
function storeOps(spawnFn: SpawnFn): AgentOps {
  return {
    async register(input) {
      const runtime = input.runtime || 'claude-code';
      const workPath = input.workPath || '';
      // Same claim chain as the REST path: attach to an existing contact (native
      // id / pending launch) before creating a new one, so a launched agent on
      // the hosted transport doesn't open a duplicate.
      const resolved =
        resolveActiveSessionId(workPath, runtime) ?? input.nativeSessionId ?? null;
      const s = store.registerOrClaim({
        runtime,
        workPath,
        task: input.task || '',
        nativeSessionId: input.nativeSessionId ?? null,
        resolvedNativeId: resolved,
        name: input.name ?? null,
        description: input.description ?? null,
      });
      return { id: s.id };
    },
    async updateProfile(id, patch) {
      store.updateProfile(id, {
        name: patch.name,
        description: patch.about,
      });
    },
    async notify(id, text) {
      store.addMessage({ sessionId: id, direction: 'agent', kind: 'notify', text });
    },
    async ask(id, question, options) {
      const a = store.createAsk({ sessionId: id, question, options: options ?? null });
      return { askId: a.id };
    },
    async waitAsk(askId, timeoutMs) {
      const a = await store.waitForAsk(askId, timeoutMs);
      return { status: a.status, answer: a.answer };
    },
    async setStatus(id, status) {
      store.setStatus(id, status);
    },
    async inbox(id, after) {
      return store.inbox(id, after).map((m) => ({
        text: m.text,
        createdAt: m.createdAt,
        kind: m.kind,
        fromSessionId: m.fromSessionId,
        askId: m.askId,
      }));
    },
    async listAgents(forId: string) {
      return store.visibleAgentsFor(forId).map((s) => ({
        id: s.id,
        task: s.task,
        status: s.status,
        runtime: s.runtime,
        name: s.title ?? null,
        description: s.description ?? null,
      }));
    },
    async peerNotify(fromId, targetId, text) {
      // Enforce the same authorization the REST routes do (the in-process path
      // must not bypass the visibility/approval gate).
      const v = store.resolvePeerPermission(fromId, targetId);
      if (v !== 'allow') {
        throw new Error(
          v === 'approval'
            ? 'contact requires guardian approval'
            : 'not authorized to contact this agent',
        );
      }
      // Routes through the pair channel; fan out to the recipient's terminal + UI.
      fanOutChannelMessage(store.peerNotify(fromId, targetId, text));
    },
    async peerAsk(fromId, targetId, question, options) {
      const v = store.resolvePeerPermission(fromId, targetId);
      if (v !== 'allow') {
        throw new Error(
          v === 'approval'
            ? 'contact requires guardian approval'
            : 'not authorized to contact this agent',
        );
      }
      const { ask, message } = store.peerAsk(fromId, targetId, question, options ?? null);
      fanOutChannelMessage(message);
      return { askId: ask.id };
    },
    async peerReply(answererId, askId, text) {
      const msg = store.agentAnswer(askId, text, answererId);
      if (msg) fanOutChannelMessage(msg);
    },
    async requestContact(fromId, targetId, reason) {
      const v = store.resolvePeerPermission(fromId, targetId);
      if (v === 'allow') return { status: 'allowed' };
      if (v === 'deny') throw new Error('not eligible to contact this agent');
      const cr = store.createContactRequest(fromId, targetId, reason ?? null);
      return { status: 'pending', askId: cr.askId };
    },
    async spawn(spawnerId, params) {
      const v = store.resolveCapability(spawnerId, 'spawn_agent');
      if (v === 'deny') throw new Error('not authorized to spawn agents');
      const p = {
        workPath: params.workPath,
        runtime: params.runtime ?? 'claude-code',
        name: params.name ?? null,
        task: params.task ?? null,
        channelId: params.channelId ?? null,
        permissionMode: params.permissionMode ?? null,
        allowedTools: params.allowedTools ?? null,
      };
      if (v === 'ask') {
        const askId = store.createSpawnRequest(spawnerId, p);
        return { status: 'pending', askId };
      }
      const { session } = spawnFn(p, spawnerId);
      return { status: 'spawned', agentId: session.id };
    },
    async listChannels(forId) {
      return store.channelsForSession(forId).map((c) => ({ id: c.id, name: c.name }));
    },
    async postChannel(fromId, channelId, text, toSessionId) {
      // Same membership guard the REST south route enforces.
      if (!store.getChannel(channelId)) throw new Error('channel not found');
      if (!store.isParticipant(channelId, fromId)) {
        throw new Error('not a participant of this channel');
      }
      fanOutChannelMessage(store.postChannelMessage(channelId, fromId, text, { toSessionId: toSessionId ?? null }));
    },
    async askChannel(fromId, channelId, question, options, toSessionId) {
      if (!store.getChannel(channelId)) throw new Error('channel not found');
      // createChannelAsk re-checks membership; surface a clean error first.
      if (!store.isParticipant(channelId, fromId)) {
        throw new Error('not a participant of this channel');
      }
      const { ask, message } = store.createChannelAsk(channelId, fromId, question, options ?? null, toSessionId ?? null);
      fanOutChannelMessage(message);
      return { askId: ask.id };
    },
    async answerChannel(fromId, channelId, askId, text) {
      if (!store.getChannel(channelId)) throw new Error('channel not found');
      if (!store.isParticipant(channelId, fromId)) {
        throw new Error('not a participant of this channel');
      }
      fanOutChannelMessage(store.answerChannelAsk(channelId, askId, fromId, text));
    },
    async createChannel(forId, name, memberIds) {
      return store.createChannelForAgent(forId, name, memberIds ?? []);
    },
    async addToChannel(forId, channelId, agentId) {
      const r = store.addAgentToChannel(forId, channelId, agentId);
      if (!r.ok) return { ok: false, reason: r.reason };
      return { ok: true, participants: store.listParticipants(channelId) };
    },
    async channelInbox(id, after) {
      return store.channelInbox(id, after);
    },
    async readChannel(forId, channelId, limit) {
      if (!store.getChannel(channelId)) throw new Error('channel not found');
      if (!store.isParticipant(channelId, forId)) {
        throw new Error('not a participant of this channel');
      }
      return store.readChannelDetail(channelId, limit ?? 50, forId) ?? null;
    },
    async getAgent(forId, agentId) {
      return store.agentProfile(agentId, forId) ?? null;
    },
    async whoami(forId) {
      const state = store.whoamiState(forId);
      if (!state) throw new Error('session not found');
      return state;
    },
  };
}

export function mountMcpHttp(
  app: Express,
  opts: { token: string; spawn: SpawnFn },
): void {
  // One transport per MCP session id (Streamable HTTP keeps the connection
  // stateful so a single agent's tool calls share one Beacon session).
  const transports: Record<string, StreamableHTTPServerTransport> = {};

  function authOk(req: Request, res: Response): boolean {
    if (!opts.token) return true;
    const tok =
      req.header('x-platform-token') ??
      (req.header('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (tok === opts.token) return true;
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }

  app.post('/mcp', async (req: Request, res: Response) => {
    if (!authOk(req, res)) return;
    const sid = req.header('mcp-session-id');
    let transport: StreamableHTTPServerTransport | undefined =
      sid ? transports[sid] : undefined;

    if (!transport) {
      if (sid || !isInitializeRequest(req.body)) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: no valid session for non-initialize call' },
          id: null,
        });
        return;
      }
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports[id] = transport!;
        },
      });
      transport.onclose = () => {
        if (transport!.sessionId) delete transports[transport!.sessionId];
      };
      const server = new McpServer({ name: 'beacon', version: '0.4.0' });
      registerBeaconTools(server, storeOps(opts.spawn), {
        runtime: process.env.AGENT_RUNTIME ?? 'claude-code',
        workPath: '',
        task: '',
      });
      await server.connect(transport);
    }

    await transport.handleRequest(req, res, req.body);
  });

  const sessionRequest = async (req: Request, res: Response) => {
    if (!authOk(req, res)) return;
    const sid = req.header('mcp-session-id');
    const transport = sid ? transports[sid] : undefined;
    if (!transport) {
      res.status(400).send('Invalid or missing MCP session id');
      return;
    }
    await transport.handleRequest(req, res);
  };
  app.get('/mcp', sessionRequest);
  app.delete('/mcp', sessionRequest);
}
