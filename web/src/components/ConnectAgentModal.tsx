import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Loader2, Plug, X } from "lucide-react";
import { getConnectInfo, type ConnectInfo } from "../lib/api";
import { useStore } from "../lib/store";
import { useI18n } from "../lib/i18n";

type Tab = "mcp" | "skill" | "codex" | "http";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ConnectAgentModal({ open, onClose }: Props) {
  const { t } = useI18n();
  const { sessions } = useStore();
  const [tab, setTab] = useState<Tab>("mcp");
  const [info, setInfo] = useState<ConnectInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Detect a brand-new agent connecting while the modal is open.
  const baselineCountRef = useRef<number>(0);
  useEffect(() => {
    if (open) baselineCountRef.current = sessions.length;
  }, [open, sessions.length]);

  const newSession = useMemo(() => {
    if (!open) return null;
    if (sessions.length <= baselineCountRef.current) return null;
    return sessions[sessions.length - 1] ?? null;
  }, [open, sessions]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getConnectInfo()
      .then((data) => {
        if (!cancelled) setInfo(data);
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : t("connect.error"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, t]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="connect-agent-title"
      className="fixed inset-0 z-40 flex items-center justify-center px-4"
      style={{
        background: "rgba(15, 16, 20, 0.45)",
        animation: "fade-in 160ms ease-out both",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative flex w-full max-w-[640px] flex-col overflow-hidden rounded-2xl"
        style={{
          background: "var(--surface-card)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow-2)",
          maxHeight: "min(86vh, 720px)",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-start justify-between gap-3 border-b px-5 py-4"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="flex items-start gap-3">
            <div
              className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
              style={{
                background: "var(--surface-card)",
                color: "var(--text-secondary)",
                border: "1px solid var(--border)",
              }}
            >
              <Plug size={16} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2
                  id="connect-agent-title"
                  className="text-base font-semibold text-strong"
                >
                  {t("connect.title")}
                </h2>
                {info && (
                  <span
                    className="rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums"
                    style={{
                      color: "var(--text-muted)",
                      background: "var(--surface-hover)",
                      border: "1px solid var(--border)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    v{info.version}
                  </span>
                )}
              </div>
              <p
                className="mt-0.5 text-xs"
                style={{ color: "var(--text-secondary)" }}
              >
                {t("connect.subtitle")}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={t("connect.close")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-150"
            style={{
              color: "var(--text-secondary)",
              border: "1px solid transparent",
              background: "transparent",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--surface-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <X size={15} />
          </button>
        </div>

        {/* Tabs */}
        <div
          className="flex items-center gap-1 border-b px-3"
          style={{ borderColor: "var(--border)" }}
          role="tablist"
        >
          {([
            { id: "mcp", label: "MCP" },
            { id: "skill", label: "Skill" },
            { id: "codex", label: "Codex" },
            { id: "http", label: "HTTP" },
          ] as { id: Tab; label: string }[]).map((tEntry) => {
            const active = tab === tEntry.id;
            return (
              <button
                key={tEntry.id}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(tEntry.id)}
                className="relative px-3 py-2 text-[12.5px] font-medium transition-colors duration-150"
                style={{ color: active ? "var(--text)" : "var(--text-secondary)" }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.color = "var(--text)";
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.color = "var(--text-secondary)";
                }}
              >
                {tEntry.label}
                {active && (
                  <span
                    aria-hidden
                    className="absolute inset-x-2 -bottom-px h-px"
                    style={{ background: "var(--accent)" }}
                  />
                )}
              </button>
            );
          })}
        </div>

        <div className="scroll-area min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {loading && !info && !error ? (
            <LoadingState />
          ) : error ? (
            <ErrorState message={error} />
          ) : info ? (
            <>
              {tab === "mcp" && <McpTab info={info} newSession={newSession} />}
              {tab === "skill" && <SkillTab info={info} />}
              {tab === "codex" && <CodexTab info={info} />}
              {tab === "http" && <HttpTab info={info} />}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function LoadingState() {
  const { t } = useI18n();
  return (
    <div
      className="flex h-32 items-center justify-center gap-2 text-[12.5px]"
      style={{ color: "var(--text-secondary)" }}
    >
      <Loader2 size={14} className="animate-spin" style={{ color: "var(--text-muted)" }} />
      {t("connect.loading")}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div
      className="rounded-lg px-3 py-2 text-[12.5px]"
      style={{
        color: "var(--danger)",
        background: "var(--surface-card)",
        border: "1px solid var(--border)",
      }}
    >
      {message}
    </div>
  );
}

function NewAgentBanner({ id }: { id: string }) {
  const { t } = useI18n();
  return (
    <div
      className="flex items-start gap-2 rounded-lg px-3 py-2 text-[12.5px]"
      style={{
        color: "var(--green)",
        background: "var(--color-working-soft)",
        border: "1px solid var(--border)",
      }}
    >
      <Check size={13} className="mt-0.5 shrink-0" />
      <div>
        <span style={{ color: "var(--text)" }}>{t("connect.newAgent")}</span>{" "}
        <span className="font-medium" style={{ color: "var(--text)" }}>
          {id}
        </span>
      </div>
    </div>
  );
}

function McpTab({
  info,
  newSession,
}: {
  info: ConnectInfo;
  newSession: ReturnType<typeof useStore>["sessions"][number] | null;
}) {
  const { t } = useI18n();
  const mcpJsonText = useMemo(
    () => JSON.stringify(info.mcpJson, null, 2),
    [info.mcpJson],
  );
  return (
    <div className="flex flex-col gap-5">
      {newSession && <NewAgentBanner id={newSession.id} />}

      <div>
        <SectionTitle>{t("connect.mcp.recommended")}</SectionTitle>
        <CodeBlock value={info.claudeMcpHttp} ariaLabel="claude mcp add http" />
        <p className="mt-2 text-[12.5px]" style={{ color: "var(--text-secondary)" }}>
          {t("connect.mcp.httpHint")}
        </p>
      </div>

      <Hr />

      <div>
        <SectionTitle>{t("connect.mcp.localTitle")}</SectionTitle>
        <CodeBlock value={info.claudeMcpAdd} ariaLabel="claude mcp add local" />
        <div className="mt-3">
          <SectionTitle>{t("connect.mcp.jsonTitle")}</SectionTitle>
          <CodeBlock value={mcpJsonText} ariaLabel=".mcp.json content" />
        </div>
      </div>

      <div className="text-[12px]" style={{ color: "var(--text-muted)" }}>
        {t("connect.mcp.tools")}{" "}
        <span style={{ color: "var(--text-secondary)" }}>
          {info.tools.join(" · ")}
        </span>
      </div>
    </div>
  );
}

function SkillTab({ info }: { info: ConnectInfo }) {
  const { t } = useI18n();
  const usageText = useMemo(() => info.skill.usage.join("\n"), [info.skill.usage]);
  return (
    <div className="flex flex-col gap-5">
      <div>
        <SectionTitle>{t("connect.skill.installTitle")}</SectionTitle>
        <CodeBlock value={info.skill.install} ariaLabel="install skill" />
        <p className="mt-2 text-[12px]" style={{ color: "var(--text-muted)" }}>
          {t("connect.skill.windows")}
        </p>
        <div className="mt-1">
          <CodeBlock value={info.skill.installWindows} ariaLabel="install skill on windows" />
        </div>
      </div>

      <Hr />

      <div>
        <SectionTitle>{t("connect.skill.useTitle")}</SectionTitle>
        <CodeBlock value={usageText} ariaLabel="beacon cli usage" />
      </div>

      <div className="text-[12px]" style={{ color: "var(--text-muted)" }}>
        {t("connect.capabilities")}{" "}
        <span style={{ color: "var(--text-secondary)" }}>
          register · notify · ask · status · inbox
        </span>
      </div>
    </div>
  );
}

function CodexTab({ info }: { info: ConnectInfo }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-5">
      <div>
        <SectionTitle>{t("connect.codex.httpTitle")}</SectionTitle>
        <CodeBlock value={info.codexMcpHttp} ariaLabel="codex mcp add http" />
      </div>
      <div>
        <SectionTitle>{t("connect.codex.localTitle")}</SectionTitle>
        <CodeBlock value={info.codexMcpAdd} ariaLabel="codex mcp add local" />
      </div>
      <div
        className="flex items-start gap-2 rounded-lg px-3 py-2 text-[12.5px]"
        style={{
          color: "var(--amber)",
          background: "var(--surface-card)",
          border: "1px solid var(--border)",
        }}
      >
        <span className="mt-[2px] dot" style={{ background: "var(--amber)" }} />
        <div>{t("connect.codex.warn")}</div>
      </div>
    </div>
  );
}

function HttpTab({ info }: { info: ConnectInfo }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12.5px]" style={{ color: "var(--text-secondary)" }}>
        {t("connect.http.desc")}
      </p>
      <CodeBlock value={info.httpExample} ariaLabel="HTTP example" />
      <div className="text-[12px]" style={{ color: "var(--text-muted)" }}>
        {t("connect.http.contract")}{" "}
        <span style={{ color: "var(--text-secondary)" }}>docs/connect-agent.md</span>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider"
      style={{ color: "var(--text-muted)" }}
    >
      {children}
    </div>
  );
}

function Hr() {
  return <div className="h-px w-full" style={{ background: "var(--border)" }} aria-hidden />;
}

function CodeBlock({ value, ariaLabel }: { value: string; ariaLabel: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      className="group relative overflow-hidden rounded-lg"
      style={{
        background: "var(--surface-card)",
        border: "1px solid var(--border)",
      }}
    >
      <button
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          } catch {
            // ignore
          }
        }}
        aria-label={ariaLabel}
        title={ariaLabel}
        className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md transition-colors"
        style={{
          color: copied ? "var(--green)" : "var(--text-muted)",
          background: "var(--surface-card)",
          border: "1px solid var(--border)",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--surface-hover)";
          e.currentTarget.style.color = "var(--text)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "var(--surface-card)";
          e.currentTarget.style.color = copied ? "var(--green)" : "var(--text-muted)";
        }}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
      <pre
        className="scroll-area m-0 max-h-[280px] overflow-auto px-3.5 py-3 pr-12 text-[12px] leading-relaxed"
        style={{ color: "var(--text)", fontFamily: "var(--font-mono)" }}
      >
        <code>{value}</code>
      </pre>
    </div>
  );
}
