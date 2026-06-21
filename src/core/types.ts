// Core domain types for the agent-native interaction platform.
// A "session" is one agent working on one task (a work-path). To the human it
// appears as a distinct contact. Messages flow both ways; "asks" are blocking
// questions the agent raises and waits on.

export type SessionStatus =
  | 'registered' // just announced, not yet doing anything
  | 'working'    // actively executing the task
  | 'waiting'    // blocked on a human answer (ask pending)
  | 'idle'       // alive but not actively working
  | 'done';      // task finished

export const SESSION_STATUSES: SessionStatus[] = [
  'registered',
  'working',
  'waiting',
  'idle',
  'done',
];

// Trust tier graduates how much an agent contact is allowed to do. Phase 1
// stores it but enforces nothing; authorization arrives in a later phase.
export type TrustTier = 'restricted' | 'standard' | 'trusted' | 'autonomous';

export const TRUST_TIERS: TrustTier[] = [
  'restricted',
  'standard',
  'trusted',
  'autonomous',
];

// The platform owner / guardian: the human a session is accountable to. One row
// is ensured at startup; sessions are bound to it via `guardianId`.
export interface Owner {
  id: string;
  name: string | null;
  token: string | null;
  createdAt: number;
}

export interface Session {
  id: string;
  runtime: string; // "claude-code" | "codex" | ...
  workPath: string; // working directory / task root
  task: string; // human-readable description of what it's doing
  status: SessionStatus;
  title: string | null; // display name; agent self-reports it, human can override. Falls back to `task`.
  // Agent self-introduction: who it is, what it does / is good at. Lets a peer
  // decide whether to contact it. Agent-reported at register; human-editable.
  description: string | null;
  archivedAt: number | null; // when archived (hidden from active list), else null
  lastSeenAt: number | null; // last time the agent talked to Beacon (presence)
  bindKey: string | null; // continuation credential; null = anonymous one-shot
  // The runtime's own session id (e.g. CLAUDE_CODE_SESSION_ID), when the agent
  // reports it. Enables precise `--resume <id>`; not an identity key. Null when
  // unknown (older rows, runtimes that don't expose one).
  nativeSessionId: string | null;
  origin: 'agent' | 'human'; // 'agent' self-registered | 'human' pre-created
  guardianId: string | null; // Owner.id this session is accountable to
  trustTier: TrustTier; // graduated trust; defaults to 'standard' at read time
  // Admission: when the owner admitted this agent as a live contact. Null while
  // pending the owner's decision (register_agent resolved to 'ask'); such a
  // session is quarantined — invisible to peers and barred from acting — until
  // approved. Human-created and auto-allowed sessions are admitted at creation.
  admittedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export type MsgDirection = 'agent' | 'human';

// notify  : agent -> human, non-blocking FYI
// ask     : agent -> human, blocking question (links to an Ask)
// answer  : human -> agent, reply that resolves an Ask
// chat    : free-form message either direction
// status  : system line recording a status change
// peer    : agent -> agent, carried on the recipient session's thread
export type MsgKind = 'notify' | 'ask' | 'answer' | 'chat' | 'status' | 'peer';

export interface Message {
  id: string;
  sessionId: string;
  direction: MsgDirection;
  kind: MsgKind;
  text: string;
  // The originating session for an agent->agent 'peer' message; null otherwise.
  fromSessionId: string | null;
  askId: string | null; // set for kind 'ask' and 'answer'
  meta: Record<string, unknown> | null; // e.g. ask options
  createdAt: number;
  deliveredAt: number | null; // when agent first read it via check_inbox
}

// A per-pair authorization grant overriding the sender's trust tier for a
// specific (fromId -> toId) edge. 'allow' opens the edge; 'deny' closes it.
export type GrantEffect = 'allow' | 'deny';

export interface Grant {
  id: string;
  fromId: string;
  toId: string;
  effect: GrantEffect;
  createdAt: number;
}

// An agent-initiated request to be allowed to contact another agent. It surfaces
// to the guardian as a normal Ask (options 'approve' | 'deny'); approving it
// mints an allow Grant. Lets authorization flow agent -> human, not only human.
export type ContactRequestStatus = 'pending' | 'approved' | 'denied';

export interface ContactRequest {
  id: string;
  fromId: string;
  toId: string;
  askId: string; // the guardian-facing Ask the human answers
  reason: string | null;
  status: ContactRequestStatus;
  createdAt: number;
  decidedAt: number | null;
}

export type AskStatus = 'pending' | 'answered' | 'cancelled';

export interface Ask {
  id: string;
  sessionId: string;
  question: string;
  options: string[] | null;
  status: AskStatus;
  answer: string | null;
  createdAt: number;
  answeredAt: number | null;
}
