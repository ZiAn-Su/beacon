import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Loader2, RefreshCw, WifiOff } from "lucide-react";
import "@xterm/xterm/css/xterm.css";

type ConnState = "connecting" | "open" | "error" | "closed";

interface Props {
  sessionId: string;
}

export function TerminalPanel({ sessionId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  const [connState, setConnState] = useState<ConnState>("connecting");
  const [key, setKey] = useState(0); // bump to reconnect

  const reconnect = useCallback(() => {
    wsRef.current?.close();
    termRef.current?.clear();
    setConnState("connecting");
    setKey((k) => k + 1);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Reuse or create the Terminal instance across reconnects so scroll history
    // is preserved.
    if (!termRef.current) {
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
      termRef.current = term;
      fitRef.current = fitAddon;
    }

    fitRef.current?.fit();

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/pty?sessionId=${sessionId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnState("open");
      fitRef.current?.fit();
      const term = termRef.current;
      if (term) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };

    ws.onmessage = (e: MessageEvent) => {
      const data = typeof e.data === "string" ? e.data : new Uint8Array(e.data as ArrayBuffer);
      termRef.current?.write(data);
    };

    ws.onerror = () => {
      setConnState("error");
    };

    ws.onclose = (e) => {
      if (e.code === 1008) {
        // Auth / session not found — don't offer reconnect
        termRef.current?.write("\r\n[Server: " + (e.reason || "connection refused") + "]\r\n");
      }
      setConnState((prev) => prev === "error" ? "error" : "closed");
    };

    const onData = termRef.current?.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    });

    const ro = new ResizeObserver(() => {
      try {
        fitRef.current?.fit();
        const term = termRef.current;
        if (ws.readyState === WebSocket.OPEN && term) {
          ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      } catch { /* terminal may be disposed */ }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      onData?.dispose();
      ws.close();
    };
  // key triggers reconnect; sessionId change always remounts
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, key]);

  // Dispose terminal when session changes
  useEffect(() => {
    return () => {
      termRef.current?.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [sessionId]);

  return (
    <div style={{ position: "relative", height: "100%", background: "#0d1117" }}>
      {/* Actual terminal canvas */}
      <div
        ref={containerRef}
        style={{ height: "100%", padding: "6px 8px 4px" }}
      />

      {/* Overlay for connecting / error / closed states */}
      {connState !== "open" && (
        <Overlay state={connState} onReconnect={reconnect} />
      )}
    </div>
  );
}

function Overlay({
  state,
  onReconnect,
}: {
  state: ConnState;
  onReconnect: () => void;
}) {
  if (state === "connecting") {
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          background: "rgba(13,17,23,0.85)",
          color: "#6e7681",
          fontSize: 13,
        }}
      >
        <Loader2 size={20} style={{ animation: "spin 1s linear infinite" }} />
        <span>正在连接终端…</span>
      </div>
    );
  }

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        background: "rgba(13,17,23,0.9)",
      }}
    >
      <WifiOff size={22} style={{ color: "#6e7681" }} />
      <span style={{ color: "#6e7681", fontSize: 13 }}>
        {state === "error" ? "连接失败 — 请确认平台正在运行" : "终端已断开"}
      </span>
      <button
        onClick={onReconnect}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 14px",
          borderRadius: 8,
          background: "#21262d",
          border: "1px solid #30363d",
          color: "#c9d1d9",
          fontSize: 12,
          cursor: "pointer",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "#30363d"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "#21262d"; }}
      >
        <RefreshCw size={12} />
        重连
      </button>
    </div>
  );
}
