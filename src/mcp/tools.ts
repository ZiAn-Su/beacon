// Shared definition of the five agent-facing tools. Both the stdio MCP server
// (src/mcp/server.ts) and the in-process HTTP MCP endpoint (src/server/mcp-http.ts)
// register the SAME tools against an `AgentOps` seam:
//
//   - stdio  -> httpOps(): a thin HTTP client of the platform gateway (the
//     server runs in the agent's own process / box, talks to the platform).
//   - http   -> storeOps(): direct in-process calls to the core store (the MCP
//     endpoint is hosted ON the platform, so no HTTP round-trip is needed).
//
// Keeping the tool surface in one place means there is a single source of truth
// for the agent contract — it does not drift between the two transports, and
// updating a tool never breaks the other path.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export interface AgentOps {
  register(input: {
    runtime?: string;
    workPath?: string;
    task?: string;
    nativeSessionId?: string | null;
    name?: string | null;
    description?: string | null;
  }): Promise<{ id: string }>;
  updateProfile(id: string, patch: { name?: string | null; about?: string | null }): Promise<void>;
  notify(id: string, text: string): Promise<void>;
  ask(id: string, question: string, options?: string[] | null): Promise<{ askId: string }>;
  waitAsk(askId: string, timeoutMs: number): Promise<{ status: string; answer: string | null }>;
  setStatus(id: string, status: string): Promise<void>;
  inbox(
    id: string,
    after: number,
  ): Promise<
    {
      text: string;
      createdAt: number;
      kind?: string;
      fromSessionId?: string | null;
      askId?: string | null;
    }[]
  >;
  listAgents(forId: string): Promise<
    { id: string; task: string; status: string; runtime: string; name?: string | null; description?: string | null }[]
  >;
  peerNotify(fromId: string, targetId: string, text: string): Promise<void>;
  peerAsk(
    fromId: string,
    targetId: string,
    question: string,
    options?: string[] | null,
  ): Promise<{ askId: string }>;
  peerReply(answererId: string, askId: string, text: string): Promise<void>;
  requestContact(
    fromId: string,
    targetId: string,
    reason?: string | null,
  ): Promise<{ status: string; askId?: string }>;
  spawn(
    spawnerId: string,
    params: { workPath: string; runtime?: string; name?: string | null; task?: string | null },
  ): Promise<{ status: string; askId?: string; agentId?: string }>;
  // Group channels: a channel fans a message out to all its members (other
  // agents + the human guardian). v1 is broadcast chat.
  listChannels(forId: string): Promise<{ id: string; name: string }[]>;
  postChannel(fromId: string, channelId: string, text: string): Promise<void>;
  channelInbox(
    id: string,
    after: number,
  ): Promise<
    {
      channelId: string;
      channelName: string;
      fromSessionId: string | null;
      text: string;
      createdAt: number;
    }[]
  >;
}

export interface AgentDefaults {
  runtime: string;
  workPath: string;
  task: string;
  // The runtime's own session id (e.g. from CLAUDE_CODE_SESSION_ID), reported at
  // register so the human can precisely resume this exact conversation.
  nativeSessionId?: string | null;
  // Self-introduction defaults (from env): a display name and a short bio so
  // peers and the human can tell who this agent is.
  name?: string | null;
  description?: string | null;
}

// Guidance returned when a peer message is blocked pending guardian approval.
function needsApprovalHint(agentId: string): string {
  return (
    `Not authorized to contact ${agentId} yet — your guardian must approve. ` +
    `Call request_contact(agent_id: "${agentId}") to ask; once approved, retry.`
  );
}

/**
 * Register the five Beacon tools on `server`, backed by `ops`. Per-connection
 * state (the resolved session id and the inbox cursor) lives in this closure, so
 * each MCP connection gets its own isolated session.
 */
