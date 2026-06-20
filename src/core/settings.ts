// User-facing settings, persisted to disk and edited from the UI (never env
// vars). Currently: what to do when you message an agent whose process is not
// running.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

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
}

const DEFAULTS: Settings = {
  autoStart: 'ask',
  startPermission: 'bypassPermissions',
  agentComm: 'open',
};

let cache: Settings | null = null;

export function getSettings(): Settings {
  if (cache) return cache;
  try {
    cache = { ...DEFAULTS, ...(JSON.parse(readFileSync(PATH, 'utf8')) as Partial<Settings>) };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

export function setSettings(patch: Partial<Settings>): Settings {
  const next: Settings = { ...getSettings(), ...patch };
  // Validate enum.
  if (!['ask', 'auto', 'off'].includes(next.autoStart)) next.autoStart = 'ask';
  if (!['open', 'off'].includes(next.agentComm)) next.agentComm = 'open';
  cache = next;
  try {
    mkdirSync(dirname(PATH), { recursive: true });
    writeFileSync(PATH, JSON.stringify(next, null, 2));
  } catch {
    // non-fatal
  }
  return next;
}
