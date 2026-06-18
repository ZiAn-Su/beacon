import type { Session } from "../types";
import { Avatar } from "./Avatar";
import { classNames, pathBase, sessionName } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { HelpCircle } from "lucide-react";

interface Props {
  session: Session;
  selected: boolean;
  waiting: boolean;
  unread: number;
  pendingAsk: boolean;
  onClick: () => void;
  now: number;
}

export function ContactCard({
  session,
  selected,
  unread,
  pendingAsk,
  onClick,
  now,
}: Props) {
  const { t, rel } = useI18n();
  const baseName = pathBase(session.workPath) || session.runtime;
  const task = sessionName(session, t("contacts.taskFallback", { name: baseName }));
  const showUnread = unread > 0;
  const askDominant = pendingAsk;

  return (
    <button
      onClick={onClick}
      className={classNames(
        "group relative w-full text-left rounded-lg px-2.5 py-2 transition-colors duration-150",
      )}
      style={{
        background: selected ? "var(--surface-active)" : "transparent",
        border: `1px solid ${selected ? "var(--border)" : "transparent"}`,
      }}
      onMouseEnter={(e) => {
        if (!selected) e.currentTarget.style.background = "var(--surface-hover)";
      }}
      onMouseLeave={(e) => {
        if (!selected) e.currentTarget.style.background = "transparent";
      }}
    >
      {selected && (
        <span
          className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full"
          style={{ background: "var(--accent)" }}
          aria-hidden
        />
      )}

      <div className="flex items-start gap-2.5">
        <div className="relative shrink-0">
          <Avatar id={session.id} label={baseName} size={28} />
          <StatusDot status={session.status} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <div
              className="truncate text-[13px] font-medium text-strong"
              title={task}
            >
              {task}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {showUnread && (
                <UnreadBadge count={unread} askDominant={askDominant} />
              )}
              <div
                className="text-[11px] tabular-nums"
                style={{ color: "var(--text-muted)" }}
              >
                {rel(session.updatedAt, now)}
              </div>
            </div>
          </div>

          <div
            className="mt-0.5 flex items-center gap-1.5 truncate text-[11.5px]"
            style={{ color: "var(--text-muted)" }}
          >
            <span className="truncate font-mono">
              {session.runtime} · {baseName}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

function UnreadBadge({
  count,
  askDominant,
}: {
  count: number;
  askDominant: boolean;
}) {
  const { t } = useI18n();
  const display = count > 99 ? "99+" : String(count);
  return (
    <span
      aria-label={
        askDominant
          ? t("contacts.unreadNeedsYou", { n: count })
          : t("contacts.unread", { n: count })
      }
      className="inline-flex h-[18px] min-w-[18px] items-center justify-center gap-0.5 rounded-full px-1.5 text-[10px] font-semibold leading-none tabular-nums"
      style={{
        color: askDominant ? "#fff" : "#fff",
        background: "var(--accent)",
        border: "1px solid var(--accent)",
      }}
    >
      {askDominant && <HelpCircle size={9} strokeWidth={2.5} />}
      {display}
    </span>
  );
}

function StatusDot({ status }: { status: Session["status"] }) {
  const color =
    status === "working"
      ? "var(--color-working)"
      : status === "waiting"
        ? "var(--color-waiting)"
        : status === "idle"
          ? "var(--color-idle)"
          : status === "done"
            ? "var(--color-done)"
            : "var(--color-registered)";
  return (
    <span
      className="absolute -bottom-0.5 -right-0.5 block h-2 w-2 rounded-full"
      style={{
        background: color,
        boxShadow: "0 0 0 2px var(--bg-sidebar)",
      }}
      aria-hidden
    >
      {status === "working" && (
        <span
          className="absolute inset-0 rounded-full"
          style={{
            background: color,
            animation: "pulse-soft 2.4s ease-in-out infinite",
          }}
        />
      )}
    </span>
  );
}

