// Owner-controlled capability permissions. This module is the single source of
// truth for what an agent is allowed to do, modelled on Claude Code's
// allow/ask/deny rules.
//
// Resolution is layered, most-specific wins:
//   per-pair grant (contact only)  >  per-agent override  >  owner global default
//   >  built-in fallback ('ask').
//
// 'ask' routes to the owner as a runtime approval (reusing Beacon's ask flow).

// A bounded thing an agent may attempt. Add a key here and it is automatically
// governed by the same owner-controlled machinery; nothing is implicitly open.
export type Capability =
  | 'contact_agent'  // initiate peer messaging to another agent
  | 'register_agent' // come online as a contact (admission)
  | 'spawn_agent';   // launch a brand-new agent process

export const CAPABILITIES: Capability[] = [
  'contact_agent',
  'register_agent',
  'spawn_agent',
];

// Three states, identical to Claude Code: allow outright, ask the owner, or deny.
export type Effect = 'allow' | 'ask' | 'deny';

export const EFFECTS: Effect[] = ['allow', 'ask', 'deny'];

export function isCapability(x: string): x is Capability {
  return (CAPABILITIES as string[]).includes(x);
}

export function isEffect(x: string): x is Effect {
  return (EFFECTS as string[]).includes(x);
}

// Owner global defaults applied when no per-agent override decides. Per the
// owner's chosen posture, everything unconfigured is 'ask' — nothing is silently
// allowed.
export const DEFAULT_GLOBAL_PERMISSIONS: Record<Capability, Effect> = {
  contact_agent: 'ask',
  register_agent: 'ask',
  spawn_agent: 'ask',
};

// Pure resolver over already-fetched inputs (the store wires it to its tables).
// Order: per-agent override -> owner global default. Per-pair grants and the
// contact visible-scope rule live in the store, which is the only place with the
// target session in hand.
export function resolveEffect(input: {
  agentOverride?: Effect | null;
  globalDefault: Effect;
}): Effect {
  return input.agentOverride ?? input.globalDefault;
}
