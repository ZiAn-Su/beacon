import { Bell, BellOff, Languages, Moon, Settings, Sun } from "lucide-react";
import { useI18n } from "../lib/i18n";

interface Props {
  theme: "dark" | "light";
  onToggleTheme: () => void;
  notifPermission: "default" | "granted" | "denied" | "unsupported";
  onRequestNotifications: () => Promise<unknown>;
  onOpenSettings: () => void;
}

export function Rail({
  theme,
  onToggleTheme,
  notifPermission,
  onRequestNotifications,
  onOpenSettings,
}: Props) {
  const { t, lang, toggleLang } = useI18n();
  return (
    <aside
      className="hidden md:flex w-14 shrink-0 flex-col items-center justify-between border-r py-4"
      style={{ borderColor: "var(--border)", background: "var(--bg)" }}
    >
      <div className="flex flex-col items-center gap-3">
        <BrandMark />
        {notifPermission !== "unsupported" && (
          <button
            onClick={() => void onRequestNotifications()}
            aria-label={
              notifPermission === "granted"
                ? t("rail.notifOn")
                : t("rail.notifEnable")
            }
            title={
              notifPermission === "granted"
                ? t("rail.notifOn")
                : notifPermission === "denied"
                  ? t("rail.notifBlocked")
                  : t("rail.notifEnable")
            }
            className="flex h-9 w-9 items-center justify-center rounded-lg transition-colors duration-150"
            style={{
              color:
                notifPermission === "granted"
                  ? "var(--accent)"
                  : "var(--text-secondary)",
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
            {notifPermission === "granted" ? (
              <Bell size={16} />
            ) : (
              <BellOff size={16} />
            )}
          </button>
        )}
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
        <button
          onClick={toggleLang}
          aria-label={lang === "zh" ? t("rail.langToEn") : t("rail.langToZh")}
          title={lang === "zh" ? t("rail.langToEn") : t("rail.langToZh")}
          className="relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors duration-150"
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
          <Languages size={17} />
          <span
            className="absolute -bottom-0.5 -right-0.5 rounded px-0.5 text-[8px] font-bold leading-none"
            style={{
              color: "var(--accent)",
              background: "var(--bg)",
            }}
          >
            {t("rail.langBadge")}
          </span>
        </button>
        <button
          onClick={onToggleTheme}
          aria-label={
            theme === "dark" ? t("rail.themeToLight") : t("rail.themeToDark")
          }
          title={
            theme === "dark" ? t("rail.themeToLight") : t("rail.themeToDark")
          }
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
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
    </aside>
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
