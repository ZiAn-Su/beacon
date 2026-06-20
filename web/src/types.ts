// Mirrors the backend contract in src/core/types.ts. Keep in sync.

export type SessionStatus =
  | "registered"
  | "working"
  | "waiting"
  | "idle"
  | "done";

export type TrustTier = "restricted" | "standard" | "trusted" | "autonomous";

export interface Session {
  id: string;
  runtime: string;
  workPath: string;
  task: string;
  status: SessionStatus;
  title: string | null;
  archivedAt: number | null;
  lastSeenAt: number | null;
  // Authorization graduation for this agent's outbound peer messaging.
  // Optional for forward-compat with older payloads; defaults to "standard".
  trustTier?: TrustTier;
  // Who brought this contact into being: a self-registering agent, or a human.
  // Optional for forward-compat; defaults to "agent".
  origin?: "agent" | "human";
  createdAt: number;
  updatedAt: number;
}

export type MsgDirection = "agent" | "human";
export type MsgKind = "notify" | "ask" | "answer" | "chat" | "status" | "peer";

export interface Message {
  id: string;
  sessionId: string;
  direction: MsgDirection;
  kind: MsgKind;
  text: string;
  // Originating session for an agent->agent "peer" message; null otherwise.
  fromSessionId: string | null;
  askId: string | null;
  meta: { options?: string[] } | null;
  createdAt: number;
  deliveredAt: number | null;
}

export type WsEvent =
  | { type: "hello"; sessions: Session[] }
  | { type: "session"; session: Session }
  | { type: "message"; message: Message };
