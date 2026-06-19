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

const isWin = process.platform === 'win32';

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
}

// How long after spawn we treat the TUI as "still booting" — messages sent in
// this window are queued and flushed once it's ready, so they don't get dropped
// before the input box exists.
const BOOT_MS = 3500;

const live = new Map<string, LivePty>();

/** Runtimes Beacon knows how to drive as an agent (vs. a bare shell). */
function isAgentRuntime(runtime: string): boolean {
  return runtime === 'claude-code' || runtime === 'claude' || runtime === 'codex';
}

/** Is there a live interactive terminal (PTY) for this session right now? */
export function hasLivePty(sessionId: string): boolean {
  return live.has(sessionId);
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

function spawnTarget(runtime: string): SpawnTarget {
  const wrap = (cmd: string): SpawnTarget =>
    isWin
      ? { file: 'cmd.exe', args: ['/k', cmd] }
      : { file: process.env.SHELL ?? 'bash', args: ['-c', `exec ${cmd}`] };

  if (runtime === 'claude-code' || runtime === 'claude') return wrap('claude --continue');
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

  const { file, args } = spawnTarget(session.runtime);
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
  };
  live.set(sessionId, entry);

  // Flush any messages queued while the TUI was booting, once it's ready.
  setTimeout(() => {
    const e = live.get(sessionId);
    if (!e) return;
    const queued = e.pending;
    e.pending = [];
    for (const line of queued) submit(e, line);
  }, BOOT_MS);

  // While a terminal is open, keep the session's presence "online" — the
  // interactive agent doesn't call Beacon's south API itself, so without this
  // it would look offline and /reply would try to spawn a conflicting process.
  store.touchSeen(sessionId);
  entry.heartbeat = setInterval(() => {
    if (entry.clients.size > 0) store.touchSeen(sessionId);
  }, 30_000);

  proc.onData((data: string) => {
    entry.buffer += data;
    if (entry.buffer.length > BUFFER_CAP) {
      entry.buffer = entry.buffer.slice(entry.buffer.length - BUFFER_CAP);
    }
    for (const ws of entry.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
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
      const tok = url.searchParams.get('token') ?? '';
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
