// PTY WebSocket server — embeds a real terminal in the web UI.
//
// Clients connect to /pty?sessionId=<id> and get a full PTY running the
// session's agent (claude --continue, codex, etc.) in its workPath.
//
// PTY processes are PERSISTENT and keyed by sessionId: spawning `claude
// --continue` is expensive (cold-starts the CLI, reloads the whole
// conversation), so we keep the process alive across reconnects. Switching
// the Messages/Terminal tab, reloading the page, or opening a second browser
// tab all *attach* to the same live process — only the very first open pays
// the spawn cost. Recent output is buffered and replayed on attach so the
// screen is reconstructed instantly.
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import * as pty from 'node-pty';
import { URL } from 'node:url';
import * as store from '../core/store';
import { ccsProfile } from './runtimes';
import { getSettings } from '../core/settings';

// Claude (and ccs, which is Claude under the hood) permission modes. A launched
// terminal agent must run under the owner's chosen mode (default
// bypassPermissions) — otherwise it stalls on a "Do you want to proceed?" prompt
// for every tool call, invisibly to the human on Beacon. wake.ts already passes
// this for relaunch; the PTY launch must too.
const CLAUDE_PERM_MODES = ['bypassPermissions', 'acceptEdits', 'default', 'plan', 'auto', 'dontAsk'];
function permFlag(): string {
  const m = getSettings().startPermission;
  return CLAUDE_PERM_MODES.includes(m) ? ` --permission-mode ${m}` : '';
}

// Per-spawn permission mode override: when spawn_agent includes a permissionMode
// arg, we store it here (sessionId -> mode) so the next spawn uses it instead of
// the global default. Cleared after spawn.
const spawnPermOverride = new Map<string, string>();
export function setSpawnPermission(sessionId: string, mode: string): void {
  if (CLAUDE_PERM_MODES.includes(mode)) spawnPermOverride.set(sessionId, mode);
}
function takeSpawnPerm(sessionId: string): string {
  const mode = spawnPermOverride.get(sessionId);
  spawnPermOverride.delete(sessionId);
  return mode && CLAUDE_PERM_MODES.includes(mode)
    ? ` --permission-mode ${mode}`
    : permFlag();
}

// Per-spawn pre-approved tools: maps to claude's `--allowedTools` so a spawned
// agent can run specific tools / command prefixes (e.g. "Bash(ffmpeg *)", "Read")
// without a per-call permission prompt AND without the bypassPermissions startup
// confirmation — the granular middle ground for autonomous agents that must run
// commands. Sanitized hard because the value is interpolated into the launch
// command string: only tool-name characters survive, so no shell injection.
const spawnAllowedTools = new Map<string, string>();
export function sanitizeAllowedTools(tools: string[]): string {
  return tools
    .map((t) => String(t).trim())
    // Allow tool names + simple arg patterns: letters, digits, _ ( ) . * : / space - ,
    // Reject anything with shell metacharacters (; | & $ ` " ' < > etc.).
    .filter((t) => t.length > 0 && /^[A-Za-z0-9_().*:/ ,-]+$/.test(t))
    .join(' ')
    .slice(0, 800)
    .trim();
}
export function setSpawnAllowedTools(sessionId: string, tools: string[]): void {
  const safe = sanitizeAllowedTools(tools);
  if (safe) spawnAllowedTools.set(sessionId, safe);
}
function takeSpawnAllowedTools(sessionId: string): string {
  const tools = spawnAllowedTools.get(sessionId);
  spawnAllowedTools.delete(sessionId);
  // Value is sanitized (no quotes/metachars), so double-quoting is safe in both
  // cmd.exe and bash.
  return tools ? ` --allowedTools "${tools}"` : '';
}

const isWin = process.platform === 'win32';

