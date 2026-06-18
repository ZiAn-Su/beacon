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

export async function listSessions(): Promise<Session[]> {
  const r = await fetch("/api/sessions");
  const data = await json<{ sessions: Session[] }>(r);
  return data.sessions;
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

export interface ReplyResult {
  message: Message;
  /** What the server did about agent liveness: "spawned" = it was offline and is being woken. */
  wake?: string;
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

export async function cancelAsk(askId: string): Promise<void> {
  const r = await fetch(`/api/asks/${encodeURIComponent(askId)}/cancel`, {
    method: "POST",
  });
  await json<{ ask: unknown }>(r);
}

/** Rename and/or archive a conversation (PATCH /api/sessions/:id). */
export async function patchSession(
  sessionId: string,
  body: { title?: string | null; archived?: boolean },
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
