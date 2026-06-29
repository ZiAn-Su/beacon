// Launch an ISOLATED demo platform for recording / screenshots, pre-populated
// with a realistic but entirely FICTIONAL demo scene (no real / private data).
//
// It uses its OWN database and port, so the live platform on 4319 and ALL of its
// real data (real conversations, internal comms) are completely untouched. When
// the demo db is empty, it seeds a demo scene so opening the page immediately
// shows something worth recording: agent contacts with live statuses, a 1:1
// notify/ask thread, and a group channel with a sample collaboration.
//
//   npm run demo                                  -> http://127.0.0.1:4400
//   (optional, for a LIVE animated notify/ask agent, in a 2nd terminal:)
//   PowerShell:  $env:PLATFORM_URL='http://127.0.0.1:4400'; npm run sim
//
// Reset to a fresh seeded scene any time by deleting data/demo.db (and -wal/-shm)
// and re-running. The live data/beacon.db is never touched by this script.
//
// Override defaults if needed: DEMO_PORT / DEMO_DB.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

process.env.PORT = process.env.DEMO_PORT ?? process.env.PORT ?? '4400';
process.env.BEACON_DB = process.env.DEMO_DB ?? process.env.BEACON_DB ?? 'data/demo.db';

console.log(
  `[demo] starting an ISOLATED demo platform — db=${process.env.BEACON_DB} port=${process.env.PORT} ` +
    `(live data/beacon.db on 4319 is untouched)`,
);

// Import the gateway AFTER the env is set: it reads PORT at load and the store
// opens BEACON_DB at import, so both must be in place first.
await import('../src/server/index');
const store = await import('../src/core/store');

// Seed only an EMPTY demo db, so re-running doesn't duplicate the scene (delete
// data/demo.db to reset). The scene is all fictional — safe to record.
if (store.listSessions().length === 0) {
  seedDemoScene();
  console.log('[demo] seeded a demo scene: 3 agent contacts, a notify/ask thread, and a group channel');
}

function seedDemoScene(): void {
  // Give each demo agent a REAL, isolated working directory. A fake path made the
  // embedded Terminal fail with "Cannot create process, error code: 267" (invalid
  // directory). These dirs are empty + under data/ (gitignored) — opening a
  // contact's Terminal lands in a real folder instead of erroring.
  const wsRoot = join(process.cwd(), 'data', 'demo-workspaces');
  const agent = (name: string, task: string, about: string) => {
    const dir = join(wsRoot, name.toLowerCase().replace(/\W+/g, '-'));
    mkdirSync(dir, { recursive: true });
    return store.createSession({ runtime: 'claude-code', workPath: dir, task, name, description: about, admitted: true });
  };

  const max = agent('Backend engineer Max', 'Migrating the auth module to the new token format', 'Backend specialist. Owns auth, sessions, and the token pipeline.');
  const iris = agent('Docs writer Iris', 'Rewriting the API reference for v2', 'Turns shipped features into clear docs and examples.');
  const qa = agent('QA bot', 'Running the end-to-end regression suite', 'Runs the full e2e suite on every change and reports failures.');

  store.setStatus(max.id, 'waiting');
  store.setStatus(iris.id, 'working');
  store.setStatus(qa.id, 'done');

  // 1:1 thread on Max — the signature notify -> notify -> blocking ask flow.
  store.addMessage({ sessionId: max.id, direction: 'agent', kind: 'notify', text: 'Cloned the repo and mapped the **auth module**. Starting the migration.' });
  store.addMessage({ sessionId: max.id, direction: 'agent', kind: 'notify', text: 'Step 2/4 done: rewrote token issuance in `auth/token.ts`. Tests green ✅' });
  store.createAsk({
    sessionId: max.id,
    question: 'The next step drops the legacy `sessions` table — this is irreversible. Proceed?',
    options: ['Proceed', 'Skip this step', 'Pause and let me check'],
  });

  // A group channel showing fan-out, an @directed message, and a group ask/answer.
  const ch = store.createChannel('release-team');
  for (const a of [max, iris, qa]) store.addParticipant(ch.id, a.id);
  store.postChannelMessage(ch.id, null, 'Ship checklist for **v2** — where are we?');
  store.postChannelMessage(ch.id, max.id, 'Auth migration done, tests green. One irreversible step left (dropping the old `sessions` table) — waiting on a decision.');
  store.postChannelMessage(ch.id, qa.id, 'e2e: **142/142 passing** ✅');
  store.postChannelMessage(ch.id, iris.id, 'API reference for v2 is drafted.', { toSessionId: max.id });
  const { ask } = store.createChannelAsk(ch.id, iris.id, 'Can someone confirm the new `/v2/login` response shape before I finalize the docs?', null, max.id);
  store.answerChannelAsk(ch.id, ask.id, max.id, 'Confirmed: `{ token, expiresAt, user }`. No `sessionId` field anymore.');
}

export {}; // make this file a module so the top-level await above is allowed
