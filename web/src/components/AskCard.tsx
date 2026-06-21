import { useState } from "react";
import { Check, HelpCircle, Rocket, UserPlus, Users, X } from "lucide-react";
import type { Message } from "../types";
import { useStore } from "../lib/store";
import { classNames, pathBase, sessionName } from "../lib/format";
import { useI18n } from "../lib/i18n";

interface Props {
  ask: Message;
  answered: boolean;
  answerText?: string;
}

export function AskCard({ ask, answered, answerText }: Props) {
  const { t } = useI18n();
  const { send, cancelAsk, sessions } = useStore();
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const options = ask.meta?.options ?? [];

  // A contact / admission / spawn request renders a localized approval card; the
  // option tokens stay 'approve' / 'deny' (what the backend matches) but the
  // buttons and copy are localized.
  const cr = ask.meta?.contactRequest;
  const adm = ask.meta?.admissionRequest;
  const sp = ask.meta?.spawnRequest;
  const approval = cr || adm || sp;
  const nameOf = (id: string) => {
    const s = sessions.find((x) => x.id === id);
    return s ? sessionName(s, pathBase(s.workPath) || s.runtime) : id.slice(0, 8);
  };
  const optionLabel = (opt: string) =>
    approval ? (opt === "approve" ? t("contactReq.approve") : t("contactReq.deny")) : opt;
  const headerTag = answered
    ? t("ask.resolved")
    : cr
      ? t("contactReq.tag")
      : adm
        ? t("admitReq.tag")
        : sp
          ? t("spawnReq.tag")
          : t("ask.needs");
  const bodyText = cr
    ? t("contactReq.body", { from: nameOf(cr.fromId), to: nameOf(cr.toId) })
    : adm
      ? t("admitReq.body", { agent: nameOf(adm.agentId) })
      : sp
        ? t("spawnReq.body", { from: nameOf(sp.spawnerId), path: sp.workPath })
        : ask.text;
  const approvalIcon = adm ? (
    <UserPlus size={16} />
  ) : sp ? (
    <Rocket size={16} />
  ) : (
    <Users size={16} />
  );

  if (dismissed) return null;

  return (
    <div
      className="relative w-full max-w-[560px] overflow-hidden rounded-xl"
      style={{
        background: "var(--surface-card)",
        border: "1px solid var(--border)",
      }}
    >
      {/* 2px accent left bar (only when pending) */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[2px]"
        style={{
          background: answered ? "var(--border-strong)" : "var(--accent)",
        }}
      />

      <div className="flex items-start gap-3 p-3.5 pl-4">
        <div
          className={classNames(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
            !answered && "working-ring",
          )}
          style={{
            background: answered
              ? "var(--surface-hover)"
              : "var(--accent-soft)",
            color: answered ? "var(--text-secondary)" : "var(--accent)",
            border: `1px solid ${
              answered ? "var(--border)" : "var(--accent-soft)"
            }`,
          }}
        >
          {answered ? <Check size={16} /> : approval ? approvalIcon : <HelpCircle size={16} />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider"
              style={{
                color: answered ? "var(--text-secondary)" : "var(--accent)",
                background: answered
                  ? "var(--surface-hover)"
                  : "var(--accent-soft)",
                border: `1px solid ${
                  answered ? "var(--border)" : "var(--accent-soft)"
                }`,
              }}
            >
              {headerTag}
            </span>
          </div>

          <div
            className="mt-2 text-[14.5px] leading-relaxed text-strong"
            style={{ whiteSpace: "pre-wrap" }}
          >
            {bodyText}
          </div>

          {cr?.reason ? (
            <div
              className="mt-1.5 text-[12.5px] italic"
              style={{ color: "var(--text-muted)" }}
            >
              {t("contactReq.reason", { reason: cr.reason })}
            </div>
          ) : null}

          {answered ? (
            <div
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs"
              style={{
                color: "var(--green)",
                background: "var(--color-working-soft)",
                border: "1px solid var(--border)",
              }}
            >
              <Check size={12} />
              <span style={{ color: "var(--text)" }}>{t("ask.youAnswered")}</span>{" "}
              <span className="font-medium" style={{ color: "var(--text)" }}>
                {answerText ?? ""}
              </span>
            </div>
          ) : options.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {options.map((opt, i) => (
                <button
                  key={opt}
                  disabled={busy}
                  onClick={async () => {
                    if (busy) return;
                    setBusy(true);
                    try {
                      await send(ask.sessionId, opt, ask.askId);
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors duration-150 disabled:opacity-60"
                  style={
                    i === 0
                      ? {
                          color: "#fff",
                          background: "var(--accent)",
                          border: "1px solid var(--accent)",
                        }
                      : {
                          color: "var(--text)",
                          background: "var(--surface-card)",
                          border: "1px solid var(--border)",
                        }
                  }
                  onMouseEnter={(e) => {
                    if (i === 0) {
                      e.currentTarget.style.background = "var(--accent-2)";
                      e.currentTarget.style.borderColor = "var(--accent-2)";
                    } else {
                      e.currentTarget.style.background = "var(--surface-hover)";
                      e.currentTarget.style.borderColor = "var(--border-strong)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (i === 0) {
                      e.currentTarget.style.background = "var(--accent)";
                      e.currentTarget.style.borderColor = "var(--accent)";
                    } else {
                      e.currentTarget.style.background = "var(--surface-card)";
                      e.currentTarget.style.borderColor = "var(--border)";
                    }
                  }}
                >
                  {optionLabel(opt)}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {!answered && (
          <button
            onClick={async () => {
              if (busy) return;
              setBusy(true);
              try {
                await cancelAsk(ask.askId!);
                setDismissed(true);
              } finally {
                setBusy(false);
              }
            }}
            title={t("ask.dismiss")}
            aria-label={t("ask.dismiss")}
            disabled={busy}
            className="ml-1 flex h-7 w-7 items-center justify-center rounded-lg transition-colors duration-150 disabled:opacity-50"
            style={{
              color: "var(--text-muted)",
              background: "transparent",
              border: "1px solid transparent",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--text)";
              e.currentTarget.style.background = "var(--surface-hover)";
              e.currentTarget.style.borderColor = "var(--border)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--text-muted)";
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.borderColor = "transparent";
            }}
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
