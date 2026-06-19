import { useCallback, useEffect, useMemo, useState } from "react";
import type { Message, Session } from "../types";
import { useStore } from "../lib/store";
import { ConversationHeader } from "./ConversationHeader";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { EmptyState } from "./EmptyState";
import { TerminalPanel } from "./TerminalPanel";
import { MessageSquareText } from "lucide-react";
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
  const { messagesBySession, loadingMessages, ensureSessionMessages, send } = useStore();
  const { t } = useI18n();
  const messages: Message[] = messagesBySession[session.id] ?? [];

  const [terminalOpen, setTerminalOpen] = useState(false);

  // Reset terminal panel when switching conversations.
  useEffect(() => {
    setTerminalOpen(false);
  }, [session.id]);

  const handleSend = useCallback(
    async (sessionId: string, text: string, askId?: string | null) => {
      return await send(sessionId, text, askId);
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
        terminalOpen={terminalOpen}
        onToggleTerminal={() => setTerminalOpen((v) => !v)}
      />

      {terminalOpen ? (
        <div className="min-h-0 flex-1">
          <TerminalPanel sessionId={session.id} />
        </div>
      ) : (
        <>
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
          <Composer session={session} pendingAsk={pendingAsk} onSend={handleSend} />
        </>
      )}
    </section>
  );
}