// Callback the gateway registers to replay missed 1:1 messages into a terminal
// once it is ready (see setOnPtyReady). Kept as a hook rather than a core bus
// event so the pty layer doesn't reach into core domain events.
let onPtyReady: ((sessionId: string) => void) | null = null;
export function setOnPtyReady(cb: (sessionId: string) => void): void {
  onPtyReady = cb;
}

// Cap of replayed scrollback per session (chars). Enough to redraw a TUI.
const BUFFER_CAP = 200_000;
// Kill an idle PTY this long after its last client disconnects.
const IDLE_KILL_MS = 30 * 60_000;

interface SpawnTarget {
  file: string;
  args: string[];
}

interface LivePty {
  proc: pty.IPty;
  buffer: string;
  clients: Set<WebSocket>;
  cols: number;
  rows: number;
  spawnedAt: number;
  pending: string[]; // messages queued while the TUI is still booting
  idleTimer: NodeJS.Timeout | null;
  heartbeat: NodeJS.Timeout | null;
  lastDataAt: number; // last time the PTY produced output (activity signal)
  gateAt: number; // last time we auto-dismissed a boot gate (debounce)
  promptNotedAt: number; // last time we surfaced a stuck-on-prompt notify
  limitNotedAt: number; // last time we surfaced a usage/rate-limit notify
  promptWaiting: boolean; // we set 'waiting' from a terminal prompt (recover it)
  intentionalKill: boolean; // platform killed it on purpose (delete / idle reap) — don't notify on exit
}

// How long after spawn we treat the TUI as "still booting" — messages sent in
// this window are queued and flushed once it's ready, so they don't get dropped
// before the input box exists.
const BOOT_MS = 3500;

// Strip ANSI escapes so we can pattern-match the visible terminal text.
function ansiStrip(s: string): string {
  return s
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
}
// Benign one-time boot gates that just want an Enter to move on (Claude Code's
// "Welcome to Claude Code for VS Code … Press Enter to continue", etc.). A
// launched agent would otherwise sit here forever, invisibly to the human.
const ENTER_GATE = /press enter to continue/i;
// Only auto-press Enter during the boot window, so we never interfere with the
// agent's real work later.
const GATE_WINDOW_MS = 30_000;
// Flip a working agent to 'idle' after this long with no terminal output.
const QUIET_IDLE_MS = 60_000;

// The agent is stuck on an interactive prompt the human must resolve IN the
// terminal — a trust-folder gate, a permission choice, a yes/no, a first-run
// picker. Under bypassPermissions most are gone, but a few (folder trust, theme
// on first run) still block. We do NOT auto-answer these (they are real
// decisions); we surface them so the human isn't left wondering why no reply came.
const PROMPT_GATE =
  /(do you want to proceed|do you trust the files|press \d+ to|❯\s*\d+\.|\b1\.\s+yes\b|\(y\/n\)|\[y\/n\])/i;
// The model/provider refused or throttled: usage cap, rate limit, quota, or an
// account spending limit (402 Daily spending limit / daily quota). Same silent-
// stall problem from the human's side — surface it instead of hanging. Wording
// varies across providers/plans, so match the common phrasings AND the HTTP code.
const LIMIT_GATE =
  /(usage limit reached|reached your usage limit|approaching your .{0,24}limit|spending limit|daily quota|quota will reset|rate limit|\b402\b|429 too many|quota exceeded|insufficient .{0,14}(quota|credit|balance)|overloaded_error)/i;
// A persistent prompt produces output once; debounce so we notify once, not on
// every chunk, and re-notify only if it recurs after this window.
const DETECT_DEBOUNCE_MS = 45_000;

// Pull the last line matching `re` from stripped terminal text, trimmed, so the
// surfaced notify carries the actual prompt/limit text the human needs to see.
function matchedLine(text: string, re: RegExp): string {
  const lines = text.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const ln = lines[i]!.trim();
    if (ln && re.test(ln)) return ln.slice(0, 160);
  }
  return '';
}

const live = new Map<string, LivePty>();

