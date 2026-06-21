import { useCallback, useEffect, useState } from "react";
import { Check, FolderSearch, Loader2, Plus, RefreshCw, Rocket, X } from "lucide-react";
import {
  discoverAgents,
  importAgent,
  launchAgent,
  type DiscoveredSession,
} from "../lib/api";
import { relativeTime } from "../lib/format";
import { useI18n } from "../lib/i18n";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called with the new/imported contact's id so the app can select it. */
  onAdded: (id: string) => void;
  /** Pre-fill the folder (e.g. the currently selected contact's work path). */
  defaultPath?: string;
}

// Known runtimes shown in the dropdown. The original claude-code / codex stay
// first; ccs:* runs Claude Code routed to another model (mm = minimax m3, ark =
// …). A "custom" entry reveals a text box for any other ccs:<profile>.
const KNOWN_RUNTIMES = ["claude-code", "codex", "ccs:mm", "ccs:ark"] as const;
const CUSTOM = "__custom__";
const POLL_MS = 4000;

export function AddAgentModal({ open, onClose, onAdded, defaultPath }: Props) {
  const { t } = useI18n();
  const [path, setPath] = useState(defaultPath ?? "");
  const [runtime, setRuntime] = useState<string>("claude-code");
  // When the chosen runtime isn't one of the known ones, the dropdown shows
  // "custom" and a text box edits the value directly.
  const [customMode, setCustomMode] = useState(false);
  const showCustom = customMode || !(KNOWN_RUNTIMES as readonly string[]).includes(runtime);
  const [found, setFound] = useState<DiscoveredSession[]>([]);
  const [scanning, setScanning] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newTask, setNewTask] = useState("");
  const [launching, setLaunching] = useState(false);

  // Reset the folder to the supplied default each time the modal opens.
  useEffect(() => {
    if (open) setPath(defaultPath ?? "");
  }, [open, defaultPath]);

  const scan = useCallback(async () => {
    const p = path.trim();
    if (!p) { setFound([]); return; }
    setScanning(true);
    try {
      setFound(await discoverAgents(p, runtime));
    } catch {
      setFound([]);
    } finally {
      setScanning(false);
    }
  }, [path, runtime]);

  // Debounced scan on path/runtime change, then poll for real-time updates while
  // the folder is set (new conversations appear without a manual refresh).
  useEffect(() => {
    if (!open) return;
    const p = path.trim();
    if (!p) { setFound([]); return; }
    const debounce = setTimeout(() => void scan(), 450);
    const poll = setInterval(() => void scan(), POLL_MS);
    return () => { clearTimeout(debounce); clearInterval(poll); };
  }, [open, path, runtime, scan]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const doImport = async (s: DiscoveredSession) => {
    if (s.importedAs) { onAdded(s.importedAs); return; }
    setBusyId(s.nativeSessionId);
    try {
      const session = await importAgent({
        workPath: path.trim(),
        runtime,
        nativeSessionId: s.nativeSessionId,
        name: s.title || null,
      });
      onAdded(session.id);
      await scan(); // refresh the imported flags
    } catch { /* ignore */ } finally {
      setBusyId(null);
    }
  };

  const doLaunch = async () => {
    const p = path.trim();
    if (!p) return;
    setLaunching(true);
    try {
      const session = await launchAgent({
        workPath: p,
        runtime,
        name: newName.trim() || null,
        task: newTask.trim() || null,
      });
      onAdded(session.id);
      onClose();
    } catch { /* ignore */ } finally {
      setLaunching(false);
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-agent-title"
      className="fixed inset-0 z-40 flex items-center justify-center px-4"
      style={{ background: "rgba(15, 16, 20, 0.45)", animation: "fade-in 160ms ease-out both" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative flex w-full max-w-[600px] flex-col overflow-hidden rounded-2xl"
        style={{
          background: "var(--surface-card)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow-2)",
          maxHeight: "min(86vh, 760px)",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-start gap-3">
            <div
              className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
              style={{ background: "var(--surface-card)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
            >
              <Plus size={16} />
            </div>
            <div>
              <h2 id="add-agent-title" className="text-base font-semibold text-strong">
                {t("addAgent.title")}
              </h2>
              <p className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                {t("addAgent.subtitle")}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={t("addAgent.close")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
            style={{ color: "var(--text-secondary)" }}
          >
            <X size={15} />
          </button>
        </div>

        <div className="scroll-area min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {/* Shared: folder + runtime */}
          <div className="flex flex-col gap-2.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
              {t("addAgent.folder")}
            </label>
            <div className="flex items-center gap-2">
              <div
                className="flex flex-1 items-center gap-2 rounded-lg px-2.5 py-1.5"
                style={{ background: "var(--bg-sidebar)", border: "1px solid var(--border)" }}
              >
                <FolderSearch size={14} style={{ color: "var(--text-muted)" }} />
                <input
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder={t("addAgent.folderPlaceholder")}
                  className="min-w-0 flex-1 bg-transparent font-mono text-[12.5px] outline-none"
                  style={{ color: "var(--text)" }}
                />
              </div>
              <select
                value={showCustom ? CUSTOM : runtime}
                onChange={(e) => {
                  if (e.target.value === CUSTOM) {
                    setCustomMode(true);
                    if ((KNOWN_RUNTIMES as readonly string[]).includes(runtime)) setRuntime("ccs:");
                  } else {
                    setCustomMode(false);
                    setRuntime(e.target.value);
                  }
                }}
                className="rounded-lg px-2 py-1.5 text-[12.5px] outline-none"
                style={{ background: "var(--bg-sidebar)", color: "var(--text)", border: "1px solid var(--border)" }}
              >
                {KNOWN_RUNTIMES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
                <option value={CUSTOM}>{t("addAgent.runtimeCustom")}</option>
              </select>
              {showCustom && (
                <input
                  value={runtime}
                  onChange={(e) => setRuntime(e.target.value)}
                  spellCheck={false}
                  autoFocus
                  placeholder="ccs:<profile>"
                  className="w-28 rounded-lg px-2 py-1.5 font-mono text-[12.5px] outline-none"
                  style={{ background: "var(--bg-sidebar)", color: "var(--text)", border: "1px solid var(--border)" }}
                />
              )}
            </div>
          </div>

          {/* Discover existing */}
          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                {t("addAgent.existing")}
              </span>
              <button
                onClick={() => void scan()}
                disabled={!path.trim() || scanning}
                aria-label={t("addAgent.refresh")}
                title={t("addAgent.refresh")}
                className="flex items-center gap-1 text-[11px] disabled:opacity-40"
                style={{ color: "var(--text-muted)" }}
              >
                {scanning ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              </button>
            </div>

            {!path.trim() ? (
              <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>{t("addAgent.enterFolder")}</p>
            ) : found.length === 0 ? (
              <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
                {scanning ? t("addAgent.scanning") : t("addAgent.none")}
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {found.map((s) => (
                  <li
                    key={s.nativeSessionId}
                    className="flex items-center gap-3 rounded-lg px-3 py-2"
                    style={{ background: "var(--bg-sidebar)", border: "1px solid var(--border)" }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12.5px]" style={{ color: "var(--text)" }}>
                        {s.title || t("addAgent.untitled")}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
                        <code style={{ fontFamily: "var(--font-mono)" }}>{s.nativeSessionId.slice(0, 8)}</code>
                        <span>·</span>
                        <span>{relativeTime(s.updatedAt)}</span>
                      </div>
                    </div>
                    {s.importedAs ? (
                      <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: "var(--green)" }}>
                        <Check size={12} /> {t("addAgent.imported")}
                      </span>
                    ) : (
                      <button
                        onClick={() => void doImport(s)}
                        disabled={busyId === s.nativeSessionId}
                        className="shrink-0 rounded-md px-2.5 py-1 text-[11.5px] font-semibold disabled:opacity-40"
                        style={{ color: "#fff", background: "var(--accent)", border: "1px solid var(--accent)" }}
                      >
                        {busyId === s.nativeSessionId ? t("addAgent.importing") : t("addAgent.import")}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="my-6 h-px w-full" style={{ background: "var(--border)" }} />

          {/* Create new */}
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
              {t("addAgent.createNew")}
            </span>
            <div className="mt-2 flex flex-col gap-2">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("addAgent.namePlaceholder")}
                className="rounded-lg px-3 py-2 text-[13px] outline-none"
                style={{ background: "var(--bg-sidebar)", color: "var(--text)", border: "1px solid var(--border)" }}
              />
              <input
                value={newTask}
                onChange={(e) => setNewTask(e.target.value)}
                placeholder={t("addAgent.taskPlaceholder")}
                className="rounded-lg px-3 py-2 text-[13px] outline-none"
                style={{ background: "var(--bg-sidebar)", color: "var(--text)", border: "1px solid var(--border)" }}
              />
              <button
                onClick={() => void doLaunch()}
                disabled={!path.trim() || launching}
                className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold disabled:opacity-40"
                style={{ color: "#fff", background: "var(--accent)", border: "1px solid var(--accent)" }}
              >
                {launching ? <Loader2 size={14} className="animate-spin" /> : <Rocket size={14} />}
                {t("addAgent.launch")}
              </button>
              <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{t("addAgent.launchHint")}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
