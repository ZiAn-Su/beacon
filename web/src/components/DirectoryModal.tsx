import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  BookUser,
  Check,
  ShieldCheck,
  ShieldX,
  Trash2,
  X,
} from "lucide-react";
import type { Session } from "../types";
import {
  createGrant,
  deleteGrant,
  listAgents,
  listGrants,
  type Grant,
} from "../lib/api";
import { Avatar } from "./Avatar";
import { isOnline, pathBase, sessionName } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { useStore } from "../lib/store";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Jump to a contact's conversation when its row is clicked. */
  onSelect?: (id: string) => void;
}

const STATUS_COLOR: Record<Session["status"], string> = {
  registered: "var(--color-registered)",
  working: "var(--color-working)",
  waiting: "var(--color-waiting)",
  idle: "var(--color-idle)",
  done: "var(--color-done)",
};

export function DirectoryModal({ open, onClose, onSelect }: Props) {
  const { t } = useI18n();
  const { deleteSession } = useStore();
  const [agents, setAgents] = useState<Session[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // Grant builder state.
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [a, g] = await Promise.all([listAgents(), listGrants()]);
      setAgents(a);
      setGrants(g);
    } catch {
      // leave whatever we had
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void refresh();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, refresh]);

  if (!open) return null;

  const active = agents.filter((a) => a.archivedAt == null);
  const archived = agents.filter((a) => a.archivedAt != null);
  const roster = showArchived ? agents : active;

  const nameOf = (id: string) => {
    const s = agents.find((a) => a.id === id);
    if (!s) return id.slice(0, 8);
    return sessionName(s, pathBase(s.workPath) || s.runtime);
  };

  const submitGrant = async (effect: "allow" | "deny") => {
    if (!fromId || !toId || fromId === toId) return;
    setBusy(true);
    try {
      await createGrant(fromId, toId, effect);
      await refresh();
    } catch {
      // ignore — keep the form as-is
    } finally {
      setBusy(false);
    }
  };

  const removeGrant = async (id: string) => {
    setBusy(true);
    try {
      await deleteGrant(id);
      setGrants((g) => g.filter((x) => x.id !== id));
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("dir.title")}
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(15,16,20,0.45)", animation: "fade-in 150ms ease-out both" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-[640px] flex-col overflow-hidden rounded-2xl"
        style={{
          background: "var(--surface-card)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow-2)",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-5 py-4"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="flex items-center gap-2.5">
            <BookUser size={16} style={{ color: "var(--text-secondary)" }} />
            <h2 className="text-base font-semibold text-strong">{t("dir.title")}</h2>
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums"
              style={{
                color: "var(--text-secondary)",
                background: "var(--bg-sidebar)",
                border: "1px solid var(--border)",
              }}
            >
              {active.length}
            </span>
          </div>
          <button
            onClick={onClose}
            aria-label={t("dir.close")}
            className="flex h-8 w-8 items-center justify-center rounded-lg"
            style={{ color: "var(--text-secondary)" }}
          >
            <X size={15} />
          </button>
        </div>

        <div className="scroll-area flex-1 overflow-y-auto px-5 py-5">
          {/* Roster */}
          <div className="mb-2.5 flex items-center justify-between">
            <div
              className="text-[10.5px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--text-muted)" }}
            >
              {t("dir.roster")}
            </div>
            {archived.length > 0 && (
              <button
                onClick={() => setShowArchived((v) => !v)}
                className="text-[11px] font-medium"
                style={{ color: "var(--text-muted)" }}
              >
                {showArchived
                  ? t("dir.hideArchived")
                  : t("dir.showArchived", { n: archived.length })}
              </button>
            )}
          </div>

          {roster.length === 0 ? (
            <div
              className="rounded-xl px-4 py-6 text-center text-[12.5px]"
              style={{ color: "var(--text-muted)", border: "1px dashed var(--border)" }}
            >
              {loading ? t("dir.loading") : t("dir.empty")}
            </div>
          ) : (
            <ul className="flex flex-col gap-1">
              {roster.map((a) => {
                const label = pathBase(a.workPath) || a.runtime;
                const title = sessionName(a, label);
                const online = isOnline(a, Date.now());
                const tier = a.trustTier ?? "standard";
                return (
                  <li key={a.id} className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        if (onSelect) {
                          onSelect(a.id);
                          onClose();
                        }
                      }}
                      className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors"
                      style={{ background: "transparent" }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "var(--surface-hover)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "transparent";
                      }}
                    >
                      <div className="relative shrink-0">
                        <Avatar id={a.id} label={label} size={34} />
                        <span
                          className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full"
                          style={{
                            background: online
                              ? STATUS_COLOR[a.status]
                              : "var(--text-muted)",
                            boxShadow: "0 0 0 2px var(--surface-card)",
                          }}
                          title={t(`status.${a.status}`)}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium text-strong">
                          {title}
                        </div>
                        <div
                          className="mt-0.5 flex items-center gap-1.5 text-[11px]"
                          style={{ color: "var(--text-muted)" }}
                        >
                          <span
                            className="rounded px-1 py-px font-semibold uppercase tracking-wide"
                            style={{
                              color: "var(--text-secondary)",
                              background: "var(--bg-sidebar)",
                              border: "1px solid var(--border)",
                            }}
                          >
                            {a.runtime}
                          </span>
                          <span className="truncate">{a.workPath || "—"}</span>
                        </div>
                      </div>
                      <span
                        className="shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium"
                        style={{
                          color: tier === "restricted" ? "var(--danger)" : "var(--text-secondary)",
                          background: "var(--bg-sidebar)",
                          border: "1px solid var(--border)",
                        }}
                        title={t("dir.trustHint")}
                      >
                        {t(`trust.${tier}`)}
                      </span>
                    </button>
                    {confirmId === a.id ? (
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          onClick={() => { void deleteSession(a.id); setConfirmId(null); }}
                          className="rounded-md px-2 py-1 text-[11px] font-semibold"
                          style={{ color: "#fff", background: "var(--danger)", border: "1px solid var(--danger)" }}
                        >
                          {t("profile.deleteYes")}
                        </button>
                        <button
                          onClick={() => setConfirmId(null)}
                          className="rounded-md px-2 py-1 text-[11px] font-medium"
                          style={{ color: "var(--text-secondary)", background: "var(--surface-card)", border: "1px solid var(--border)" }}
                        >
                          {t("profile.deleteCancel")}
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmId(a.id)}
                        aria-label={t("profile.delete")}
                        title={t("profile.delete")}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors"
                        style={{ color: "var(--text-muted)" }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--danger)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {/* Authorization (grants) */}
          <div
            className="mb-2.5 mt-7 text-[10.5px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--text-muted)" }}
          >
            {t("dir.authHeading")}
          </div>
          <p className="mb-3 text-[12px]" style={{ color: "var(--text-muted)" }}>
            {t("dir.authDesc")}
          </p>

          {/* Builder */}
          <div
            className="flex flex-col gap-2.5 rounded-xl p-3"
            style={{ background: "var(--bg-sidebar)", border: "1px solid var(--border)" }}
          >
            <div className="flex items-center gap-2">
              <AgentSelect
                value={fromId}
                onChange={setFromId}
                agents={active}
                placeholder={t("dir.fromAgent")}
              />
              <ArrowRight size={15} className="shrink-0" style={{ color: "var(--text-muted)" }} />
              <AgentSelect
                value={toId}
                onChange={setToId}
                agents={active}
                placeholder={t("dir.toAgent")}
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                disabled={busy || !fromId || !toId || fromId === toId}
                onClick={() => void submitGrant("allow")}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition-colors disabled:opacity-40"
                style={{ color: "#fff", background: "var(--accent)", border: "1px solid var(--accent)" }}
              >
                <ShieldCheck size={13} />
                {t("dir.allow")}
              </button>
              <button
                disabled={busy || !fromId || !toId || fromId === toId}
                onClick={() => void submitGrant("deny")}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition-colors disabled:opacity-40"
                style={{
                  color: "var(--text)",
                  background: "var(--surface-card)",
                  border: "1px solid var(--border)",
                }}
              >
                <ShieldX size={13} />
                {t("dir.deny")}
              </button>
            </div>
          </div>

          {/* Existing grants */}
          {grants.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1.5">
              {grants.map((g) => (
                <li
                  key={g.id}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12.5px]"
                  style={{ background: "var(--surface-card)", border: "1px solid var(--border)" }}
                >
                  <span
                    className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                    style={{
                      color: g.effect === "allow" ? "var(--green)" : "var(--danger)",
                      background: "var(--bg-sidebar)",
                    }}
                  >
                    {g.effect === "allow" ? <Check size={12} /> : <X size={12} />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    <span style={{ color: "var(--text)" }}>{nameOf(g.fromId)}</span>
                    <ArrowRight size={11} className="mx-1 inline" style={{ color: "var(--text-muted)" }} />
                    <span style={{ color: "var(--text)" }}>{nameOf(g.toId)}</span>
                  </span>
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
                    style={{
                      color: g.effect === "allow" ? "var(--green)" : "var(--danger)",
                      background: "var(--bg-sidebar)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    {g.effect === "allow" ? t("dir.allow") : t("dir.deny")}
                  </span>
                  <button
                    disabled={busy}
                    onClick={() => void removeGrant(g.id)}
                    aria-label={t("dir.removeGrant")}
                    title={t("dir.removeGrant")}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md disabled:opacity-40"
                    style={{ color: "var(--text-muted)" }}
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between border-t px-5 py-3"
          style={{ borderColor: "var(--border)" }}
        >
          <span className="text-[11.5px]" style={{ color: "var(--text-muted)" }}>
            {t("dir.footer")}
          </span>
          <button
            onClick={onClose}
            className="rounded-lg px-3.5 py-1.5 text-[13px] font-semibold"
            style={{ color: "#fff", background: "var(--accent)", border: "1px solid var(--accent)" }}
          >
            {t("dir.done")}
          </button>
        </div>
      </div>
    </div>
  );
}

function AgentSelect({
  value,
  onChange,
  agents,
  placeholder,
}: {
  value: string;
  onChange: (id: string) => void;
  agents: Session[];
  placeholder: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-[12.5px]"
      style={{
        background: "var(--surface-card)",
        color: value ? "var(--text)" : "var(--text-muted)",
        border: "1px solid var(--border)",
      }}
    >
      <option value="">{placeholder}</option>
      {agents.map((a) => (
        <option key={a.id} value={a.id} style={{ color: "var(--text)" }}>
          {sessionName(a, pathBase(a.workPath) || a.runtime)}
        </option>
      ))}
    </select>
  );
}
