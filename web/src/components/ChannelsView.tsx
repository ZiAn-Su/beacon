import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  ArrowUp,
  AtSign,
  Check,
  CheckCheck,
  Clock,
  Hash,
  HelpCircle,
  Plus,
  Trash2,
  Users,
  X,
} from "lucide-react";
import type { ChannelMemberState, ChannelMsgKind, Session } from "../types";
import { useStore } from "../lib/store";
import { useI18n } from "../lib/i18n";
import { isOnline } from "../lib/format";
import { Avatar } from "./Avatar";
import { EmptyState } from "./EmptyState";
import { CreateChannelModal } from "./CreateChannelModal";
import { Markdown } from "./Markdown";

const STATUS_COLOR: Record<Session["status"], string> = {
  registered: "var(--color-registered)",
  working: "var(--color-working)",
  waiting: "var(--color-waiting)",
  idle: "var(--color-idle)",
  done: "var(--color-done)",
};

interface Props {
  sessions: Session[];
  now: number;
  // When set (e.g. opened from a contact profile), auto-select this channel.
  targetChannelId?: string | null;
  onTargetConsumed?: () => void;
}

// Group channels view: a channel list on the left, the selected group thread on
// the right. The human (owner) is implicitly a member of every channel; agents
// are explicit participants the owner adds. v1 is broadcast chat.
export function ChannelsView({ sessions, now, targetChannelId, onTargetConsumed }: Props) {
  const { t } = useI18n();
  const {
    channels,
    channelMessages,
    channelParticipants,
    channelStates,
    ensureChannelDetail,
    createChannel,
    deleteChannel,
    addChannelMember,
    removeChannelMember,
    postToChannel,
    answerChannelAsk,
  } = useStore();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [mobileThread, setMobileThread] = useState(false);

  // A deep-link from a contact profile: select the requested channel, then clear
  // the request so it doesn't fight manual selection.
  useEffect(() => {
    if (!targetChannelId) return;
    if (channels.some((c) => c.id === targetChannelId)) {
      setSelectedId(targetChannelId);
      setMobileThread(true);
      onTargetConsumed?.();
    }
  }, [targetChannelId, channels, onTargetConsumed]);

  // Keep a valid selection as channels come and go.
  useEffect(() => {
    if (selectedId && channels.some((c) => c.id === selectedId)) return;
    if (targetChannelId) return; // let the deep-link effect place the selection
    setSelectedId(channels.length ? channels[0]!.id : null);
  }, [channels, selectedId, targetChannelId]);

  useEffect(() => {
    if (selectedId) void ensureChannelDetail(selectedId);
  }, [selectedId, ensureChannelDetail]);

  const selected = useMemo(
    () => channels.find((c) => c.id === selectedId) ?? null,
    [channels, selectedId],
  );

  const sessionById = useMemo(() => {
    const m = new Map<string, Session>();
    for (const s of sessions) m.set(s.id, s);
    return m;
  }, [sessions]);

  const ordered = useMemo(
    () => [...channels].sort((a, b) => b.createdAt - a.createdAt),
    [channels],
  );

  return (
    <div className="flex h-full w-full min-w-0">
      {/* Channel list */}
      <div
        className={
          "flex h-full w-full flex-col md:w-[280px] md:shrink-0 md:border-r " +
          (mobileThread ? "hidden md:flex" : "flex")
        }
        style={{ borderColor: "var(--border)" }}
      >
        <div
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{ borderColor: "var(--border)" }}
        >
          <h1 className="text-sm font-semibold text-strong">
            {t("channels.title")}
          </h1>
          <button
            onClick={() => setCreateOpen(true)}
            aria-label={t("channels.newAria")}
            title={t("channels.new")}
            className="flex h-8 items-center gap-1 rounded-lg px-2 text-[12.5px] font-medium transition-colors"
            style={{
              color: "var(--accent)",
              background: "var(--accent-soft)",
              border: "1px solid transparent",
            }}
          >
            <Plus size={15} />
            <span className="hidden sm:inline">{t("channels.new")}</span>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto scroll-area px-2 py-2">
          {ordered.length === 0 ? (
            <div className="px-2 py-8">
              <EmptyState
                title={t("channels.empty.title")}
                description={t("channels.empty.desc")}
              />
              <div className="mt-3 flex justify-center">
                <button
                  onClick={() => setCreateOpen(true)}
                  className="rounded-lg px-3 py-1.5 text-[13px] font-semibold"
                  style={{
                    color: "#fff",
                    background: "var(--accent)",
                    border: "1px solid var(--accent)",
                  }}
                >
                  {t("channels.empty.action")}
                </button>
              </div>
            </div>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {ordered.map((c) => {
                const active = c.id === selectedId;
                const memberCount = (channelParticipants[c.id] ?? []).length;
                return (
                  <li key={c.id}>
                    <button
                      onClick={() => {
                        setSelectedId(c.id);
                        setMobileThread(true);
                      }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors"
                      style={{
                        background: active ? "var(--accent-soft)" : "transparent",
                      }}
                      onMouseEnter={(e) => {
                        if (!active)
                          e.currentTarget.style.background = "var(--surface-hover)";
                      }}
                      onMouseLeave={(e) => {
                        if (!active)
                          e.currentTarget.style.background = "transparent";
                      }}
                    >
                      <span
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                        style={{
                          background: active
                            ? "var(--accent)"
                            : "var(--surface-card)",
                          color: active ? "#fff" : "var(--text-secondary)",
                          border: "1px solid var(--border)",
                        }}
                      >
                        <Hash size={15} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div
                          className="truncate text-[13.5px] font-medium"
                          style={{ color: active ? "var(--accent)" : "var(--text)" }}
                        >
                          {c.name}
                        </div>
                        <div
                          className="truncate text-[11px]"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {t("channels.memberCount", { n: memberCount })}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Thread */}
      <div
        className={
          "min-w-0 flex-1 " + (mobileThread ? "flex" : "hidden md:flex")
        }
      >
        {selected ? (
          <ChannelThread
            key={selected.id}
            channelId={selected.id}
            name={selected.name}
            now={now}
            sessions={sessions}
            sessionById={sessionById}
            participants={channelParticipants[selected.id] ?? []}
            messages={channelMessages[selected.id] ?? []}
            states={channelStates[selected.id] ?? []}
            onBack={() => setMobileThread(false)}
            onPost={postToChannel}
            onAnswer={answerChannelAsk}
            onAddMember={addChannelMember}
            onRemoveMember={removeChannelMember}
            onDelete={async () => {
              await deleteChannel(selected.id);
            }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <EmptyState
              title={t("channels.pick.title")}
              description={t("channels.pick.desc")}
            />
          </div>
        )}
      </div>

      <CreateChannelModal
        open={createOpen}
        agents={sessions.filter((s) => s.archivedAt == null)}
        onClose={() => setCreateOpen(false)}
        onCreate={async (name, participants) => {
          const ch = await createChannel(name, participants);
          setSelectedId(ch.id);
          setMobileThread(true);
        }}
      />
    </div>
  );
}

function ChannelThread({
  channelId,
  name,
  now,
  sessions,
  sessionById,
  participants,
  messages,
  states,
  onBack,
  onPost,
  onAnswer,
  onAddMember,
  onRemoveMember,
  onDelete,
}: {
  channelId: string;
  name: string;
  now: number;
  sessions: Session[];
  sessionById: Map<string, Session>;
  participants: string[];
  messages: {
    id: string;
    fromSessionId: string | null;
    text: string;
    kind?: ChannelMsgKind;
    askId?: string | null;
    toSessionId?: string | null;
    createdAt: number;
  }[];
  states: ChannelMemberState[];
  onBack: () => void;
  onPost: (channelId: string, text: string, toSessionId?: string | null) => Promise<void>;
  onAnswer: (channelId: string, askId: string, text: string) => Promise<void>;
  onAddMember: (channelId: string, sessionId: string) => Promise<void>;
  onRemoveMember: (channelId: string, sessionId: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const { t, rel } = useI18n();
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // When set, the composer answers this pending channel ask instead of chatting.
  const [answering, setAnswering] = useState<{ askId: string; question: string } | null>(null);
  // When set, the next post is @directed at this member (still broadcast to all).
  const [target, setTarget] = useState<string | null>(null);
  const [targetMenuOpen, setTargetMenuOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Ask is resolved once a later 'answer' message carries the same askId.
  const answeredAskIds = useMemo(() => {
    const s = new Set<string>();
    for (const m of messages) if (m.kind === "answer" && m.askId) s.add(m.askId);
    return s;
  }, [messages]);

  const nameFor = useCallback(
    (id: string) => {
      const s = sessionById.get(id);
      return s?.title ?? s?.task ?? `${t("channels.unknownAgent")} ${id.slice(0, 6)}`;
    },
    [sessionById, t],
  );

  // Auto-scroll to the newest message.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const autosize = useCallback(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(160, el.scrollHeight)}px`;
  }, []);
  useLayoutEffect(() => {
    autosize();
  }, [value, autosize]);

  const submit = useCallback(async () => {
    const text = value.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      if (answering) {
        await onAnswer(channelId, answering.askId, text);
        setAnswering(null);
      } else {
        await onPost(channelId, text, target);
        setTarget(null);
      }
      setValue("");
    } finally {
      setSending(false);
    }
  }, [value, sending, onPost, onAnswer, answering, channelId, target]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  const addable = useMemo(
    () =>
      sessions.filter(
        (s) => s.archivedAt == null && !participants.includes(s.id),
      ),
    [sessions, participants],
  );

  const sendDisabled = value.trim().length === 0 || sending;

  return (
    <div className="flex h-full w-full flex-col">
      {/* Header */}
      <div
        className="flex shrink-0 items-center gap-2 border-b px-3 py-2.5 sm:px-5"
        style={{ borderColor: "var(--border)", background: "var(--bg)" }}
      >
        <button
          onClick={onBack}
          aria-label={t("conv.back")}
          className="flex h-8 w-8 items-center justify-center rounded-lg md:hidden"
          style={{ color: "var(--text-secondary)" }}
        >
          <X size={16} />
        </button>
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{
            background: "var(--surface-card)",
            color: "var(--text-secondary)",
            border: "1px solid var(--border)",
          }}
        >
          <Hash size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold text-strong">
            {name}
          </div>
          <div className="truncate text-[11.5px]" style={{ color: "var(--text-muted)" }}>
            {t("channels.memberCount", { n: participants.length })}
          </div>
        </div>

        {/* Members — one click opens the manage panel (add AND remove). The
            stacked avatars carry live status so you can see who can receive. */}
        <div className="relative">
          <button
            onClick={() => setAddOpen((v) => !v)}
            aria-label={t("channels.manageMembers")}
            title={t("channels.manageMembers")}
            className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 transition-colors"
            style={{
              color: "var(--text-secondary)",
              border: "1px solid var(--border)",
              background: "var(--surface-card)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--surface-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--surface-card)";
            }}
          >
            <span className="hidden items-center sm:flex">
              {participants.slice(0, 4).map((id, i) => {
                const s = sessionById.get(id);
                const online = s ? isOnline(s, now) : false;
                return (
                  <span
                    key={id}
                    className="relative"
                    title={nameFor(id)}
                    style={{ marginLeft: i === 0 ? 0 : -8 }}
                  >
                    <Avatar id={id} label={nameFor(id)} size={24} ring />
                    <span
                      className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full"
                      style={{
                        background: online && s ? STATUS_COLOR[s.status] : "var(--text-muted)",
                        boxShadow: "0 0 0 1.5px var(--bg)",
                      }}
                    />
                  </span>
                );
              })}
            </span>
            <Users size={15} />
            <span className="text-[12px] font-medium tabular-nums">
              {participants.length}
            </span>
          </button>
          {addOpen && (
            <MemberMenu
              participants={participants}
              addable={addable}
              nameFor={nameFor}
              onAdd={async (id) => {
                await onAddMember(channelId, id);
              }}
              onRemove={async (id) => {
                await onRemoveMember(channelId, id);
              }}
              onClose={() => setAddOpen(false)}
            />
          )}
        </div>

        {/* Delete channel */}
        <button
          onClick={() => setConfirmDelete(true)}
          aria-label={t("channels.delete")}
          title={t("channels.delete")}
          className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
          style={{ color: "var(--text-muted)", border: "1px solid transparent" }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--danger)";
            e.currentTarget.style.background = "var(--surface-hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--text-muted)";
            e.currentTarget.style.background = "transparent";
          }}
        >
          <Trash2 size={15} />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto scroll-area px-3 py-4 sm:px-6">
        <div className="mx-auto flex w-full max-w-[860px] flex-col gap-3">
          {messages.length === 0 ? (
            <p
              className="py-10 text-center text-sm"
              style={{ color: "var(--text-muted)" }}
            >
              {t("channels.thread.empty")}
            </p>
          ) : (
            messages.map((m) => {
              const mine = m.fromSessionId == null;
              const who = mine ? t("channels.fromYou") : nameFor(m.fromSessionId!);
              const isAsk = m.kind === "ask" && !!m.askId;
              const isAnswer = m.kind === "answer";
              const answered = isAsk && answeredAskIds.has(m.askId!);
              return (
                <div
                  key={m.id}
                  className={"flex gap-2.5 " + (mine ? "flex-row-reverse" : "flex-row")}
                >
                  {!mine && (
                    <div className="pt-5">
                      <Avatar id={m.fromSessionId!} label={who} size={28} />
                    </div>
                  )}
                  <div className={"min-w-0 max-w-[78%] " + (mine ? "items-end" : "items-start")}>
                    <div
                      className={
                        "mb-1 flex items-baseline gap-2 text-[11px] " +
                        (mine ? "justify-end" : "justify-start")
                      }
                      style={{ color: "var(--text-muted)" }}
                    >
                      {isAsk && (
                        <span
                          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                          style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                        >
                          <HelpCircle size={10} />
                          {t("channels.askBadge")}
                        </span>
                      )}
                      {isAnswer && (
                        <span className="font-semibold" style={{ color: "var(--color-working)" }}>
                          {t("channels.answerBadge")}
                        </span>
                      )}
                      <span className="font-medium" style={{ color: "var(--text-secondary)" }}>
                        {who}
                      </span>
                      {m.toSessionId && (
                        <span
                          className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                          style={{ background: "var(--surface-hover)", color: "var(--accent)", border: "1px solid var(--accent-soft)" }}
                        >
                          <AtSign size={9} />
                          {nameFor(m.toSessionId)}
                        </span>
                      )}
                      <span>{rel(m.createdAt, now)}</span>
                    </div>
                    <div
                      className="break-words rounded-2xl px-3.5 py-2 text-[14px] leading-relaxed"
                      style={
                        mine
                          ? { background: "var(--accent)", color: "#fff" }
                          : isAsk
                            ? {
                                background: "var(--accent-soft)",
                                color: "var(--text)",
                                border: "1px solid var(--accent)",
                              }
                            : {
                                background: "var(--surface-card)",
                                color: "var(--text)",
                                border: "1px solid var(--border)",
                              }
                      }
                    >
                      <Markdown text={m.text} onAccent={mine} />
                    </div>
                    {isAsk && !mine && (
                      <div className={"mt-1 flex " + (mine ? "justify-end" : "justify-start")}>
                        {answered ? (
                          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                            {t("channels.askAnswered")}
                          </span>
                        ) : (
                          <button
                            onClick={() => {
                              setAnswering({ askId: m.askId!, question: m.text });
                              taRef.current?.focus();
                            }}
                            className="rounded-md px-2 py-0.5 text-[11.5px] font-semibold transition-colors"
                            style={{
                              color: "#fff",
                              background: "var(--accent)",
                              border: "1px solid var(--accent)",
                            }}
                          >
                            {t("channels.answer")}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
          {messages.length > 0 && (
            <ChannelReceipts
              lastMessage={messages[messages.length - 1]!}
              participants={participants}
              states={states}
              nameFor={nameFor}
            />
          )}
        </div>
      </div>

      {/* Composer */}
      <div
        className="shrink-0 border-t px-3 pb-3 pt-2 sm:px-6 sm:pb-4 sm:pt-3"
        style={{ borderColor: "var(--border)", background: "var(--bg)" }}
      >
        <div className="mx-auto w-full max-w-[860px]">
          {answering && (
            <div
              className="mb-2 flex items-center gap-2 rounded-xl px-3 py-2"
              style={{ background: "var(--accent-soft)", border: "1px solid var(--accent-soft)" }}
            >
              <HelpCircle size={13} style={{ color: "var(--accent)" }} />
              <div className="min-w-0 flex-1">
                <div
                  className="text-[10.5px] font-semibold uppercase tracking-wider"
                  style={{ color: "var(--accent)" }}
                >
                  {t("channels.answeringAsk")}
                </div>
                <div className="truncate text-[12px]" style={{ color: "var(--text-secondary)" }}>
                  {answering.question}
                </div>
              </div>
              <button
                onClick={() => setAnswering(null)}
                aria-label={t("channels.create.cancel")}
                className="flex h-6 w-6 items-center justify-center rounded-md"
                style={{ color: "var(--text-muted)" }}
              >
                <X size={13} />
              </button>
            </div>
          )}
          {target && !answering && (
            <div
              className="mb-2 flex items-center gap-2 rounded-xl px-3 py-2"
              style={{ background: "var(--accent-soft)", border: "1px solid var(--accent-soft)" }}
            >
              <AtSign size={13} style={{ color: "var(--accent)" }} />
              <div className="min-w-0 flex-1 truncate text-[12px]" style={{ color: "var(--text-secondary)" }}>
                {t("channels.directedTo", { name: nameFor(target) })}
              </div>
              <button
                onClick={() => setTarget(null)}
                aria-label={t("channels.create.cancel")}
                className="flex h-6 w-6 items-center justify-center rounded-md"
                style={{ color: "var(--text-muted)" }}
              >
                <X size={13} />
              </button>
            </div>
          )}
          <div
            className="relative flex items-end gap-2 rounded-2xl px-3 py-2"
            style={{
              background: "var(--surface-card)",
              border: "1px solid var(--border)",
              boxShadow: "var(--shadow-1)",
            }}
          >
            {!answering && participants.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setTargetMenuOpen((v) => !v)}
                  aria-label={t("channels.directTo")}
                  title={t("channels.directTo")}
                  className="mb-0.5 flex h-9 w-9 items-center justify-center rounded-xl transition-colors"
                  style={{ color: target ? "var(--accent)" : "var(--text-muted)" }}
                >
                  <AtSign size={17} />
                </button>
                {targetMenuOpen && (
                  <TargetMenu
                    participants={participants}
                    nameFor={nameFor}
                    onPick={(id) => {
                      setTarget(id);
                      setTargetMenuOpen(false);
                    }}
                    onClose={() => setTargetMenuOpen(false)}
                  />
                )}
              </div>
            )}
            <textarea
              ref={taRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={
                answering
                  ? t("channels.composer.answerPlaceholder")
                  : t("channels.composer.placeholder", { name })
              }
              rows={1}
              spellCheck
              className="scroll-area max-h-[160px] min-h-[36px] flex-1 resize-none bg-transparent px-1 py-1.5 text-sm leading-relaxed outline-none placeholder:text-[var(--text-muted)]"
              style={{ color: "var(--text)" }}
              disabled={sending}
            />
            <button
              onClick={() => void submit()}
              disabled={sendDisabled}
              aria-label={t("composer.send")}
              className="mb-0.5 flex h-9 w-9 items-center justify-center rounded-xl transition-colors"
              style={{
                background: sendDisabled ? "var(--surface-hover)" : "var(--accent)",
                color: sendDisabled ? "var(--text-muted)" : "#fff",
                border: `1px solid ${sendDisabled ? "var(--border)" : "var(--accent)"}`,
              }}
            >
              <ArrowUp size={16} />
            </button>
          </div>
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDelete
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            setConfirmDelete(false);
            await onDelete();
          }}
        />
      )}
    </div>
  );
}

// Two-tier read receipts for the latest message: which agent members it was
// delivered to (typed into their live terminal) and which have read it (pulled
// the channel). The poster is excluded. Owner posts show all agents.
function ChannelReceipts({
  lastMessage,
  participants,
  states,
  nameFor,
}: {
  lastMessage: { fromSessionId: string | null; createdAt: number };
  participants: string[];
  states: ChannelMemberState[];
  nameFor: (id: string) => string;
}) {
  const { t } = useI18n();
  const recipients = participants.filter((id) => id !== lastMessage.fromSessionId);
  if (recipients.length === 0) return null;
  const ts = lastMessage.createdAt;
  const stateOf = (id: string): "read" | "delivered" | "pending" => {
    const s = states.find((x) => x.sessionId === id);
    if (s?.readAt != null && s.readAt >= ts) return "read";
    if (s?.deliveredAt != null && s.deliveredAt >= ts) return "delivered";
    return "pending";
  };
  const readN = recipients.filter((id) => stateOf(id) === "read").length;
  const deliveredN = recipients.filter((id) => stateOf(id) !== "pending").length;
  return (
    <div
      className="flex items-center justify-end gap-2 pr-1 pt-0.5 text-[10.5px]"
      style={{ color: "var(--text-muted)" }}
    >
      <div className="flex items-center">
        {recipients.map((id, i) => {
          const st = stateOf(id);
          const color =
            st === "read"
              ? "var(--accent)"
              : st === "delivered"
                ? "var(--text-secondary)"
                : "var(--text-muted)";
          return (
            <span
              key={id}
              className="relative"
              style={{ marginLeft: i === 0 ? 0 : -6 }}
              title={`${nameFor(id)} · ${t(`channels.receipt.${st}`)}`}
            >
              <Avatar id={id} label={nameFor(id)} size={18} ring />
              <span
                className="absolute -bottom-1 -right-1 flex h-3 w-3 items-center justify-center rounded-full"
                style={{ background: "var(--bg)", color }}
              >
                {st === "read" ? (
                  <CheckCheck size={9} />
                ) : st === "delivered" ? (
                  <Check size={9} />
                ) : (
                  <Clock size={8} />
                )}
              </span>
            </span>
          );
        })}
      </div>
      <span>
        {t("channels.receiptSummary", {
          read: readN,
          delivered: deliveredN,
          total: recipients.length,
        })}
      </span>
    </div>
  );
}

// Popover to pick one member to @direct the next message at. The message still
// broadcasts to the whole channel; the target is just flagged.
function TargetMenu({
  participants,
  nameFor,
  onPick,
  onClose,
}: {
  participants: string[];
  nameFor: (id: string) => string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [onClose]);
  return (
    <div
      ref={ref}
      className="absolute bottom-11 left-0 z-30 w-[220px] overflow-hidden rounded-xl"
      style={{ background: "var(--surface-card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-2)" }}
    >
      <div className="scroll-area max-h-[260px] overflow-y-auto p-1.5">
        <div
          className="px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--text-muted)" }}
        >
          {t("channels.directTo")}
        </div>
        {participants.map((id) => (
          <button
            key={id}
            onClick={() => onPick(id)}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors"
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-hover)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            <Avatar id={id} label={nameFor(id)} size={22} />
            <span className="min-w-0 flex-1 truncate text-[12.5px]">{nameFor(id)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// A small popover listing current members (removable) and addable agents.
function MemberMenu({
  participants,
  addable,
  nameFor,
  onAdd,
  onRemove,
  onClose,
}: {
  participants: string[];
  addable: Session[];
  nameFor: (id: string) => string;
  onAdd: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute right-0 top-10 z-30 w-[260px] overflow-hidden rounded-xl"
      style={{
        background: "var(--surface-card)",
        border: "1px solid var(--border)",
        boxShadow: "var(--shadow-2)",
      }}
    >
      <div className="max-h-[300px] overflow-y-auto scroll-area p-1.5">
        <div
          className="px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--text-muted)" }}
        >
          {t("channels.members")}
        </div>
        <div
          className="flex items-center gap-2 rounded-lg px-2 py-1.5"
          style={{ color: "var(--text-secondary)" }}
        >
          <span
            className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold"
            style={{ background: "var(--accent)", color: "#fff" }}
          >
            ★
          </span>
          <span className="text-[12.5px]">{t("channels.you")}</span>
        </div>
        {participants.length === 0 ? (
          <p className="px-2 py-1.5 text-[12px]" style={{ color: "var(--text-muted)" }}>
            {t("channels.noMembers")}
          </p>
        ) : (
          participants.map((id) => (
            <div
              key={id}
              className="group flex items-center gap-2 rounded-lg px-2 py-1.5"
            >
              <Avatar id={id} label={nameFor(id)} size={24} />
              <span className="min-w-0 flex-1 truncate text-[12.5px]">
                {nameFor(id)}
              </span>
              <button
                onClick={() => void onRemove(id)}
                aria-label={t("channels.removeMember")}
                title={t("channels.removeMember")}
                className="flex h-6 w-6 items-center justify-center rounded-md"
                style={{ color: "var(--text-muted)" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "var(--danger)";
                  e.currentTarget.style.background = "var(--surface-hover)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "var(--text-muted)";
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <X size={13} />
              </button>
            </div>
          ))
        )}

        {addable.length > 0 && (
          <>
            <div
              className="mt-1 border-t px-2 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wider"
              style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
            >
              {t("channels.addMember")}
            </div>
            {addable.map((s) => {
              const label = s.title ?? s.task ?? s.id.slice(0, 8);
              return (
                <button
                  key={s.id}
                  onClick={() => void onAdd(s.id)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors"
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--surface-hover)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  <Avatar id={s.id} label={label} size={24} />
                  <span className="min-w-0 flex-1 truncate text-[12.5px]">
                    {label}
                  </span>
                  <Plus size={13} style={{ color: "var(--accent)" }} />
                </button>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

function ConfirmDelete({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(15, 16, 20, 0.45)", animation: "fade-in 140ms ease-out both" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="w-full max-w-[380px] overflow-hidden rounded-2xl"
        style={{
          background: "var(--surface-card)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow-2)",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5">
          <h2 className="text-base font-semibold text-strong">
            {t("channels.deleteConfirm")}
          </h2>
        </div>
        <div
          className="mt-4 flex items-center justify-end gap-2 border-t px-5 py-3"
          style={{ borderColor: "var(--border)" }}
        >
          <button
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-[13px] font-medium"
            style={{
              color: "var(--text-secondary)",
              background: "transparent",
              border: "1px solid var(--border)",
            }}
          >
            {t("channels.deleteCancel")}
          </button>
          <button
            onClick={onConfirm}
            className="rounded-lg px-3.5 py-1.5 text-[13px] font-semibold"
            style={{ color: "#fff", background: "var(--danger)", border: "1px solid var(--danger)" }}
          >
            {t("channels.deleteYes")}
          </button>
        </div>
      </div>
    </div>
  );
}