/** Runtimes Beacon knows how to drive as an agent (vs. a bare shell). */
function isAgentRuntime(runtime: string): boolean {
  return (
    runtime === 'claude-code' ||
    runtime === 'claude' ||
    runtime === 'codex' ||
    ccsProfile(runtime) !== null // ccs:<profile>, e.g. ccs:mm, ccs:ark
  );
}

/** Is there a live interactive terminal (PTY) for this session right now? */
export function hasLivePty(sessionId: string): boolean {
  return live.has(sessionId);
}

/** Kill and forget a session's terminal (e.g. when the contact is deleted). */
export function killPty(sessionId: string): void {
  const entry = live.get(sessionId);
  if (!entry) return;
  entry.intentionalKill = true; // deliberate teardown — onExit must not notify
  try { entry.proc.kill(); } catch { /* already exited */ }
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  if (entry.heartbeat) clearInterval(entry.heartbeat);
  for (const ws of entry.clients) {
    try { ws.close(); } catch { /* ignore */ }
  }
  live.delete(sessionId);
}

/**
 * Ensure an interactive agent terminal exists for this session, spawning one on
 * demand if needed. Returns false only for runtimes we can't launch as an agent
 * (so the caller can fall back to queuing). This is what makes "send a message"
 * always reach a real agent — no "offline"/"queued" dead-ends.
 */
export function ensurePty(sessionId: string): boolean {
  if (live.has(sessionId)) return true;
  const session = store.getSession(sessionId);
  if (!session || !isAgentRuntime(session.runtime)) return false;
  const r = getOrSpawn(sessionId);
  if ('error' in r) return false;
  // Spawned with no viewing client yet; arm the idle reaper so an unwatched
  // process doesn't live forever.
  armIdle(sessionId, r);
  return true;
}

function armIdle(sessionId: string, entry: LivePty): void {
  if (entry.clients.size === 0 && !entry.idleTimer) {
    entry.idleTimer = setTimeout(() => {
      entry.intentionalKill = true; // routine reap of an unwatched terminal — not a crash
      try { entry.proc.kill(); } catch { /* already exited */ }
      if (entry.heartbeat) clearInterval(entry.heartbeat);
      live.delete(sessionId);
    }, IDLE_KILL_MS);
  }
}

function submit(entry: LivePty, oneLine: string): void {
  try {
    entry.proc.write(oneLine);
    setTimeout(() => {
      try { entry.proc.write('\r'); } catch { /* exited */ }
    }, 60);
  } catch { /* exited */ }
}

// Submit a message that was queued during a COLD spawn. At BOOT_MS the TUI
// composer frequently shows the typed text but is not yet ready to SUBMIT it:
// a single Enter can land as a paste-confirm / newline instead of a send, so the
// message sits in the input box and the human has to press Enter in the terminal
// themselves (the reported bug). After writing the text once, retry Enter a few
// times as the composer settles. A stray Enter on an empty / already-submitted
// composer is a no-op in claude, so the retries are safe; they only ever turn a
// stuck-in-the-box message into a sent one.
function submitCold(entry: LivePty, oneLine: string): void {
  try {
    entry.proc.write(oneLine);
  } catch { return; /* exited */ }
  for (const delay of [150, 1100, 2400]) {
    setTimeout(() => {
      try { entry.proc.write('\r'); } catch { /* exited */ }
    }, delay);
  }
}

/**
 * Deliver a human message into the session's terminal as if typed into the
 * agent, then submit it (Enter). Spawns the terminal on demand if none exists.
 * If the TUI is still booting, the message is queued and flushed when ready.
 * Returns false only for runtimes Beacon can't launch.
 */
