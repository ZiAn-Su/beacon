import { useCallback, useEffect, useMemo, useState } from "react";
import { BookUser, MessageSquare, Search, Trash2, User } from "lucide-react";
import type { Session, TrustTier } from "../types";
import {
  createGrant,
  deleteGrant,
  listContactRequests,
  listGrants,
  type ContactRequest,
  type Grant,
} from "../lib/api";
import { Avatar } from "./Avatar";
import { isOnline, isVisibleScope, pathBase, sessionName } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { useStore } from "../lib/store";

const TRUST_TIERS: TrustTier[] = ["restricted", "standard", "trusted", "autonomous"];

const STATUS_COLOR: Record<Session["status"], string> = {
  registered: "var(--color-registered)",
  working: "var(--color-working)",
  waiting: "var(--color-waiting)",
  idle: "var(--color-idle)",
  done: "var(--color-done)",
};

interface Props {
  sessions: Session[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Jump to the chat view for this contact (the "Message" action). */
  onMessage: (id: string) => void;
  /** Open the authorization-overview dialog (the "Manage directory" action). */
  onOpenManage: () => void;
}

export function ContactsView({ sessions, selectedId, onSelect, onMessage, onOpenManage }: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const active = useMemo(
    () => sessions.filter((s) => s.archivedAt == null),
    [sessions],
  );
  const archived = useMemo(
    () => sessions.filter((s) => s.archivedAt != null),
    [sessions],
  );

  const filter = (list: Session[]) => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((s) => {
      const name = sessionName(s, pathBase(s.workPath) || s.runtime).toLowerCase();
      return (
        name.includes(q) ||
        s.runtime.toLowerCase().includes(q) ||
        s.workPath.toLowerCase().includes(q)
      );
    });
  };

  const rosterActive = filter(active).sort((a, b) => b.updatedAt - a.updatedAt);
  const rosterArchived = filter(archived).sort((a, b) => b.updatedAt - a.updatedAt);

  const selected = useMemo(
    () => sessions.find((s) => s.id === selectedId) ?? null,
    [sessions, selectedId],
  );

  return (
    <div className="flex h-full min-w-0 flex-1">
      {/* Left: roster */}
      <div
        className="flex h-full w-full flex-col md:w-[280px] md:shrink-0 md:border-r"
        style={{ borderColor: "var(--border)", background: "var(--bg-sidebar)" }}
      >
        <div className="px-3 pt-3">
          <div
            className="flex items-center gap-2 rounded-lg px-2.5 py-1.5"
            style={{ background: "var(--surface-card)", border: "1px solid var(--border)" }}
          >
            <Search size={13} style={{ color: "var(--text-muted)" }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("contactsView.search")}
              className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none"
              style={{ color: "var(--text)" }}
            />
          </div>
          <button
            onClick={onOpenManage}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-[12.5px] font-semibold transition-colors"
            style={{ background: "var(--surface-card)", color: "var(--text)", border: "1px solid var(--border)" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-hover)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "var(--surface-card)"; }}
          >
            <BookUser size={13} />
            {t("contactsView.manage")}
          </button>
        </div>

