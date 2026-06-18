import { useEffect, useMemo, useRef, useState } from "react";
import type { Message } from "../types";
import { MessageItem } from "./MessageItem";
import { useI18n } from "../lib/i18n";

interface Props {
  messages: Message[];
  loading: boolean;
}

export function MessageList({ messages, loading }: Props) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [stickToBottom, setStickToBottom] = useState(true);

  // Compute pending-ask ids (asks with no human answer yet) and the
  // human answer text per ask.
  const { pendingAskIds, resolvedAnswers } = useMemo(() => {
    const pending = new Set<string>();
    const answers: Record<string, string> = {};
    for (const m of messages) {
      if (m.kind === "ask" && m.askId) pending.add(m.askId);
      if (m.direction === "human" && m.askId) {
        pending.delete(m.askId);
        answers[m.askId] = m.text;
      }
    }
    return { pendingAskIds: pending, resolvedAnswers: answers };
  }, [messages]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      setStickToBottom(distance < 80);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (stickToBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, stickToBottom]);

  return (
    <div
      ref={scrollerRef}
      className="scroll-area relative h-full w-full overflow-y-auto"
      style={{ background: "var(--bg)" }}
    >
      <div className="mx-auto flex w-full max-w-[860px] flex-col gap-3 px-4 py-6 sm:px-8">
        {loading && messages.length === 0 ? (
          <SkeletonList />
        ) : messages.length === 0 ? (
          <EmptyThread />
        ) : (
          <GroupedList
            messages={messages}
            pendingAskIds={pendingAskIds}
            resolvedAnswers={resolvedAnswers}
          />
        )}
      </div>
    </div>
  );
}

function GroupedList({
  messages,
  pendingAskIds,
  resolvedAnswers,
}: {
  messages: Message[];
  pendingAskIds: Set<string>;
  resolvedAnswers: Record<string, string>;
}) {
  return (
    <>
      {messages.map((m, i) => (
        <MessageItem
          key={m.id}
          message={m}
          pendingAskIds={pendingAskIds}
          resolvedAnswers={resolvedAnswers}
          isLast={i === messages.length - 1}
        />
      ))}
    </>
  );
}

function SkeletonList() {
  return (
    <div className="flex flex-col gap-3">
      {[60, 40, 75, 55].map((w, i) => (
        <div
          key={i}
          className="h-10 rounded-2xl"
          style={{
            width: `${w}%`,
            background:
              "linear-gradient(90deg, var(--surface-card) 0%, var(--surface-hover) 50%, var(--surface-card) 100%)",
            backgroundSize: "200% 100%",
            animation: "shimmer 1.6s linear infinite",
          }}
        />
      ))}
    </div>
  );
}

function EmptyThread() {
  const { t } = useI18n();
  return (
    <div className="mt-16 flex flex-col items-center text-center">
      <div
        className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl"
        style={{
          background: "var(--surface-card)",
          border: "1px solid var(--border)",
          color: "var(--text-secondary)",
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
      </div>
      <h4 className="text-sm font-semibold text-strong">{t("msg.empty.title")}</h4>
      <p className="mt-1 max-w-sm text-xs text-secondary">{t("msg.empty.desc")}</p>
    </div>
  );
}
