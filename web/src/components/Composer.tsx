import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { ArrowUp, HelpCircle, ImagePlus, X } from "lucide-react";
import type { Attachment, Message, Session } from "../types";
import { classNames } from "../lib/format";
import { uploadImage } from "../lib/api";
import { useI18n } from "../lib/i18n";

interface Props {
  session: Session;
  pendingAsk: Message | null;
  onSend: (
    sessionId: string,
    text: string,
    askId?: string | null,
    attachments?: { id: string; name: string }[],
  ) => Promise<string | undefined>;
}

const MAX_HEIGHT = 220;

export function Composer({ session, pendingAsk, onSend }: Props) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Upload image files (from paste or the picker) and stage them as attachments.
  const addFiles = useCallback(async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    setUploading(true);
    try {
      for (const f of images) {
        try {
          const up = await uploadImage(f);
          setAttachments((prev) => [...prev, up]);
        } catch {
          /* skip a file that failed to upload */
        }
      }
    } finally {
      setUploading(false);
    }
  }, []);

  const onPaste = useCallback(
    (e: ReactClipboardEvent<HTMLTextAreaElement>) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) =>
        f.type.startsWith("image/"),
      );
      if (files.length > 0) {
        e.preventDefault();
        void addFiles(files);
      }
    },
    [addFiles],
  );

  // Auto-grow the textarea to its content, capped at MAX_HEIGHT.
  const autosize = useCallback(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(MAX_HEIGHT, el.scrollHeight)}px`;
  }, []);

  useLayoutEffect(() => {
    autosize();
  }, [value, autosize]);

  // Reset the composer when switching sessions.
  useEffect(() => {
    setValue("");
    setAttachments([]);
  }, [session.id]);

  const submit = useCallback(
    async (textOverride?: string) => {
      const text = (textOverride ?? value).trim();
      // Ask quick-replies (textOverride) never carry attachments.
      const atts = textOverride == null ? attachments : [];
      if ((!text && atts.length === 0) || sending) return;
      setSending(true);
      try {
        await onSend(
          session.id,
          text,
          pendingAsk?.askId ?? null,
          atts.map((a) => ({ id: a.id, name: a.name })),
        );
        if (textOverride == null) {
          setValue("");
          setAttachments([]);
        }
      } finally {
        setSending(false);
      }
    },
    [value, attachments, sending, onSend, session.id, pendingAsk?.askId],
  );

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  const placeholder = pendingAsk
    ? t("composer.answer")
    : session.status === "waiting"
      ? t("composer.reply")
      : t("composer.message");

  const sendDisabled =
    (value.trim().length === 0 && attachments.length === 0) || sending || uploading;

  return (
    <div
      className="shrink-0 border-t px-3 pb-3 pt-2 sm:px-6 sm:pb-4 sm:pt-3"
      style={{ borderColor: "var(--border)", background: "var(--bg)" }}
    >
      <div className="mx-auto w-full max-w-[860px]">
        {pendingAsk && (
          <PendingAskBar ask={pendingAsk} onPick={(opt) => void submit(opt)} />
        )}

        {(attachments.length > 0 || uploading) && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {attachments.map((a) => (
              <div
                key={a.id}
                className="group relative h-16 w-16 overflow-hidden rounded-lg"
                style={{ border: "1px solid var(--border)" }}
                title={a.name}
              >
                <img src={a.url} alt={a.name} className="h-full w-full object-cover" />
                <button
                  onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                  aria-label={t("composer.removeImage")}
                  className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full"
                  style={{ background: "rgba(0,0,0,0.55)", color: "#fff" }}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            {uploading && (
              <div
                className="flex h-16 w-16 items-center justify-center rounded-lg text-[11px]"
                style={{
                  border: "1px dashed var(--border)",
                  color: "var(--text-muted)",
                }}
              >
                {t("composer.uploading")}
              </div>
            )}
          </div>
        )}

        <div
          className="relative flex items-end gap-2 rounded-2xl px-3 py-2 transition-shadow"
          style={{
            background: "var(--surface-card)",
            border: "1px solid var(--border)",
            boxShadow: "var(--shadow-1)",
          }}
        >
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            multiple
            className="hidden"
            onChange={(e) => {
              void addFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={sending}
            aria-label={t("composer.attachImage")}
            title={t("composer.attachImage")}
            className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors duration-150"
            style={{ color: "var(--text-muted)", background: "transparent" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--surface-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <ImagePlus size={17} />
          </button>
          <textarea
            ref={taRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder={placeholder}
            rows={1}
            spellCheck
            className={classNames(
              "scroll-area max-h-[220px] min-h-[36px] flex-1 resize-none bg-transparent px-1 py-1.5 text-sm leading-relaxed",
              "outline-none placeholder:text-[var(--text-muted)]",
            )}
            style={{ color: "var(--text)" }}
            disabled={sending}
          />
          <div className="flex items-center gap-1.5 pb-0.5">
            <span
              className="hidden sm:inline-block rounded-md px-1.5 py-0.5 text-[10.5px] font-medium"
              style={{
                color: "var(--text-muted)",
                background: "var(--surface-hover)",
                border: "1px solid var(--border)",
              }}
            >
              <kbd
                className="font-mono"
                style={{ color: "var(--text-secondary)" }}
              >
                Enter
              </kbd>{" "}
              {t("composer.toSend")} ·{" "}
              <kbd
                className="font-mono"
                style={{ color: "var(--text-secondary)" }}
              >
                Shift+Enter
              </kbd>{" "}
              {t("composer.newline")}
            </span>
            <button
              onClick={() => void submit()}
              disabled={sendDisabled}
              aria-label={t("composer.send")}
              className="flex h-9 w-9 items-center justify-center rounded-xl transition-colors duration-150 disabled:opacity-100"
              style={{
                background: sendDisabled ? "var(--surface-hover)" : "var(--accent)",
                color: sendDisabled ? "var(--text-muted)" : "#fff",
                border: `1px solid ${
                  sendDisabled ? "var(--border)" : "var(--accent)"
                }`,
              }}
              onMouseEnter={(e) => {
                if (!sendDisabled) e.currentTarget.style.background = "var(--accent-2)";
              }}
              onMouseLeave={(e) => {
                if (!sendDisabled) e.currentTarget.style.background = "var(--accent)";
              }}
            >
              <ArrowUp size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PendingAskBar({
  ask,
  onPick,
}: {
  ask: Message;
  onPick: (option: string) => void;
}) {
  const { t } = useI18n();
  const options = ask.meta?.options ?? [];
  return (
    <div
      className="mb-2 flex items-center gap-2 rounded-xl px-3 py-2"
      style={{
        background: "var(--accent-soft)",
        border: "1px solid var(--accent-soft)",
      }}
    >
      <span
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
        style={{
          background: "transparent",
          color: "var(--accent)",
        }}
      >
        <HelpCircle size={12} />
      </span>
      <div className="min-w-0 flex-1">
        <div
          className="text-[10.5px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--accent)" }}
        >
          {t("composer.answering")}
        </div>
      </div>
      {options.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1.5">
          {options.map((opt, i) => (
            <button
              key={opt}
              onClick={() => onPick(opt)}
              className="rounded-md px-2 py-0.5 text-[11.5px] font-medium transition-colors duration-150"
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
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
