import { useEffect } from "react";
import { Bell, BellOff, Languages, Moon, Settings as SettingsIcon, Sun, X } from "lucide-react";
import { useStore } from "../lib/store";
import { useI18n } from "../lib/i18n";
import type { AppSettings } from "../lib/api";

interface Props {
  open: boolean;
  onClose: () => void;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  notifPermission: "default" | "granted" | "denied" | "unsupported";
  onRequestNotifications: () => Promise<unknown>;
}

export function SettingsModal({ open, onClose, theme, onToggleTheme, notifPermission, onRequestNotifications }: Props) {
  const { t, lang, toggleLang } = useI18n();
  const { settings, updateSettings } = useStore();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const current = settings?.autoStart ?? "ask";
  const choose = (v: AppSettings["autoStart"]) => void updateSettings({ autoStart: v });

  const options: { id: AppSettings["autoStart"]; label: string; desc: string }[] = [
    { id: "ask", label: t("settings.ask"), desc: t("settings.askDesc") },
    { id: "auto", label: t("settings.auto"), desc: t("settings.autoDesc") },
    { id: "off", label: t("settings.off"), desc: t("settings.offDesc") },
  ];

  const agentComm = settings?.agentComm ?? "open";
  const chooseComm = (v: NonNullable<AppSettings["agentComm"]>) =>
    void updateSettings({ agentComm: v });
  const commOptions: { id: NonNullable<AppSettings["agentComm"]>; label: string; desc: string }[] = [
    { id: "open", label: t("settings.agentCommOpen"), desc: t("settings.agentCommOpenDesc") },
    { id: "off", label: t("settings.agentCommOff"), desc: t("settings.agentCommOffDesc") },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("settings.title")}
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(15,16,20,0.45)", animation: "fade-in 150ms ease-out both" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-[480px] overflow-hidden rounded-2xl"
        style={{
          background: "var(--surface-card)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow-2)",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between border-b px-5 py-4"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="flex items-center gap-2.5">
            <SettingsIcon size={16} style={{ color: "var(--text-secondary)" }} />
            <h2 className="text-base font-semibold text-strong">{t("settings.title")}</h2>
          </div>
          <button
            onClick={onClose}
            aria-label={t("settings.done")}
            className="flex h-8 w-8 items-center justify-center rounded-lg"
            style={{ color: "var(--text-secondary)" }}
          >
            <X size={15} />
          </button>
        </div>

        <div className="px-5 py-5">
          <div
            className="mb-2.5 text-[10.5px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--text-muted)" }}
          >
            {t("settings.offlineHeading")}
          </div>
          <div className="flex flex-col gap-2">
            {options.map((o) => {
              const active = current === o.id;
              return (
                <button
                  key={o.id}
                  onClick={() => choose(o.id)}
                  className="flex items-start gap-3 rounded-xl px-3.5 py-3 text-left transition-colors"
                  style={{
                    background: active ? "var(--accent-soft)" : "var(--surface-card)",
                    border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                  }}
                >
                  <span
                    className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
                    style={{ border: `1.5px solid ${active ? "var(--accent)" : "var(--border-strong)"}` }}
                  >
                    {active && (
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: "var(--accent)" }}
                      />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span
                      className="block text-[13.5px] font-medium"
                      style={{ color: active ? "var(--accent)" : "var(--text)" }}
                    >
                      {o.label}
                    </span>
                    <span className="mt-0.5 block text-[12px]" style={{ color: "var(--text-muted)" }}>
                      {o.desc}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div
            className="mb-2.5 mt-6 text-[10.5px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--text-muted)" }}
          >
            {t("settings.agentCommHeading")}
          </div>
          <div className="flex flex-col gap-2">
            {commOptions.map((o) => {
              const active = agentComm === o.id;
              return (
                <button
                  key={o.id}
                  onClick={() => chooseComm(o.id)}
                  className="flex items-start gap-3 rounded-xl px-3.5 py-3 text-left transition-colors"
                  style={{
                    background: active ? "var(--accent-soft)" : "var(--surface-card)",
                    border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                  }}
                >
                  <span
                    className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
                    style={{ border: `1.5px solid ${active ? "var(--accent)" : "var(--border-strong)"}` }}
                  >
                    {active && (
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: "var(--accent)" }}
                      />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span
                      className="block text-[13.5px] font-medium"
                      style={{ color: active ? "var(--accent)" : "var(--text)" }}
                    >
                      {o.label}
                    </span>
                    <span className="mt-0.5 block text-[12px]" style={{ color: "var(--text-muted)" }}>
                      {o.desc}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* Appearance + language + notifications — consolidated here from the rail. */}
          <div
            className="mb-2.5 mt-6 text-[10.5px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--text-muted)" }}
          >
            {t("settings.generalHeading")}
          </div>
          <div className="flex flex-col gap-2.5">
            <SettingRow label={t("settings.theme")}>
              <SegBtn
                active={theme === "light"}
                onClick={() => { if (theme !== "light") onToggleTheme(); }}
                icon={<Sun size={13} />}
                label={t("settings.themeLight")}
              />
              <SegBtn
                active={theme === "dark"}
                onClick={() => { if (theme !== "dark") onToggleTheme(); }}
                icon={<Moon size={13} />}
                label={t("settings.themeDark")}
              />
            </SettingRow>
            <SettingRow label={t("settings.language")}>
              <SegBtn active={lang === "zh"} onClick={() => { if (lang !== "zh") toggleLang(); }} icon={<Languages size={13} />} label={t("settings.langZh")} />
              <SegBtn active={lang === "en"} onClick={() => { if (lang !== "en") toggleLang(); }} icon={<Languages size={13} />} label={t("settings.langEn")} />
            </SettingRow>
            {notifPermission !== "unsupported" && (
              <SettingRow label={t("settings.notifications")}>
                {notifPermission === "granted" ? (
                  <span className="inline-flex items-center gap-1.5 text-[12.5px]" style={{ color: "var(--green)" }}>
                    <Bell size={13} /> {t("rail.notifOn")}
                  </span>
                ) : (
                  <button
                    onClick={() => void onRequestNotifications()}
                    disabled={notifPermission === "denied"}
                    className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12.5px] font-medium disabled:opacity-50"
                    style={{ color: "var(--text)", background: "var(--surface-card)", border: "1px solid var(--border)" }}
                  >
                    <BellOff size={13} />
                    {notifPermission === "denied" ? t("rail.notifBlocked") : t("rail.notifEnable")}
                  </button>
                )}
              </SettingRow>
            )}
          </div>
        </div>

        <div
          className="flex justify-end border-t px-5 py-3"
          style={{ borderColor: "var(--border)" }}
        >
          <button
            onClick={onClose}
            className="rounded-lg px-3.5 py-1.5 text-[13px] font-semibold"
            style={{ color: "#fff", background: "var(--accent)", border: "1px solid var(--accent)" }}
          >
            {t("settings.done")}
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-xl px-3.5 py-2.5"
      style={{ background: "var(--surface-card)", border: "1px solid var(--border)" }}
    >
      <span className="text-[13px]" style={{ color: "var(--text)" }}>{label}</span>
      <div className="flex shrink-0 items-center gap-1">{children}</div>
    </div>
  );
}

function SegBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12.5px] font-medium transition-colors"
      style={{
        color: active ? "#fff" : "var(--text-secondary)",
        background: active ? "var(--accent)" : "var(--bg-sidebar)",
        border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
      }}
    >
      {icon}
      {label}
    </button>
  );
}
