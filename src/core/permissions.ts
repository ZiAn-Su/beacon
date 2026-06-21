// Owner-controlled capability permissions. This module is the single source of
// truth for what an agent is allowed to do, modelled on Claude Code's
// allow/ask/deny rules. The trust tiers are defined here as named capability
// presets, so the UI can render exactly what each tier means instead of showing
// an opaque label.
//
// Resolution is layered, most-specific wins:
//   per-pair grant (contact only)  >  per-agent override  >  trust-tier preset
//   >  owner global default  >  built-in fallback ('ask').
//
// 'ask' routes to the owner as a runtime approval (reusing Beacon's ask flow).

import type { TrustTier } from './types';

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

// What each trust tier grants, per capability. This table IS the meaning of a
// tier — the UI renders it as a legend so the owner can see the difference at a
// glance. A capability absent from a tier (e.g. register_agent, which is decided
// before any tier is assigned) falls through to the owner's global default.
//
//   contact_agent: for in-scope targets (same work directory). Out-of-scope
//   targets always require an explicit per-pair grant regardless of tier.
//   spawn_agent: no target, applies directly.
export const TIER_PRESETS: Record<TrustTier, Partial<Record<Capability, Effect>>> = {
  restricted: { contact_agent: 'deny', spawn_agent: 'deny' },
  standard: { contact_agent: 'ask', spawn_agent: 'ask' },
  trusted: { contact_agent: 'allow', spawn_agent: 'ask' },
  autonomous: { contact_agent: 'allow', spawn_agent: 'allow' },
};

// Owner global defaults applied when neither a per-agent override nor a tier
// preset decides. Per the owner's chosen posture, everything unconfigured is
// 'ask' — nothing is silently allowed.
export const DEFAULT_GLOBAL_PERMISSIONS: Record<Capability, Effect> = {
  contact_agent: 'ask',
  register_agent: 'ask',
  spawn_agent: 'ask',
};

// Pure resolver over already-fetched inputs (the store wires it to its tables).
// Order: per-agent override -> tier preset -> global default -> 'ask'.
// Per-pair grants and the contact visible-scope rule live in the store, which
// is the only place with the target session in hand.
export function resolveEffect(input: {
  capability: Capability;
  tier: TrustTier;
  agentOverride?: Effect | null;
  globalDefault: Effect;
}): Effect {
  if (input.agentOverride) return input.agentOverride;
  const preset = TIER_PRESETS[input.tier]?.[input.capability];
  if (preset) return preset;
  return input.globalDefault;
}
