import type { Attachment, Channel, ChannelMemberState, ChannelMessage, Message, Session } from "../types";

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
  attachments?: { id: string; name: string }[],
): Promise<ReplyResult> {
  const body: Record<string, unknown> = { text };
  if (askId) body.askId = askId;
  if (attachments && attachments.length) body.attachments = attachments;
  const r = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/reply`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return json<ReplyResult>(r);
}

/** Read a File as base64 (no data: prefix) for the upload endpoint. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Upload an image file; returns the saved attachment (url + path). */
export async function uploadImage(file: File): Promise<Attachment> {
  const dataBase64 = await fileToBase64(file);
  const r = await fetch("/api/uploads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: file.name, mime: file.type, dataBase64 }),
  });
  return (await json<{ upload: Attachment }>(r)).upload;
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

// ---- owner permission model (capabilities) ----
export type Capability = "contact_agent" | "register_agent" | "spawn_agent";
export type Effect = "allow" | "ask" | "deny";

// Everything the permission panel needs: the capability set, the three effects,
// the owner global defaults, and the agent-to-agent master switch.
export interface PermissionModel {
  capabilities: Capability[];
  effects: Effect[];
  globalDefaults: Record<Capability, Effect>;
  agentComm: "open" | "off";
}

export async function getPermissions(): Promise<PermissionModel> {
  const r = await fetch("/api/permissions");
  return json<PermissionModel>(r);
}

// The capability set + tier presets are static for a running platform; cache them
// so per-contact profiles don't refetch. Global defaults can change, so callers
// that need the live defaults use getPermissions() directly.
let _permCache: Promise<PermissionModel> | null = null;
export function getPermissionsCached(): Promise<PermissionModel> {
  if (!_permCache) _permCache = getPermissions();
  return _permCache;
}

/** Per-agent capability override (null effect clears it). */
export async function setAgentPolicy(
  sessionId: string,
  capability: Capability,
  effect: Effect | null,
): Promise<Partial<Record<Capability, Effect>>> {
  const r = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/policy`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ capability, effect }),
  });
  return (await json<{ policies: Partial<Record<Capability, Effect>> }>(r)).policies;
}

export async function getAgentPolicies(
  sessionId: string,
): Promise<Partial<Record<Capability, Effect>>> {
  const r = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/policy`);
  return (await json<{ policies: Partial<Record<Capability, Effect>> }>(r)).policies;
}

/** Agents quarantined pending the owner's admission decision. */
export async function listAdmissions(): Promise<Session[]> {
  const r = await fetch("/api/admissions");
  return (await json<{ pending: Session[] }>(r)).pending;
}

export async function admitSession(
  sessionId: string,
  approve: boolean,
): Promise<void> {
  const r = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/admit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ approve }),
  });
  await json<unknown>(r);
}

export interface SpawnRequest {
  id: string;
  spawnerId: string;
  askId: string;
  params: { workPath: string; runtime: string; name?: string | null; task?: string | null };
  status: "pending" | "approved" | "denied";
  createdAt: number;
  decidedAt: number | null;
}

export async function listSpawnRequests(): Promise<SpawnRequest[]> {
  const r = await fetch("/api/spawn-requests");
  return (await json<{ pending: SpawnRequest[] }>(r)).pending;
}

export async function decideSpawnRequest(
  askId: string,
  approve: boolean,
): Promise<void> {
  const r = await fetch(`/api/spawn-requests/${encodeURIComponent(askId)}/decide`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ approve }),
  });
  await json<unknown>(r);
}

export interface AppSettings {
  autoStart: "ask" | "auto" | "off";
  startPermission: string;
  // Global master switch for agent-to-agent messaging.
  agentComm?: "open" | "off";
  // Owner global capability defaults.
  permissions?: Record<Capability, Effect>;
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

/** Permanently delete a contact and everything attached to it. */
export async function deleteSession(sessionId: string): Promise<void> {
  const r = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });
  await json<{ ok: boolean }>(r);
}

/** Batch archive / unarchive / delete contacts. Returns the affected count. */
export async function batchSessions(
  ids: string[],
  action: "archive" | "unarchive" | "delete",
): Promise<number> {
  const r = await fetch("/api/sessions/batch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids, action }),
  });
  return (await json<{ affected: number }>(r)).affected;
}

/** Rename and/or archive a conversation (PATCH /api/sessions/:id). */
export async function patchSession(
  sessionId: string,
  body: { title?: string | null; description?: string | null; archived?: boolean },
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

// ---- group channels (north / owner side) ----

// The list endpoint returns each channel WITH its participant ids, so the
// channel list can show member counts without opening (selecting) each one.
export interface ChannelListItem extends Channel {
  participants: string[];
}
export async function listChannels(): Promise<ChannelListItem[]> {
  const r = await fetch("/api/channels");
  return (await json<{ channels: ChannelListItem[] }>(r)).channels;
}

// Channels a given session belongs to — for the contact profile's group entries.
export async function listSessionChannels(sessionId: string): Promise<Channel[]> {
  const r = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/member-channels`);
  return (await json<{ channels: Channel[] }>(r)).channels;
}

export interface ChannelDetail {
  channel: Channel;
  participants: string[];
  messages: ChannelMessage[];
  states?: ChannelMemberState[];
}

export async function getChannel(id: string): Promise<ChannelDetail> {
  const r = await fetch(`/api/channels/${encodeURIComponent(id)}`);
  return json<ChannelDetail>(r);
}

export async function createChannel(
  name: string,
  participants: string[],
): Promise<{ channel: Channel; participants: string[] }> {
  const r = await fetch("/api/channels", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, participants }),
  });
  return json<{ channel: Channel; participants: string[] }>(r);
}

export async function renameChannel(id: string, name: string): Promise<Channel> {
  const r = await fetch(`/api/channels/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return (await json<{ channel: Channel }>(r)).channel;
}

export async function deleteChannel(id: string): Promise<void> {
  const r = await fetch(`/api/channels/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  await json<{ ok: boolean }>(r);
}

export async function addChannelParticipant(
  channelId: string,
  sessionId: string,
): Promise<string[]> {
  const r = await fetch(`/api/channels/${encodeURIComponent(channelId)}/participants`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  return (await json<{ participants: string[] }>(r)).participants;
}

export async function removeChannelParticipant(
  channelId: string,
  sessionId: string,
): Promise<string[]> {
  const r = await fetch(
    `/api/channels/${encodeURIComponent(channelId)}/participants/${encodeURIComponent(sessionId)}`,
    { method: "DELETE" },
  );
  return (await json<{ participants: string[] }>(r)).participants;
}

/** Owner posts to a channel (fromSessionId null). Optionally @directed at one member. */
export async function postChannelMessage(
  channelId: string,
  text: string,
  toSessionId?: string | null,
): Promise<ChannelMessage> {
  const r = await fetch(`/api/channels/${encodeURIComponent(channelId)}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, toSessionId: toSessionId ?? undefined }),
  });
  return (await json<{ message: ChannelMessage }>(r)).message;
}

/** Owner answers a pending channel ask (first answer wins, unblocks the asker). */
export async function answerChannelAsk(
  channelId: string,
  askId: string,
  text: string,
): Promise<ChannelMessage> {
  const r = await fetch(`/api/channels/${encodeURIComponent(channelId)}/answer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ askId, text }),
  });
  return (await json<{ message: ChannelMessage }>(r)).message;
}
