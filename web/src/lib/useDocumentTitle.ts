import { useEffect, useRef } from "react";

const APP_TITLE = "Beacon";
const FLASH_INTERVAL_MS = 1000;
const FLASH_GLYPH = "\u26A1"; // lightning bolt

interface Options {
  totalUnread: number;
  hasAnyPendingAsk: boolean;
  tabVisible: boolean;
}

/**
 * Reflects unread counts in `document.title`. When `totalUnread > 0`, the
 * title is prefixed with `(${n})`. If a pending ask exists and the tab is
 * hidden, the title alternates every ~1s between the count and an attention
 * glyph so the user notices even from another window.
 */
export function useDocumentTitle({
  totalUnread,
  hasAnyPendingAsk,
  tabVisible,
}: Options): void {
  // Track the original document title once so we can restore it cleanly.
  const originalTitleRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (originalTitleRef.current == null) {
      originalTitleRef.current = document.title || APP_TITLE;
    }
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const base = originalTitleRef.current ?? APP_TITLE;
    const intervalRef = { current: null as number | null };

    const clearInterval = () => {
      if (intervalRef.current != null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    // Restore clean title when nothing is unread.
    if (totalUnread <= 0) {
      clearInterval();
      document.title = base;
      return clearInterval;
    }

    const countTitle = `(${totalUnread}) ${base}`;
    const shouldFlash = hasAnyPendingAsk && !tabVisible;
    if (!shouldFlash) {
      clearInterval();
      document.title = countTitle;
      return clearInterval;
    }

    // Flash: alternate between the count and the glyph + count.
    let toggle = false;
    document.title = countTitle;
    intervalRef.current = window.setInterval(() => {
      toggle = !toggle;
      document.title = toggle
        ? `${FLASH_GLYPH} ${base}`
        : `(${totalUnread}) ${base}`;
    }, FLASH_INTERVAL_MS);

    return clearInterval;
  }, [totalUnread, hasAnyPendingAsk, tabVisible]);
}