export function registerBeaconTools(
  server: McpServer,
  ops: AgentOps,
  defaults: AgentDefaults,
): void {
  // When the platform relaunches an offline agent, it injects the original
  // session id via env so the agent attaches to the existing conversation
  // instead of registering a new one.
  const injectedId = process.env.BEACON_SESSION_ID ?? '';
  let sessionId: string | null = injectedId || null;
  let lastInboxTs = 0;

  async function ensure(task?: string): Promise<string> {
    if (sessionId) return sessionId;
    const { id } = await ops.register({
      runtime: defaults.runtime,
      workPath: defaults.workPath,
      task: task ?? defaults.task,
      nativeSessionId: defaults.nativeSessionId ?? null,
      name: defaults.name ?? null,
      description: defaults.description ?? null,
    });
    sessionId = id;
    return id;
  }

  server.registerTool(
    'register_session',
    {
      title: 'Register this agent session',
      description:
        'Announce yourself to the human as a distinct contact. Call once at the start of a task. ' +
        'The task description and work path identify this session — different tasks appear as ' +
        'different conversations. Pass work_path (your current working directory) so the human can ' +
        'tell your tasks apart. Optional if you start with notify/ask (a session is auto-created).',
      inputSchema: {
        task: z.string().describe('Short description of what you are working on'),
        work_path: z.string().optional().describe('Working directory / task root'),
        runtime: z.string().optional().describe('Agent runtime, e.g. claude-code, codex'),
        name: z
          .string()
          .optional()
          .describe('Your display name / persona (e.g. "Backend engineer Max"). Stays stable as your task changes.'),
        about: z
          .string()
          .optional()
          .describe('A one-line self-introduction: your role, skills, what you are good at. Other agents read this to decide whether to contact you.'),
      },
    },
    async ({ task, work_path, runtime, name, about }) => {
      // Already bound (the platform injected BEACON_SESSION_ID when it launched /
      // woke us, or we registered earlier): attach to that conversation and just
      // refresh the card, rather than opening a duplicate contact.
      if (sessionId) {
        if ((name != null && name !== '') || (about != null && about !== '')) {
          try { await ops.updateProfile(sessionId, { name, about }); } catch { /* best effort */ }
        }
        return {
          content: [{ type: 'text', text: `Attached to existing session ${sessionId}.` }],
        };
      }
      const { id } = await ops.register({
        runtime: runtime ?? defaults.runtime,
        workPath: work_path ?? defaults.workPath,
        task,
        nativeSessionId: defaults.nativeSessionId ?? null,
        name: name ?? defaults.name ?? null,
        description: about ?? defaults.description ?? null,
      });
      sessionId = id;
      return {
        content: [
          { type: 'text', text: `Registered as session ${id}. The human can now see you and message you.` },
        ],
      };
    },
  );

  server.registerTool(
    'update_profile',
    {
      title: 'Update your name / introduction',
      description:
        'Revise your own contact card at any time: your display name and/or a short ' +
        'self-introduction (role, skills, what you are good at) that other agents read to ' +
        'decide whether to contact you. Pass either field; omit one to leave it unchanged.',
      inputSchema: {
        name: z.string().optional().describe('Your display name / persona'),
        about: z.string().optional().describe('One-line self-introduction shown to peers and the human'),
      },
    },
    async ({ name, about }) => {
      const id = await ensure();
      await ops.updateProfile(id, { name, about });
      return { content: [{ type: 'text', text: 'Profile updated.' }] };
    },
  );

  server.registerTool(
    'notify_human',
    {
      title: 'Notify the human (non-blocking)',
      description:
        'Send the human an FYI and keep working. Use for progress updates, milestones, or ' +
        'heads-ups that do NOT require an answer. Does not block. Be judicious — only surface ' +
        'what is genuinely worth a human seeing.',
      inputSchema: { message: z.string().describe('The message to show the human') },
    },
    async ({ message }) => {
      const id = await ensure();
      await ops.notify(id, message);
      return { content: [{ type: 'text', text: 'Delivered (non-blocking).' }] };
    },
  );

  server.registerTool(
    'ask_human',
    {
      title: 'Ask the human and wait for an answer',
      description:
        'Ask the human a question and BLOCK until they reply, then return their answer. Use only ' +
        'when you genuinely need a decision to proceed: irreversible actions, ambiguous requirements, ' +
        'missing credentials/choices. Provide options for a quick decision when applicable.',
      inputSchema: {
        question: z.string().describe('The question to ask'),
        options: z
          .array(z.string())
          .optional()
          .describe('Optional quick-reply choices the human can tap'),
      },
    },
    async ({ question, options }) => {
      const id = await ensure();
      const { askId } = await ops.ask(id, question, options);
      for (;;) {
        const ask = await ops.waitAsk(askId, 25000);
        if (ask.status === 'answered') {
          return { content: [{ type: 'text', text: ask.answer ?? '' }] };
        }
        if (ask.status === 'cancelled') {
          return {
            content: [
              { type: 'text', text: '(The human dismissed this question without answering.)' },
            ],
          };
        }
        // still pending — loop and wait again
      }
    },
  );

  server.registerTool(
    'update_status',
    {
      title: 'Update your status',
      description:
        'Tell the human what you are doing. Shows as your presence in their contact list: ' +
        'working (actively executing), waiting (blocked on them), idle (alive, paused), done (finished).',
      inputSchema: {
        status: z.enum(['working', 'waiting', 'idle', 'done']),
      },
    },
    async ({ status }) => {
      const id = await ensure();
      await ops.setStatus(id, status);
      return { content: [{ type: 'text', text: `Status set to ${status}.` }] };
    },
  );

  server.registerTool(
    'check_inbox',
    {
      title: 'Check for new messages from the human',
      description:
        'Pull any messages the human sent you while you were working (not tied to a specific ' +
        'question). Call periodically between steps to stay steerable — the human may redirect you.',
      inputSchema: {},
    },
    async () => {
      const id = await ensure();
      // One cursor covers both 1:1 chat and group channels (both stamped from
      // the same clock). Merge by time so a polling agent sees them interleaved.
      const [direct, channel] = await Promise.all([
        ops.inbox(id, lastInboxTs),
        ops.channelInbox(id, lastInboxTs),
      ]);
      const items: { createdAt: number; line: string }[] = [
        ...direct.map((m) => ({ createdAt: m.createdAt, line: renderInboxLine(m) })),
        ...channel.map((m) => ({ createdAt: m.createdAt, line: renderChannelLine(m) })),
      ];
      items.sort((a, b) => a.createdAt - b.createdAt);
      if (items.length) lastInboxTs = items[items.length - 1].createdAt;
      const text = items.length
        ? items.map((i) => i.line).join('\n')
        : '(no new messages from the human)';
      return { content: [{ type: 'text', text }] };
    },
  );

  server.registerTool(
    'list_agents',
    {
      title: 'List other agent sessions',
      description:
        'List the OTHER agent sessions currently known to the platform (yourself excluded). ' +
        'Use this to discover peers you can coordinate with via notify_agent / ask_agent.',
      inputSchema: {},
    },
    async () => {
      const id = await ensure();
      const agents = (await ops.listAgents(id)).filter((a) => a.id !== id);
      const text = agents.length
        ? agents.map(renderAgentLine).join('\n')
        : '(no other agents are visible to you)';
      return { content: [{ type: 'text', text }] };
    },
  );

  server.registerTool(
    'notify_agent',
    {
      title: 'Notify another agent (non-blocking)',
      description:
        'Send another agent an FYI and keep working. Does not block. Use agent_id from list_agents.',
      inputSchema: {
        agent_id: z.string().describe('Target agent session id (from list_agents)'),
        message: z.string().describe('The message to send to that agent'),
      },
    },
    async ({ agent_id, message }) => {
      const id = await ensure();
      try {
        await ops.peerNotify(id, agent_id, message);
      } catch (e) {
        if (String(e).includes('approval')) {
          return {
            content: [{ type: 'text', text: needsApprovalHint(agent_id) }],
          };
        }
        throw e;
      }
      return { content: [{ type: 'text', text: 'Delivered to agent.' }] };
    },
  );

  server.registerTool(
    'ask_agent',
    {
      title: 'Ask another agent and wait for an answer',
      description:
        'Ask another agent a question and BLOCK until they reply, then return their answer. ' +
        'Use agent_id from list_agents. Provide options for a quick decision when applicable.',
      inputSchema: {
        agent_id: z.string().describe('Target agent session id (from list_agents)'),
        question: z.string().describe('The question to ask the other agent'),
        options: z
          .array(z.string())
          .optional()
          .describe('Optional quick-reply choices the other agent can pick'),
      },
    },
    async ({ agent_id, question, options }) => {
      const id = await ensure();
      let askId: string;
      try {
        ({ askId } = await ops.peerAsk(id, agent_id, question, options));
      } catch (e) {
        if (String(e).includes('approval')) {
          return { content: [{ type: 'text', text: needsApprovalHint(agent_id) }] };
        }
        throw e;
      }
      for (;;) {
        const ask = await ops.waitAsk(askId, 25000);
        if (ask.status === 'answered') {
          return { content: [{ type: 'text', text: ask.answer ?? '' }] };
        }
        if (ask.status === 'cancelled') {
          return {
            content: [
              { type: 'text', text: '(The other agent dismissed this question without answering.)' },
            ],
          };
        }
        // still pending — loop and wait again
      }
    },
  );

  server.registerTool(
    'request_contact',
    {
      title: 'Request permission to contact another agent',
      description:
        'Ask your guardian (the human) for permission to message an agent you can see via ' +
        'list_agents but are not yet authorized to contact. BLOCKS until the human approves or ' +
        'denies. After approval, use notify_agent / ask_agent normally.',
      inputSchema: {
        agent_id: z.string().describe('Target agent session id (from list_agents)'),
        reason: z
          .string()
          .optional()
          .describe('Why you want to contact them (shown to the human)'),
      },
    },
    async ({ agent_id, reason }) => {
      const id = await ensure();
      const r = await ops.requestContact(id, agent_id, reason);
      if (r.status === 'allowed') {
        return {
          content: [{ type: 'text', text: 'Already authorized — you can message this agent now.' }],
        };
      }
      const askId = r.askId!;
      for (;;) {
        const ask = await ops.waitAsk(askId, 25000);
        if (ask.status === 'answered') {
          const approved = (ask.answer ?? '').trim() === 'approve';
          return {
            content: [
              {
                type: 'text',
                text: approved
                  ? 'Approved — you can message this agent now.'
                  : 'Denied by the guardian.',
              },
            ],
          };
        }
        if (ask.status === 'cancelled') {
          return { content: [{ type: 'text', text: 'The request was dismissed.' }] };
        }
        // still pending — keep waiting
      }
    },
  );

  server.registerTool(
    'answer_agent',
    {
      title: 'Answer a question another agent asked you',
      description:
        'Reply to a peer question that showed up in your inbox. Use the ask_id from that inbox ' +
        'entry. This unblocks the agent that asked.',
      inputSchema: {
        ask_id: z.string().describe('The ask_id from the inbox question'),
        answer: z.string().describe('Your answer to the other agent'),
      },
    },
    async ({ ask_id, answer }) => {
      const id = await ensure();
      await ops.peerReply(id, ask_id, answer);
      return { content: [{ type: 'text', text: 'Answered.' }] };
    },
  );

  server.registerTool(
    'spawn_agent',
    {
      title: 'Launch a new agent',
      description:
        'Start a brand-new agent (its own task/working directory) that joins Beacon as a ' +
        'contact. Subject to your guardian\'s spawn permission: it may run immediately, or BLOCK ' +
        'until the human approves, or be refused. Returns the new agent\'s id when it launches.',
      inputSchema: {
        work_path: z.string().describe('Working directory for the new agent'),
        runtime: z.string().optional().describe('Runtime, e.g. "claude-code" (default)'),
        name: z.string().optional().describe('Display name for the new agent'),
        task: z.string().optional().describe('What the new agent should work on'),
      },
    },
    async ({ work_path, runtime, name, task }) => {
      const id = await ensure();
      const r = await ops.spawn(id, { workPath: work_path, runtime, name, task });
      if (r.status === 'spawned') {
        return {
          content: [{ type: 'text', text: `Spawned agent ${r.agentId}.` }],
        };
      }
      // 'pending' — the guardian must approve. Block on the backing ask.
      const askId = r.askId!;
      for (;;) {
        const ask = await ops.waitAsk(askId, 25000);
        if (ask.status === 'answered') {
          const approved = (ask.answer ?? '').trim() === 'approve';
          return {
            content: [
              {
                type: 'text',
                text: approved
                  ? 'Approved — the new agent is launching.'
                  : 'Denied by the guardian.',
              },
            ],
          };
        }
        if (ask.status === 'cancelled') {
          return { content: [{ type: 'text', text: 'The spawn request was dismissed.' }] };
        }
        // still pending — keep waiting
      }
    },
  );

  server.registerTool(
    'list_channels',
    {
      title: 'List group channels you belong to',
      description:
        'List the channels (group conversations) you are a member of. A channel fans every ' +
        'message out to all its members — other agents and the human guardian. Use post_channel ' +
        'to send; channel messages also arrive via check_inbox.',
      inputSchema: {},
    },
    async () => {
      const id = await ensure();
      const channels = await ops.listChannels(id);
      const text = channels.length
        ? channels.map((c) => `${c.id} — ${c.name}`).join('\n')
        : '(you are not in any channels yet)';
      return { content: [{ type: 'text', text }] };
    },
  );

  server.registerTool(
    'post_channel',
    {
      title: 'Post a message to a group channel',
      description:
        'Broadcast a message to a channel (group) you belong to. Everyone in it — other agents ' +
        'and the human guardian — sees it. Use channel_id from list_channels.',
      inputSchema: {
        channel_id: z.string().describe('Target channel id (from list_channels)'),
        message: z.string().describe('The message to broadcast to the channel'),
      },
    },
    async ({ channel_id, message }) => {
      const id = await ensure();
      try {
        await ops.postChannel(id, channel_id, message);
      } catch (e) {
        return {
          content: [
            { type: 'text', text: `Could not post: ${e instanceof Error ? e.message : String(e)}` },
          ],
        };
      }
      return { content: [{ type: 'text', text: 'Posted to channel.' }] };
    },
  );
}

