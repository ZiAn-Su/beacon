import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Message, Session, WsEvent } from "../types";
import {
  cancelAsk,
  getConversation,
  listSessions,
  patchSession,
  reply,
} from "./api";
import { useSocket } from "./useSocket";

interface StoreState {
  sessions: Session[];
  messagesBySession: Record<string, Message[]>;
  loadingSessions: boolean;
  loadingMessages: boolean;
  wsStatus: "connecting" | "open" | "closed";
  // Selection + visibility (used to gate unread / notifications).
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  tabVisible: boolean;
  // Unread tracking (see spec 1).
  unreadBySession: Record<string, number>;
  totalUnread: number;
  pendingAskBySession: Record<string, boolean>;
  hasPendingAsk: (sessionId: string) => boolean;
  // Actions
  ensureSessionMessages: (sessionId: string) => Promise<void>;
  send: (sessionId: string, text: string, askId?: string | null) => Promise<void>;
  cancelAsk: (askId: string) => Promise<void>;
  renameSession: (sessionId: string, title: string | null) => Promise<void>;
  setArchived: (sessionId: string, archived: boolean) => Promise<void>;
  /** Force-reset unread for a session (e.g. on focus). */
  markSessionRead: (sessionId: string) => void;
}

const StoreContext = createContext<StoreState | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [messagesBySession, setMessagesBySession] = useState<
    Record<string, Message[]>
  >({});
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tabVisible, setTabVisible] = useState<boolean>(
    () =>
      typeof document === "undefined"
        ? true
        : document.visibilityState !== "hidden",
  );
  const [unreadBySession, setUnreadBySession] = useState<Record<string, number>>(
    {},
  );
  const loadedSessionsRef = useRef<Set<string>>(new Set());

  // Track tab visibility for unread + notification gating.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const update = () =>
      setTabVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
    };
  }, []);

  // Reader refs so the WS handler can read latest state without re-creating.
  const selectedIdRef = useRef<string | null>(selectedId);
  selectedIdRef.current = selectedId;
  const tabVisibleRef = useRef<boolean>(tabVisible);
  tabVisibleRef.current = tabVisible;

  // Compute derived per-session pending-ask map from messages.
  const pendingAskBySession = useMemo<Record<string, boolean>>(() => {
    const out: Record<string, boolean> = {};
    for (const sid of Object.keys(messagesBySession)) {
      const list = messagesBySession[sid] ?? [];
      for (let i = list.length - 1; i >= 0; i--) {
        const m = list[i]!;
        if (m.kind === "ask" && m.askId) {
          const answered = list.some(
            (x) => x.askId === m.askId && x.direction === "human",
          );
          if (!answered) {
            out[sid] = true;
            break;
          }
        }
      }
    }
    return out;
  }, [messagesBySession]);

  const hasPendingAsk = useCallback(
    (sessionId: string) => Boolean(pendingAskBySession[sessionId]),
    [pendingAskBySession],
  );

  const totalUnread = useMemo(
    () => Object.values(unreadBySession).reduce((a, b) => a + b, 0),
    [unreadBySession],
  );

  const markSessionRead = useCallback((sessionId: string) => {
    setUnreadBySession((prev) => {
      if (!prev[sessionId]) return prev;
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
  }, []);

  // When the selected session changes, reset its unread to 0.
  const lastAutoClearedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedId) return;
    if (lastAutoClearedRef.current === selectedId) return;
    lastAutoClearedRef.current = selectedId;
    markSessionRead(selectedId);
  }, [selectedId, markSessionRead]);

  // When the tab regains focus and there is a selected session, clear its unread.
  useEffect(() => {
    if (!tabVisible || !selectedId) return;
    markSessionRead(selectedId);
  }, [tabVisible, selectedId, markSessionRead]);

  const handleEvent = useCallback((e: WsEvent) => {
    switch (e.type) {
      case "hello": {
        setSessions(e.sessions);
        setLoadingSessions(false);
        break;
      }
      case "session": {
        setSessions((prev) => {
          const next = prev.slice();
          const idx = next.findIndex((s) => s.id === e.session.id);
          if (idx >= 0) next[idx] = e.session;
          else next.push(e.session);
          return next;
        });
        break;
      }
      case "message": {
        const m = e.message;
        setMessagesBySession((prev) => {
          const list = prev[m.sessionId] ?? [];
          // Avoid duplicates if the server echoes a message we already
          // optimistically added.
          if (list.some((x) => x.id === m.id)) return prev;
          return { ...prev, [m.sessionId]: [...list, m] };
        });
        // Bump the session's updatedAt so contacts re-sort naturally.
        setSessions((prev) => {
          const idx = prev.findIndex((s) => s.id === m.sessionId);
          if (idx < 0) return prev;
          const next = prev.slice();
          const s = next[idx]!;
          next[idx] = { ...s, updatedAt: Math.max(s.updatedAt, m.createdAt) };
          return next;
        });
        // Unread tracking: only count agent->human messages (notify/ask/chat),
        // and only if the session is not currently selected or the tab is hidden.
        if (
          m.direction === "agent" &&
          (m.kind === "notify" || m.kind === "ask" || m.kind === "chat")
        ) {
          const sel = selectedIdRef.current;
          const visible = tabVisibleRef.current;
          const shouldCount = sel !== m.sessionId || !visible;
          if (shouldCount) {
            setUnreadBySession((prev) => ({
              ...prev,
              [m.sessionId]: (prev[m.sessionId] ?? 0) + 1,
            }));
          }
        }
        break;
      }
    }
  }, []);

  const wsStatus = useSocket(handleEvent);

  // Initial REST fetch as a safety net if WS hello is delayed or missed
  // (e.g. the page is loaded but the WS connection failed before hello).
  useEffect(() => {
    let cancelled = false;
    listSessions()
      .then((list) => {
        if (cancelled) return;
        setSessions((prev) => mergeSessions(prev, list));
      })
      .catch(() => {
        // backend may not be up; ignore.
      })
      .finally(() => {
        if (!cancelled) setLoadingSessions(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const ensureSessionMessages = useCallback(async (sessionId: string) => {
    if (loadedSessionsRef.current.has(sessionId)) return;
    loadedSessionsRef.current.add(sessionId);
    setLoadingMessages(true);
    try {
      const { messages } = await getConversation(sessionId);
      setMessagesBySession((prev) => ({ ...prev, [sessionId]: messages }));
    } catch {
      loadedSessionsRef.current.delete(sessionId);
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  const send = useCallback(
    async (sessionId: string, text: string, askId?: string | null) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const message = await reply(sessionId, trimmed, askId ?? null);
      setMessagesBySession((prev) => {
        const list = prev[sessionId] ?? [];
        if (list.some((x) => x.id === message.id)) return prev;
        return { ...prev, [sessionId]: [...list, message] };
      });
      setSessions((prev) => {
        const idx = prev.findIndex((s) => s.id === sessionId);
        if (idx < 0) return prev;
        const next = prev.slice();
        const s = next[idx]!;
        next[idx] = { ...s, updatedAt: Math.max(s.updatedAt, message.createdAt) };
        return next;
      });
    },
    [],
  );

  const upsertSession = useCallback((session: Session) => {
    setSessions((prev) => {
      const idx = prev.findIndex((s) => s.id === session.id);
      if (idx < 0) return [...prev, session];
      const next = prev.slice();
      next[idx] = session;
      return next;
    });
  }, []);

  const renameSession = useCallback(
    async (sessionId: string, title: string | null) => {
      const session = await patchSession(sessionId, { title });
      upsertSession(session);
    },
    [upsertSession],
  );

  const setArchived = useCallback(
    async (sessionId: string, archived: boolean) => {
      const session = await patchSession(sessionId, { archived });
      upsertSession(session);
    },
    [upsertSession],
  );

  const value = useMemo<StoreState>(
    () => ({
      sessions,
      messagesBySession,
      loadingSessions,
      loadingMessages,
      wsStatus,
      selectedId,
      setSelectedId,
      tabVisible,
      unreadBySession,
      totalUnread,
      pendingAskBySession,
      hasPendingAsk,
      ensureSessionMessages,
      send,
      cancelAsk,
      renameSession,
      setArchived,
      markSessionRead,
    }),
    [
      sessions,
      messagesBySession,
      loadingSessions,
      loadingMessages,
      wsStatus,
      selectedId,
      tabVisible,
      unreadBySession,
      totalUnread,
      pendingAskBySession,
      hasPendingAsk,
      ensureSessionMessages,
      send,
      renameSession,
      setArchived,
      markSessionRead,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreState {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within a StoreProvider");
  return ctx;
}

function mergeSessions(prev: Session[], next: Session[]): Session[] {
  const byId = new Map<string, Session>();
  for (const s of prev) byId.set(s.id, s);
  for (const s of next) byId.set(s.id, s);
  return Array.from(byId.values());
}
