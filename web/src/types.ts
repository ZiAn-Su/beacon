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
  // Agent self-introduction (role / skills / what it does) so peers and the
  // human can decide whether to contact it. Optional for forward-compat.
  description?: string | null;
  archivedAt: number | null;
  lastSeenAt: number | null;
  // Authorization graduation for this agent's outbound peer messaging.
  // Optional for forward-compat with older payloads; defaults to "standard".
  trustTier?: TrustTier;
  // Who brought this contact into being: a self-registering agent, or a human.
  // Optional for forward-compat; defaults to "agent".
  origin?: "agent" | "human";
  // The runtime's own session id, when reported. Enables precise `--resume`.
  nativeSessionId?: string | null;
  // When the owner admitted this agent as a live contact. null = quarantined,
  // pending the owner's decision. Optional for forward-compat (defaults admitted).
  admittedAt?: number | null;
  createdAt: number;
  updatedAt: number;
}

export type MsgDirection = "agent" | "human";
export type MsgKind = "notify" | "ask" | "answer" | "chat" | "status" | "peer";

// An image the human attached to a message. `url` serves the thumbnail; `path`
// is the absolute file path handed to the agent.
export interface Attachment {
  id: string;
  name: string;
  mime: string;
  url: string;
  path: string;
}

export interface Message {
  id: string;
  sessionId: string;
  direction: MsgDirection;
  kind: MsgKind;
  text: string;
  // Originating session for an agent->agent "peer" message; null otherwise.
  fromSessionId: string | null;
  askId: string | null;
  meta: {
    options?: string[];
    // Image attachments on a human message.
    attachments?: Attachment[];
    // Present when this ask backs an agent-initiated contact request; the UI
    // renders a localized approval card and the approve/deny option tokens.
    contactRequest?: { fromId: string; toId: string; reason?: string | null };
    // Present when this ask backs a register admission (an agent awaiting the
    // owner's decision before it goes live).
    admissionRequest?: { agentId: string };
    // Present when this ask backs an agent-initiated spawn request.
    spawnRequest?: { spawnerId: string; workPath: string; runtime: string; name?: string | null; task?: string | null };
  } | null;
  createdAt: number;
  deliveredAt: number | null;
}

// Group channels: a channel fans a message out to all members (agents + the
// human owner). v1 is broadcast chat. Mirrors src/core/types.ts.
export interface Channel {
  id: string;
  name: string;
  createdAt: number;
}

export type ChannelMsgKind = "chat" | "ask" | "answer";

export interface ChannelMessage {
  id: string;
  channelId: string;
  // The posting agent's session id, or null for the human (owner).
  fromSessionId: string | null;
  text: string;
  // 'ask' = a blocking question to the group; 'answer' resolved one. Optional
  // for forward-compat (older payloads default to 'chat').
  kind?: ChannelMsgKind;
  askId?: string | null;
  // @directed target member id, or null/undefined for a plain broadcast.
  toSessionId?: string | null;
  createdAt: number;
}

// Per-member receipts for a channel: how far each agent member has been
// delivered (typed into its live terminal) and read (it pulled the channel).
export interface ChannelMemberState {
  sessionId: string;
  deliveredAt: number | null;
  readAt: number | null;
}

export type WsEvent =
  | { type: "hello"; sessions: Session[] }
  | { type: "session"; session: Session }
  | { type: "session-removed"; id: string }
  | { type: "message"; message: Message }
  | { type: "channel"; channel: Channel }
  | { type: "channel-removed"; id: string }
  | { type: "channel-message"; message: ChannelMessage }
  | { type: "channel-state"; channelId: string; states: ChannelMemberState[] };