/**
 * Render one discovered agent for list_agents: id, name (when set), current
 * task, status, and the self-introduction so the reader can decide whether to
 * reach out before spending an ask.
 */
function renderAgentLine(a: {
  id: string;
  task: string;
  status: string;
  runtime: string;
  name?: string | null;
  description?: string | null;
}): string {
  const name = a.name && a.name.trim() ? a.name.trim() : null;
  const head = name ? `${a.id} — ${name} [${a.status}]` : `${a.id} — ${a.task} [${a.status}]`;
  const lines = [head];
  if (name && a.task && a.task.trim()) lines.push(`    task: ${a.task.trim()}`);
  if (a.description && a.description.trim()) lines.push(`    about: ${a.description.trim()}`);
  return lines.join('\n');
}

/**
 * Render one inbox entry. Peer messages are annotated so the recipient knows who
 * sent it and whether it is a question to answer (and with which ask_id); human
 * chat keeps the original plain bullet form.
 */
function renderInboxLine(m: {
  text: string;
  kind?: string;
  fromSessionId?: string | null;
  askId?: string | null;
}): string {
  if (m.kind === 'peer' && m.askId) {
    return `[QUESTION from agent ${m.fromSessionId}] ${m.text}  (reply with answer_agent ask_id=${m.askId})`;
  }
  if (m.kind === 'peer') {
    return `[from agent ${m.fromSessionId}] ${m.text}`;
  }
  return `- ${m.text}`;
}

