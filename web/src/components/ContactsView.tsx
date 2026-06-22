import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArchiveRestore, BookUser, Check, CheckSquare, Copy, Hash, History, MessageSquare, Pencil, Play, Plus, Search, Square, Terminal, Trash2, User, X } from "lucide-react";
import type { Channel, Session } from "../types";
import {
  createGrant,
  deleteGrant,
  listContactRequests,
  listGrants,
  listSessionChannels,
  type ContactRequest,
  type Grant,
} from "../lib/api";
import { Avatar } from "./Avatar";
import { PermissionsForAgent } from "./PermissionsForAgent";
import { absoluteTime, isOnline, isVisibleScope, pathBase, sessionName } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { useStore } from "../lib/store";

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
  /** Jump to the Channels view and open a specific group. */
  onOpenChannel?: (channelId: string) => void;
  /** Open the authorization-overview dialog (the "Manage directory" action). */
  onOpenManage: () => void;
  /** Open the "add an agent" dialog (discover existing / create new). */
  onOpenAdd: () => void;
}

export function ContactsView({ sessions, selectedId, onSelect, onMessage, onOpenChannel, onOpenManage, onOpenAdd }: Props) {
  const { t } = useI18n();
  const { batchSessions } = useStore();
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirmBatch, setConfirmBatch] = useState(false);
  const [busy, setBusy] = useState(false);

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

  // Ids currently shown (active, plus archived when expanded) — the scope that
  // "select all" and batch actions operate on.
  const visibleIds = useMemo(
    () => [...rosterActive, ...(showArchived ? rosterArchived : [])].map((s) => s.id),
    [rosterActive, rosterArchived, showArchived],
  );
  const allPicked = visibleIds.length > 0 && visibleIds.every((id) => picked.has(id));

  const togglePick = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const exitSelect = () => { setSelectMode(false); setPicked(new Set()); setConfirmBatch(false); };
  const toggleAll = () =>
    setPicked(allPicked ? new Set() : new Set(visibleIds));
  const runBatch = async (action: "archive" | "delete") => {
    const ids = [...picked];
    if (!ids.length) return;
    setBusy(true);
    try { await batchSessions(ids, action); exitSelect(); }
    catch { /* ignore */ } finally { setBusy(false); }
  };

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
            onClick={onOpenAdd}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-[12.5px] font-semibold transition-colors"
            style={{ background: "var(--accent)", color: "#fff", border: "1px solid var(--accent)" }}
          >
            <Plus size={14} />
            {t("contactsView.add")}
          </button>
          <button
            onClick={onOpenManage}
            className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-[12.5px] font-semibold transition-colors"
            style={{ background: "var(--surface-card)", color: "var(--text)", border: "1px solid var(--border)" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-hover)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "var(--surface-card)"; }}
          >
            <BookUser size={13} />
            {t("contactsView.manage")}
          </button>

          {/* Batch-select toggle / controls */}
          {!selectMode ? (
            <button
              onClick={() => setSelectMode(true)}
              className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg py-1 text-[11.5px] font-medium transition-colors"
              style={{ color: "var(--text-muted)" }}
            >
              <CheckSquare size={12} />
              {t("contactsView.select")}
            </button>
          ) : (
            <div className="mt-1.5 flex items-center justify-between px-0.5 text-[11.5px]">
              <button onClick={toggleAll} className="font-medium" style={{ color: "var(--accent)" }}>
                {allPicked ? t("contactsView.selectNone") : t("contactsView.selectAll")}
              </button>
              <span style={{ color: "var(--text-muted)" }}>{t("contactsView.pickedN", { n: picked.size })}</span>
              <button onClick={exitSelect} className="font-medium" style={{ color: "var(--text-secondary)" }}>
                {t("contactsView.selectDone")}
              </button>
            </div>
          )}
        </div>

        <div className="scroll-area mt-2 flex-1 overflow-y-auto px-2 pb-2">
          <RosterSection
            title={t("contactsView.agents", { n: rosterActive.length })}
            list={rosterActive}
            selectedId={selectedId}
            onSelect={onSelect}
            emptyLabel={t("contactsView.empty")}
            selectMode={selectMode}
            picked={picked}
            onTogglePick={togglePick}
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
                  selectMode={selectMode}
                  picked={picked}
                  onTogglePick={togglePick}
                />
              )}
            </div>
          )}
        </div>

        {/* Batch action bar */}
        {selectMode && (
          <div className="border-t px-3 py-2.5" style={{ borderColor: "var(--border)", background: "var(--surface-card)" }}>
            {confirmBatch ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px]" style={{ color: "var(--danger)" }}>
                  {t("contactsView.confirmDeleteN", { n: picked.size })}
                </span>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    disabled={busy}
                    onClick={() => void runBatch("delete")}
                    className="rounded-md px-2.5 py-1 text-[12px] font-semibold disabled:opacity-40"
                    style={{ color: "#fff", background: "var(--danger)", border: "1px solid var(--danger)" }}
                  >
                    {t("profile.deleteYes")}
                  </button>
                  <button
                    onClick={() => setConfirmBatch(false)}
                    className="rounded-md px-2.5 py-1 text-[12px] font-medium"
                    style={{ color: "var(--text-secondary)", background: "var(--bg-sidebar)", border: "1px solid var(--border)" }}
                  >
                    {t("profile.deleteCancel")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  disabled={busy || picked.size === 0}
                  onClick={() => void runBatch("archive")}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-[12.5px] font-semibold transition-colors disabled:opacity-40"
                  style={{ color: "var(--text)", background: "var(--bg-sidebar)", border: "1px solid var(--border)" }}
                >
                  <Archive size={13} />
                  {t("contactsView.archiveN", { n: picked.size })}
                </button>
                <button
                  disabled={busy || picked.size === 0}
                  onClick={() => setConfirmBatch(true)}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-[12.5px] font-semibold transition-colors disabled:opacity-40"
                  style={{ color: "var(--danger)", background: "var(--bg-sidebar)", border: "1px solid var(--border)" }}
                >
                  <Trash2 size={13} />
                  {t("contactsView.deleteN", { n: picked.size })}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right: profile detail */}
      <div className="hidden min-w-0 flex-1 md:flex">
        {selected ? (
          <ContactProfile session={selected} onMessage={onMessage} onOpenChannel={onOpenChannel} sessions={active} />
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
  selectMode,
  picked,
  onTogglePick,
}: {
  title?: string;
  list: Session[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  emptyLabel?: string;
  dim?: boolean;
  selectMode?: boolean;
  picked?: Set<string>;
  onTogglePick?: (id: string) => void;
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
            const isPicked = !!picked?.has(s.id);
            const active = selectMode ? isPicked : selectedId === s.id;
            return (
              <li key={s.id}>
                <button
                  onClick={() => (selectMode ? onTogglePick?.(s.id) : onSelect(s.id))}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors"
                  style={{ background: active ? "var(--accent-soft)" : "transparent" }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "var(--surface-hover)"; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
                >
                  {selectMode && (
                    <span className="shrink-0" style={{ color: isPicked ? "var(--accent)" : "var(--text-muted)" }}>
                      {isPicked ? <CheckSquare size={16} /> : <Square size={16} />}
                    </span>
                  )}
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

export function ContactProfile({
  session,
  onMessage,
  onOpenChannel,
  sessions,
  now,
}: {
  session: Session;
  /** When provided, shows a "Message" action (Contacts page); omit in the chat panel. */
  onMessage?: (id: string) => void;
  /** Jump to a group this contact belongs to. */
  onOpenChannel?: (channelId: string) => void;
  sessions: Session[];
  now?: number;
}) {
  const { t, rel } = useI18n();
  const { renameSession, setSessionDescription, setArchived, deleteSession } = useStore();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [memberChannels, setMemberChannels] = useState<Channel[]>([]);
  const nowMs = now ?? Date.now();
  const label = pathBase(session.workPath) || session.runtime;
  const title = sessionName(session, label);
  const online = isOnline(session, nowMs);
  // Show the current task as a subtitle only when a distinct display name exists
  // (otherwise the name already *is* the task and we'd print it twice).
  const taskLine = session.task?.trim();
  const showTask = !!taskLine && taskLine !== title;

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
  useEffect(() => { void refresh(); setConfirmDelete(false); }, [refresh, session.id]);

  // The groups this contact belongs to (its joined-channels entry points).
  useEffect(() => {
    let live = true;
    setMemberChannels([]);
    listSessionChannels(session.id)
      .then((cs) => { if (live) setMemberChannels(cs); })
      .catch(() => { /* keep empty */ });
    return () => { live = false; };
  }, [session.id]);

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
          <div className="flex items-start gap-4">
            <Avatar id={session.id} label={label} size={56} />
            <div className="min-w-0 flex-1">
              <NameEditor
                key={session.id}
                value={session.title ?? ""}
                display={title}
                placeholder={t("profile.namePlaceholder")}
                editLabel={t("profile.editName")}
                onSave={(v) => void renameSession(session.id, v)}
              />
              {showTask && (
                <div className="mt-0.5 truncate text-[12.5px]" style={{ color: "var(--text-secondary)" }} title={taskLine}>
                  {taskLine}
                </div>
              )}
              <div className="mt-1.5 flex items-center gap-2 text-[12px]" style={{ color: "var(--text-muted)" }}>
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

          {/* Self-introduction: who this agent is, so peers can decide to reach out. */}
          <AboutEditor
            key={"about-" + session.id}
            value={session.description ?? ""}
            placeholder={t("profile.aboutPlaceholder")}
            editLabel={t("profile.editAbout")}
            heading={t("profile.about")}
            onSave={(v) => void setSessionDescription(session.id, v)}
          />

          <div className="my-6 h-px w-full" style={{ background: "var(--border)" }} />

          {/* Identity metadata — compact key/value rows. */}
          <Field label={t("profile.agentId")}>
            <CopyId value={session.id} copiedLabel={t("profile.copied")} copyLabel={t("profile.copy")} mono />
          </Field>
          <Field label={t("profile.sessionId")}>
            {session.nativeSessionId ? (
              <CopyId value={session.nativeSessionId} copiedLabel={t("profile.copied")} copyLabel={t("profile.copy")} mono />
            ) : (
              <span className="text-[12.5px]" style={{ color: "var(--text-muted)" }}>
                {t("profile.sessionIdMissing")}
              </span>
            )}
          </Field>
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

          <div className="my-6 h-px w-full" style={{ background: "var(--border)" }} />

          {/* Per-agent permissions: effective effect + override per capability. */}
          <Section title={t("profile.permissions")}>
            <PermissionsForAgent sessionId={session.id} />
          </Section>

          {/* Its address book: who it can reach / request, with status + actions. */}
          <Section title={t("profile.contacts")}>
            {book.length === 0 ? (
              <p className="text-[12.5px]" style={{ color: "var(--text-muted)" }}>
                {t("profile.noContacts")}
              </p>
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
            <p className="mt-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
              {t("profile.contactsHint")}
            </p>
          </Section>

          {/* Group channels this agent belongs to — a jump-in entry per group. */}
          <Section title={t("profile.channels")}>
            {memberChannels.length === 0 ? (
              <p className="text-[12.5px]" style={{ color: "var(--text-muted)" }}>
                {t("profile.noChannels")}
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {memberChannels.map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => onOpenChannel?.(c.id)}
                      disabled={!onOpenChannel}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] transition-colors disabled:cursor-default"
                      style={{ background: "var(--surface-card)", border: "1px solid var(--border)", color: "var(--text)" }}
                      onMouseEnter={(e) => { if (onOpenChannel) e.currentTarget.style.background = "var(--surface-hover)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "var(--surface-card)"; }}
                    >
                      <span
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                        style={{ background: "var(--bg-sidebar)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
                      >
                        <Hash size={13} />
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                      {onOpenChannel && (
                        <span className="shrink-0 text-[11px]" style={{ color: "var(--accent)" }}>
                          {t("profile.openChannel")}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* Timeline */}
          <Section title={t("info.timeline")}>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-3 text-[12.5px]">
                <span className="inline-flex items-center gap-1.5" style={{ color: "var(--text-secondary)" }}>
                  <Play size={12} style={{ color: "var(--text-muted)" }} /> {t("info.started")}
                </span>
                <span className="tabular-nums" style={{ color: "var(--text)" }} title={absoluteTime(session.createdAt)}>
                  {rel(session.createdAt, nowMs)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 text-[12.5px]">
                <span className="inline-flex items-center gap-1.5" style={{ color: "var(--text-secondary)" }}>
                  <History size={12} style={{ color: "var(--text-muted)" }} /> {t("info.updated")}
                </span>
                <span className="tabular-nums" style={{ color: "var(--text)" }} title={absoluteTime(session.updatedAt)}>
                  {rel(session.updatedAt, nowMs)}
                </span>
              </div>
            </div>
          </Section>

          {/* Capabilities */}
          <Section title={t("info.capabilities")}>
            <div className="text-[12.5px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
              register · notify · ask · status · inbox
            </div>
          </Section>

          {/* Open / resume the agent's session in a terminal */}
          {session.workPath && (
            <Section title={t("info.openSession")}>
              <OpenSessionRow session={session} />
            </Section>
          )}

          {/* Management: archive (reversible) and delete (permanent). */}
          <Section title={t("profile.manage")}>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => void setArchived(session.id, session.archivedAt == null)}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors"
                style={{ color: "var(--text)", background: "var(--surface-card)", border: "1px solid var(--border)" }}
              >
                {session.archivedAt == null ? <Archive size={13} /> : <ArchiveRestore size={13} />}
                {session.archivedAt == null ? t("profile.archive") : t("profile.unarchive")}
              </button>

              {confirmDelete ? (
                <div className="inline-flex items-center gap-1.5">
                  <span className="text-[12px]" style={{ color: "var(--danger)" }}>{t("profile.deleteConfirm")}</span>
                  <button
                    onClick={() => void deleteSession(session.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold"
                    style={{ color: "#fff", background: "var(--danger)", border: "1px solid var(--danger)" }}
                  >
                    <Trash2 size={13} />
                    {t("profile.deleteYes")}
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="rounded-lg px-3 py-1.5 text-[12.5px] font-medium"
                    style={{ color: "var(--text-secondary)", background: "var(--surface-card)", border: "1px solid var(--border)" }}
                  >
                    {t("profile.deleteCancel")}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors"
                  style={{ color: "var(--danger)", background: "var(--surface-card)", border: "1px solid var(--border)" }}
                >
                  <Trash2 size={13} />
                  {t("profile.delete")}
                </button>
              )}
            </div>
            <p className="mt-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
              {t("profile.deleteHint")}
            </p>
          </Section>
        </div>
      </div>

      {/* Action bar — only on the Contacts page (in the chat panel you're already here). */}
      {onMessage && (
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
      )}
    </div>
  );
}

function resumeCommand(session: {
  runtime: string;
  workPath: string;
  nativeSessionId?: string | null;
}): string {
  const sid = session.nativeSessionId;
  if (session.runtime === "claude-code" || session.runtime === "claude") {
    return `cd "${session.workPath}" && claude ${sid ? `--resume ${sid}` : "--continue"}`;
  }
  if (session.runtime === "codex") {
    return `cd "${session.workPath}" && codex${sid ? ` resume ${sid}` : ""}`;
  }
  return `cd "${session.workPath}"`;
}

function OpenSessionRow({
  session,
}: {
  session: { runtime: string; workPath: string; nativeSessionId?: string | null };
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const cmd = resumeCommand(session);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11.5px]" style={{ color: "var(--text-muted)" }}>
        {t("info.openSessionDesc")}
      </p>
      <div
        className="flex items-center gap-2 rounded-lg px-2.5 py-2"
        style={{ background: "var(--surface-card)", border: "1px solid var(--border)" }}
      >
        <Terminal size={12} className="shrink-0" style={{ color: "var(--text-muted)" }} />
        <code
          className="min-w-0 flex-1 truncate text-[11px]"
          style={{ color: "var(--text)", fontFamily: "var(--font-mono)" }}
          title={cmd}
        >
          {cmd}
        </code>
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(cmd);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            } catch { /* ignore */ }
          }}
          aria-label={copied ? t("info.openSessionCopied") : t("info.openSession")}
          title={copied ? t("info.openSessionCopied") : t("info.openSession")}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
          style={{ color: copied ? "var(--green)" : "var(--text-muted)" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-hover)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
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
    <div className="mb-3 flex gap-4">
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

// A titled block for the interactive sections (trust, contacts) — sets them
// apart from the flat key/value metadata above with a clear heading.
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
        {title}
      </div>
      {children}
    </div>
  );
}

// Inline editor for the contact's display name. Hover reveals a pencil; clicking
// swaps the heading for an input. Empty save clears the override (reverts to the
// agent's task). `display` is what renders when not editing (already name-resolved).
function NameEditor({
  value,
  display,
  placeholder,
  editLabel,
  onSave,
}: {
  value: string;
  display: string;
  placeholder: string;
  editLabel: string;
  onSave: (v: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = () => {
    const v = draft.trim();
    onSave(v ? v : null);
    setEditing(false);
  };
  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") cancel();
        }}
        placeholder={placeholder}
        className="w-full rounded-md px-1.5 py-0.5 text-[18px] font-semibold outline-none"
        style={{ color: "var(--text)", background: "var(--surface-card)", border: "1px solid var(--accent)" }}
      />
    );
  }
  return (
    <div className="group flex items-center gap-1.5">
      <h2 className="truncate text-[18px] font-semibold text-strong" title={display}>
        {display}
      </h2>
      <button
        onClick={() => { setDraft(value); setEditing(true); }}
        aria-label={editLabel}
        title={editLabel}
        className="shrink-0 transition-colors hover:opacity-100"
        style={{ color: "var(--text-muted)" }}
      >
        <Pencil size={13} />
      </button>
    </div>
  );
}

// Self-introduction block. Shows the bio (or a muted prompt) with a hover pencil;
// editing swaps in a textarea with save / cancel.
function AboutEditor({
  value,
  placeholder,
  editLabel,
  heading,
  onSave,
}: {
  value: string;
  placeholder: string;
  editLabel: string;
  heading: string;
  onSave: (v: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  const commit = () => {
    const v = draft.trim();
    onSave(v ? v : null);
    setEditing(false);
  };
  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  return (
    <div className="mt-5">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
          {heading}
        </span>
        {!editing && (
          <button
            onClick={() => { setDraft(value); setEditing(true); }}
            aria-label={editLabel}
            title={editLabel}
            className="shrink-0"
            style={{ color: "var(--text-muted)" }}
          >
            <Pencil size={12} />
          </button>
        )}
      </div>
      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            ref={ref}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") cancel();
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit();
            }}
            placeholder={placeholder}
            rows={3}
            className="w-full resize-y rounded-lg px-3 py-2 text-[13px] leading-relaxed outline-none"
            style={{ color: "var(--text)", background: "var(--surface-card)", border: "1px solid var(--accent)" }}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={commit}
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[12px] font-semibold"
              style={{ color: "#fff", background: "var(--accent)", border: "1px solid var(--accent)" }}
            >
              <Check size={12} /> {/* save */}
            </button>
            <button
              onClick={cancel}
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[12px] font-semibold"
              style={{ color: "var(--text-secondary)", background: "var(--bg-sidebar)", border: "1px solid var(--border)" }}
            >
              <X size={12} />
            </button>
          </div>
        </div>
      ) : (
        <p
          className="whitespace-pre-wrap text-[13px] leading-relaxed"
          style={{ color: value ? "var(--text)" : "var(--text-muted)" }}
        >
          {value || placeholder}
        </p>
      )}
    </div>
  );
}

// A monospace id with a one-click copy button (the necessary peer address / the
// runtime's resume id).
function CopyId({
  value,
  copyLabel,
  copiedLabel,
  mono,
}: {
  value: string;
  copyLabel: string;
  copiedLabel: string;
  mono?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* clipboard may be blocked */ }
  };
  return (
    <div className="group flex items-center gap-2">
      <code
        className={"break-all text-[12px] " + (mono ? "" : "")}
        style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}
        title={value}
      >
        {value}
      </code>
      <button
        onClick={() => void copy()}
        aria-label={copied ? copiedLabel : copyLabel}
        title={copied ? copiedLabel : copyLabel}
        className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
        style={{ color: copied ? "var(--green)" : "var(--text-muted)" }}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  );
}
