// Mirrors the backend contract in src/core/types.ts. Keep in sync.

export type SessionStatus =
  | "registered"
  | "working"
  | "waiting"
  | "idle"
  | "done";

export interface Session {
  id: string;
  runtime: string;
  workPath: string;
  task: string;
  status: SessionStatus;
  title: string | null;
  archivedAt: number | null;
  lastSeenAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export type MsgDirection = "agent" | "human";
export type MsgKind = "notify" | "ask" | "answer" | "chat" | "status";

export interface Message {
  id: string;
  sessionId: string;
  direction: MsgDirection;
  kind: MsgKind;
  text: string;
  askId: string | null;
  meta: { options?: string[] } | null;
  createdAt: number;
}

export type WsEvent =
  | { type: "hello"; sessions: Session[] }
  | { type: "session"; session: Session }
  | { type: "message"; message: Message };