export function writeToPty(sessionId: string, text: string): boolean {
  if (!ensurePty(sessionId)) return false;
  const entry = live.get(sessionId);
  if (!entry) return false;
  // Collapse newlines to spaces so a multi-line paste doesn't submit early in
  // the TUI composer.
  const oneLine = text.replace(/\r?\n/g, ' ').trim();
  if (!oneLine) return false;

  if (Date.now() - entry.spawnedAt < BOOT_MS) {
    // Still booting — queue; the flush timer (set at spawn) delivers it.
    entry.pending.push(oneLine);
  } else {
    submit(entry, oneLine);
  }
  return true;
}

// Sessions the human just created in the UI: start a FRESH agent (no resume /
// continue, which would attach to an unrelated recent conversation in the dir).
const freshLaunch = new Set<string>();
/** Mark a session so its next spawn starts a brand-new agent process. */
export function markFreshLaunch(sessionId: string): void {
  freshLaunch.add(sessionId);
}

function spawnTarget(runtime: string, nativeSessionId: string | null, fresh: boolean, sessionId: string): SpawnTarget {
  const wrap = (cmd: string): SpawnTarget =>
    isWin
      ? { file: 'cmd.exe', args: ['/k', cmd] }
      : { file: process.env.SHELL ?? 'bash', args: ['-c', `exec ${cmd}`] };

  // Per-spawn flags: permission mode + pre-approved tools (--allowedTools). Both
  // are consumed (cleared) here, so they only apply to this one launch.
  const perm = takeSpawnPerm(sessionId) + takeSpawnAllowedTools(sessionId);
  if (runtime === 'claude-code' || runtime === 'claude') {
    // Fresh launch -> a new conversation. Otherwise resume the EXACT conversation
    // when the platform knows its native id; else the most recent in the work dir.
    if (fresh) return wrap(`claude${perm}`);
    return wrap((nativeSessionId ? `claude --resume ${nativeSessionId}` : 'claude --continue') + perm);
  }
  // ccs:<profile> -> Claude Code routed to another model (minimax m3, ark, …).
  // ccs forwards claude args, so resume/continue + permission mode work identically.
  const profile = ccsProfile(runtime);
  if (profile) {
    const base = `ccs ${profile}`;
    if (fresh) return wrap(`${base}${perm}`);
    return wrap((nativeSessionId ? `${base} --resume ${nativeSessionId}` : `${base} --continue`) + perm);
  }
  if (runtime === 'codex') return wrap('codex');

  // Unknown runtime: open an interactive shell in workPath
  return isWin
    ? { file: 'cmd.exe', args: [] }
    : { file: process.env.SHELL ?? 'bash', args: [] };
}

