// User-facing settings, persisted to disk and edited from the UI (never env
// vars). Currently: what to do when you message an agent whose process is not
// running.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  CAPABILITIES,
  DEFAULT_GLOBAL_PERMISSIONS,
  isEffect,
  type Capability,
  type Effect,
} from './permissions';

const PATH = process.env.BEACON_SETTINGS ?? 'data/settings.json';

export interface Settings {
  // When you message an offline agent:
  //   ask  - show a one-click "start it?" prompt (default)
  //   auto - start it automatically
  //   off  - just queue the message until the agent runs on its own
  autoStart: 'ask' | 'auto' | 'off';
  // Permission level the started agent runs under (maps to Claude
  // --permission-mode). bypassPermissions lets it actually do the work.
  startPermission: string;
  // Global agent-to-agent messaging switch (single guardian, no per-grant scope
  // yet — that's a later phase):
  //   open - peer-notify / peer-ask are allowed (default)
  //   off  - both are refused with 403
  agentComm: 'open' | 'off';
  // Owner global defaults per capability (allow/ask/deny), applied when neither a
  // per-agent override nor a trust-tier preset decides. See core/permissions.ts.
  permissions: Record<Capability, Effect>;
}

const DEFAULTS: Settings = {
  autoStart: 'ask',
  startPermission: 'bypassPermissions',
  agentComm: 'open',
  permissions: { ...DEFAULT_GLOBAL_PERMISSIONS },
};

let cache: Settings | null = null;

// Coerce the permissions map: start from defaults, accept only known capability
// keys carrying a valid effect. Keeps an old/partial file from dropping a
// capability or smuggling in an invalid value.
function normPermissions(raw: unknown): Record<Capability, Effect> {
  const out: Record<Capability, Effect> = { ...DEFAULT_GLOBAL_PERMISSIONS };
  if (raw && typeof raw === 'object') {
    for (const cap of CAPABILITIES) {
      const v = (raw as Record<string, unknown>)[cap];
      if (typeof v === 'string' && isEffect(v)) out[cap] = v;
    }
  }
  return out;
}

export function getSettings(): Settings {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(readFileSync(PATH, 'utf8')) as Partial<Settings>;
    cache = { ...DEFAULTS, ...parsed, permissions: normPermissions(parsed.permissions) };
  } catch {
    cache = { ...DEFAULTS, permissions: { ...DEFAULT_GLOBAL_PERMISSIONS } };
  }
  return cache;
}

export function setSettings(patch: Partial<Settings>): Settings {
  const next: Settings = { ...getSettings(), ...patch };
  // Validate enum.
  if (!['ask', 'auto', 'off'].includes(next.autoStart)) next.autoStart = 'ask';
  if (!['open', 'off'].includes(next.agentComm)) next.agentComm = 'open';
  next.permissions = normPermissions(next.permissions);
  cache = next;
  try {
    mkdirSync(dirname(PATH), { recursive: true });
    writeFileSync(PATH, JSON.stringify(next, null, 2));
  } catch {
    // non-fatal
  }
  return next;
}
