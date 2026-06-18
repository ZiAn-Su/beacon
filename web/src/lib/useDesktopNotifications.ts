import { useCallback, useEffect, useRef, useState } from "react";
import type { Message, Session } from "../types";

const DISMISS_KEY = "interact-notif-dismissed";
const PER_SESSION_COOLDOWN_MS = 3000;

type NotificationKind = "default" | "granted" | "denied" | "unsupported";

function readPermission(): NotificationKind {
  if (typeof window === "undefined") return "unsupported";
  if (!("Notification" in window)) return "unsupported";
  // Notification.permission is typed as NotificationPermission in lib.dom, but
  // we normalize to a small set we control.
  const p = (Notification as unknown as { permission?: string }).permission;
  if (p === "granted") return "granted";
  if (p === "denied") return "denied";
  return "default";
}

function readDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(v: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (v) window.localStorage.setItem(DISMISS_KEY, "1");
    else window.localStorage.removeItem(DISMISS_KEY);
  } catch {
    // ignore
  }
}

export interface UseDesktopNotifications {
  permission: NotificationKind;
  /** Whether we should show the in-app "enable notifications" prompt. */
  shouldPrompt: boolean;
  requestPermission: () => Promise<NotificationKind>;
  dismissPrompt: () => void;
  /** Fire a desktop notification for an agent->human message. */
  notify: (message: Message, session: Session | undefined) => void;
}

/**
 * Web Notifications API wrapper. Guarded for environments where the
 * `Notification` global is missing. Tracks the user's dismissal in
 * localStorage so we don't repeatedly nag them to enable notifications.
 */
export function useDesktopNotifications(): UseDesktopNotifications {
  const [permission, setPermission] = useState<NotificationKind>(() =>
    readPermission(),
  );
  const [dismissed, setDismissed] = useState<boolean>(() => readDismissed());

  // Per-session debounce map: sessionId -> last fire timestamp.
  const lastFiredRef = useRef<Record<string, number>>({});

  // Keep state in sync if permission changes externally (e.g. browser UI).
  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    const onChange = () => setPermission(readPermission());
    // Some browsers don't support this event; guard defensively.
    const nav = navigator as unknown as {
      permissions?: {
        query?: (q: { name: string }) => { addEventListener?: (t: string, h: () => void) => void };
      };
    };
    let perm: { addEventListener?: (t: string, h: () => void) => void } | null =
      null;
    try {
      perm = nav.permissions?.query?.({ name: "notifications" }) ?? null;
    } catch {
      perm = null;
    }
    if (perm && typeof perm.addEventListener === "function") {
      perm.addEventListener("change", onChange);
      return () => {
        try {
          perm?.addEventListener?.("change", () => {});
        } catch {
          // ignore
        }
      };
    }
    return undefined;
  }, []);

  const requestPermission = useCallback(async (): Promise<NotificationKind> => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return "unsupported";
    }
    try {
      const result = await Notification.requestPermission();
      const next: NotificationKind =
        result === "granted"
          ? "granted"
          : result === "denied"
            ? "denied"
            : "default";
      setPermission(next);
      if (next === "granted") {
        // Successful grant: drop the dismissal flag so the prompt won't
        // reappear if the user later revokes.
        writeDismissed(false);
        setDismissed(false);
      }
      return next;
    } catch {
      return permission;
    }
  }, [permission]);

  const dismissPrompt = useCallback(() => {
    writeDismissed(true);
    setDismissed(true);
  }, []);

  const notify = useCallback(
    (message: Message, session: Session | undefined) => {
      if (typeof window === "undefined") return;
      if (!("Notification" in window)) return;
      if (permission !== "granted") return;
      // Debounce per session.
      const now = Date.now();
      const last = lastFiredRef.current[message.sessionId] ?? 0;
      if (now - last < PER_SESSION_COOLDOWN_MS) return;
      lastFiredRef.current[message.sessionId] = now;

      const title =
        session?.title?.trim() ||
        session?.task?.trim() ||
        session?.runtime ||
        "Agent";
      const bodyPrefix =
        message.kind === "ask" ? "\u2753 " : message.kind === "notify" ? "" : "";
      const body = `${bodyPrefix}${message.text || ""}`.trim() || title;

      let n: Notification | null = null;
      try {
        n = new Notification(title, {
          body,
          tag: message.sessionId,
          icon: "/favicon.svg",
        });
      } catch {
        // Some browsers throw if the constructor is unavailable; bail.
        return;
      }
      if (!n) return;
      n.onclick = () => {
        try {
          window.focus();
        } catch {
          // ignore
        }
        // Selecting the session is handled by the consuming layer; we
        // dispatch a custom event with the session id, which App.tsx
        // listens to. This keeps the hook decoupled from the store.
        try {
          window.dispatchEvent(
            new CustomEvent("interact:focus-session", {
              detail: { sessionId: message.sessionId },
            }),
          );
        } catch {
          // ignore
        }
        try {
          n!.close();
        } catch {
          // ignore
        }
      };
    },
    [permission],
  );

  const shouldPrompt =
    !dismissed && permission === "default" && typeof window !== "undefined"
      ? "Notification" in window
      : false;

  return {
    permission,
    shouldPrompt: Boolean(shouldPrompt),
    requestPermission,
    dismissPrompt,
    notify,
  };
}