function getOrSpawn(sessionId: string): LivePty | { error: string } {
  const existing = live.get(sessionId);
  if (existing) return existing;

  const session = store.getSession(sessionId);
  if (!session) return { error: 'Session not found' };

  const fresh = freshLaunch.delete(sessionId);
  const { file, args } = spawnTarget(session.runtime, session.nativeSessionId, fresh, sessionId);
  const cols = 120;
  const rows = 30;

  let proc: pty.IPty;
  try {
    proc = pty.spawn(file, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: session.workPath || process.cwd(),
      env: {
        ...process.env,
        BEACON_SESSION_ID: session.id,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      } as Record<string, string>,
    });
  } catch (err) {
    console.error(`[pty] spawn failed for ${sessionId} (${file} ${args.join(' ')}):`, err);
    return { error: `Failed to start: ${String(err)}` };
  }

  const entry: LivePty = {
    proc,
    buffer: '',
    clients: new Set(),
    cols,
    rows,
    spawnedAt: Date.now(),
    pending: [],
    idleTimer: null,
    heartbeat: null,
    lastDataAt: Date.now(),
    gateAt: 0,
    promptNotedAt: 0,
    limitNotedAt: 0,
    promptWaiting: false,
    intentionalKill: false,
  };
  live.set(sessionId, entry);

  // Flush any messages queued while the TUI was booting, once it's ready. Use
  // the cold-start submit (retries Enter as the composer settles) since this is
  // exactly the just-spawned case where a single Enter often fails to send. Space
  // multiple queued messages so their submits don't interleave.
  setTimeout(() => {
    const e = live.get(sessionId);
    if (!e) return;
    const queued = e.pending;
    e.pending = [];
    queued.forEach((line, i) => setTimeout(() => submitCold(e, line), i * 2800));
    // Terminal is up: let the gateway replay any 1:1 messages this agent missed
    // while it had no live terminal (e.g. across a platform restart), so nothing
    // is silently dropped. Fires after the boot queue so order stays natural.
    if (onPtyReady) {
      setTimeout(() => { try { onPtyReady!(sessionId); } catch { /* ignore */ } }, queued.length * 2800 + 400);
    }
  }, BOOT_MS);

  // While a terminal is open, keep the session's presence "online" — the
  // interactive agent doesn't call Beacon's south API itself, so without this
  // it would look offline and /reply would try to spawn a conflicting process.
  store.touchSeen(sessionId);
  entry.heartbeat = setInterval(() => {
    if (entry.clients.size > 0) store.touchSeen(sessionId);
    // Activity -> idle: a working terminal agent that's produced no output for a
    // while is no longer actively doing anything. Surfaces on Beacon (the roster
    // status) so the human can tell it's quiet without opening the terminal.
    const s = store.getSession(sessionId);
    if (s && s.status === 'working' && Date.now() - entry.lastDataAt > QUIET_IDLE_MS) {
      store.setStatus(sessionId, 'idle');
    }
  }, 30_000);

  proc.onData((data: string) => {
    entry.buffer += data;
    if (entry.buffer.length > BUFFER_CAP) {
      entry.buffer = entry.buffer.slice(entry.buffer.length - BUFFER_CAP);
    }
    for (const ws of entry.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }
    entry.lastDataAt = Date.now();
    const recent = ansiStrip(entry.buffer).slice(-1800);
    // Activity -> working: producing output means it's doing something. Only flip
    // from a resting state so we don't thrash the status on every chunk.
    const s = store.getSession(sessionId);
    if (s && (s.status === 'idle' || s.status === 'registered')) {
      store.setStatus(sessionId, 'working');
    } else if (
      s &&
      s.status === 'waiting' &&
      entry.promptWaiting &&
      !PROMPT_GATE.test(recent)
    ) {
      // A terminal prompt we surfaced has been answered (output moved past it) —
      // flip back to working. Scoped to prompt-driven waits so we never override
      // a genuine ask_human block.
      entry.promptWaiting = false;
      store.setStatus(sessionId, 'working');
    }
    // Auto-dismiss benign boot gates (welcome screens) during the boot window so
    // a launched agent doesn't sit stuck on "Press Enter to continue".
    if (
      Date.now() - entry.spawnedAt < GATE_WINDOW_MS &&
      Date.now() - entry.gateAt > 3000 &&
      ENTER_GATE.test(recent)
    ) {
      entry.gateAt = Date.now();
      try { entry.proc.write('\r'); } catch { /* exited */ }
    }
    // Silent-stall surfacing: the launched agent doesn't call Beacon's south API,
    // so when it gets stuck on a terminal prompt or hits a model usage/rate limit,
    // the human would otherwise see nothing — message sent, no reply, no clue.
    // Surface both as an agent notify (-> roster status + desktop notification),
    // debounced so a persistent prompt pings once. A real choice is never
    // auto-answered; we just tell the human to open the terminal and decide.
    const nowMs = Date.now();
    if (LIMIT_GATE.test(recent) && nowMs - entry.limitNotedAt > DETECT_DEBOUNCE_MS) {
      entry.limitNotedAt = nowMs;
      const line = matchedLine(recent, LIMIT_GATE);
      store.addMessage({
        sessionId,
        direction: 'agent',
        kind: 'notify',
        text:
          `Paused — hit a model usage / account limit.${line ? ` ${line}` : ''} ` +
          `If this is an account spending/quota cap, switch the account and restart this agent ` +
          `(messages won't get through until it restarts on a working account).`,
      });
      store.setStatus(sessionId, 'idle');
    } else if (
      nowMs - entry.spawnedAt > 1500 &&
      PROMPT_GATE.test(recent) &&
      nowMs - entry.promptNotedAt > DETECT_DEBOUNCE_MS
    ) {
      entry.promptNotedAt = nowMs;
      entry.promptWaiting = true;
      const line = matchedLine(recent, PROMPT_GATE);
      store.addMessage({
        sessionId,
        direction: 'agent',
        kind: 'notify',
        text: `Waiting on a choice in the terminal — open it to decide.${line ? ` ${line}` : ''}`,
      });
      store.setStatus(sessionId, 'waiting');
    }
  });

  proc.onExit(({ exitCode }) => {
    const note = `\r\n\x1b[2m[process exited (${exitCode})]\x1b[0m\r\n`;
    for (const ws of entry.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(note);
        ws.close();
      }
    }
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    if (entry.heartbeat) clearInterval(entry.heartbeat);
    // The agent's underlying terminal process DIED on its own — not a deliberate
    // teardown (contact delete / idle reap). The human must be told, or their
    // messages silently vanish into a process that no longer exists (exactly the
    // "Beacon went dead" failure when an agent hit its account quota). Skip if a
    // limit notify just fired (it already explained the cause and the fix).
    if (!entry.intentionalKill && Date.now() - entry.limitNotedAt > 15_000) {
      store.addMessage({
        sessionId,
        direction: 'agent',
        kind: 'notify',
        text:
          `Stopped — the agent's terminal process exited (code ${exitCode}). ` +
          `This often means it hit an account limit or its session errored. ` +
          `Send it a message to restart it (it relaunches on the current account); ` +
          `if it keeps failing, start a fresh conversation for it.`,
      });
      try { store.setStatus(sessionId, 'idle'); } catch { /* session may be gone */ }
    }
    live.delete(sessionId);
  });

  return entry;
}

