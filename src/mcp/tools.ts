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
  register(input: { runtime?: string; workPath?: string; task?: string }): Promise<{ id: string }>;
  notify(id: string, text: string): Promise<void>;
  ask(id: string, question: string, options?: string[] | null): Promise<{ askId: string }>;
  waitAsk(askId: string, timeoutMs: number): Promise<{ status: string; answer: string | null }>;
  setStatus(id: string, status: string): Promise<void>;
  inbox(id: string, after: number): Promise<{ text: string; createdAt: number }[]>;
}

export interface AgentDefaults {
  runtime: string;
  workPath: string;
  task: string;
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
  let sessionId: string | null = null;
  let lastInboxTs = 0;

  async function ensure(task?: string): Promise<string> {
    if (sessionId) return sessionId;
    const { id } = await ops.register({
      runtime: defaults.runtime,
      workPath: defaults.workPath,
      task: task ?? defaults.task,
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
      },
    },
    async ({ task, work_path, runtime }) => {
      const { id } = await ops.register({
        runtime: runtime ?? defaults.runtime,
        workPath: work_path ?? defaults.workPath,
        task,
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
      const messages = await ops.inbox(id, lastInboxTs);
      if (messages.length) lastInboxTs = messages[messages.length - 1].createdAt;
      const text = messages.length
        ? messages.map((m) => `- ${m.text}`).join('\n')
        : '(no new messages from the human)';
      return { content: [{ type: 'text', text }] };
    },
  );
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
        }),
      });
      return { id: session.id };
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
      const { messages } = await api<{ messages: { text: string; createdAt: number }[] }>(
        `/api/sessions/${id}/inbox?after=${after}`,
      );
      return messages;
    },
  };
}
