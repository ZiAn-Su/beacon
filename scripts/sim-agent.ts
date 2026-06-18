// Simulated agent — drives the platform's south API exactly like the MCP server
// would, so we can verify the notify/ask/status loop end-to-end without a real
// Claude Code / Codex attached.
//
//   npm run platform     # terminal 1
//   npm run sim          # terminal 2 (registers, notifies, then blocks on ask)
//   # answer the question in the web UI, or:
//   # curl -X POST .../reply  -> the sim unblocks and prints the answer
const BASE = process.env.PLATFORM_URL ?? 'http://127.0.0.1:4319';

async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`[sim] platform: ${BASE}`);
  const { session } = await api<{ session: { id: string } }>('/api/sessions/register', {
    runtime: 'sim-agent',
    workPath: 'F:/Project/InteractPlatform',
    task: 'Demo: migrate the auth module to the new token format',
  });
  const id = session.id;
  console.log(`[sim] registered session ${id}`);

  await api(`/api/sessions/${id}/status`, { status: 'working' });
  await api(`/api/sessions/${id}/notify`, { text: 'Cloned the repo and mapped the auth module. Starting the migration.' });
  await sleep(800);
  await api(`/api/sessions/${id}/notify`, { text: 'Step 2/4 done: rewrote token issuance. Tests green.' });
  await sleep(800);

  console.log('[sim] asking the human (this BLOCKS until you answer in the UI)…');
  const { askId } = await api<{ askId: string }>(`/api/sessions/${id}/ask`, {
    question: 'The next step drops the legacy `sessions` table — this is irreversible. Proceed?',
    options: ['Proceed', 'Skip this step', 'Pause and let me check'],
  });

  let answer = '';
  for (;;) {
    const { ask } = await api<{ ask: { status: string; answer: string | null } }>(
      `/api/asks/${askId}/wait?timeoutMs=25000`
    );
    if (ask.status === 'answered') { answer = ask.answer ?? ''; break; }
    if (ask.status === 'cancelled') { answer = '(cancelled)'; break; }
  }
  console.log(`[sim] human answered: ${answer}`);

  await api(`/api/sessions/${id}/notify`, { text: `Got it: "${answer}". Continuing accordingly.` });
  await api(`/api/sessions/${id}/status`, { status: 'done' });
  console.log('[sim] done.');
}

main().catch((e) => {
  console.error('[sim] error:', e);
  process.exit(1);
});
