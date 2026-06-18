// Small formatting helpers — no deps.

export function relativeTime(ts: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 5) return "now";
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo`;
  const yr = Math.floor(day / 365);
  return `${yr}y`;
}

export function absoluteTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function shortTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

// A session is "online" if the agent talked to Beacon within this window. Kept
// in sync with the server's ONLINE_TTL_MS (src/server/wake.ts).
export const ONLINE_TTL_MS = 60_000;

/** Whether the agent process is currently live (recently interacted with Beacon). */
export function isOnline(
  session: { lastSeenAt: number | null },
  now: number = Date.now(),
): boolean {
  return !!session.lastSeenAt && now - session.lastSeenAt < ONLINE_TTL_MS;
}

/** Human-facing conversation name: explicit title > agent task > fallback. */
export function sessionName(
  session: { title?: string | null; task?: string },
  fallback: string,
): string {
  const title = session.title?.trim();
  if (title) return title;
  const task = session.task?.trim();
  if (task) return task;
  return fallback;
}

export function pathBase(p: string): string {
  if (!p) return "";
  // Normalize slashes for Windows and POSIX
  const norm = p.replace(/\\/g, "/");
  const parts = norm.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

export function pathDir(p: string): string {
  if (!p) return "";
  const norm = p.replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/");
  if (idx < 0) return "";
  return norm.slice(0, idx);
}

/**
 * Stable two-color gradient for an avatar (derived from id).
 * Near-monochrome: subtle hue shift on a desaturated palette so the
 * UI stays calm and the orange accent remains the only signal color.
 */
export function avatarGradient(id: string): { from: string; to: string } {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  const hue1 = Math.abs(h) % 360;
  const hue2 = (hue1 + 24) % 360;
  return {
    from: `hsl(${hue1} 18% 62%)`,
    to: `hsl(${hue2} 22% 52%)`,
  };
}

export function initials(label: string): string {
  const cleaned = label.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (!cleaned) return "?";
  const parts = cleaned.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]!.toUpperCase()).join("");
}

export function classNames(
  ...parts: Array<string | false | null | undefined>
): string {
  return parts.filter(Boolean).join(" ");
}
