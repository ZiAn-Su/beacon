---
name: beacon
description: Talk to your human over Beacon while you work. Send non-blocking progress updates (notify), ask a blocking question and wait for the answer (ask), set your status, or read messages the human sent you. Use when running a long task and you want to keep a human in the loop, or need a decision before an irreversible/ambiguous step. The human sees you as a live contact in the Beacon app and replies there.
---

# Beacon — reach your human

You can talk to a human over **Beacon**. You appear to them as a live contact with a status,
and you choose when to reach out. Use the bundled CLI in this skill's directory. Run it with
`node`, from this skill's folder (referred to below as `<skill>`):

```bash
node <skill>/beacon.mjs register "<short task description>"   # announce yourself (do this first)
node <skill>/beacon.mjs notify   "<message>"                   # FYI, you keep working (non-blocking)
node <skill>/beacon.mjs ask      "<question>" "Option A" "Option B"   # BLOCKS, prints the human's answer
node <skill>/beacon.mjs status   working|waiting|idle|done     # update your presence
node <skill>/beacon.mjs inbox                                  # print messages the human sent you
```

The session is remembered per working directory, so after `register` the later commands all land
in the same conversation. `PLATFORM_URL` overrides the platform address (default
`http://127.0.0.1:4319`); set `PLATFORM_TOKEN` if the platform requires it.

## When to use which

- **register** — once, at the start, with a one-line description of the task you're doing.
- **notify** — meaningful progress, milestones, or heads-ups that do **not** need an answer.
  Be judicious; don't narrate every step.
- **ask** — only when you genuinely need a human decision to proceed: irreversible actions,
  ambiguous requirements, missing choices or credentials. The command **blocks** until they
  answer and prints their reply on stdout — read it and act on it. Provide options when the
  decision is a clear pick.
- **status** — `working` while executing, `waiting` is set automatically while an `ask` is open,
  `idle` when paused, `done` when finished.
- **inbox** — call between steps to pick up anything the human sent you unprompted (they may
  redirect you).

## Example

```bash
node <skill>/beacon.mjs register "Migrate auth-service to the new token format"
node <skill>/beacon.mjs notify   "Build green, 142 tests pass. Ready for the production migration."
ANSWER=$(node <skill>/beacon.mjs ask "Run the irreversible production DB migration now?" "Approve" "Hold")
# $ANSWER is the human's reply — branch on it
node <skill>/beacon.mjs notify   "Migration applied. Deploy complete."
node <skill>/beacon.mjs status   done
```

## Notes

- This is the **zero-config** path: no MCP server, no `claude mcp add`, no restart. It only needs
  the Beacon platform running (`npm run platform`) and this skill installed.
- For non-Claude / structured runtimes, Beacon also ships an MCP server (`src/mcp/server.ts`) that
  exposes the same five capabilities as MCP tools — see the Beacon README.
