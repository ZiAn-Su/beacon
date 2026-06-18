import { useEffect, useRef, useState } from "react";
import type { WsEvent } from "../types";

// Build a WebSocket URL from the current page, respecting current protocol/host
// and the /ws path. Vite dev server proxies /ws -> ws://127.0.0.1:4319.
function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}

export type SocketStatus = "connecting" | "open" | "closed";

export function useSocket(onEvent: (e: WsEvent) => void): SocketStatus {
  const [status, setStatus] = useState<SocketStatus>("connecting");
  // Keep the latest callback in a ref so we don't reopen the socket on every
  // parent re-render.
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    let stopped = false;
    let ws: WebSocket | null = null;
    let retry = 0;
    let reconnectTimer: number | null = null;

    const connect = () => {
      if (stopped) return;
      setStatus("connecting");
      try {
        ws = new WebSocket(wsUrl());
      } catch {
        scheduleReconnect();
        return;
      }
      ws.onopen = () => {
        retry = 0;
        setStatus("open");
      };
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as WsEvent;
          onEventRef.current(data);
        } catch {
          // Ignore malformed frames; the server only sends JSON objects.
        }
      };
      ws.onerror = () => {
        // The close event will follow; we reconnect there.
      };
      ws.onclose = () => {
        setStatus("closed");
        scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      if (stopped) return;
      // Exponential-ish backoff capped at 8s, with a small floor.
      const delay = Math.min(8000, 500 * Math.pow(2, retry));
      retry += 1;
      reconnectTimer = window.setTimeout(connect, delay);
    };

    connect();
    return () => {
      stopped = true;
      if (reconnectTimer != null) window.clearTimeout(reconnectTimer);
      try {
        ws?.close();
      } catch {
        // ignore
      }
    };
  }, []);

  return status;
}
