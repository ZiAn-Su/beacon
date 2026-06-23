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
    params: {
      workPath: string;
      runtime?: string;
      name?: string | null;
      task?: string | null;
      channelId?: string | null;
      permissionMode?: string | null;
      allowedTools?: string[] | null;
    },
  ): Promise<{ status: string; askId?: string; agentId?: string }>;
  // Retire an agent you manage (the complement of spawn): stop it and archive it.
  retire(actorId: string, agentId: string): Promise<{ ok: boolean; reason?: string }>;
  // Group channels: a channel fans a message out to all its members (other
  // agents + the human guardian). v1 is broadcast chat; v2 adds blocking asks.
  listChannels(forId: string): Promise<{ id: string; name: string }[]>;
  // Agent-side channel organization: create a channel (the human owner is always
  // present) and add agents you are authorized to contact.
  createChannel(
    forId: string,
    name: string,
    memberIds?: string[],
  ): Promise<{ channel: { id: string; name: string }; added: string[]; skipped: { id: string; reason: string }[] }>;
  addToChannel(
    forId: string,
    channelId: string,
    agentId: string,
  ): Promise<{ ok: boolean; reason?: string; participants?: string[] }>;
  postChannel(fromId: string, channelId: string, text: string, toSessionId?: string | null): Promise<void>;
  askChannel(
    fromId: string,
    channelId: string,
    question: string,
    options?: string[] | null,
    toSessionId?: string | null,
  ): Promise<{ askId: string }>;
  answerChannel(
    fromId: string,
    channelId: string,
    askId: string,
    text: string,
  ): Promise<void>;
  channelInbox(
    id: string,
    after: number,
  ): Promise<
    {
      channelId: string;
      channelName: string;
      fromSessionId: string | null;
      text: string;
      kind: 'chat' | 'ask' | 'answer';
      askId: string | null;
      toSessionId: string | null;
      createdAt: number;
    }[]
  >;
  // Pull tools: acquire context, not just receive it.
  readChannel(
    forId: string,
    channelId: string,
    limit?: number,
  ): Promise<{
    channel: { id: string; name: string };
    members: { id: string; name: string | null; task: string; about: string | null; status: string; runtime: string }[];
    messages: { fromSessionId: string | null; text: string; kind: 'chat' | 'ask' | 'answer'; askId: string | null; createdAt: number }[];
  } | null>;
  getAgent(
    forId: string,
    agentId: string,
  ): Promise<{
    id: string;
    name: string | null;
    task: string;
    about: string | null;
    status: string;
    runtime: string;
    origin: string;
    lastSeenAt: number | null;
    lastActivity: { kind: string; text: string; createdAt: number; channel: string | null } | null;
  } | null>;
  whoami(forId: string): Promise<{
    id: string;
    name: string | null;
    task: string;
    status: string;
    runtime: string;
    channels: { id: string; name: string }[];
    pendingAsks: { channelId: string; channelName: string; askId: string; question: string; fromSessionId: string | null }[];
  }>;
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
    // Honor the documented contract that notify/ask auto-creates a session even
    // when the agent never called register_session and set no AGENT_TASK: fall
    // back to a placeholder task so registration can't 400 ("task is required").
    // The agent can refine it later via register_session / update_profile.
    const resolvedTask = (task ?? defaults.task ?? '').trim() || '(auto-registered agent)';
    const { id } = await ops.register({
      runtime: defaults.runtime,
      workPath: defaults.workPath,
      task: resolvedTask,
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
        ...channel.map((m) => ({ createdAt: m.createdAt, line: renderChannelLine(m, id) })),
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
        'Send another agent an FYI and keep working. Does not block. Use agent_id from list_agents. ' +
        'The exchange happens in a shared space the two of you and your human guardian can all see ' +
        '(agent-to-agent is always supervised) — it is not a private channel.',
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
        'Use agent_id from list_agents. Provide options for a quick decision when applicable. ' +
        'The exchange happens in a shared space the two of you and your human guardian can all see ' +
        '(agent-to-agent is always supervised) — it is not a private channel.',
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
        channel_id: z
          .string()
          .optional()
          .describe('Optional: a channel you belong to that the new agent auto-joins on launch'),
        permission_mode: z
          .string()
          .optional()
          .describe(
            'Optional permission mode for the spawned agent: "acceptEdits" (auto-accept file edits, ' +
            'ask for commands), "default" (ask each time), "plan" (plan mode), "dontAsk"/"auto", or ' +
            '"bypassPermissions" (no prompts, but shows a one-time interactive risk confirmation at ' +
            'startup that can stall the agent — prefer acceptEdits + allowed_tools instead). If omitted, ' +
            'uses the platform\'s global default.',
          ),
        allowed_tools: z
          .array(z.string())
          .optional()
          .describe(
            'Optional list of tools / command prefixes the spawned agent may run WITHOUT a per-call ' +
            'permission prompt, e.g. ["Bash(ffmpeg *)", "Bash(git *)", "Read", "Write"]. This is the ' +
            'safe, granular way to let an autonomous agent (e.g. a QA agent that must run commands) ' +
            'work unattended without bypassPermissions and without stalling on prompts.',
          ),
      },
    },
    async ({ work_path, runtime, name, task, channel_id, permission_mode, allowed_tools }) => {
      const id = await ensure();
      const r = await ops.spawn(id, {
        workPath: work_path,
        runtime,
        name,
        task,
        channelId: channel_id,
        permissionMode: permission_mode,
        allowedTools: allowed_tools,
      });
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
    'retire_agent',
    {
      title: 'Retire an agent you manage',
      description:
        'The complement of spawn_agent: stop an agent and archive it (remove it from the active ' +
        'roster and from its channels) once its task is done — so finished one-off workers do not ' +
        'pile up as idle contacts. You may retire an agent you are authorized to manage (an agent ' +
        'you spawned is authorized automatically). Archive, not delete: its history is kept and the ' +
        'human can still permanently delete it. Use agent_id from list_agents.',
      inputSchema: {
        agent_id: z.string().describe('The agent to retire (from list_agents) — one you manage'),
      },
    },
    async ({ agent_id }) => {
      const id = await ensure();
      const r = await ops.retire(id, agent_id);
      if (!r.ok) {
        return { content: [{ type: 'text', text: `Could not retire: ${r.reason ?? 'unknown error'}` }] };
      }
      return { content: [{ type: 'text', text: `Retired agent ${agent_id} (stopped and archived).` }] };
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
    'create_channel',
    {
      title: 'Create a group channel',
      description:
        'Create a new group channel and become its first member. The human guardian is always ' +
        'present as the owner, so group collaboration stays supervised. Optionally pass member ids ' +
        '(from list_agents) to add at creation — each is added only if you are authorized to contact ' +
        'it; the rest come back as skipped so you can request_contact and add_to_channel later. ' +
        'Use this to self-organize your team instead of asking the human to wire up a channel.',
      inputSchema: {
        name: z.string().describe('Channel name (e.g. "release-team")'),
        member_ids: z
          .array(z.string())
          .optional()
          .describe('Optional initial members (agent ids from list_agents)'),
      },
    },
    async ({ name, member_ids }) => {
      const id = await ensure();
      const r = await ops.createChannel(id, name, member_ids);
      const lines = [
        `Created channel #${r.channel.name} (id=${r.channel.id}). You are a member; the human owner is present.`,
      ];
      if (r.added.length) lines.push(`Added ${r.added.length} member(s).`);
      if (r.skipped.length) {
        lines.push(
          `Skipped (not added): ${r.skipped.map((s) => `${s.id} — ${s.reason}`).join('; ')}.`,
        );
      }
      return { content: [{ type: 'text', text: lines.join(' ') }] };
    },
  );

  server.registerTool(
    'add_to_channel',
    {
      title: 'Add an agent to a channel',
      description:
        'Add another agent to a group channel you belong to. Subject to the same authorization as ' +
        'contacting it directly: you must be allowed to contact the agent (agents you spawned are ' +
        'authorized automatically). Use agent_id from list_agents and channel_id from list_channels.',
      inputSchema: {
        channel_id: z.string().describe('Target channel id (from list_channels) — you must be a member'),
        agent_id: z.string().describe('Agent id to add (from list_agents)'),
      },
    },
    async ({ channel_id, agent_id }) => {
      const id = await ensure();
      const r = await ops.addToChannel(id, channel_id, agent_id);
      if (!r.ok) {
        return { content: [{ type: 'text', text: `Could not add: ${r.reason ?? 'unknown error'}` }] };
      }
      return { content: [{ type: 'text', text: 'Added to channel.' }] };
    },
  );

  server.registerTool(
    'post_channel',
    {
      title: 'Post a message to a group channel',
      description:
        'Broadcast a message to a channel (group) you belong to. Everyone in it — other agents ' +
        'and the human guardian — sees it. Use channel_id from list_channels. Optionally address ' +
        'it at one member with to_agent_id (it stays visible to all; they are flagged as the target).',
      inputSchema: {
        channel_id: z.string().describe('Target channel id (from list_channels)'),
        message: z.string().describe('The message to broadcast to the channel'),
        to_agent_id: z
          .string()
          .optional()
          .describe('Optional: address this message at one member (still seen by all)'),
      },
    },
    async ({ channel_id, message, to_agent_id }) => {
      const id = await ensure();
      try {
        await ops.postChannel(id, channel_id, message, to_agent_id ?? null);
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

  server.registerTool(
    'ask_channel',
    {
      title: 'Ask a group channel and wait for an answer',
      description:
        'Post a BLOCKING question to a channel you belong to and wait until any member — ' +
        'another agent or the human guardian — answers. First answer wins. Use channel_id ' +
        'from list_channels. Provide options for a quick decision when applicable.',
      inputSchema: {
        channel_id: z.string().describe('Target channel id (from list_channels)'),
        question: z.string().describe('The question to ask the group'),
        options: z
          .array(z.string())
          .optional()
          .describe('Optional quick-reply choices a member can pick'),
        to_agent_id: z
          .string()
          .optional()
          .describe('Optional: direct the question at one member (any member may still answer)'),
      },
    },
    async ({ channel_id, question, options, to_agent_id }) => {
      const id = await ensure();
      let askId: string;
      try {
        ({ askId } = await ops.askChannel(id, channel_id, question, options, to_agent_id ?? null));
      } catch (e) {
        return {
          content: [
            { type: 'text', text: `Could not ask: ${e instanceof Error ? e.message : String(e)}` },
          ],
        };
      }
      for (;;) {
        const ask = await ops.waitAsk(askId, 25000);
        if (ask.status === 'answered') {
          return { content: [{ type: 'text', text: ask.answer ?? '' }] };
        }
        if (ask.status === 'cancelled') {
          return {
            content: [{ type: 'text', text: '(The question was dismissed without an answer.)' }],
          };
        }
        // still pending — loop and wait again
      }
    },
  );

  server.registerTool(
    'answer_channel',
    {
      title: 'Answer a pending question in a channel',
      description:
        'Reply to a channel question that showed up in your inbox (kind ASKS, with an ask_id). ' +
        'First answer wins and unblocks the asker. Use the channel_id and ask_id from that inbox entry.',
      inputSchema: {
        channel_id: z.string().describe('The channel id from the inbox question'),
        ask_id: z.string().describe('The ask_id from the inbox question'),
        answer: z.string().describe('Your answer to the group'),
      },
    },
    async ({ channel_id, ask_id, answer }) => {
      const id = await ensure();
      try {
        await ops.answerChannel(id, channel_id, ask_id, answer);
      } catch (e) {
        return {
          content: [
            { type: 'text', text: `Could not answer: ${e instanceof Error ? e.message : String(e)}` },
          ],
        };
      }
      return { content: [{ type: 'text', text: 'Answered the channel.' }] };
    },
  );

  server.registerTool(
    'read_channel',
    {
      title: 'Read a channel: roster + recent history',
      description:
        'Pull a group channel you belong to: its members (each with their bio and current ' +
        'status) and the recent message history. Use this to orient — what is this channel ' +
        'about, who is in it, and what was said — before posting or asking. channel_id from ' +
        'list_channels.',
      inputSchema: {
        channel_id: z.string().describe('Target channel id (from list_channels)'),
        limit: z
          .number()
          .optional()
          .describe('How many recent messages to return (default 50, max 200)'),
      },
    },
    async ({ channel_id, limit }) => {
      const id = await ensure();
      let detail;
      try {
        detail = await ops.readChannel(id, channel_id, limit);
      } catch (e) {
        return {
          content: [
            { type: 'text', text: `Could not read channel: ${e instanceof Error ? e.message : String(e)}` },
          ],
        };
      }
      if (!detail) {
        return { content: [{ type: 'text', text: 'Channel not found.' }] };
      }
      return { content: [{ type: 'text', text: renderChannelDetail(detail) }] };
    },
  );

  server.registerTool(
    'get_agent',
    {
      title: 'Look up another agent\'s profile',
      description:
        'Pull a peer agent\'s profile and presence: display name, task, self-introduction, runtime, ' +
        'current status, when it was last seen, and (for agents you are authorized to contact, such ' +
        'as ones you spawned) its most recent activity — so you can tell a working agent apart from ' +
        'one that paused, stalled, or finished, and orchestrate accordingly. Poll this on a child ' +
        'you spawned instead of waiting for it to post. Use an agent id from list_agents, a channel ' +
        'roster, or an inbox message.',
      inputSchema: {
        agent_id: z.string().describe('The agent id to look up'),
      },
    },
    async ({ agent_id }) => {
      const id = await ensure();
      const profile = await ops.getAgent(id, agent_id);
      if (!profile) {
        return { content: [{ type: 'text', text: 'No such agent.' }] };
      }
      return { content: [{ type: 'text', text: renderAgentProfile(profile) }] };
    },
  );

  server.registerTool(
    'whoami',
    {
      title: 'Your own Beacon state',
      description:
        'Pull your own orientation on Beacon: your id, display name, task and status; the group ' +
        'channels you belong to; and any group questions still awaiting an answer you could give. ' +
        'Useful right after waking up or reconnecting.',
      inputSchema: {},
    },
    async () => {
      const id = await ensure();
      const state = await ops.whoami(id);
      return { content: [{ type: 'text', text: renderWhoami(state) }] };
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
function renderChannelLine(
  m: {
    channelId: string;
    channelName: string;
    fromSessionId: string | null;
    text: string;
    kind: 'chat' | 'ask' | 'answer';
    askId: string | null;
    toSessionId?: string | null;
  },
  selfId?: string,
): string {
  const who = m.fromSessionId ? `agent ${m.fromSessionId}` : 'guardian';
  const addressed = m.toSessionId
    ? m.toSessionId === selfId
      ? ' →you'
      : ` →agent ${m.toSessionId.slice(0, 8)}`
    : '';
  if (m.kind === 'ask' && m.askId) {
    return (
      `[#${m.channelName} · ${who} ASKS${addressed}] ${m.text}  ` +
      `(answer with answer_channel channel_id=${m.channelId} ask_id=${m.askId})`
    );
  }
  if (m.kind === 'answer') {
    return `[#${m.channelName} · ${who} answered] ${m.text}`;
  }
  return (
    `[#${m.channelName} · ${who}${addressed}] ${m.text}  ` +
    `(reply to the group with post_channel channel_id=${m.channelId})`
  );
}

/** Render read_channel: a header, the roster (name [status] — about), then the
 *  recent history with each sender resolved against the roster. */
function renderChannelDetail(d: {
  channel: { id: string; name: string };
  members: { id: string; name: string | null; task: string; about: string | null; status: string; runtime: string }[];
  messages: { fromSessionId: string | null; text: string; kind: 'chat' | 'ask' | 'answer'; askId: string | null; createdAt: number }[];
}): string {
  const label = (id: string | null): string => {
    if (!id) return 'the human guardian';
    const m = d.members.find((x) => x.id === id);
    const n = m?.name?.trim() || m?.task?.trim();
    return n ? n : `agent ${id.slice(0, 8)}`;
  };
  const out: string[] = [`Channel #${d.channel.name}  (id=${d.channel.id})`];
  // Every channel includes the human owner — agent collaboration is never
  // unsupervised. Make that explicit so the agent knows a human is present.
  out.push('Owner: the human guardian (always present in this channel)');
  out.push(`Agent members (${d.members.length}):`);
  if (d.members.length === 0) {
    out.push('  (no agents — only you and the guardian)');
  } else {
    for (const m of d.members) {
      const nm = m.name?.trim() || m.task?.trim() || `agent ${m.id.slice(0, 8)}`;
      let line = `  - ${nm} [${m.status}] (id=${m.id})`;
      if (m.about && m.about.trim()) line += ` — ${m.about.trim()}`;
      out.push(line);
    }
  }
  out.push('Recent messages:');
  if (d.messages.length === 0) {
    out.push('  (no messages yet)');
  } else {
    for (const msg of d.messages) {
      const who = label(msg.fromSessionId);
      if (msg.kind === 'ask' && msg.askId) {
        out.push(`  ${who} ASKS: ${msg.text}  (answer_channel channel_id=${d.channel.id} ask_id=${msg.askId})`);
      } else if (msg.kind === 'answer') {
        out.push(`  ${who} answered: ${msg.text}`);
      } else {
        out.push(`  ${who}: ${msg.text}`);
      }
    }
  }
  return out.join('\n');
}

/** A coarse, human-readable "how long ago" for a timestamp. */
function agoText(ts: number | null): string {
  if (!ts) return 'never';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** Render get_agent: a peer's profile + presence so the reader can decide who to
 *  ask and tell a working agent apart from a paused/stalled/finished one. */
function renderAgentProfile(p: {
  id: string;
  name: string | null;
  task: string;
  about: string | null;
  status: string;
  runtime: string;
  origin: string;
  lastSeenAt: number | null;
  lastActivity: { kind: string; text: string; createdAt: number; channel: string | null } | null;
}): string {
  const nm = p.name?.trim() || p.task?.trim() || `agent ${p.id.slice(0, 8)}`;
  const lines = [
    `${nm} [${p.status}]  (id=${p.id})`,
    `    runtime: ${p.runtime} · origin: ${p.origin}`,
    `    last seen: ${agoText(p.lastSeenAt)}`,
  ];
  if (p.lastActivity) {
    const a = p.lastActivity;
    const where = a.channel ? `#${a.channel} ` : '';
    const snippet = a.text.length > 140 ? `${a.text.slice(0, 140)}…` : a.text;
    lines.push(`    last activity: [${where}${a.kind}] ${snippet} — ${agoText(a.createdAt)}`);
  }
  if (p.task && p.task.trim()) lines.push(`    task: ${p.task.trim()}`);
  if (p.about && p.about.trim()) lines.push(`    about: ${p.about.trim()}`);
  return lines.join('\n');
}

/** Render whoami: identity, channels, and group asks awaiting an answer. */
function renderWhoami(s: {
  id: string;
  name: string | null;
  task: string;
  status: string;
  runtime: string;
  channels: { id: string; name: string }[];
  pendingAsks: { channelId: string; channelName: string; askId: string; question: string; fromSessionId: string | null }[];
}): string {
  const nm = s.name?.trim() || s.task?.trim() || `agent ${s.id.slice(0, 8)}`;
  const out = [
    `You are ${nm} [${s.status}]  (id=${s.id}, runtime ${s.runtime})`,
    s.task && s.task.trim() ? `task: ${s.task.trim()}` : 'task: (none)',
  ];
  out.push(
    s.channels.length
      ? `Channels (${s.channels.length}): ${s.channels.map((c) => `#${c.name} (${c.id})`).join(', ')}`
      : 'Channels: (none)',
  );
  if (s.pendingAsks.length) {
    out.push(`Group questions awaiting an answer (${s.pendingAsks.length}):`);
    for (const a of s.pendingAsks) {
      out.push(`  #${a.channelName}: ${a.question}  (answer_channel channel_id=${a.channelId} ask_id=${a.askId})`);
    }
  } else {
    out.push('Group questions awaiting an answer: (none)');
  }
  return out.join('\n');
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
            channelId: params.channelId ?? null,
            permissionMode: params.permissionMode ?? null,
            allowedTools: params.allowedTools ?? null,
          }),
        },
      );
      return { status: r.status, askId: r.askId, agentId: r.session?.id };
    },
    async retire(actorId, agentId) {
      try {
        await api(`/api/sessions/${actorId}/retire-agent`, {
          method: 'POST',
          body: JSON.stringify({ agentId }),
        });
        return { ok: true };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const m = msg.match(/\{"error":"([^"]+)"\}/);
        return { ok: false, reason: m ? m[1] : msg };
      }
    },
    async listChannels(forId) {
      const { channels } = await api<{ channels: { id: string; name: string }[] }>(
        `/api/sessions/${forId}/channels`,
      );
      return channels.map((c) => ({ id: c.id, name: c.name }));
    },
    async createChannel(forId, name, memberIds) {
      return api<{
        channel: { id: string; name: string };
        added: string[];
        skipped: { id: string; reason: string }[];
      }>(`/api/sessions/${forId}/create-channel`, {
        method: 'POST',
        body: JSON.stringify({ name, memberIds: memberIds ?? [] }),
      });
    },
    async addToChannel(forId, channelId, agentId) {
      try {
        const r = await api<{ participants: string[] }>(
          `/api/sessions/${forId}/add-to-channel`,
          { method: 'POST', body: JSON.stringify({ channelId, agentId }) },
        );
        return { ok: true, participants: r.participants };
      } catch (e) {
        // The REST route returns 403/404 with { error } for an unauthorized or
        // unknown target; surface that as a clean reason instead of throwing.
        const msg = e instanceof Error ? e.message : String(e);
        const m = msg.match(/\{"error":"([^"]+)"\}/);
        return { ok: false, reason: m ? m[1] : msg };
      }
    },
    async postChannel(fromId, channelId, text, toSessionId) {
      await api(`/api/sessions/${fromId}/channel-post`, {
        method: 'POST',
        body: JSON.stringify({ channelId, text, toSessionId: toSessionId ?? undefined }),
      });
    },
    async askChannel(fromId, channelId, question, options, toSessionId) {
      const { askId } = await api<{ askId: string }>(`/api/sessions/${fromId}/channel-ask`, {
        method: 'POST',
        body: JSON.stringify({ channelId, question, options: options ?? undefined, toSessionId: toSessionId ?? undefined }),
      });
      return { askId };
    },
    async answerChannel(fromId, channelId, askId, text) {
      await api(`/api/sessions/${fromId}/channel-answer`, {
        method: 'POST',
        body: JSON.stringify({ channelId, askId, text }),
      });
    },
    async channelInbox(id, after) {
      const { messages } = await api<{
        messages: {
          channelId: string;
          channelName: string;
          fromSessionId: string | null;
          text: string;
          kind: 'chat' | 'ask' | 'answer';
          askId: string | null;
          toSessionId: string | null;
          createdAt: number;
        }[];
      }>(`/api/sessions/${id}/channel-inbox?after=${after}`);
      return messages;
    },
    async readChannel(forId, channelId, limit) {
      const q = `channel=${encodeURIComponent(channelId)}${limit ? `&limit=${limit}` : ''}`;
      const { detail } = await api<{
        detail: {
          channel: { id: string; name: string };
          members: { id: string; name: string | null; task: string; about: string | null; status: string; runtime: string }[];
          messages: { fromSessionId: string | null; text: string; kind: 'chat' | 'ask' | 'answer'; askId: string | null; createdAt: number }[];
        } | null;
      }>(`/api/sessions/${forId}/read-channel?${q}`);
      return detail;
    },
    async getAgent(forId, agentId) {
      const { profile } = await api<{
        profile: {
          id: string;
          name: string | null;
          task: string;
          about: string | null;
          status: string;
          runtime: string;
          origin: string;
          lastSeenAt: number | null;
          lastActivity: { kind: string; text: string; createdAt: number; channel: string | null } | null;
        } | null;
      }>(`/api/sessions/${forId}/agent/${encodeURIComponent(agentId)}`);
      return profile;
    },
    async whoami(forId) {
      const { state } = await api<{
        state: {
          id: string;
          name: string | null;
          task: string;
          status: string;
          runtime: string;
          channels: { id: string; name: string }[];
          pendingAsks: { channelId: string; channelName: string; askId: string; question: string; fromSessionId: string | null }[];
        };
      }>(`/api/sessions/${forId}/whoami`);
      return state;
    },
  };
}
