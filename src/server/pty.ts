// PTY WebSocket server — embeds a real terminal in the web UI.
// Clients connect to /pty?sessionId=<id> and get a full PTY session
// running the session's agent (claude --continue, codex, etc.) in its workPath.
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Server } from 'node:http';
import * as pty from 'node-pty';
import { URL } from 'node:url';
import * as store from '../core/store';

const isWin = process.platform === 'win32';

interface SpawnTarget {
  file: string;
  args: string[];
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

export function mountPtyWs(httpServer: Server, platformToken: string): void {
  const wss = new WebSocketServer({ server: httpServer, path: '/pty' });

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

    const session = store.getSession(sessionId);
    if (!session) {
      ws.send('\r\n[Session not found]\r\n');
      ws.close(1008, 'Session not found');
      return;
    }

    const { file, args } = spawnTarget(session.runtime);

    let proc: pty.IPty;
    try {
      proc = pty.spawn(file, args, {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd: session.workPath || process.cwd(),
        env: {
          ...process.env,
          BEACON_SESSION_ID: session.id,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
        } as Record<string, string>,
      });
    } catch (err) {
      ws.send(`\r\n[Failed to start: ${String(err)}]\r\n`);
      ws.close();
      return;
    }

    proc.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    proc.onExit(({ exitCode }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(`\r\n[Process exited (${exitCode})]\r\n`);
        ws.close();
      }
    });

    ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
      try {
        const text = raw.toString();
        const msg = JSON.parse(text) as { type: string; data?: string; cols?: number; rows?: number };
        if (msg.type === 'input' && typeof msg.data === 'string') {
          proc.write(msg.data);
        } else if (msg.type === 'resize' && msg.cols && msg.rows) {
          proc.resize(Number(msg.cols), Number(msg.rows));
        }
      } catch {
        proc.write(raw.toString());
      }
    });

    ws.on('close', () => {
      try { proc.kill(); } catch { /* already exited */ }
    });
  });
}
