import type { Message, Session } from "../types";

// Typed wrappers for the north-side REST contract. In dev Vite proxies
// `/api` -> http://127.0.0.1:4319, so we just use relative URLs.

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
  return (await res.json()) as T;
}

export async function getHealth(): Promise<{ version: string }> {
  const r = await fetch("/api/health");
  return json<{ ok: boolean; version: string; ts: number }>(r);
}

export async function listSessions(): Promise<Session[]> {
  const r = await fetch("/api/sessions");
  const data = await json<{ sessions: Session[] }>(r);
  return data.sessions;
}

// The full agent roster (single-user => every session is an agent/contact),
// including archived ones. The directory filters as needed.
export async function listAgents(): Promise<Session[]> {
  const r = await fetch("/api/agents");
  const data = await json<{ agents: Session[] }>(r);
  return data.agents;
}

// A per-pair authorization edge (fromId -> toId) overriding the sender's
// trust tier for agent-to-agent messaging.
export interface Grant {
  id: string;
  fromId: string;
  toId: string;
  effect: "allow" | "deny";
  createdAt: number;
}

export async function listGrants(): Promise<Grant[]> {
  const r = await fetch("/api/grants");
  return (await json<{ grants: Grant[] }>(r)).grants;
}

export async function createGrant(
  fromId: string,
  toId: string,
  effect: "allow" | "deny",
): Promise<Grant> {
  const r = await fetch("/api/grants", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fromId, toId, effect }),
  });
  return (await json<{ grant: Grant }>(r)).grant;
}

export async function deleteGrant(id: string): Promise<void> {
  const r = await fetch(`/api/grants/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  await json<{ ok: boolean }>(r);
}

// An agent-initiated request to contact another agent, pending guardian decision.
export interface ContactRequest {
  id: string;
  fromId: string;
  toId: string;
  askId: string;
  reason: string | null;
  status: "pending" | "approved" | "denied";
  createdAt: number;
  decidedAt: number | null;
}

export async function listContactRequests(): Promise<ContactRequest[]> {
  const r = await fetch("/api/contact-requests");
  return (await json<{ requests: ContactRequest[] }>(r)).requests;
}

// A runtime conversation found on disk under a folder, discoverable for import.
export interface DiscoveredSession {
  nativeSessionId: string;
  title: string;
  updatedAt: number;
  importedAs: string | null; // Beacon session id if already imported, else null
}

export async function discoverAgents(
  path: string,
  runtime: string,
): Promise<DiscoveredSession[]> {
  const q = `path=${encodeURIComponent(path)}&runtime=${encodeURIComponent(runtime)}`;
  const r = await fetch(`/api/discover?${q}`);
  return (await json<{ sessions: DiscoveredSession[] }>(r)).sessions;
}

export async function importAgent(body: {
  workPath: string;
  runtime: string;
  nativeSessionId: string;
  name?: string | null;
}): Promise<Session> {
  const r = await fetch("/api/sessions/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await json<{ session: Session }>(r)).session;
}

export async function launchAgent(body: {
  workPath: string;
  runtime: string;
  name?: string | null;
  task?: string | null;
}): Promise<Session> {
  const r = await fetch("/api/sessions/launch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await json<{ session: Session }>(r)).session;
}

export interface Conversation {
  session: Session;
  messages: Message[];
}

export async function getConversation(
  sessionId: string,
): Promise<Conversation> {
  const r = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/messages`);
  return json<Conversation>(r);
}

// What happened for the agent after you sent: it's running, we're starting it,
// it's offline and the UI should offer to start it, or the message was queued.
export type AgentDelivery = "online" | "starting" | "offline" | "queued";

export interface ReplyResult {
  message: Message;
  agent?: AgentDelivery;
}

export async function reply(
  sessionId: string,
  text: string,
  askId?: string | null,
): Promise<ReplyResult> {
  const r = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/reply`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(askId ? { text, askId } : { text }),
  });
  return json<ReplyResult>(r);
}

/** One-click "start the offline agent now". */
export async function startAgent(sessionId: string, text: string): Promise<string> {
  const r = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const data = await json<{ result: string }>(r);
  return data.result;
}

export interface AppSettings {
  autoStart: "ask" | "auto" | "off";
  startPermission: string;
  // Global master switch for agent-to-agent messaging.
  agentComm?: "open" | "off";
}

export async function getSettings(): Promise<AppSettings> {
  const r = await fetch("/api/settings");
  return (await json<{ settings: AppSettings }>(r)).settings;
}

export async function putSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const r = await fetch("/api/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  return (await json<{ settings: AppSettings }>(r)).settings;
}

export async function cancelAsk(askId: string): Promise<void> {
  const r = await fetch(`/api/asks/${encodeURIComponent(askId)}/cancel`, {
    method: "POST",
  });
  await json<{ ask: unknown }>(r);
}

/** Rename and/or archive a conversation (PATCH /api/sessions/:id). */
export async function patchSession(
  sessionId: string,
  body: { title?: string | null; description?: string | null; archived?: boolean; trustTier?: string },
): Promise<Session> {
  const r = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await json<{ session: Session }>(r);
  return data.session;
}

// Connect-an-agent panel data, served by GET /api/connect-info.
// Paths and commands are pre-resolved by the backend; the UI just renders.
export interface ConnectInfo {
  platformUrl: string;
  version: string;
  requiresToken: boolean;
  serverPath: string;
  command: string;
  args: string[];
  tools: string[];
  mcpUrl: string;
  claudeMcpHttp: string;
  codexMcpHttp: string;
  skill: {
    sourceDir: string;
    cliPath: string;
    install: string;
    installWindows: string;
    usage: string[];
  };
  claudeMcpAdd: string;
  mcpJson: { mcpServers: Record<string, unknown> };
  codexMcpAdd: string;
  httpExample: string;
}

export async function getConnectInfo(): Promise<ConnectInfo> {
  const r = await fetch('/api/connect-info');
  return json<ConnectInfo>(r);
}
