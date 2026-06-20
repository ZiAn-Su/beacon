#!/usr/bin/env node
// Beacon CLI — a zero-dependency bridge from a Claude Code (or any shell-capable)
// agent to the Beacon platform, over its plain HTTP API. No MCP, no config:
// just `node beacon.mjs <command>`. Talks to PLATFORM_URL (default :4319).
//
//   node beacon.mjs register "<task>"          announce yourself (one task = one contact)
//   node beacon.mjs notify   "<message>"       non-blocking FYI, keep working
//   node beacon.mjs ask      "<question>" [opt...]   BLOCK until the human answers; prints answer
//   node beacon.mjs status   <working|waiting|idle|done>
//   node beacon.mjs inbox                      print messages the human sent since last check
//
// Agent-to-agent (peers are other sessions registered on the same platform):
//   node beacon.mjs agents                     list other agent contacts: id — task [status]
//   node beacon.mjs notify-agent <id> <msg...> non-blocking FYI to another agent
//   node beacon.mjs ask-agent    <id> <q> [opt...]   BLOCK until that agent answers; prints answer
//   node beacon.mjs answer-agent <askId> <ans...>    answer a peer question from your inbox
//
// The session id is cached per work-path in the OS temp dir, so notify/ask/inbox
// across separate CLI calls all belong to the same conversation.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const BASE = (process.env.PLATFORM_URL ?? 'http://127.0.0.1:4319').replace(/\/$/, '');
const TOKEN = process.env.PLATFORM_TOKEN ?? '';
const RUNTIME = process.env.AGENT_RUNTIME ?? 'claude-code';
const WORK = process.env.AGENT_WORK_PATH ?? process.cwd();
// The runtime's own session id, when it exposes one (Claude Code sets
// CLAUDE_CODE_SESSION_ID). Lets the human precisely resume this conversation.
const NATIVE_SESSION_ID =
  process.env.AGENT_SESSION_ID ??
  process.env.CLAUDE_CODE_SESSION_ID ??
  process.env.CODEX_SESSION_ID ??
  null;
// When the platform relaunches an offline agent, it injects this so the skill
// attaches to the original conversation instead of registering a new one.
const INJECTED_SESSION = process.env.BEACON_SESSION_ID ?? '';

const cacheDir = join(tmpdir(), 'beacon');
if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
const cacheFile = join(cacheDir, createHash('sha1').update(WORK).digest('hex') + '.json');

const loadCache = () => {
  try { return JSON.parse(readFileSync(cacheFile, 'utf8')); } catch { return {}; }
};
const saveCache = (c) => writeFileSync(cacheFile, JSON.stringify(c));

// Annotate peer messages so the recipient knows who sent it and, for a question,
// which ask_id to answer with. Human chat keeps the original plain bullet form.
const renderInboxLine = (m) => {
  if (m.kind === 'peer' && m.askId) {
    return `[QUESTION from agent ${m.fromSessionId}] ${m.text}  (reply with answer-agent ${m.askId})`;
  }
  if (m.kind === 'peer') {
    return `[from agent ${m.fromSessionId}] ${m.text}`;
  }
  return `- ${m.text}`;
};

async function api(path, body) {
  const res = await fetch(BASE + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'content-type': 'application/json',
      ...(TOKEN ? { 'x-platform-token': TOKEN } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${await res.text().catch(() => '')}`);
  return res.json();
}

async function register(task) {
  const { session } = await api('/api/sessions/register', {
    runtime: RUNTIME,
    workPath: WORK,
    task: task || process.env.AGENT_TASK || '',
    nativeSessionId: NATIVE_SESSION_ID,
  });
  saveCache({ sessionId: session.id, lastInboxTs: 0 });
  return session.id;
}

async function ensureSession() {
  // Priority: injected id (platform-relaunched) > local cache > new registration.
  if (INJECTED_SESSION) {
    saveCache({ ...loadCache(), sessionId: INJECTED_SESSION });
    return INJECTED_SESSION;
  }
  const c = loadCache();
  return c.sessionId || register('');
}

const [cmd, ...args] = process.argv.slice(2);

try {
  if (cmd === 'register') {
    console.log(`registered session ${await register(args.join(' '))}`);
  } else if (cmd === 'notify') {
    const id = await ensureSession();
    await api(`/api/sessions/${id}/notify`, { text: args.join(' ') });
    console.log('delivered (non-blocking)');
  } else if (cmd === 'ask') {
    const id = await ensureSession();
    const question = args[0] ?? '';
    const options = args.slice(1);
    const { askId } = await api(`/api/sessions/${id}/ask`, {
      question,
      options: options.length ? options : undefined,
    });
    process.stderr.write('waiting for the human to answer…\n');
    for (;;) {
      const { ask } = await api(`/api/asks/${askId}/wait?timeoutMs=25000`);
      if (ask.status === 'answered') { console.log(ask.answer ?? ''); break; }
      if (ask.status === 'cancelled') { console.log('(the human dismissed this question without answering)'); break; }
    }
  } else if (cmd === 'status') {
    const id = await ensureSession();
    await api(`/api/sessions/${id}/status`, { status: args[0] });
    console.log(`status set to ${args[0]}`);
  } else if (cmd === 'inbox') {
    const c = loadCache();
    const id = c.sessionId || (await ensureSession());
    const { messages } = await api(`/api/sessions/${id}/inbox?after=${c.lastInboxTs ?? 0}`);
    if (messages.length) {
      c.sessionId = id;
      c.lastInboxTs = messages[messages.length - 1].createdAt;
      saveCache(c);
    }
    console.log(messages.length ? messages.map(renderInboxLine).join('\n') : '(no new messages from the human)');
  } else if (cmd === 'agents') {
    const id = await ensureSession();
    const { agents } = await api('/api/agents');
    const others = agents.filter((a) => a.id !== id);
    console.log(others.length ? others.map((a) => `${a.id} — ${a.task} [${a.status}]`).join('\n') : '(no other agents are registered)');
  } else if (cmd === 'notify-agent') {
    const id = await ensureSession();
    const targetId = args[0] ?? '';
    await api(`/api/sessions/${id}/peer-notify`, { targetId, text: args.slice(1).join(' ') });
    console.log('delivered to agent (non-blocking)');
  } else if (cmd === 'ask-agent') {
    const id = await ensureSession();
    const targetId = args[0] ?? '';
    const question = args[1] ?? '';
    const options = args.slice(2);
    const { askId } = await api(`/api/sessions/${id}/peer-ask`, {
      targetId,
      question,
      options: options.length ? options : undefined,
    });
    process.stderr.write('waiting for the other agent to answer…\n');
    for (;;) {
      const { ask } = await api(`/api/asks/${askId}/wait?timeoutMs=25000`);
      if (ask.status === 'answered') { console.log(ask.answer ?? ''); break; }
      if (ask.status === 'cancelled') { console.log('(the other agent dismissed this question without answering)'); break; }
    }
  } else if (cmd === 'answer-agent') {
    const id = await ensureSession();
    const askId = args[0] ?? '';
    await api(`/api/sessions/${id}/peer-reply`, { askId, text: args.slice(1).join(' ') });
    console.log('answered');
  } else {
    console.log('usage: node beacon.mjs <register [task] | notify <msg> | ask <question> [opt...] | status <s> | inbox | agents | notify-agent <id> <msg...> | ask-agent <id> <q> [opt...] | answer-agent <askId> <ans...>>');
    process.exit(1);
  }
} catch (e) {
  console.error(`beacon error: ${e.message}`);
  console.error(`(is the Beacon platform running at ${BASE}? start it with: npm run platform)`);
  process.exit(1);
}
