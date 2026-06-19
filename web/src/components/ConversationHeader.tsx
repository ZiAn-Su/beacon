import {
  Archive,
  ArchiveRestore,
  ChevronLeft,
  Copy,
  Folder,
  MessageSquareText,
  MoreVertical,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Terminal,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Session } from "../types";
import { Avatar } from "./Avatar";
import { StatusBadge } from "./StatusBadge";
import { isOnline, pathBase, sessionName } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { useStore } from "../lib/store";
import { RenameDialog } from "./RenameDialog";

interface Props {
  session: Session;
  now?: number;
  onBack?: () => void;
  showBack?: boolean;
  infoOpen?: boolean;
  onToggleInfo?: () => void;
  canToggleInfo?: boolean;
  terminalOpen?: boolean;
  onToggleTerminal?: () => void;
}

export function ConversationHeader({
  session,
  now,
  onBack,
  showBack,
  infoOpen,
  onToggleInfo,
  canToggleInfo,
  terminalOpen,
  onToggleTerminal,
}: Props) {
  const { t } = useI18n();
  const { renameSession, setArchived } = useStore();
  const online = isOnline(session, now ?? Date.now());
  const baseName = pathBase(session.workPath) || session.runtime;
  const title = sessionName(session, t("conv.titleFallback", { name: baseName }));
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const isArchived = session.archivedAt != null;

  return (
    <header
      className="flex h-16 shrink-0 items-center gap-3 border-b px-4 sm:px-6"
      style={{ borderColor: "var(--border)", background: "var(--bg)" }}
    >
      {showBack && (
        <button
          onClick={onBack}
          aria-label={t("conv.back")}
          className="md:hidden flex h-9 w-9 items-center justify-center rounded-lg"
          style={{ color: "var(--text-secondary)" }}
        >
          <ChevronLeft size={20} />
        </button>
      )}

      <Avatar id={session.id} label={baseName} size={36} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h2
            className="truncate text-[15px] font-semibold text-strong"
            title={title}
          >
            {title}
          </h2>
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs">
          <span
            className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider"
            style={{
              color: "var(--text-secondary)",
              background: "var(--surface-card)",
              border: "1px solid var(--border)",
            }}
          >
            {session.runtime}
          </span>
          <span
            className="inline-flex min-w-0 items-center gap-1 truncate text-[11.5px]"
            style={{ color: "var(--text-muted)" }}
            title={session.workPath}
          >
            <Folder size={11} className="shrink-0" />
            <span className="truncate font-mono">
              {session.workPath || t("conv.pathPlaceholder")}
            </span>
            {session.workPath && (
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(session.workPath);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1200);
                  } catch {
                    // ignore
                  }
                }}
                title={t("conv.copyPath")}
                aria-label={t("conv.copyPath")}
                className="ml-0.5 inline-flex h-5 w-5 items-center justify-center rounded transition-colors"
                style={{ color: "var(--text-muted)" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "var(--text)";
                  e.currentTarget.style.background = "var(--surface-hover)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "var(--text-muted)";
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <Copy size={11} />
              </button>
            )}
          </span>
          <StatusBadge status={session.status} online={online} />
          {copied && (
            <span className="text-[11px]" style={{ color: "var(--green)" }}>
              {t("conv.copied")}
            </span>
          )}
        </div>
      </div>

      {onToggleTerminal && (
        <ViewToggle
          terminalOpen={!!terminalOpen}
          onToggle={onToggleTerminal}
        />
      )}

      {canToggleInfo && onToggleInfo && (
        <button
          onClick={onToggleInfo}
          aria-label={infoOpen ? t("conv.hideInfo") : t("conv.showInfo")}
          title={infoOpen ? t("conv.hideInfo") : t("conv.showInfo")}
          className="hidden lg:flex h-9 w-9 items-center justify-center rounded-lg"
          style={{
            color: infoOpen ? "var(--accent)" : "var(--text-secondary)",
            background: "var(--surface-card)",
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
          {infoOpen ? (
            <PanelRightClose size={15} />
          ) : (
            <PanelRightOpen size={15} />
          )}
        </button>
      )}

      <SessionMenu
        open={menuOpen}
        onOpen={() => setMenuOpen(true)}
        onClose={() => setMenuOpen(false)}
        isArchived={isArchived}
        onRename={() => {
          setMenuOpen(false);
          setRenameOpen(true);
        }}
        onToggleArchive={() => {
          setMenuOpen(false);
          void setArchived(session.id, !isArchived);
        }}
      />

      {renameOpen && (
        <RenameDialog
          initial={session.title ?? session.task ?? ""}
          onCancel={() => setRenameOpen(false)}
          onSave={async (value) => {
            await renameSession(session.id, value.trim() ? value.trim() : null);
            setRenameOpen(false);
          }}
        />
      )}
    </header>
  );
}

function ViewToggle({
  terminalOpen,
  onToggle,
}: {
  terminalOpen: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const tabs = [
    { key: false, icon: <MessageSquareText size={14} />, label: t("conv.viewMessages") },
    { key: true,  icon: <Terminal size={14} />,          label: t("conv.viewTerminal") },
  ] as const;
  return (
    <div
      className="flex items-center overflow-hidden rounded-lg"
      style={{ border: "1px solid var(--border)", background: "var(--surface-card)" }}
    >
      {tabs.map(({ key, icon, label }) => {
        const active = terminalOpen === key;
        return (
          <button
            key={String(key)}
            onClick={() => { if (!active) onToggle(); }}
            aria-label={label}
            title={label}
            className="flex h-8 items-center gap-1.5 px-2.5 text-[12px] font-medium transition-colors"
            style={{
              color: active ? "var(--accent)" : "var(--text-secondary)",
              background: active ? "var(--accent-soft)" : "transparent",
            }}
            onMouseEnter={(e) => {
              if (!active) e.currentTarget.style.background = "var(--surface-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = active ? "var(--accent-soft)" : "transparent";
            }}
          >
            {icon}
            <span className="hidden sm:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

function SessionMenu({
  open,
  onOpen,
  onClose,
  isArchived,
  onRename,
  onToggleArchive,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  isArchived: boolean;
  onRename: () => void;
  onToggleArchive: () => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => (open ? onClose() : onOpen())}
        aria-label={t("conv.menu")}
        title={t("conv.menu")}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-9 w-9 items-center justify-center rounded-lg"
        style={{
          color: open ? "var(--text)" : "var(--text-secondary)",
          background: open ? "var(--surface-hover)" : "var(--surface-card)",
          border: "1px solid var(--border)",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--surface-hover)";
          e.currentTarget.style.borderColor = "var(--border-strong)";
        }}
        onMouseLeave={(e) => {
          if (!open) e.currentTarget.style.background = "var(--surface-card)";
          e.currentTarget.style.borderColor = "var(--border)";
        }}
      >
        <MoreVertical size={16} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1.5 min-w-[160px] overflow-hidden rounded-xl py-1"
          style={{
            background: "var(--surface-card)",
            border: "1px solid var(--border)",
            boxShadow: "var(--shadow-2)",
            animation: "fade-in 120ms ease-out both",
          }}
        >
          <MenuItem icon={<Pencil size={14} />} label={t("conv.rename")} onClick={onRename} />
          <MenuItem
            icon={isArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
            label={isArchived ? t("conv.unarchive") : t("conv.archive")}
            onClick={onToggleArchive}
          />
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-3 py-2 text-[13px] transition-colors"
      style={{ color: "var(--text)", background: "transparent" }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--surface-hover)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <span style={{ color: "var(--text-muted)" }}>{icon}</span>
      {label}
    </button>
  );
}
