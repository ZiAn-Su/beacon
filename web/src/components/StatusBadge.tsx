import type { SessionStatus } from "../types";
import { classNames } from "../lib/format";
import { useI18n } from "../lib/i18n";

interface Props {
  status: SessionStatus;
  size?: "sm" | "md";
  withDot?: boolean;
  online?: boolean; // when provided, dims the badge if offline
}

export function StatusBadge({ status, size = "sm", withDot = true, online }: Props) {
  const { t } = useI18n();
  const color = online === false ? "var(--text-muted)" : STATUS_COLOR[status];
  const bg = online === false ? "var(--surface-hover)" : STATUS_BG[status];
  return (
    <span
      className={classNames(
        "inline-flex items-center gap-1.5 rounded-full font-medium",
        size === "sm" ? "h-5 px-2 text-[11px]" : "h-6 px-2.5 text-xs",
      )}
      style={{
        color,
        background: bg,
        border: "1px solid var(--border)",
        opacity: online === false ? 0.7 : 1,
      }}
      title={online === false ? t("presence.notRunning") : undefined}
    >
      {withDot && (
        <span
          className={classNames("dot", status === "working" && online !== false && "working-dot")}
          style={{ background: color }}
        />
      )}
      {t(`status.${status}`)}
      {online === false && (
        <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
          · {t("presence.notRunning")}
        </span>
      )}
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
