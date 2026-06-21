// Runtime launch helpers.
//
// `ccs` (the npm "CCS CLI") runs Claude Code routed to another provider/model:
//   ccs <profile> [claude-args...]
// e.g. `ccs mm` (minimax m3), `ccs ark`. Because the underlying agent IS Claude
// Code, it accepts the same flags (--resume / --continue / --print /
// --permission-mode) and writes the same ~/.claude/projects transcripts — so
// once we know how to invoke it, everything else (native-id resume, BEACON_SESSION_ID
// injection) works for free.
//
// We expose any ccs profile as the runtime string `ccs:<profile>` so new
// profiles (mm, ark, …) need zero per-profile code. The profile charset is
// restricted so the value is safe to interpolate into a shell command.
const CCS_RUNTIME_RE = /^ccs:([a-zA-Z0-9._-]+)$/;

/** The ccs profile for a `ccs:<profile>` runtime, or null if not a ccs runtime. */
export function ccsProfile(runtime: string): string | null {
  const m = CCS_RUNTIME_RE.exec(runtime.trim());
  return m ? m[1]! : null;
}
