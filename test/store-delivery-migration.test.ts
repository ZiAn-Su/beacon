// Regression test for the one-time deliveredAt backfill (store.ts, user_version
// gate). Before 0.10.2, terminal-pushed messages were never stamped delivered;
// the new replay-on-reconnect would re-send that whole backlog. The migration
// marks pre-existing 1:1 human messages delivered, runs once, and is idempotent.
// Validated here against a raw DB seeded to look "pre-migration".
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const tmpDir = join(tmpdir(), 'beacon-test-migr-' + randomUUID());
mkdirSync(tmpDir, { recursive: true });
const dbPath = join(tmpDir, 'm.db');

after(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

// The exact one-time migration store.ts runs, applied to a given db handle.
function runBackfill(db: Database.Database): void {
  const ver = db.pragma('user_version', { simple: true }) as number;
  if (ver < 1) {
    db.exec(
      `UPDATE messages SET deliveredAt = createdAt
       WHERE deliveredAt IS NULL AND direction = 'human' AND kind = 'chat'`,
    );
    db.pragma('user_version = 1');
  }
}

test('backfill marks pre-existing 1:1 human messages delivered, leaves others, pins version', () => {
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE messages (id TEXT PRIMARY KEY, sessionId TEXT, direction TEXT, kind TEXT, createdAt INTEGER, deliveredAt INTEGER)`);
  const ins = db.prepare(`INSERT INTO messages (id, sessionId, direction, kind, createdAt, deliveredAt) VALUES (?,?,?,?,?,?)`);
  ins.run('h1', 's1', 'human', 'chat', 1000, null);   // old human chat, never stamped
  ins.run('h2', 's1', 'human', 'chat', 2000, 1500);   // already delivered — keep its ts
  ins.run('a1', 's1', 'agent', 'notify', 1200, null); // agent message — not a 1:1 inbound, leave null

  assert.equal(db.pragma('user_version', { simple: true }), 0);
  runBackfill(db);

  const rows = Object.fromEntries(
    (db.prepare(`SELECT id, deliveredAt FROM messages`).all() as { id: string; deliveredAt: number | null }[])
      .map((r) => [r.id, r.deliveredAt]),
  );
  assert.equal(rows.h1, 1000); // backfilled to createdAt
  assert.equal(rows.h2, 1500); // untouched (already had a value)
  assert.equal(rows.a1, null); // agent message left alone
  assert.equal(db.pragma('user_version', { simple: true }), 1); // pinned
  db.close();
});

test('re-running the migration is a no-op (does not re-touch later-undelivered messages)', () => {
  const db = new Database(dbPath); // user_version already 1 from the previous test
  // A NEW genuinely-undelivered message arrives after the one-time backfill.
  db.prepare(`INSERT INTO messages (id, sessionId, direction, kind, createdAt, deliveredAt) VALUES (?,?,?,?,?,?)`)
    .run('h3', 's1', 'human', 'chat', 3000, null);
  runBackfill(db); // must NOT mark h3 (version already pinned)
  const h3 = db.prepare(`SELECT deliveredAt FROM messages WHERE id = 'h3'`).get() as { deliveredAt: number | null };
  assert.equal(h3.deliveredAt, null); // still undelivered -> will be replayed/pulled normally
  db.close();
});
