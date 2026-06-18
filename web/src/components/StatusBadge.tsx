import type { SessionStatus } from "../types";
import { classNames } from "../lib/format";
import { useI18n } from "../lib/i18n";

interface Props {
  status: SessionStatus;
  size?: "sm" | "md";
  withDot?: boolean;
}

export function StatusBadge({ status, size = "sm", withDot = true }: Props) {
  const { t } = useI18n();
  const color = STATUS_COLOR[status];
  const bg = STATUS_BG[status];
  return (
    <span
      className={classNames(
        "inline-flex items-center gap-1.5 rounded-full font-medium",
        size === "sm" ? "h-5 px-2 text-[11px]" : "h-6 px-2.5 text-xs",
      )}
      style={{
        color: color,
        background: bg,
        border: "1px solid var(--border)",
      }}
    >
      {withDot && (
        <span
          className={classNames("dot", status === "working" && "working-dot")}
          style={{ background: color }}
        />
      )}
      {t(`status.${status}`)}
    </span>
  );
}

const STATUS_COLOR: Record<SessionStatus, string> = {
  registered: "var(--color-registered)",
  working: "var(--color-working)",
  waiting: "var(--color-waiting)",
  idle: "var(--color-idle)",
  done: "var(--color-done)",
};

const STATUS_BG: Record<SessionStatus, string> = {
  registered: "var(--color-registered-soft)",
  working: "var(--color-working-soft)",
  waiting: "var(--color-waiting-soft)",
  idle: "var(--color-idle-soft)",
  done: "var(--color-done-soft)",
};
