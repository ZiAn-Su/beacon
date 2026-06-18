import { useEffect, useRef, useState } from "react";
import { useI18n } from "../lib/i18n";

interface Props {
  initial: string;
  onCancel: () => void;
  onSave: (value: string) => void | Promise<void>;
}

export function RenameDialog({ initial, onCancel, onSave }: Props) {
  const { t } = useI18n();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onSave(value);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("rename.title")}
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{
        background: "rgba(15, 16, 20, 0.45)",
        animation: "fade-in 140ms ease-out both",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="w-full max-w-[420px] overflow-hidden rounded-2xl"
        style={{
          background: "var(--surface-card)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow-2)",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5">
          <h2 className="text-base font-semibold text-strong">
            {t("rename.title")}
          </h2>
          <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
            {t("rename.desc")}
          </p>
        </div>
        <div className="px-5 py-4">
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder={t("rename.placeholder")}
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{
              background: "var(--bg)",
              color: "var(--text)",
              border: "1px solid var(--border-strong)",
            }}
          />
        </div>
        <div
          className="flex items-center justify-end gap-2 border-t px-5 py-3"
          style={{ borderColor: "var(--border)" }}
        >
          <button
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors"
            style={{
              color: "var(--text-secondary)",
              background: "transparent",
              border: "1px solid var(--border)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--surface-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            {t("rename.cancel")}
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy}
            className="rounded-lg px-3.5 py-1.5 text-[13px] font-semibold transition-colors disabled:opacity-60"
            style={{
              color: "#fff",
              background: "var(--accent)",
              border: "1px solid var(--accent)",
            }}
            onMouseEnter={(e) => {
              if (!busy) e.currentTarget.style.background = "var(--accent-2)";
            }}
            onMouseLeave={(e) => {
              if (!busy) e.currentTarget.style.background = "var(--accent)";
            }}
          >
            {t("rename.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
