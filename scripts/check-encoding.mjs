// Quality gate: every text file in the repo must be clean UTF-8 — no invalid
// bytes, no U+FFFD replacement chars, no UTF-8 BOM, and (in code files) no stray
// CJK ideographs, which are almost always an em-dash/ellipsis mangled by a
// Windows PowerShell rewrite into a valid-but-wrong glyph. Docs (.md) may hold
// Chinese, so they are exempt from the CJK rule. Exits 1 if anything is off.
//
// The replacement char and CJK ranges are built from code points (not literal
// glyphs) so this checker file stays pure ASCII and never flags itself.
import { readFileSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';

const REPLACEMENT = String.fromCharCode(0xfffd);
// [U+3400..U+9FFF] CJK ideographs + [U+FF01..U+FF60] fullwidth forms.
const cjkRe = new RegExp(
  '[' +
    String.fromCodePoint(0x3400) + '-' + String.fromCodePoint(0x9fff) +
    String.fromCodePoint(0xff01) + '-' + String.fromCodePoint(0xff60) +
  ']',
);
const exts = new Set(['.ts', '.tsx', '.mjs', '.js', '.json', '.md', '.html', '.css']);
const skip = new Set(['node_modules', '.git', 'dist', '.qa', 'data']);
// Files that legitimately contain CJK in code: the UI translation dictionary.
// All other user-facing Chinese must live here, so the CJK-in-code heuristic
// keeps catching accidental mojibake everywhere else. (Invalid-UTF8 / U+FFFD /
// BOM checks still apply to this file too.)
const cjkAllow = new Set(['web/src/lib/i18n.tsx']);
const dec = new TextDecoder('utf-8', { fatal: true });
const bad = [];

function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!exts.has(extname(e.name))) continue;
    const buf = readFileSync(p);
    const issues = [];
    try {
      const txt = dec.decode(buf);
      const rel = p.replace(/\\/g, '/').replace(/^\.\//, '');
      if (txt.includes(REPLACEMENT)) issues.push('U+FFFD');
      if (extname(e.name) !== '.md' && !cjkAllow.has(rel) && cjkRe.test(txt)) {
        issues.push('CJK-in-code(mojibake?)');
      }
    } catch {
      issues.push('invalid-UTF8');
    }
    if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) issues.push('BOM');
    if (issues.length) bad.push(`${issues.join(',').padEnd(24)} ${p}`);
  }
}

walk('.');
if (bad.length) {
  console.error('Encoding check FAILED:\n' + bad.join('\n'));
  process.exit(1);
}
console.log('Encoding check passed: clean UTF-8, no BOM, no U+FFFD, no stray CJK in code.');
