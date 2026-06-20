// Reading a runtime's own on-disk conversation history, so the PLATFORM can
// learn an agent's native session id objectively (not by trusting a self-report)
// and so the human can discover existing conversations under a folder to import.
//
// Claude Code writes one JSONL transcript per conversation at
//   ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl
// where <encoded-cwd> replaces every non-alphanumeric char in the absolute work
// path with '-'  (F:\Project\X -> F--Project-X). The file name is the session id;
// each line is a JSON event. We treat the most-recently-modified transcript in a
// folder as that folder's *active* conversation.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';

export interface AgentSessionMeta {
  nativeSessionId: string; // = transcript file name (the runtime's own id)
  title: string; // first human prompt, truncated (may be empty)
  updatedAt: number; // mtime in ms
}

// Claude Code's project-dir encoding: non-alphanumeric -> '-', case preserved.
function claudeProjectDir(workPath: string): string {
  const enc = workPath.replace(/[^a-zA-Z0-9]/g, '-');
  return join(homedir(), '.claude', 'projects', enc);
}

/** The directory where `runtime` stores its conversations for `workPath`, or null. */
export function sessionStorageDir(workPath: string, runtime: string): string | null {
  if (!workPath) return null;
  if (runtime === 'claude-code' || runtime === 'claude') return claudeProjectDir(workPath);
  // Other runtimes (codex, ...) keep their own layouts; add them here as known.
  return null;
}

// Best-effort title: the first user prompt in the transcript, truncated. Reads
// only the head of the file so a huge transcript stays cheap.
function firstUserText(file: string): string {
  let head: string;
  try {
    const raw = readFileSync(file, 'utf8');
    head = raw.length > 64_000 ? raw.slice(0, 64_000) : raw;
  } catch {
    return '';
  }
  let fallback = '';
  for (const line of head.split('\n')) {
    if (!line.trim()) continue;
    let o: { type?: string; message?: { role?: string; content?: unknown } };
    try { o = JSON.parse(line); } catch { continue; }
    if (o.type !== 'user' || !o.message || o.message.role !== 'user') continue;
    const c = o.message.content;
    let text = '';
    if (typeof c === 'string') text = c;
    else if (Array.isArray(c)) {
      const part = c.find((p) => p && typeof p === 'object' && (p as { type?: string }).type === 'text');
      text = part ? String((part as { text?: string }).text ?? '') : '';
    }
    text = text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (!fallback) fallback = text;
    // Skip injected wrappers (local-command output, command tags, image stubs,
    // caveats) — find the first line that reads like a real human prompt.
    if (/^(<|Caveat:|\[Image)/.test(text)) continue;
    return text.length > 80 ? text.slice(0, 80) + '…' : text;
  }
  return fallback.length > 80 ? fallback.slice(0, 80) + '…' : fallback;
}

/**
 * List the runtime's existing conversations for `workPath`, newest first. Empty
 * when the runtime is unsupported, the folder has no history, or it's unreadable.
 */
export function listAgentSessions(workPath: string, runtime: string): AgentSessionMeta[] {
  const dir = sessionStorageDir(workPath, runtime);
  if (!dir || !existsSync(dir)) return [];
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return [];
  }
  const out: AgentSessionMeta[] = [];
  for (const f of files) {
    const full = join(dir, f);
    let mtimeMs: number;
    try { mtimeMs = statSync(full).mtimeMs; } catch { continue; }
    out.push({
      nativeSessionId: f.replace(/\.jsonl$/, ''),
      title: firstUserText(full),
      updatedAt: mtimeMs,
    });
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

/**
 * The native session id of the *active* conversation in `workPath` — the most
 * recently written transcript. This is how the platform stamps a registering
 * agent's session id from objective on-disk truth. Null when none is found
 * (unsupported runtime, no history, or the platform can't see the agent's disk,
 * e.g. a remote agent — in which case the caller falls back to any self-report).
 */
export function resolveActiveSessionId(workPath: string, runtime: string): string | null {
  const list = listAgentSessions(workPath, runtime);
  return list.length ? list[0].nativeSessionId : null;
}
