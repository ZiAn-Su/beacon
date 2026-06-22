// Image upload storage. The human can attach an image to a message; we save it
// to a files dir next to the SQLite db and hand the agent the absolute file
// PATH (the universal route — Claude Code, codex, any runtime can read a file by
// path). The web UI renders a thumbnail from the served URL. Base64 in, file out;
// no extra deps. Single-user, local platform — images live on the same box.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const DB_PATH = process.env.BEACON_DB ?? 'data/beacon.db';
// Absolute so the path we give an agent is one it can open regardless of its cwd.
const UPLOADS_DIR = resolve(
  process.env.BEACON_UPLOADS ?? join(dirname(DB_PATH), 'uploads'),
);

// Allowlisted image types -> file extension. Anything else is refused.
const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};
const MIME_BY_EXT: Record<string, string> = Object.fromEntries(
  Object.entries(EXT_BY_MIME).map(([m, e]) => [e, m]),
);

// 20 MB cap on a single decoded image — generous for a screenshot, bounded so a
// bad client can't fill the disk in one request.
const MAX_BYTES = 20 * 1024 * 1024;

function ensureDir(): void {
  if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });
}

export interface SavedUpload {
  id: string;
  name: string;
  mime: string;
  size: number;
  url: string;
  path: string;
}

/** Persist a base64 image. Throws on unsupported type or oversize. */
export function saveUpload(input: {
  name?: string | null;
  mime: string;
  dataBase64: string;
}): SavedUpload {
  const ext = EXT_BY_MIME[input.mime];
  if (!ext) throw new Error('unsupported image type');
  const buf = Buffer.from(input.dataBase64, 'base64');
  if (buf.length === 0) throw new Error('empty image');
  if (buf.length > MAX_BYTES) throw new Error('image too large');
  ensureDir();
  const id = randomUUID();
  const file = `${id}.${ext}`;
  const abs = join(UPLOADS_DIR, file);
  writeFileSync(abs, buf);
  const name = (input.name ?? '').toString().slice(0, 200) || file;
  return { id, name, mime: input.mime, size: buf.length, url: `/api/uploads/${id}`, path: abs };
}

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolve an upload id to its absolute path + mime, or null if unknown. */
export function resolveUpload(id: string): { path: string; mime: string } | null {
  if (!ID_RE.test(id)) return null;
  for (const [ext, mime] of Object.entries(MIME_BY_EXT)) {
    const abs = join(UPLOADS_DIR, `${id}.${ext}`);
    if (existsSync(abs)) return { path: abs, mime };
  }
  return null;
}
