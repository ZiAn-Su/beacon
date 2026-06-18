import { useEffect } from "react";
import { Settings as SettingsIcon, X } from "lucide-react";
import { useStore } from "../lib/store";
import { useI18n } from "../lib/i18n";
import type { AppSettings } from "../lib/api";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: Props) {
  const { t } = useI18n();
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
