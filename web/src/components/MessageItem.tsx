import { Bell, Bot, Check, User2 } from "lucide-react";
import type { Message } from "../types";
import { absoluteTime, shortTime } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { AskCard } from "./AskCard";

interface Props {
  message: Message;
  // Map of askId -> the human answer (or empty string) for resolved asks.
  resolvedAnswers: Record<string, string>;
  // Whether a given ask is still pending (i.e. no human answer yet).
  pendingAskIds: Set<string>;
  // Whether this message is itself the most recent in the conversation.
  isLast: boolean;
}

export function MessageItem({
  message,
  resolvedAnswers,
  pendingAskIds,
  isLast,
}: Props) {
  const { t } = useI18n();
  if (message.kind === "status") {
    return <StatusLine text={message.text} />;
  }

  if (message.kind === "ask" && message.askId) {
    const answered = !pendingAskIds.has(message.askId);
    return (
      <div className="flex justify-start">
        <div className="flex max-w-full flex-col items-start gap-1.5">
          <AvatarMini direction={message.direction} />
          <AskCard
            ask={message}
            answered={answered}
            answerText={answered ? resolvedAnswers[message.askId] : undefined}
          />
          <Timestamp time={message.createdAt} />
        </div>
      </div>
    );
  }

  if (message.direction === "agent" && message.kind === "notify") {
    return <NotifyBubble text={message.text} ts={message.createdAt} />;
  }

  if (message.direction === "agent") {
    return (
      <div className="flex justify-start">
        <div className="flex max-w-[80%] flex-col items-start gap-1.5">
          <AvatarMini direction="agent" />
          <div
            className="rounded-2xl rounded-tl-md px-3.5 py-2.5 text-sm leading-relaxed"
            style={{
              background: "var(--surface-card)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              animation: "msg-in 220ms cubic-bezier(0.2, 0.7, 0.2, 1) both",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {message.text}
          </div>
          {isLast && <Timestamp time={message.createdAt} />}
        </div>
      </div>
    );
  }

  // Human (chat or answer) - right-aligned bubble, readable text
  const showDelivery = message.direction === "human" && message.kind === "chat";
  return (
    <div className="flex justify-end">
      <div className="flex max-w-[80%] flex-col items-end gap-1.5">
        <div
          className="rounded-2xl rounded-tr-md px-3.5 py-2.5 text-sm leading-relaxed"
          style={{
            background: "var(--accent)",
            color: "#fff",
            animation: "msg-in 220ms cubic-bezier(0.2, 0.7, 0.2, 1) both",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {message.text}
        </div>
        <div className="flex items-center gap-1">
          {isLast && <Timestamp time={message.createdAt} />}
          {showDelivery && message.deliveredAt != null && (
            <span
              title={`${t("msg.delivered")} ${new Date(message.deliveredAt).toLocaleTimeString()}`}
              style={{ color: "var(--green)" }}
            >
              <Check size={11} />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function AvatarMini({ direction }: { direction: Message["direction"] }) {
  return (
    <div
      className="flex h-6 w-6 items-center justify-center rounded-full"
      style={{
        background:
          direction === "agent" ? "var(--surface-hover)" : "var(--accent-soft)",
        color: direction === "agent" ? "var(--text-secondary)" : "var(--accent)",
        border: `1px solid ${
          direction === "agent" ? "var(--border)" : "var(--accent-soft)"
        }`,
      }}
      aria-hidden
    >
      {direction === "agent" ? <Bot size={12} /> : <User2 size={12} />}
    </div>
  );
}

function Timestamp({ time }: { time: number }) {
  return (
    <time
      dateTime={new Date(time).toISOString()}
      title={absoluteTime(time)}
      className="text-[10.5px] tabular-nums"
      style={{ color: "var(--text-muted)" }}
    >
      {shortTime(time)}
    </time>
  );
}

function NotifyBubble({ text, ts }: { text: string; ts: number }) {
  return (
    <div
      className="flex items-start gap-2.5 rounded-xl px-3 py-2.5 text-[13px] leading-relaxed"
      style={{
        background: "var(--surface-card)",
        border: "1px solid var(--border)",
        color: "var(--text-secondary)",
      }}
    >
      <span
        className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
        style={{
          background: "var(--surface-hover)",
          color: "var(--text-muted)",
          border: "1px solid var(--border)",
        }}
        aria-hidden
      >
        <Bell size={9} />
      </span>
      <span
        className="min-w-0 flex-1"
        style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
      >
        {text}
      </span>
      <time
        dateTime={new Date(ts).toISOString()}
        title={absoluteTime(ts)}
        className="mt-0.5 shrink-0 text-[10.5px] tabular-nums"
        style={{ color: "var(--text-muted)" }}
      >
        {shortTime(ts)}
      </time>
    </div>
  );
}

function StatusLine({ text }: { text: string }) {
  return (
    <div className="my-1 flex items-center justify-center">
      <div
        className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11.5px]"
        style={{
          color: "var(--text-muted)",
          background: "var(--surface-card)",
          border: "1px solid var(--border)",
        }}
      >
        <span
          aria-hidden
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: "var(--text-muted)" }}
        />
        {text}
      </div>
    </div>
  );
}


