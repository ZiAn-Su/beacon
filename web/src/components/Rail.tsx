import { BookUser, MessageSquare, Settings } from "lucide-react";
import { useI18n } from "../lib/i18n";

type View = "chats" | "contacts";

interface Props {
  onOpenSettings: () => void;
  view: View;
  onChangeView: (v: View) => void;
  /** Total unread, shown as a dot on the Chats nav icon. */
  unread?: number;
}

export function Rail({ onOpenSettings, view, onChangeView, unread = 0 }: Props) {
  const { t } = useI18n();
  return (
    <aside
      className="hidden md:flex w-14 shrink-0 flex-col items-center justify-between border-r py-4"
      style={{ borderColor: "var(--border)", background: "var(--bg)" }}
    >
      <div className="flex flex-col items-center gap-3">
        <BrandMark />
        <NavButton
          active={view === "chats"}
          onClick={() => onChangeView("chats")}
          label={t("nav.chats")}
          badge={unread > 0}
        >
          <MessageSquare size={18} />
        </NavButton>
        <NavButton
          active={view === "contacts"}
          onClick={() => onChangeView("contacts")}
          label={t("nav.contacts")}
        >
          <BookUser size={18} />
        </NavButton>
      </div>
      <div className="flex flex-col items-center gap-3">
        <button
          onClick={onOpenSettings}
          aria-label={t("settings.title")}
          title={t("settings.title")}
          className="flex h-9 w-9 items-center justify-center rounded-lg transition-colors duration-150"
          style={{
            color: "var(--text-secondary)",
            background: "transparent",
            border: "1px solid transparent",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--surface-hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          <Settings size={17} />
        </button>
      </div>
    </aside>
  );
}

function NavButton({
  active,
  onClick,
  label,
  badge,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  badge?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className="relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors duration-150"
      style={{
        color: active ? "var(--accent)" : "var(--text-secondary)",
        background: active ? "var(--accent-soft)" : "transparent",
        border: "1px solid transparent",
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = "var(--surface-hover)";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      }}
    >
      {children}
      {badge && (
        <span
          className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full"
          style={{ background: "var(--accent)", boxShadow: "0 0 0 2px var(--bg)" }}
          aria-hidden
        />
      )}
    </button>
  );
}

function BrandMark() {
  return (
    <div
      className="relative flex h-9 w-9 items-center justify-center rounded-xl"
      style={{
        background: "var(--surface-card)",
        color: "var(--text)",
        border: "1px solid var(--border)",
      }}
      aria-label="Beacon"
      title="Beacon"
    >
      <span
        className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full"
        style={{ background: "var(--accent)" }}
        aria-hidden
      />
      <svg width="18" height="18" viewBox="0 0 32 32" fill="none">
        <path
          d="M8.5 11.2c0-1 .8-1.8 1.8-1.8h3.4a3.6 3.6 0 0 1 0 7.2H10.3v4.6a1.8 1.8 0 1 1-3.6 0v-10Zm1.8.6v2.4h3.4a1.2 1.2 0 1 0 0-2.4h-3.4Z"
          fill="currentColor"
        />
        <circle cx="22.4" cy="10.4" r="2.1" fill="currentColor" />
      </svg>
    </div>
  );
}
