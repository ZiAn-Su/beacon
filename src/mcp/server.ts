// MCP server (stdio) — the agent-facing south side of the platform.
//
// Any MCP-capable runtime (Claude Code, Codex, ...) adds this server and gains,
// with zero code changes, the ability to talk to a human over the platform:
//   register_session  announce yourself as a distinct contact (one task = one)
//   notify_human      non-blocking FYI, keep working
//   ask_human         BLOCK until the human answers, return their reply
//   update_status     working | waiting | idle | done
//   check_inbox       pull async messages the human sent while you worked
//
// This is the LOCAL transport: it runs in the agent's own process and is a thin
// HTTP client of the platform gateway (all state lives there). The tool surface
// itself is defined once in ./tools and shared with the platform's hosted HTTP
// MCP endpoint, so the two never drift. For zero-path, global onboarding prefer
// the hosted endpoint: `claude mcp add --transport http beacon <url>/mcp`.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerBeaconTools, httpOps } from './tools';

const PLATFORM_URL = process.env.PLATFORM_URL ?? 'http://127.0.0.1:4319';
const PLATFORM_TOKEN = process.env.PLATFORM_TOKEN ?? '';
const RUNTIME = process.env.AGENT_RUNTIME ?? 'claude-code';
const WORK_PATH = process.env.AGENT_WORK_PATH ?? process.cwd();
const DEFAULT_TASK = process.env.AGENT_TASK ?? '';

const server = new McpServer({ name: 'beacon', version: '0.3.1' });
registerBeaconTools(server, httpOps(PLATFORM_URL, PLATFORM_TOKEN), {
  runtime: RUNTIME,
  workPath: WORK_PATH,
  task: DEFAULT_TASK,
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[mcp] beacon MCP server ready on stdio');
