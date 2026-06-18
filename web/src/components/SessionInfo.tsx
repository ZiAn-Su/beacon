import { useState } from "react";
import { Check, Copy, Folder, History, Info, Play } from "lucide-react";
import type { Session } from "../types";
import { Avatar } from "./Avatar";
import { pathBase, sessionName, absoluteTime, classNames, isOnline } from "../lib/format";
import { useI18n } from "../lib/i18n";

interface Props {
  session: Session;
  /** Used to refresh relative timestamps. */
  now: number;
}

type StatusKey = Session["status"];

const STATUS_COLOR: Record<StatusKey, string> = {
  registered: "var(--color-registered)",
  working: "var(--color-working)",
  waiting: "var(--color-waiting)",
  idle: "var(--color-idle)",
  done: "var(--color-done)",
};

export function SessionInfo({ session, now }: Props) {
  const { t, rel } = useI18n();
  const baseName = pathBase(session.workPath) || session.runtime;
  const task = sessionName(session, t("conv.titleFallback", { name: baseName }));
  const statusKey: StatusKey = session.status;
  const statusColor = STATUS_COLOR[statusKey];
  const statusLabel = t(`status.${statusKey}`);
  const isWaiting = statusKey === "waiting";
  const online = isOnline(session, now);

  return (
    <aside
      className="flex h-full w-full flex-col"
      style={{ background: "var(--bg-sidebar)" }}
    >
      {/* Header */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-start gap-3">
          <Avatar id={session.id} label={baseName} size={40} />
          <div className="min-w-0 flex-1">
            <h3
              className="text-[14.5px] font-semibold leading-snug text-strong"
              title={task}
            >
              {task}
            </h3>
            <div
              className="mt-1 truncate text-[12px]"
              style={{ color: "var(--text-muted)" }}
              title={baseName}
            >
              {baseName}
            </div>
          </div>
        </div>
      </div>

      <Divider />

      <div className="scroll-area flex-1 overflow-y-auto px-5 py-4">
        {/* Status */}
        <SectionHeader>{t("info.status")}</SectionHeader>
        <Row
          icon={
            <span
              className="dot mt-1.5"
              style={{ background: statusColor }}
              aria-hidden
            />
          }
        >
          <span style={{ color: "var(--text)" }}>{statusLabel}</span>
          {isWaiting && (
            <span
              className="ml-1.5 text-[11.5px]"
              style={{ color: "var(--text-muted)" }}
            >
              {t("status.needsReply")}
            </span>
          )}
        </Row>
        <Row
          icon={
            <span
              className="mt-1.5 inline-block h-1.5 w-1.5 rounded-full"
              style={{
                background: online ? "var(--green)" : "transparent",
                border: online ? "none" : "1.5px solid var(--text-muted)",
              }}
              aria-hidden
            />
          }
        >
          <span style={{ color: online ? "var(--green)" : "var(--text-secondary)" }}>
            {online ? t("status.online") : t("status.offline")}
          </span>
          <span className="ml-1.5 text-[11.5px]" style={{ color: "var(--text-muted)" }}>
            {online ? t("presence.running") : t("presence.notRunning")}
          </span>
        </Row>

        {/* Runtime */}
        <SectionHeader>{t("info.runtime")}</SectionHeader>
        <Row>
          <span
            className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider"
            style={{
              color: "var(--text-secondary)",
              background: "var(--surface-card)",
              border: "1px solid var(--border)",
            }}
          >
            {session.runtime}
          </span>
        </Row>

        {/* Work path */}
        <SectionHeader>{t("info.workdir")}</SectionHeader>
        <WorkPathRow path={session.workPath} />

        {/* Started / Updated */}
        <SectionHeader>{t("info.timeline")}</SectionHeader>
        <Row icon={<Play size={12} style={{ color: "var(--text-muted)" }} />}>
          <KeyValue
            label={t("info.started")}
            value={rel(session.createdAt, now)}
            title={absoluteTime(session.createdAt)}
          />
        </Row>
        <Row
          icon={<History size={12} style={{ color: "var(--text-muted)" }} />}
        >
          <KeyValue
            label={t("info.updated")}
            value={rel(session.updatedAt, now)}
            title={absoluteTime(session.updatedAt)}
          />
        </Row>

        {/* Capabilities */}
        <SectionHeader>{t("info.capabilities")}</SectionHeader>
        <div
          className="text-[12.5px] leading-relaxed"
          style={{ color: "var(--text-muted)" }}
        >
          register · notify · ask · status · inbox
        </div>
      </div>

      <Divider />

      <div
        className="flex items-start gap-2 px-5 py-4 text-[11.5px] leading-relaxed"
        style={{ color: "var(--text-muted)" }}
      >
        <Info size={12} className="mt-0.5 shrink-0" style={{ color: "var(--text-muted)" }} />
        <span>{t("info.footer")}</span>
      </div>
    </aside>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mb-2 mt-4 text-[10.5px] font-semibold uppercase tracking-wider first:mt-0"
      style={{ color: "var(--text-muted)" }}
    >
      {children}
    </div>
  );
}

function Divider() {
  return <div className="h-px w-full" style={{ background: "var(--border)" }} />;
}

function Row({
  children,
  icon,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-start gap-2 text-[13px]">
      {icon ? <span className="mt-0.5 shrink-0">{icon}</span> : null}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function KeyValue({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span
        className="tabular-nums"
        style={{ color: "var(--text)" }}
        title={title}
      >
        {value}
      </span>
    </div>
  );
}

function WorkPathRow({ path }: { path: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const display = path || t("info.pathNotSet");
  const isEmpty = !path;
  return (
    <div
      className={classNames(
        "group flex items-start gap-2 rounded-lg px-2.5 py-2 text-[12px]",
      )}
      style={{
        background: "var(--surface-card)",
        border: "1px solid var(--border)",
      }}
    >
      <Folder
        size={12}
        className="mt-0.5 shrink-0"
        style={{ color: "var(--text-muted)" }}
      />
      <div
        className="min-w-0 flex-1 break-all font-mono leading-relaxed"
        style={{
          color: isEmpty ? "var(--text-muted)" : "var(--text)",
        }}
        title={path}
      >
        {display}
      </div>
      {!isEmpty && (
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(path);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            } catch {
              // ignore
            }
          }}
          aria-label={t("info.copyWorkPath")}
          title={t("info.copyWorkPath")}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors"
          style={{
            color: copied ? "var(--green)" : "var(--text-muted)",
            background: "transparent",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--surface-hover)";
            e.currentTarget.style.color = "var(--text)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = copied ? "var(--green)" : "var(--text-muted)";
          }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      )}
    </div>
  );
}