        <div className="scroll-area mt-2 flex-1 overflow-y-auto px-2 pb-2">
          <RosterSection
            title={t("contactsView.agents", { n: rosterActive.length })}
            list={rosterActive}
            selectedId={selectedId}
            onSelect={onSelect}
            emptyLabel={t("contactsView.empty")}
          />
          {rosterArchived.length > 0 && (
            <div className="mt-2">
              <button
                onClick={() => setShowArchived((v) => !v)}
                className="px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--text-muted)" }}
              >
                {showArchived
                  ? t("contactsView.hideArchived")
                  : t("contactsView.showArchived", { n: rosterArchived.length })}
              </button>
              {showArchived && (
                <RosterSection
                  list={rosterArchived}
                  selectedId={selectedId}
                  onSelect={onSelect}
                  dim
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right: profile detail */}
      <div className="hidden min-w-0 flex-1 md:flex">
        {selected ? (
          <ContactProfile session={selected} onMessage={onMessage} sessions={active} />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center">
            <div
              className="flex h-12 w-12 items-center justify-center rounded-2xl"
              style={{ background: "var(--surface-card)", border: "1px solid var(--border)", color: "var(--text-muted)" }}
            >
              <User size={22} />
            </div>
            <div className="text-[14px] font-semibold text-strong">{t("contactsView.pickTitle")}</div>
            <div className="max-w-[260px] text-[12.5px]" style={{ color: "var(--text-muted)" }}>
              {t("contactsView.pickDesc")}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RosterSection({
  title,
  list,
  selectedId,
  onSelect,
  emptyLabel,
  dim,
}: {
  title?: string;
  list: Session[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  emptyLabel?: string;
  dim?: boolean;
}) {
  return (
    <div className={dim ? "opacity-75" : undefined}>
      {title && (
        <div
          className="px-2 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--text-muted)" }}
        >
          {title}
        </div>
      )}
      {emptyLabel && list.length === 0 ? (
        <div className="px-2 py-4 text-[12px]" style={{ color: "var(--text-muted)" }}>
          {emptyLabel}
        </div>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {list.map((s) => {
            const label = pathBase(s.workPath) || s.runtime;
            const title = sessionName(s, label);
            const online = isOnline(s, Date.now());
            const active = selectedId === s.id;
            return (
              <li key={s.id}>
                <button
                  onClick={() => onSelect(s.id)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors"
                  style={{ background: active ? "var(--accent-soft)" : "transparent" }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "var(--surface-hover)"; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
                >
                  <div className="relative shrink-0">
                    <Avatar id={s.id} label={label} size={32} />
                    <span
                      className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full"
                      style={{
                        background: online ? STATUS_COLOR[s.status] : "var(--text-muted)",
                        boxShadow: "0 0 0 2px var(--bg-sidebar)",
                      }}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div
                      className="truncate text-[13px] font-medium"
                      style={{ color: active ? "var(--accent)" : "var(--text)" }}
                    >
                      {title}
                    </div>
                    <div className="truncate text-[11px]" style={{ color: "var(--text-muted)" }}>
                      {s.runtime}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ContactProfile({
  session,
  onMessage,
  sessions,
}: {
  session: Session;
  onMessage: (id: string) => void;
  sessions: Session[];
}) {
  const { t } = useI18n();
  const { setSessionTrustTier } = useStore();
  const label = pathBase(session.workPath) || session.runtime;
  const title = sessionName(session, label);
  const online = isOnline(session, Date.now());
  const tier = session.trustTier ?? "standard";

  const [grants, setGrants] = useState<Grant[]>([]);
  const [requests, setRequests] = useState<ContactRequest[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [g, r] = await Promise.all([listGrants(), listContactRequests()]);
      setGrants(g);
      setRequests(r);
    } catch { /* keep prior */ }
  }, []);
  useEffect(() => { void refresh(); }, [refresh, session.id]);

  // This contact's address book: every agent it can reach or could request —
  // i.e. in its visible scope (same working directory) or already wired by a
  // grant/pending request. Each carries a status the guardian can act on.
  type PeerStatus = "allow" | "deny" | "pending" | "open";
  const book: { peer: Session; status: PeerStatus; grantId?: string }[] = [];
  for (const peer of sessions) {
    if (peer.id === session.id) continue;
    const g = grants.find((x) => x.fromId === session.id && x.toId === peer.id);
    const pending = requests.some(
      (r) => r.fromId === session.id && r.toId === peer.id && r.status === "pending",
    );
    if (g) book.push({ peer, status: g.effect, grantId: g.id });
    else if (pending) book.push({ peer, status: "pending" });
    else if (isVisibleScope(session.workPath, peer.workPath)) book.push({ peer, status: "open" });
    // else: outside visible scope and no link -> not in the address book
  }
  book.sort((a, b) => sessionName(a.peer, "").localeCompare(sessionName(b.peer, "")));

  const setEdge = async (toId: string, effect: "allow" | "deny") => {
    setBusy(true);
    try { await createGrant(session.id, toId, effect); await refresh(); }
    catch { /* ignore */ } finally { setBusy(false); }
  };
  const clearEdge = async (grantId: string) => {
    setBusy(true);
    try { await deleteGrant(grantId); await refresh(); }
    catch { /* ignore */ } finally { setBusy(false); }
  };

  return (
    <div className="flex h-full w-full flex-col" style={{ background: "var(--bg)" }}>
      <div className="scroll-area flex-1 overflow-y-auto">
        {/* Header card */}
        <div className="px-8 pt-10">
          <div className="flex items-center gap-4">
            <Avatar id={session.id} label={label} size={56} />
            <div className="min-w-0">
              <h2 className="truncate text-[18px] font-semibold text-strong" title={title}>
                {title}
              </h2>
              <div className="mt-1 flex items-center gap-2 text-[12px]" style={{ color: "var(--text-muted)" }}>
                <span
                  className="rounded px-1.5 py-0.5 font-semibold uppercase tracking-wide"
                  style={{ color: "var(--text-secondary)", background: "var(--surface-card)", border: "1px solid var(--border)" }}
                >
                  {session.runtime}
                </span>
                <span className="flex items-center gap-1">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: online ? STATUS_COLOR[session.status] : "var(--text-muted)" }}
                  />
                  {t(`status.${session.status}`)} · {online ? t("presence.running") : t("presence.notRunning")}
                </span>
              </div>
            </div>
          </div>

          <div className="my-6 h-px w-full" style={{ background: "var(--border)" }} />

          {/* Field rows */}
          <Field label={t("profile.workdir")}>
            <span className="break-all font-mono text-[12.5px]" style={{ color: session.workPath ? "var(--text)" : "var(--text-muted)" }}>
              {session.workPath || t("profile.pathNotSet")}
            </span>
          </Field>
          <Field label={t("profile.origin")}>
            <span className="text-[13px]" style={{ color: "var(--text)" }}>
              {session.origin === "human" ? t("profile.originHuman") : t("profile.originAgent")}
            </span>
          </Field>
          {session.nativeSessionId && (
            <Field label={t("profile.sessionId")}>
              <code
                className="break-all text-[12px]"
                style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}
                title={session.nativeSessionId}
              >
                {session.nativeSessionId}
              </code>
            </Field>
          )}

          {/* Trust tier */}
          <Field label={t("profile.trust")}>
            <div className="flex min-w-0 flex-col gap-1.5">
              <div className="flex flex-wrap gap-1.5">
                {TRUST_TIERS.map((tt) => {
                  const a = tier === tt;
                  return (
                    <button
                      key={tt}
                      onClick={() => void setSessionTrustTier(session.id, tt)}
                      title={t(`trust.${tt}Desc`)}
                      className="rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors"
                      style={{
                        color: a ? "#fff" : "var(--text-secondary)",
                        background: a ? "var(--accent)" : "var(--surface-card)",
                        border: `1px solid ${a ? "var(--accent)" : "var(--border)"}`,
                      }}
                    >
                      {t(`trust.${tt}`)}
                    </button>
                  );
                })}
              </div>
              <span className="text-[11.5px]" style={{ color: "var(--text-muted)" }}>
                {t("profile.trustHint")}
              </span>
            </div>
          </Field>

          {/* Its address book: who it can reach / request, with status + actions. */}
          <Field label={t("profile.contacts")} top>
            <div className="flex min-w-0 flex-col gap-2">
              {book.length === 0 ? (
                <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>
                  {t("profile.noContacts")}
                </span>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {book.map(({ peer, status, grantId }) => (
                    <li
                      key={peer.id}
                      className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px]"
                      style={{ background: "var(--surface-card)", border: "1px solid var(--border)" }}
                    >
                      <Avatar id={peer.id} label={pathBase(peer.workPath) || peer.runtime} size={22} />
                      <span className="min-w-0 flex-1 truncate" style={{ color: "var(--text)" }}>
                        {sessionName(peer, pathBase(peer.workPath) || peer.runtime)}
                      </span>
                      <StatusPill status={status} />
                      <div className="flex shrink-0 items-center gap-1">
                        {status === "allow" || status === "deny" ? (
                          <button
                            disabled={busy}
                            onClick={() => void clearEdge(grantId!)}
                            aria-label={t("dir.removeGrant")}
                            title={t("dir.removeGrant")}
                            className="flex h-5 w-5 items-center justify-center rounded disabled:opacity-40"
                            style={{ color: "var(--text-muted)" }}
                          >
                            <Trash2 size={12} />
                          </button>
                        ) : status === "open" ? (
                          <>
                            <button
                              disabled={busy}
                              onClick={() => void setEdge(peer.id, "allow")}
                              className="rounded px-1.5 py-0.5 text-[10.5px] font-semibold disabled:opacity-40"
                              style={{ color: "#fff", background: "var(--accent)", border: "1px solid var(--accent)" }}
                            >
                              {t("dir.allow")}
                            </button>
                            <button
                              disabled={busy}
                              onClick={() => void setEdge(peer.id, "deny")}
                              className="rounded px-1.5 py-0.5 text-[10.5px] font-semibold disabled:opacity-40"
                              style={{ color: "var(--text-secondary)", background: "var(--bg-sidebar)", border: "1px solid var(--border)" }}
                            >
                              {t("dir.deny")}
                            </button>
                          </>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                {t("profile.contactsHint")}
              </span>
            </div>
          </Field>
        </div>
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-center border-t px-8 py-4" style={{ borderColor: "var(--border)" }}>
        <button
          onClick={() => onMessage(session.id)}
          className="inline-flex items-center gap-2 rounded-xl px-6 py-2.5 text-[13.5px] font-semibold transition-colors"
          style={{ color: "#fff", background: "var(--accent)", border: "1px solid var(--accent)" }}
        >
          <MessageSquare size={15} />
          {t("profile.message")}
        </button>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: "allow" | "deny" | "pending" | "open" }) {
  const { t } = useI18n();
  const map = {
    allow: { label: t("profile.peerAllow"), color: "var(--green)" },
    deny: { label: t("profile.peerDeny"), color: "var(--danger)" },
    pending: { label: t("profile.peerPending"), color: "var(--amber)" },
    open: { label: t("profile.peerOpen"), color: "var(--text-muted)" },
  } as const;
  const m = map[status];
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium"
      style={{ color: m.color, background: "var(--bg-sidebar)", border: "1px solid var(--border)" }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.color }} />
      {m.label}
    </span>
  );
}

function Field({ label, children, top }: { label: string; children: React.ReactNode; top?: boolean }) {
  return (
    <div className="mb-4 flex gap-4">
      <div
        className={"w-20 shrink-0 text-[12.5px] " + (top ? "pt-1" : "")}
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