export function mountPtyWs(platformToken: string): WebSocketServer {
  // noServer mode: the caller routes the `upgrade` event by path. (Binding via
  // the `server` option alongside the /ws server causes 400s — see index.ts.)
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const sessionId = url.searchParams.get('sessionId') ?? '';

    if (platformToken) {
      // ISS-011: accept both ?token= query param and Authorization header so
      // clients can use the same auth style as the REST south API.
      const tok =
        url.searchParams.get('token') ??
        (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
      if (tok !== platformToken) {
        ws.close(1008, 'Unauthorized');
        return;
      }
    }

    const result = getOrSpawn(sessionId);
    if ('error' in result) {
      ws.close(1008, result.error);
      return;
    }
    const entry = result;

    // Attach this client and cancel any pending idle-kill.
    entry.clients.add(ws);
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }

    // Replay buffered output so a reconnecting client sees the current screen
    // immediately instead of a blank terminal.
    if (entry.buffer && ws.readyState === WebSocket.OPEN) {
      ws.send(entry.buffer);
    }

    ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          type: string;
          data?: string;
          cols?: number;
          rows?: number;
        };
        if (msg.type === 'input' && typeof msg.data === 'string') {
          entry.proc.write(msg.data);
        } else if (msg.type === 'resize' && msg.cols && msg.rows) {
          const cols = Number(msg.cols);
          const rows = Number(msg.rows);
          if (cols !== entry.cols || rows !== entry.rows) {
            entry.cols = cols;
            entry.rows = rows;
            try { entry.proc.resize(cols, rows); } catch { /* exited */ }
          }
        }
      } catch {
        entry.proc.write(raw.toString());
      }
    });

    ws.on('close', () => {
      entry.clients.delete(ws);
      // Keep the PTY alive for fast re-attach. Only kill after a long idle with
      // no clients, so we don't leak processes for sessions nobody returns to.
      armIdle(sessionId, entry);
    });
  });

  return wss;
}
