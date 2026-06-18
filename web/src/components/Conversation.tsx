import { useCallback, useEffect, useMemo, useState } from "react";
import type { Message, Session } from "../types";
import { useStore } from "../lib/store";
import { ConversationHeader } from "./ConversationHeader";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { EmptyState } from "./EmptyState";
import { MessageSquareText, Zap } from "lucide-react";
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
  const { messagesBySession, loadingMessages, ensureSessionMessages, send } =
    useStore();
  const { t } = useI18n();
  const messages: Message[] = messagesBySession[session.id] ?? [];
  const [waking, setWaking] = useState(false);

  // Wrap send so we can surface "agent was offline, waking it up" feedback.
  const handleSend = useCallback(
    async (sessionId: string, text: string, askId?: string | null) => {
      const wake = await send(sessionId, text, askId);
      if (wake === "spawned") {
        setWaking(true);
        window.setTimeout(() => setWaking(false), 6000);
      }
      return wake;
    },
    [send],
  );

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
      {waking && (
        <div
          className="flex items-center justify-center gap-2 px-4 py-1.5 text-[12px]"
          style={{
            background: "var(--accent-soft)",
            color: "var(--accent)",
            borderTop: "1px solid var(--border)",
          }}
        >
          <Zap size={12} />
          {t("wake.spawned")}
        </div>
      )}
      <Composer session={session} pendingAsk={pendingAsk} onSend={handleSend} />
    </section>
  );
}