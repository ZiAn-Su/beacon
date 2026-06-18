import { useCallback, useEffect, useMemo, useState } from "react";
import type { Message, Session } from "../types";
import type { AgentDelivery } from "../lib/api";
import { useStore } from "../lib/store";
import { ConversationHeader } from "./ConversationHeader";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { EmptyState } from "./EmptyState";
import { Loader2, MessageSquareText, Play, Power } from "lucide-react";
import { useI18n } from "../lib/i18n";

interface Props {
  session: Session;
  now?: number;
  onBack?: () => void;
  showBack?: boolean;
  infoOpen?: boolean;
  onToggleInfo?: () => void;
  canToggleInfo?: boolean;
}

export function Conversation({
  session,
  now,
  onBack,
  showBack,
  infoOpen,
  onToggleInfo,
  canToggleInfo,
}: Props) {
  const { messagesBySession, loadingMessages, ensureSessionMessages, send, startAgent, updateSettings } =
    useStore();
  const { t } = useI18n();
  const messages: Message[] = messagesBySession[session.id] ?? [];

  const [agentState, setAgentState] = useState<AgentDelivery | null>(null);
  const [lastText, setLastText] = useState("");
  const [remember, setRemember] = useState(false);

  // Reset the inline notice when switching conversations.
  useEffect(() => {
    setAgentState(null);
    setRemember(false);
  }, [session.id]);

  const handleSend = useCallback(
    async (sessionId: string, text: string, askId?: string | null) => {
      const agent = await send(sessionId, text, askId);
      setLastText(text);
      setAgentState(agent ?? null);
      if (agent === "queued") {
        window.setTimeout(
          () => setAgentState((p) => (p === "queued" ? null : p)),
          5000,
        );
      }
      return agent;
    },
    [send],
  );

  const doStart = useCallback(async () => {
    if (remember) await updateSettings({ autoStart: "auto" });
    setAgentState("starting");
    try {
      await startAgent(session.id, lastText);
    } finally {
      window.setTimeout(
        () => setAgentState((p) => (p === "starting" ? null : p)),
        8000,
      );
    }
  }, [remember, updateSettings, startAgent, session.id, lastText]);

  // Lazily load history the first time this session is opened.
  useEffect(() => {
    void ensureSessionMessages(session.id);
  }, [session.id, ensureSessionMessages]);

  const pendingAsk = useMemo<Message | null>(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!;
      if (m.kind === "ask" && m.askId) {
        const answered = messages.some(
          (x) => x.askId === m.askId && x.direction === "human",
        );
        if (!answered) return m;
      }
    }
    return null;
  }, [messages]);

  return (
    <section
      className="flex h-full min-w-0 flex-1 flex-col"
      style={{ background: "var(--bg)" }}
    >
      <ConversationHeader
        session={session}
        now={now}
        onBack={onBack}
        showBack={showBack}
        infoOpen={infoOpen}
        onToggleInfo={onToggleInfo}
        canToggleInfo={canToggleInfo}
      />
      <div className="min-h-0 flex-1">
        {messages.length === 0 && !loadingMessages ? (
          <EmptyState
            title={t("conv.empty.title")}
            description={t("conv.empty.desc")}
            icon={<MessageSquareText size={22} />}
          />
        ) : (
          <MessageList messages={messages} loading={loadingMessages} />
        )}
      </div>

      {agentState === "offline" && (
        <OfflineBar
          remember={remember}
          onToggleRemember={() => setRemember((v) => !v)}
          onStart={() => void doStart()}
          onDismiss={() => setAgentState(null)}
        />
      )}
      {agentState === "starting" && (
        <Banner icon={<Loader2 size={13} className="animate-spin" />} text={t("offline.starting")} />
      )}
      {agentState === "queued" && (
        <Banner icon={<Power size={12} />} text={t("offline.queued")} muted />
      )}

      <Composer session={session} pendingAsk={pendingAsk} onSend={handleSend} />
    </section>
  );
}

function OfflineBar({
  remember,
  onToggleRemember,
  onStart,
  onDismiss,
}: {
  remember: boolean;
  onToggleRemember: () => void;
  onStart: () => void;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:px-6"
      style={{
        background: "var(--accent-soft)",
        borderTop: "1px solid var(--border)",
      }}
    >
      <span
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
        style={{ color: "var(--accent)" }}
      >
        <Power size={13} />
      </span>
      <span className="text-[13px]" style={{ color: "var(--text)" }}>
        {t("offline.notRunning")}
      </span>
      <label
        className="flex cursor-pointer select-none items-center gap-1.5 text-[12px]"
        style={{ color: "var(--text-secondary)" }}
      >
        <input
          type="checkbox"
          checked={remember}
          onChange={onToggleRemember}
          className="h-3.5 w-3.5 accent-[var(--accent)]"
        />
        {t("offline.remember")}
      </label>
      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={onDismiss}
          className="rounded-lg px-2.5 py-1 text-[12.5px] font-medium"
          style={{
            color: "var(--text-secondary)",
            background: "transparent",
            border: "1px solid var(--border)",
          }}
        >
          {t("offline.queue")}
        </button>
        <button
          onClick={onStart}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-[12.5px] font-semibold"
          style={{ color: "#fff", background: "var(--accent)", border: "1px solid var(--accent)" }}
        >
          <Play size={12} />
          {t("offline.start")}
        </button>
      </div>
    </div>
  );
}

function Banner({
  icon,
  text,
  muted,
}: {
  icon: React.ReactNode;
  text: string;
  muted?: boolean;
}) {
  return (
    <div
      className="flex items-center justify-center gap-2 px-4 py-1.5 text-[12px]"
      style={{
        background: muted ? "var(--surface-card)" : "var(--accent-soft)",
        color: muted ? "var(--text-muted)" : "var(--accent)",
        borderTop: "1px solid var(--border)",
      }}
    >
      {icon}
      {text}
    </div>
  );
}
