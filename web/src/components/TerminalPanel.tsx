import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useI18n } from "../lib/i18n";

interface Props {
  sessionId: string;
}

// The terminal is always-on, like a Claude Code / Codex tab: it connects when
// opened and silently auto-reconnects if the socket drops. There is no manual
// "reconnect" or "offline" state for the user to manage.
export function TerminalPanel({ sessionId }: Props) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<number>(0);
  const reconnectTimer = useRef<number | null>(null);
  const disposedRef = useRef(false);

  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    disposedRef.current = false;
    const el = containerRef.current;
    if (!el) return;

    const term = new Terminal({
      fontFamily:
        '"Cascadia Code", "JetBrains Mono", "Fira Code", Menlo, Monaco, monospace',
      fontSize: 13,
      lineHeight: 1.45,
      cursorBlink: true,
      scrollback: 5000,
      theme: {
        background: "#0d1117",
        foreground: "#c9d1d9",
        cursor: "#58a6ff",
        cursorAccent: "#0d1117",
        selectionBackground: "#264f78",
        black: "#0d1117",
        red: "#ff7b72",
        green: "#3fb950",
        yellow: "#d29922",
        blue: "#58a6ff",
        magenta: "#bc8cff",
        cyan: "#39c5cf",
        white: "#b1bac4",
        brightBlack: "#6e7681",
        brightRed: "#ffa198",
        brightGreen: "#56d364",
        brightYellow: "#e3b341",
        brightBlue: "#79c0ff",
        brightMagenta: "#d2a8ff",
        brightCyan: "#56d4dd",
        brightWhite: "#f0f6fc",
      },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(el);
    fitAddon.fit();
    termRef.current = term;
    fitRef.current = fitAddon;

    // Keystrokes -> active socket.
    term.onData((data: string) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    });

    const connect = () => {
      if (disposedRef.current) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/pty?sessionId=${sessionId}`);
      wsRef.current = ws;

      ws.onopen = () => {
        retryRef.current = 0;
        setReconnecting(false);
        // Reset so the server's buffer replay repaints cleanly instead of
        // stacking on top of the previous screen.
        term.reset();
        fitRef.current?.fit();
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      };

      ws.onmessage = (e: MessageEvent) => {
        term.write(
          typeof e.data === "string" ? e.data : new Uint8Array(e.data as ArrayBuffer),
        );
      };

      ws.onclose = (e) => {
        if (disposedRef.current) return;
        // 1008 = auth / session not found: not transient, don't hammer.
        if (e.code === 1008) {
          term.write("\r\n\x1b[33m" + (e.reason || "connection refused") + "\x1b[0m\r\n");
          return;
        }
        // Anything else: silently reconnect with light backoff.
        setReconnecting(true);
        const delay = Math.min(1000 + retryRef.current * 500, 3000);
        retryRef.current += 1;
        reconnectTimer.current = window.setTimeout(connect, delay);
      };

      ws.onerror = () => {
        // onclose will follow and handle reconnect.
        try { ws.close(); } catch { /* noop */ }
      };
    };

    connect();

    const ro = new ResizeObserver(() => {
      try {
        fitRef.current?.fit();
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      } catch { /* disposed */ }
    });
    ro.observe(el);

    return () => {
      disposedRef.current = true;
      ro.disconnect();
      if (reconnectTimer.current) window.clearTimeout(reconnectTimer.current);
      try { wsRef.current?.close(); } catch { /* noop */ }
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [sessionId]);

  return (
    <div style={{ position: "relative", height: "100%", background: "#0d1117" }}>
      <div ref={containerRef} style={{ height: "100%", padding: "6px 8px 4px" }} />
      {reconnecting && (
        <div
          style={{
            position: "absolute",
            top: 8,
            right: 12,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "3px 9px",
            borderRadius: 999,
            background: "rgba(33,38,45,0.9)",
            border: "1px solid #30363d",
            color: "#8b949e",
            fontSize: 11,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: "#d29922",
              animation: "pulse-soft 1.2s ease-in-out infinite",
            }}
          />
          {t("terminal.reconnecting")}
        </div>
      )}
    </div>
  );
}
