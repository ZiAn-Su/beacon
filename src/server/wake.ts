// Auto-wake: bring an offline agent back when a human messages it.
//
// Beacon is a bus, not a process manager — but it knows each session's runtime
// and work path, which is enough to relaunch the agent. When you message an
// OFFLINE agent, the platform spawns the runtime's wake command in that work
// path; the revived agent drains its inbox and continues.
//
// Self-configuring, per design: the per-runtime wake recipe lives here in code
// (written once per runtime type). Neither the human nor the agent configures
// anything — the platform derives the command from data it already has.
//
// Injection-proof: the human's message is delivered to the agent on STDIN, never
// on a shell command line. `claude -p` reads its prompt from stdin.
import { spawn } from 'node:child_process';
import type { Session } from '../core/types';

// A session is "online" if it talked to Beacon within this window.
export const ONLINE_TTL_MS = 60_000;
// Don't relaunch the same agent more than once per this window (avoid storms).
const COOLDOWN_MS = 90_000;

// Auto-wake is OFF by default — relaunching an agent runs it with real tool
// permissions, so the operator must opt in explicitly. BEACON_WAKE selects the
// permission mode the woken agent runs under:
//   off (default) | full | acceptEdits | default | plan | bypassPermissions
// `full` is a friendly alias for Claude's bypassPermissions (fully autonomous).
const RAW_WAKE = (process.env.BEACON_WAKE ?? 'off').trim();
const WAKE_OFF =
  RAW_WAKE === '' || RAW_WAKE === 'off' || RAW_WAKE === '0' || RAW_WAKE === 'false';

function permissionMode(): string {
  if (RAW_WAKE === 'full' || RAW_WAKE === 'bypass' || RAW_WAKE === 'yolo') {
    return 'bypassPermissions';
  }
  return RAW_WAKE; // pass through: default | acceptEdits | plan | bypassPermissions
}

const lastWake = new Map<string, number>();

export function isOnline(s: { lastSeenAt: number | null }, nowMs = Date.now()): boolean {
  return !!s.lastSeenAt && nowMs - s.lastSeenAt < ONLINE_TTL_MS;
}

// argv WITHOUT the prompt — the prompt is written to the child's stdin, so a
// hostile message can never break out onto the command line. Returns null when
// we don't know how to wake this runtime.
//
// BEACON_WAKE_CMD overrides the per-runtime default for every runtime (operator
// escape hatch, e.g. a custom resume wrapper). Split on whitespace; the message
// still goes via stdin, never argv.
function wakeArgv(runtime: string): string[] | null {
  const override = process.env.BEACON_WAKE_CMD;
  if (override && override.trim()) return override.trim().split(/\s+/);
  switch (runtime) {
    case 'claude-code':
      // Resume the most recent conversation in the work dir (reuses its full
      // context/task), one print turn, under the operator-chosen permission
      // mode. A headless `claude -p` cannot use tools — and so cannot run the
      // beacon skill to read its inbox or reply — unless a permission mode is
      // given; that is why auto-wake is opt-in (BEACON_WAKE).
      return ['claude', '--continue', '--print', '--permission-mode', permissionMode()];
    default:
      return null;
  }
}

function wakePrompt(humanText: string): string {
  return [
    'A human just sent you a new message via Beacon that needs your attention:',
    '',
    humanText,
    '',
    'This continues your earlier task session in this directory. Do these now:',
    '1) Immediately send a short Beacon notify acknowledging you received it (so',
    '   the human sees you are back) — run your beacon skill, e.g.',
    '   `node <your beacon skill path>/beacon.mjs notify "on it: ..."`.',
    '2) Check your Beacon inbox (`... beacon.mjs inbox`) for anything you missed.',
    '3) Act on the message, then notify the human of the result, or ask if you',
    '   need a decision. Keep it concise.',
  ].join('\n');
}

export type WakeResult =
  | 'spawned'
  | 'online'
  | 'cooldown'
  | 'no-template'
  | 'no-workpath'
  | 'disabled'
  | 'error';

/** Wake the agent if it is offline and we know how. Returns what it did. */
export function maybeWake(session: Session, humanText: string): WakeResult {
  if (WAKE_OFF) return 'disabled';
  if (isOnline(session)) return 'online';
  if (!session.workPath) return 'no-workpath';
  const argv = wakeArgv(session.runtime);
  if (!argv) return 'no-template';

  const prev = lastWake.get(session.id) ?? 0;
  if (Date.now() - prev < COOLDOWN_MS) return 'cooldown';
  lastWake.set(session.id, Date.now());

  try {
    const isWin = process.platform === 'win32';
    // On Windows, `claude` is a .cmd shim, which Node won't exec without a shell;
    // route through cmd.exe but keep the prompt on stdin (no shell interpolation
    // of the message). On POSIX, spawn the binary directly. Capture output so we
    // can see whether the wake actually did anything (vs failing silently).
    const child = isWin
      ? spawn('cmd.exe', ['/c', ...argv], {
          cwd: session.workPath,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        })
      : spawn(argv[0], argv.slice(1), {
          cwd: session.workPath,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
    let out = '';
    const cap = (b: Buffer) => {
      if (out.length < 4000) out += b.toString();
    };
    child.stdout?.on('data', cap);
    child.stderr?.on('data', cap);
    child.on('error', (e) =>
      console.error(`[wake] spawn error for ${session.id}: ${e.message}`),
    );
    child.on('close', (code) => {
      const tail = out.replace(/\s+/g, ' ').trim().slice(-500);
      console.log(`[wake] ${session.id} exited code=${code}; output: ${tail || '(empty)'}`);
    });
    child.stdin?.end(wakePrompt(humanText));
    console.log(
      `[wake] relaunched ${session.runtime} in ${session.workPath} for session ${session.id}`,
    );
    return 'spawned';
  } catch (e) {
    console.error(`[wake] failed for ${session.id}: ${(e as Error).message}`);
    return 'error';
  }
}
