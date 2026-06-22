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
// Optional self-introduction so the human/peers can tell who this agent is.
const AGENT_NAME = process.env.AGENT_NAME ?? null;
const AGENT_ABOUT = process.env.AGENT_ABOUT ?? process.env.AGENT_DESCRIPTION ?? null;
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

// A channel message in the merged inbox: tagged with the channel and who posted
// (a peer agent, or the human guardian). Asks/answers are flagged so the agent
// knows a group question is waiting and how to answer it.
const renderChannelLine = (m) => {
  const who = m.fromSessionId ? `agent ${m.fromSessionId}` : 'guardian';
  if (m.kind === 'ask' && m.askId) {
    return `[#${m.channelName} · ${who} ASKS] ${m.text}  (answer with answer-channel ${m.channelId} ${m.askId} <text>)`;
  }
  if (m.kind === 'answer') {
    return `[#${m.channelName} · ${who} answered] ${m.text}`;
  }
  return `[#${m.channelName} · ${who}] ${m.text}`;
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
    name: AGENT_NAME,
    description: AGENT_ABOUT,
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
  } else if (cmd === 'name') {
    const id = await ensureSession();
    await api(`/api/sessions/${id}/profile`, { name: args.join(' ') });
    console.log('name updated');
  } else if (cmd === 'about') {
    const id = await ensureSession();
    await api(`/api/sessions/${id}/profile`, { about: args.join(' ') });
    console.log('introduction updated');
  } else if (cmd === 'inbox') {
    const c = loadCache();
    const id = c.sessionId || (await ensureSession());
    const after = c.lastInboxTs ?? 0;
    // One cursor covers 1:1 chat and group channels (same clock). Merge by time.
    const [{ messages }, { messages: chan }] = await Promise.all([
      api(`/api/sessions/${id}/inbox?after=${after}`),
      api(`/api/sessions/${id}/channel-inbox?after=${after}`),
    ]);
    const items = [
      ...messages.map((m) => ({ createdAt: m.createdAt, line: renderInboxLine(m) })),
      ...chan.map((m) => ({ createdAt: m.createdAt, line: renderChannelLine(m) })),
    ].sort((a, b) => a.createdAt - b.createdAt);
    if (items.length) {
      c.sessionId = id;
      c.lastInboxTs = items[items.length - 1].createdAt;
      saveCache(c);
    }
    console.log(items.length ? items.map((i) => i.line).join('\n') : '(no new messages from the human)');
  } else if (cmd === 'channels') {
    const id = await ensureSession();
    const { channels } = await api(`/api/sessions/${id}/channels`);
    console.log(channels.length
      ? channels.map((c) => `${c.id} — ${c.name}`).join('\n')
      : '(you are not in any channels yet)');
  } else if (cmd === 'channel-post') {
    const id = await ensureSession();
    const channelId = args[0] ?? '';
    await api(`/api/sessions/${id}/channel-post`, { channelId, text: args.slice(1).join(' ') });
    console.log('posted to channel');
  } else if (cmd === 'ask-channel') {
    const id = await ensureSession();
    const channelId = args[0] ?? '';
    const question = args[1] ?? '';
    const options = args.slice(2);
    const { askId } = await api(`/api/sessions/${id}/channel-ask`, {
      channelId,
      question,
      options: options.length ? options : undefined,
    });
    process.stderr.write('waiting for a channel member to answer…\n');
    for (;;) {
      const { ask } = await api(`/api/asks/${askId}/wait?timeoutMs=25000`);
      if (ask.status === 'answered') { console.log(ask.answer ?? ''); break; }
      if (ask.status === 'cancelled') { console.log('(the question was dismissed without an answer)'); break; }
    }
  } else if (cmd === 'answer-channel') {
    const id = await ensureSession();
    const channelId = args[0] ?? '';
    const askId = args[1] ?? '';
    await api(`/api/sessions/${id}/channel-answer`, { channelId, askId, text: args.slice(2).join(' ') });
    console.log('answered the channel');
  } else if (cmd === 'read-channel') {
    const id = await ensureSession();
    const channelId = args[0] ?? '';
    const limit = args[1] ? Number(args[1]) : undefined;
    const q = `channel=${encodeURIComponent(channelId)}${limit ? `&limit=${limit}` : ''}`;
    const { detail } = await api(`/api/sessions/${id}/read-channel?${q}`);
    if (!detail) {
      console.log('channel not found');
    } else {
      const label = (sid) => {
        if (!sid) return 'the human guardian';
        const m = detail.members.find((x) => x.id === sid);
        const n = (m && (m.name || m.task) || '').trim();
        return n || `agent ${String(sid).slice(0, 8)}`;
      };
      const out = [
        `Channel #${detail.channel.name}  (id=${detail.channel.id})`,
        'Owner: the human guardian (always present in this channel)',
        `Agent members (${detail.members.length}):`,
      ];
      for (const m of detail.members) {
        const nm = (m.name || m.task || '').trim() || `agent ${m.id.slice(0, 8)}`;
        out.push(`  - ${nm} [${m.status}] (id=${m.id})${m.about && m.about.trim() ? ` — ${m.about.trim()}` : ''}`);
      }
      out.push('Recent messages:');
      if (!detail.messages.length) out.push('  (no messages yet)');
      for (const msg of detail.messages) {
        const who = label(msg.fromSessionId);
        if (msg.kind === 'ask' && msg.askId) out.push(`  ${who} ASKS: ${msg.text}  (answer-channel ${detail.channel.id} ${msg.askId} <text>)`);
        else if (msg.kind === 'answer') out.push(`  ${who} answered: ${msg.text}`);
        else out.push(`  ${who}: ${msg.text}`);
      }
      console.log(out.join('\n'));
    }
  } else if (cmd === 'agent') {
    const id = await ensureSession();
    const { profile: p } = await api(`/api/sessions/${id}/agent/${encodeURIComponent(args[0] ?? '')}`);
    if (!p) {
      console.log('no such agent');
    } else {
      const nm = (p.name || p.task || '').trim() || `agent ${p.id.slice(0, 8)}`;
      const lines = [`${nm} [${p.status}]  (id=${p.id})`, `    runtime: ${p.runtime} · origin: ${p.origin}`];
      if (p.task && p.task.trim()) lines.push(`    task: ${p.task.trim()}`);
      if (p.about && p.about.trim()) lines.push(`    about: ${p.about.trim()}`);
      console.log(lines.join('\n'));
    }
  } else if (cmd === 'whoami') {
    const id = await ensureSession();
    const { state: s } = await api(`/api/sessions/${id}/whoami`);
    const nm = (s.name || s.task || '').trim() || `agent ${s.id.slice(0, 8)}`;
    const out = [
      `You are ${nm} [${s.status}]  (id=${s.id}, runtime ${s.runtime})`,
      s.task && s.task.trim() ? `task: ${s.task.trim()}` : 'task: (none)',
      s.channels.length ? `Channels (${s.channels.length}): ${s.channels.map((c) => `#${c.name} (${c.id})`).join(', ')}` : 'Channels: (none)',
    ];
    if (s.pendingAsks.length) {
      out.push(`Group questions awaiting an answer (${s.pendingAsks.length}):`);
      for (const a of s.pendingAsks) out.push(`  #${a.channelName}: ${a.question}  (answer-channel ${a.channelId} ${a.askId} <text>)`);
    } else {
      out.push('Group questions awaiting an answer: (none)');
    }
    console.log(out.join('\n'));
  } else if (cmd === 'agents') {
    const id = await ensureSession();
    const { agents } = await api(`/api/agents?visibleTo=${encodeURIComponent(id)}`);
    const others = agents.filter((a) => a.id !== id);
    const renderAgent = (a) => {
      const name = a.title && a.title.trim() ? a.title.trim() : null;
      const head = name ? `${a.id} — ${name} [${a.status}]` : `${a.id} — ${a.task} [${a.status}]`;
      const lines = [head];
      if (name && a.task && a.task.trim()) lines.push(`    task: ${a.task.trim()}`);
      if (a.description && a.description.trim()) lines.push(`    about: ${a.description.trim()}`);
      return lines.join('\n');
    };
    console.log(others.length ? others.map(renderAgent).join('\n') : '(no other agents are visible to you)');
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
  } else if (cmd === 'spawn') {
    const id = await ensureSession();
    const workPath = args[0] ?? '';
    const task = args.slice(1).join(' ');
    const r = await api(`/api/sessions/${id}/spawn`, { workPath, task: task || undefined });
    if (r.status === 'spawned') {
      console.log(`spawned agent ${r.session?.id ?? ''}`);
    } else {
      // pending — guardian must approve. Block on the backing ask.
      process.stderr.write('waiting for the human to approve the new agent…\n');
      for (;;) {
        const { ask } = await api(`/api/asks/${r.askId}/wait?timeoutMs=25000`);
        if (ask.status === 'answered') {
          console.log(ask.answer?.trim() === 'approve' ? 'approved — the new agent is launching' : 'denied by the human');
          break;
        }
        if (ask.status === 'cancelled') { console.log('(the human dismissed the spawn request)'); break; }
      }
    }
  } else {
    console.log('usage: node beacon.mjs <register [task] | name <name...> | about <text...> | notify <msg> | ask <question> [opt...] | status <s> | inbox | agents | agent <id> | whoami | notify-agent <id> <msg...> | ask-agent <id> <q> [opt...] | answer-agent <askId> <ans...> | spawn <workPath> [task...] | channels | channel-post <channelId> <msg...> | ask-channel <channelId> <q> [opt...] | answer-channel <channelId> <askId> <ans...> | read-channel <channelId> [limit]>');
    process.exit(1);
  }
} catch (e) {
  console.error(`beacon error: ${e.message}`);
  console.error(`(is the Beacon platform running at ${BASE}? start it with: npm run platform)`);
  process.exit(1);
}