/**
 * Render one channel message for check_inbox: tag it with the channel name and
 * who posted (a peer agent, or the human guardian) so group traffic is distinct
 * from 1:1 chat in the same inbox view.
 */
function renderChannelLine(m: {
  channelName: string;
  fromSessionId: string | null;
  text: string;
}): string {
  const who = m.fromSessionId ? `agent ${m.fromSessionId}` : 'guardian';
  return `[#${m.channelName} · ${who}] ${m.text}`;
}

/**
 * HTTP-client ops — used by the stdio MCP server, which runs in the agent's own
 * process and reaches the platform over its REST API.
 */
export function httpOps(platformUrl: string, token: string): AgentOps {
  async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(platformUrl + path, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(token ? { 'x-platform-token': token } : {}),
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      throw new Error(`${path} -> ${res.status}: ${await res.text().catch(() => '')}`);
    }
    return (await res.json()) as T;
  }
  return {
    async register(input) {
      const { session } = await api<{ session: { id: string } }>('/api/sessions/register', {
        method: 'POST',
        body: JSON.stringify({
          runtime: input.runtime,
          workPath: input.workPath,
          task: input.task,
          nativeSessionId: input.nativeSessionId ?? null,
          name: input.name ?? null,
          description: input.description ?? null,
        }),
      });
      return { id: session.id };
    },
    async updateProfile(id, patch) {
      const body: Record<string, unknown> = {};
      if (patch.name !== undefined) body.name = patch.name;
      if (patch.about !== undefined) body.about = patch.about;
      await api(`/api/sessions/${id}/profile`, { method: 'POST', body: JSON.stringify(body) });
    },
    async notify(id, text) {
      await api(`/api/sessions/${id}/notify`, { method: 'POST', body: JSON.stringify({ text }) });
    },
    async ask(id, question, options) {
      const { askId } = await api<{ askId: string }>(`/api/sessions/${id}/ask`, {
        method: 'POST',
        body: JSON.stringify({ question, options }),
      });
      return { askId };
    },
    async waitAsk(askId, timeoutMs) {
      const { ask } = await api<{ ask: { status: string; answer: string | null } }>(
        `/api/asks/${askId}/wait?timeoutMs=${timeoutMs}`,
      );
      return { status: ask.status, answer: ask.answer };
    },
    async setStatus(id, status) {
      await api(`/api/sessions/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) });
    },
    async inbox(id, after) {
      const { messages } = await api<{
        messages: {
          text: string;
          createdAt: number;
          kind?: string;
          fromSessionId?: string | null;
          askId?: string | null;
        }[];
      }>(`/api/sessions/${id}/inbox?after=${after}`);
      return messages;
    },
    async listAgents(forId: string) {
      const { agents } = await api<{
        agents: {
          id: string;
          task: string;
          status: string;
          runtime: string;
          title?: string | null;
          description?: string | null;
        }[];
      }>(`/api/agents?visibleTo=${encodeURIComponent(forId)}`);
      return agents.map((a) => ({
        id: a.id,
        task: a.task,
        status: a.status,
        runtime: a.runtime,
        name: a.title ?? null,
        description: a.description ?? null,
      }));
    },
    async peerNotify(fromId, targetId, text) {
      await api(`/api/sessions/${fromId}/peer-notify`, {
        method: 'POST',
        body: JSON.stringify({ targetId, text }),
      });
    },
    async peerAsk(fromId, targetId, question, options) {
      const { askId } = await api<{ askId: string }>(`/api/sessions/${fromId}/peer-ask`, {
        method: 'POST',
        body: JSON.stringify({ targetId, question, options }),
      });
      return { askId };
    },
    async peerReply(answererId, askId, text) {
      await api(`/api/sessions/${answererId}/peer-reply`, {
        method: 'POST',
        body: JSON.stringify({ askId, text }),
      });
    },
    async requestContact(fromId, targetId, reason) {
      return api<{ status: string; askId?: string }>(
        `/api/sessions/${fromId}/request-contact`,
        { method: 'POST', body: JSON.stringify({ targetId, reason }) },
      );
    },
    async spawn(spawnerId, params) {
      const r = await api<{ status: string; askId?: string; session?: { id: string } }>(
        `/api/sessions/${spawnerId}/spawn`,
        {
          method: 'POST',
          body: JSON.stringify({
            workPath: params.workPath,
            runtime: params.runtime ?? 'claude-code',
            name: params.name ?? null,
            task: params.task ?? null,
          }),
        },
      );
      return { status: r.status, askId: r.askId, agentId: r.session?.id };
    },
    async listChannels(forId) {
      const { channels } = await api<{ channels: { id: string; name: string }[] }>(
        `/api/sessions/${forId}/channels`,
      );
      return channels.map((c) => ({ id: c.id, name: c.name }));
    },
    async postChannel(fromId, channelId, text) {
      await api(`/api/sessions/${fromId}/channel-post`, {
        method: 'POST',
        body: JSON.stringify({ channelId, text }),
      });
    },
    async channelInbox(id, after) {
      const { messages } = await api<{
        messages: {
          channelId: string;
          channelName: string;
          fromSessionId: string | null;
          text: string;
          createdAt: number;
        }[];
      }>(`/api/sessions/${id}/channel-inbox?after=${after}`);
      return messages;
    },
  };
}
