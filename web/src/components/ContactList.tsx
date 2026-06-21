import { useEffect, useState } from "react";
import { Archive, BookUser, Bot, ChevronDown, ChevronRight, Plus, Sparkles } from "lucide-react";
import type { Message, Session } from "../types";
import { ContactCard } from "./ContactCard";
import { EmptyState } from "./EmptyState";
import { useStore } from "../lib/store";
import { useI18n } from "../lib/i18n";
import { getHealth } from "../lib/api";

interface Props {
  sessions: Session[];
  messagesBySession: Record<string, Message[]>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onConnectAgent?: () => void;
  onOpenDirectory?: () => void;
}

type GroupKey = "pending" | "waiting" | "active" | "done";

// Pending (quarantined, awaiting the owner's admission) sits first — it needs a
// decision before the agent can do anything.
const GROUP_ORDER: GroupKey[] = ["pending", "active", "done", "waiting"];

function groupForStatus(status: Session["status"]): GroupKey {
  if (status === "waiting") return "waiting";
  if (status === "done") return "done";
  return "active"; // registered, working, idle
}

export function ContactList({
  sessions,
  messagesBySession,
  selectedId,
  onSelect,
  onConnectAgent,
  onOpenDirectory,
}: Props) {
  const { t } = useI18n();
  // Re-render the relative timestamps periodically.
  const [now, setNow] = useState(() => Date.now());
  const [archivedOpen, setArchivedOpen] = useState(false);
  useEffect(() => {
    const tmr = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(tmr);
  }, []);

  const { unreadBySession, hasPendingAsk } = useStore();

  // Show the running backend's version so it's obvious which build is live.
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    getHealth()
      .then((h) => alive && setVersion(h.version))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const active = sessions.filter((s) => s.archivedAt == null);
  const archived = sessions.filter((s) => s.archivedAt != null);

  // Determine "waiting" via unanswered ask AND status waiting.
  const waiting = new Set<string>();
  for (const s of active) {
    if (s.status === "waiting") {
      waiting.add(s.id);
      continue;
    }
    const list = messagesBySession[s.id] ?? [];
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i]!;
      if (m.kind === "ask" && m.askId) {
        const answered = list.some(
          (x) => x.askId === m.askId && x.direction === "human",
        );
        if (!answered) {
          waiting.add(s.id);
          break;
        }
      }
    }
  }

  // Sort by updatedAt desc within each group, then group. A quarantined agent
  // (admittedAt == null) goes to "pending" regardless of its status.
  const byGroup: Record<GroupKey, Session[]> = {
    pending: [],
    active: [],
    done: [],
    waiting: [],
  };
  const sorted = [...active].sort((a, b) => b.updatedAt - a.updatedAt);
  for (const s of sorted) {
    const g = s.admittedAt == null ? "pending" : groupForStatus(s.status);
    byGroup[g].push(s);
  }
  const archivedSorted = [...archived].sort((a, b) => b.updatedAt - a.updatedAt);

  const waitingCount = byGroup.waiting.length;
  const pendingCount = byGroup.pending.length;

  const renderCard = (s: Session) => (
    <li key={s.id}>
      <ContactCard
        session={s}
        selected={selectedId === s.id}
        waiting={waiting.has(s.id)}
        unread={unreadBySession[s.id] ?? 0}
        pendingAsk={hasPendingAsk(s.id)}
        onClick={() => onSelect(s.id)}
        now={now}
      />
    </li>
  );

  return (
    <div
      className="flex h-full w-full flex-col"
      style={{ background: "var(--bg-sidebar)" }}
    >
      <header
        className="flex h-14 items-center justify-between gap-2 border-b px-4"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <div className="relative flex h-7 w-7 items-center justify-center rounded-lg"
            style={{
              background: "var(--surface-card)",
              border: "1px solid var(--border)",
              color: "var(--text)",
            }}
          >
            <span
              className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full"
              style={{ background: "var(--accent)" }}
              aria-hidden
            />
            <Bot size={14} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <div className="truncate text-sm font-semibold text-strong">
                Beacon
              </div>
              {version && (
                <span
                  className="rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
                  style={{
                    color: "var(--text-secondary)",
                    background: "var(--surface-card)",
                    border: "1px solid var(--border)",
                  }}
                  title={`Beacon v${version}`}
                >
                  v{version}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {pendingCount > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums"
              style={{
                color: "#fff",
                background: "var(--accent)",
                border: "1px solid var(--accent)",
              }}
              title={t("contacts.group.pending")}
            >
              {t("contacts.pendingBadge", { n: pendingCount })}
            </span>
          )}
          {waitingCount > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums"
              style={{
                color: "var(--accent)",
                background: "var(--accent-soft)",
                border: "1px solid var(--border)",
              }}
            >
              {t("contacts.waitingBadge", { n: waitingCount })}
            </span>
          )}
          {onOpenDirectory && (
            <button
              onClick={onOpenDirectory}
              aria-label={t("dir.openAria")}
              title={t("dir.title")}
              className="flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-150"
              style={{
                background: "var(--surface-card)",
                color: "var(--text)",
                border: "1px solid var(--border)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--surface-hover)";
                e.currentTarget.style.borderColor = "var(--border-strong)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--surface-card)";
                e.currentTarget.style.borderColor = "var(--border)";
              }}
            >
              <BookUser size={13} />
            </button>
          )}
          {onConnectAgent && (
            <button
              onClick={onConnectAgent}
              aria-label={t("contacts.connectAria")}
              title={t("contacts.connectAria")}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-semibold transition-colors duration-150"
              style={{
                background: "var(--surface-card)",
                color: "var(--text)",
                border: "1px solid var(--border)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--surface-hover)";
                e.currentTarget.style.borderColor = "var(--border-strong)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--surface-card)";
                e.currentTarget.style.borderColor = "var(--border)";
              }}
            >
              <Plus size={12} strokeWidth={2.5} />
              {t("contacts.connect")}
            </button>
          )}
        </div>
      </header>

      <div className="scroll-area flex-1 overflow-y-auto px-2 py-2">
        {sorted.length === 0 && archivedSorted.length === 0 ? (
          <EmptyState
            title={t("contacts.empty.title")}
            description={t("contacts.empty.desc")}
            actionLabel={onConnectAgent ? t("contacts.empty.action") : undefined}
            onAction={onConnectAgent}
            icon={<Sparkles size={20} />}
          />
        ) : (
          <div className="flex flex-col gap-3">
            {GROUP_ORDER.map((g) => {
              const list = byGroup[g];
              if (list.length === 0) return null;
              return (
                <section key={g} aria-label={t(`contacts.group.${g}`)}>
                  <div
                    className="px-2 pb-1.5 pt-2 text-[10.5px] font-semibold uppercase tracking-wider"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {t(`contacts.group.${g}`)}
                    <span
                      className="ml-1.5 tabular-nums font-medium"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {list.length}
                    </span>
                  </div>
                  <ul className="flex flex-col gap-0.5">{list.map(renderCard)}</ul>
                </section>
              );
            })}

            {archivedSorted.length > 0 && (
              <section aria-label={t("contacts.group.archived")}>
                <button
                  onClick={() => setArchivedOpen((v) => !v)}
                  className="flex w-full items-center gap-1 px-2 pb-1.5 pt-2 text-[10.5px] font-semibold uppercase tracking-wider transition-colors"
                  style={{ color: "var(--text-muted)" }}
                >
                  {archivedOpen ? (
                    <ChevronDown size={12} />
                  ) : (
                    <ChevronRight size={12} />
                  )}
                  <Archive size={11} />
                  {t("contacts.group.archived")}
                  <span className="ml-0.5 tabular-nums font-medium">
                    {archivedSorted.length}
                  </span>
                </button>
                {archivedOpen && (
                  <ul className="flex flex-col gap-0.5 opacity-80">
                    {archivedSorted.map(renderCard)}
                  </ul>
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
