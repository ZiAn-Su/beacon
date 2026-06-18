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

export interface Session {
  id: string;
  runtime: string; // "claude-code" | "codex" | ...
  workPath: string; // working directory / task root
  task: string; // human-readable description of what it's doing
  status: SessionStatus;
  title: string | null; // human-set display name; overrides `task` when present
  archivedAt: number | null; // when archived (hidden from active list), else null
  createdAt: number;
  updatedAt: number;
}

export type MsgDirection = 'agent' | 'human';

// notify  : agent -> human, non-blocking FYI
// ask     : agent -> human, blocking question (links to an Ask)
// answer  : human -> agent, reply that resolves an Ask
// chat    : free-form message either direction
// status  : system line recording a status change
export type MsgKind = 'notify' | 'ask' | 'answer' | 'chat' | 'status';

export interface Message {
  id: string;
  sessionId: string;
  direction: MsgDirection;
  kind: MsgKind;
  text: string;
  askId: string | null; // set for kind 'ask' and 'answer'
  meta: Record<string, unknown> | null; // e.g. ask options
  createdAt: number;
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
