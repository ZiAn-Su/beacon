import { useEffect, useMemo, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import type { Session } from "../types";
import { Avatar } from "./Avatar";
import { useI18n } from "../lib/i18n";

interface Props {
  open: boolean;
  agents: Session[];
  onClose: () => void;
  onCreate: (name: string, participants: string[]) => Promise<void>;
}

// Create a channel: a name plus a multi-select of agents. The human (owner) is
// always implicitly a member, so the picker only covers agents.
export function CreateChannelModal({ open, agents, onClose, onCreate }: Props) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setPicked(new Set());
    setBusy(false);
    setError(null);
    const id = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const sorted = useMemo(
    () =>
      [...agents].sort((a, b) =>
        (a.title ?? a.task ?? "").localeCompare(b.title ?? b.task ?? ""),
      ),
    [agents],
  );

  if (!open) return null;

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = async () => {
    if (busy) return;
    if (!name.trim()) {
      setError(t("channels.create.nameRequired"));
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onCreate(name.trim(), [...picked]);
      onClose();
    } catch {
      setError(t("channels.create.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("channels.create.title")}
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{
        background: "rgba(15, 16, 20, 0.45)",
        animation: "fade-in 140ms ease-out both",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-[460px] flex-col overflow-hidden rounded-2xl"
        style={{
          background: "var(--surface-card)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow-2)",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-5 pt-5">
          <h2 className="text-base font-semibold text-strong">
            {t("channels.create.title")}
          </h2>
          <button
            onClick={onClose}
            aria-label={t("channels.create.close")}
            className="flex h-7 w-7 items-center justify-center rounded-lg"
            style={{ color: "var(--text-muted)" }}
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4">
          <label
            className="mb-1 block text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--text-secondary)" }}
          >
            {t("channels.create.nameLabel")}
          </label>
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder={t("channels.create.namePlaceholder")}
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{
              background: "var(--bg)",
              color: "var(--text)",
              border: `1px solid ${error ? "var(--danger)" : "var(--border-strong)"}`,
            }}
          />
          {error && (
            <p className="mt-1.5 text-[12px]" style={{ color: "var(--danger)" }}>
              {error}
            </p>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto scroll-area px-5 pb-2">
          <div
            className="mb-1 text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--text-secondary)" }}
          >
            {t("channels.create.membersLabel")}
          </div>
          <p className="mb-2 text-xs" style={{ color: "var(--text-muted)" }}>
            {t("channels.create.membersHint")}
          </p>
          {sorted.length === 0 ? (
            <p className="py-4 text-sm" style={{ color: "var(--text-muted)" }}>
              {t("channels.create.noAgents")}
            </p>
          ) : (
            <ul className="flex flex-col gap-1 pb-2">
              {sorted.map((a) => {
                const label = a.title ?? a.task ?? a.id.slice(0, 8);
                const on = picked.has(a.id);
                return (
                  <li key={a.id}>
                    <button
                      onClick={() => toggle(a.id)}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors"
                      style={{
                        background: on ? "var(--accent-soft)" : "transparent",
                        border: "1px solid transparent",
                      }}
                      onMouseEnter={(e) => {
                        if (!on) e.currentTarget.style.background = "var(--surface-hover)";
                      }}
                      onMouseLeave={(e) => {
                        if (!on) e.currentTarget.style.background = "transparent";
                      }}
                    >
                      <Avatar id={a.id} label={label} size={28} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium">
                          {label}
                        </div>
                        <div
                          className="truncate text-[11px]"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {a.task || a.workPath || a.id.slice(0, 8)}
                        </div>
                      </div>
                      <span
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
                        style={{
                          background: on ? "var(--accent)" : "transparent",
                          border: `1px solid ${on ? "var(--accent)" : "var(--border-strong)"}`,
                          color: "#fff",
                        }}
                      >
                        {on && <Check size={12} />}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div
          className="flex items-center justify-end gap-2 border-t px-5 py-3"
          style={{ borderColor: "var(--border)" }}
        >
          <button
            onClick={onClose}
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
            {t("channels.create.cancel")}
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
            {t("channels.create.submit")}
          </button>
        </div>
      </div>
    </div>
  );
}
