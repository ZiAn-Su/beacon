import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, BellOff, Moon, Sun, X } from "lucide-react";
import { Rail } from "./components/Rail";
import { ContactList } from "./components/ContactList";
import { ContactsView } from "./components/ContactsView";
import { Conversation } from "./components/Conversation";
import { SessionInfo } from "./components/SessionInfo";
import { EmptyState } from "./components/EmptyState";
import { ConnectAgentModal } from "./components/ConnectAgentModal";
import { AddAgentModal } from "./components/AddAgentModal";
import { DirectoryModal } from "./components/DirectoryModal";
import { SettingsModal } from "./components/SettingsModal";
import { StoreProvider, useStore } from "./lib/store";
import { useDocumentTitle } from "./lib/useDocumentTitle";
import { useDesktopNotifications } from "./lib/useDesktopNotifications";
import { useI18n } from "./lib/i18n";

type Theme = "dark" | "light";

const THEME_KEY = "interact-theme";

function readInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    // ignore
  }
  return window.matchMedia?.("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

function Shell() {
  const {
    sessions,
    messagesBySession,
    loadingSessions,
    wsStatus,
    selectedId,
    setSelectedId,
    tabVisible,
    totalUnread,
    pendingAskBySession,
  } = useStore();
  const { t } = useI18n();
  const [theme, setTheme] = useState<Theme>(() => readInitialTheme());
  const [view, setView] = useState<"chats" | "contacts">("chats");
  const [contactId, setContactId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"contacts" | "conversation">(
    "contacts",
  );
  const [infoOpen, setInfoOpen] = useState(true);
  const [connectOpen, setConnectOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const notif = useDesktopNotifications();

  // Ticking clock so online/offline presence flips without needing an event.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 20_000);
    return () => window.clearInterval(t);
  }, []);

  // Apply theme to <html> via data-theme and persist.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  // Default-select the first waiting session, then the most recent.
  useEffect(() => {
    if (selectedId && sessions.some((s) => s.id === selectedId)) return;
    const waiting = sessions.find((s) => s.status === "waiting");
    if (waiting) {
      setSelectedId(waiting.id);
      return;
    }
    if (sessions.length > 0) {
      const next = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)[0]!;
      setSelectedId(next.id);
    } else {
      setSelectedId(null);
    }
  }, [sessions, selectedId, setSelectedId]);

  const selected = useMemo(
    () => sessions.find((s) => s.id === selectedId) ?? null,
    [sessions, selectedId],
  );

  // Mobile: when a session is selected, switch into the conversation view.
  useEffect(() => {
    if (selected) setMobileView("conversation");
  }, [selected]);

  // Document title: reflect unread count and flash on pending ask while hidden.
  const hasAnyPendingAsk = useMemo(
    () => Object.values(pendingAskBySession).some(Boolean),
    [pendingAskBySession],
  );
  useDocumentTitle({ totalUnread, hasAnyPendingAsk, tabVisible });

  // Track incoming agent messages we have already seen so we can fire
  // desktop notifications for new ones, without re-firing on every render.
  const seenIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const sid of Object.keys(messagesBySession)) {
      for (const m of messagesBySession[sid] ?? []) {
        if (seenIdsRef.current.has(m.id)) continue;
        seenIdsRef.current.add(m.id);
        if (
          m.direction === "agent" &&
          (m.kind === "notify" || m.kind === "ask" || m.kind === "chat")
        ) {
          const session = sessions.find((s) => s.id === m.sessionId);
          const shouldFire = tabVisible
            ? selectedId !== m.sessionId
            : true;
          if (shouldFire) notif.notify(m, session);
        }
      }
    }
    // intentionally not depending on `sessions`/`notif` identity churn
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messagesBySession, tabVisible, selectedId]);

  // Click on a desktop notification => focus the window + select the session.
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{ sessionId: string }>).detail;
      if (detail?.sessionId) setSelectedId(detail.sessionId);
    };
    window.addEventListener("interact:focus-session", handler as EventListener);
    return () =>
      window.removeEventListener(
        "interact:focus-session",
        handler as EventListener,
      );
  }, [setSelectedId]);

  // Subtle WebAudio blip when a pending ask arrives while the tab is hidden.
  useEffect(() => {
    if (tabVisible) return;
    if (!hasAnyPendingAsk) return;
    if (typeof window === "undefined") return;
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 520;
      gain.gain.value = 0.0001;
      osc.connect(gain).connect(ctx.destination);
      const now = ctx.currentTime;
      gain.gain.exponentialRampToValueAtTime(0.06, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
      osc.start(now);
      osc.stop(now + 0.4);
      osc.onended = () => {
        try {
          ctx.close();
        } catch {
          // ignore
        }
      };
    } catch {
      // never let audio errors break the app
    }
  }, [hasAnyPendingAsk, tabVisible]);

  return (
    <div
      className="flex h-screen w-screen overflow-hidden"
      style={{ background: "var(--bg)" }}
    >
      <Rail
        theme={theme}
        onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
        notifPermission={notif.permission}
        onRequestNotifications={notif.requestPermission}
        onOpenSettings={() => setSettingsOpen(true)}
        view={view}
        onChangeView={setView}
        unread={totalUnread}
      />

      {/* Mobile-only theme + notif toggles in the header. */}
      <div className="md:hidden absolute right-3 top-3 z-20 flex items-center gap-2">
        <button
          onClick={() =>
            notif.permission === "granted"
              ? undefined
              : void notif.requestPermission()
          }
          aria-label={
            notif.permission === "granted"
              ? t("rail.notifOn")
              : t("rail.notifEnable")
          }
          title={
            notif.permission === "granted"
              ? t("rail.notifOn")
              : t("rail.notifEnable")
          }
          className="flex h-9 w-9 items-center justify-center rounded-lg"
          style={{
            background: "var(--surface-card)",
            color: "var(--text-secondary)",
            border: "1px solid var(--border)",
          }}
        >
          {notif.permission === "granted" ? (
            <Bell size={16} />
          ) : (
            <BellOff size={16} />
          )}
        </button>
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label={theme === "dark" ? t("rail.themeToLight") : t("rail.themeToDark")}
          className="flex h-9 w-9 items-center justify-center rounded-lg"
          style={{
            background: "var(--surface-card)",
            color: "var(--text-secondary)",
            border: "1px solid var(--border)",
          }}
        >
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>

      {view === "chats" ? (
        <>
          {/* Left column: Contact list (264px on >=md, full-screen on mobile). */}
          <div
            className={
              "flex h-full min-w-0 flex-1 " +
              (mobileView === "contacts" ? "block" : "hidden") +
              " md:block md:w-[264px] md:shrink-0 md:border-r"
            }
            style={{ borderColor: "var(--border)" }}
          >
            <ContactList
              sessions={sessions}
              messagesBySession={messagesBySession}
              selectedId={selectedId}
              onSelect={(id) => setSelectedId(id)}
              onConnectAgent={() => setConnectOpen(true)}
            />
          </div>

          {/* Center column: Conversation (always visible at >=md; full-screen on mobile when selected). */}
          <div
            className={
              "min-w-0 flex-1 " +
              (mobileView === "conversation" ? "flex" : "hidden") +
              " md:flex"
            }
          >
            {selected ? (
              <Conversation
                session={selected}
                now={now}
                onBack={() => setMobileView("contacts")}
                showBack
                infoOpen={infoOpen}
                onToggleInfo={() => setInfoOpen((v) => !v)}
                canToggleInfo
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <EmptyState
                  title={t("app.pick.title")}
                  description={t("app.pick.desc")}
                />
              </div>
            )}
          </div>

          {/* Right column: SessionInfo (280px on >=lg; toggleable on >=md/<lg; hidden <md). */}
          {selected && infoOpen && (
            <div
              className="hidden md:block md:w-[280px] md:shrink-0 md:border-l"
              style={{ borderColor: "var(--border)" }}
            >
              <SessionInfo session={selected} now={now} />
            </div>
          )}
        </>
      ) : (
        <ContactsView
          sessions={sessions}
          selectedId={contactId}
          onSelect={setContactId}
          onMessage={(id) => {
            setSelectedId(id);
            setView("chats");
            setMobileView("conversation");
          }}
          onOpenManage={() => setDirectoryOpen(true)}
          onOpenAdd={() => setAddOpen(true)}
        />
      )}

      {notif.shouldPrompt && (
        <NotificationPrompt
          onEnable={notif.requestPermission}
          onDismiss={notif.dismissPrompt}
        />
      )}

      {/* Tiny WS status indicator in the bottom-right corner */}
      <ConnectionPill status={wsStatus} loading={loadingSessions} />

      <ConnectAgentModal
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
      />

      <AddAgentModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        defaultPath={
          sessions.find((s) => s.id === contactId)?.workPath ??
          selected?.workPath ??
          ""
        }
        onAdded={(id) => {
          setContactId(id);
          setSelectedId(id);
        }}
      />

      <DirectoryModal
        open={directoryOpen}
        onClose={() => setDirectoryOpen(false)}
        onSelect={(id) => setSelectedId(id)}
      />

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

function NotificationPrompt({
  onEnable,
  onDismiss,
}: {
  onEnable: () => Promise<unknown>;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      role="status"
      className="fixed bottom-12 left-1/2 z-30 -translate-x-1/2"
      style={{ animation: "fade-in 200ms ease-out both" }}
    >
      <div
        className="flex items-center gap-2 rounded-full px-3 py-1.5 text-[12px]"
        style={{
          background: "var(--surface-card)",
          color: "var(--text-secondary)",
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow-2)",
        }}
      >
        <Bell size={12} style={{ color: "var(--accent)" }} />
        <span>{t("app.notifPrompt")}</span>
        <button
          onClick={() => void onEnable()}
          className="ml-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
          style={{
            background: "var(--accent)",
            color: "#fff",
          }}
        >
          {t("app.enable")}
        </button>
        <button
          onClick={onDismiss}
          aria-label={t("app.dismiss")}
          className="ml-0.5 flex h-5 w-5 items-center justify-center rounded-full"
          style={{ color: "var(--text-muted)" }}
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}

function ConnectionPill({
  status,
  loading,
}: {
  status: "connecting" | "open" | "closed";
  loading: boolean;
}) {
  const { t } = useI18n();
  if (loading) return null;
  const label =
    status === "open"
      ? t("app.live")
      : status === "connecting"
        ? t("app.connecting")
        : t("app.offline");
  const color =
    status === "open"
      ? "var(--color-working)"
      : status === "connecting"
        ? "var(--amber)"
        : "var(--danger)";
  return (
    <div
      className="pointer-events-none fixed bottom-3 right-3 z-30 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-medium"
      style={{
        background: "var(--surface-card)",
        color: "var(--text-secondary)",
        border: "1px solid var(--border)",
        animation: "fade-in 200ms ease-out both",
      }}
      title={`WebSocket: ${label}`}
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: color }}
      />
      {label}
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
