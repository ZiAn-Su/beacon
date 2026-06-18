// Starting an offline agent: Beacon relaunches the agent in its work path so it
// can read your message and respond. Whether/how this happens is controlled by
// the in-app settings (src/core/settings.ts), never env vars.
//
// Injection-proof: the human's message is delivered to the agent on STDIN, never
// on a shell command line. `claude -p` reads its prompt from stdin.
import { spawn } from 'node:child_process';
import type { Session } from '../core/types';

// A session is "online" if its agent talked to Beacon within this window.
export const ONLINE_TTL_MS = 60_000;
// Don't relaunch the same agent more than once per this window (avoid storms).
const COOLDOWN_MS = 90_000;

const lastStart = new Map<string, number>();

export function isOnline(s: { lastSeenAt: number | null }, nowMs = Date.now()): boolean {
  return !!s.lastSeenAt && nowMs - s.lastSeenAt < ONLINE_TTL_MS;
}

// argv WITHOUT the prompt — the prompt is written to the child's stdin, so a
// hostile message can never break out onto the command line. Returns null when
// we don't know how to start this runtime.
function startArgv(runtime: string, permissionMode: string): string[] | null {
  const override = process.env.BEACON_WAKE_CMD;
  if (override && override.trim()) return override.trim().split(/\s+/);
  switch (runtime) {
    case 'claude-code':
      // Resume the most recent conversation in the work dir (reuses its full
      // context/task), one print turn, under the chosen permission mode.
      return ['claude', '--continue', '--print', '--permission-mode', permissionMode];
    default:
      return null;
  }
}

function startPrompt(humanText: string): string {
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

export type StartResult =
  | 'started'
  | 'cooldown'
  | 'no-runtime-support'
  | 'no-workpath'
  | 'error';

/**
 * Relaunch the agent in its work path so it can read `humanText` and respond.
 * Caller decides WHETHER to call this (online check + settings); this just does
 * the launch, with a cooldown to avoid storms.
 */
export function startAgent(
  session: Session,
  humanText: string,
  permissionMode: string,
): StartResult {
  if (!session.workPath) return 'no-workpath';
  const argv = startArgv(session.runtime, permissionMode);
  if (!argv) return 'no-runtime-support';

  const prev = lastStart.get(session.id) ?? 0;
  if (Date.now() - prev < COOLDOWN_MS) return 'cooldown';
  lastStart.set(session.id, Date.now());

  try {
    const isWin = process.platform === 'win32';
    // Tell the relaunched agent WHICH Beacon session it is, so its beacon
    // skill / MCP attaches to this conversation instead of registering a new
    // one. The env propagates down to the skill subprocess the agent runs.
    const env = { ...process.env, BEACON_SESSION_ID: session.id };
    // On Windows, `claude` is a .cmd shim, which Node won't exec without a shell;
    // route through cmd.exe but keep the prompt on stdin (no shell interpolation
    // of the message). On POSIX, spawn the binary directly. Capture output so we
    // can see whether the start actually did anything (vs failing silently).
    const child = isWin
      ? spawn('cmd.exe', ['/c', ...argv], {
          cwd: session.workPath,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
          env,
        })
      : spawn(argv[0], argv.slice(1), {
          cwd: session.workPath,
          stdio: ['pipe', 'pipe', 'pipe'],
          env,
        });
    let out = '';
    const cap = (b: Buffer) => {
      if (out.length < 4000) out += b.toString();
    };
    child.stdout?.on('data', cap);
    child.stderr?.on('data', cap);
    child.on('error', (e) =>
      console.error(`[start] spawn error for ${session.id}: ${e.message}`),
    );
    child.on('close', (code) => {
      const tail = out.replace(/\s+/g, ' ').trim().slice(-500);
      console.log(`[start] ${session.id} exited code=${code}; output: ${tail || '(empty)'}`);
    });
    child.stdin?.end(startPrompt(humanText));
    console.log(
      `[start] relaunched ${session.runtime} in ${session.workPath} for session ${session.id}`,
    );
    return 'started';
  } catch (e) {
    console.error(`[start] failed for ${session.id}: ${(e as Error).message}`);
    return 'error';
  }
}

/** Can Beacon relaunch this runtime at all? (drives whether the UI offers it) */
export function canStart(runtime: string): boolean {
  return !!startArgv(runtime, 'default');
}
