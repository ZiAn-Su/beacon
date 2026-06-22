// Release cutter — one command to ship a versioned release safely.
//
//   node scripts/release.mjs <patch|minor|major>
//   (or: npm run release -- minor)
//
// What it does, in order, aborting on the first failure:
//   1. computes the next version from package.json
//   2. GATE: refuses unless CHANGELOG.md already has a "## [<next>]" section
//      (release notes are written by a human/agent first — the script never
//      invents them)
//   3. verifies the build: typecheck + encoding + web build
//   4. bumps version in package.json + web/package.json
//   5. commits (package.json + web/package.json + CHANGELOG.md), tags v<next>
//   6. pushes main + the tag
//
// It does NOT restart any running platform — deploying to a live instance is a
// separate, deliberate step (see RELEASE.md), because a restart briefly drops
// WebSocket / long-poll connections for real users.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = resolve(root, 'web');

const bump = (process.argv[2] || '').toLowerCase();
if (!['patch', 'minor', 'major'].includes(bump)) {
  console.error('usage: node scripts/release.mjs <patch|minor|major>');
  process.exit(1);
}

const pkgPath = resolve(root, 'package.json');
const webPkgPath = resolve(webRoot, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(pkg.version);
if (!m) {
  console.error(`package.json version "${pkg.version}" is not X.Y.Z`);
  process.exit(1);
}
const [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
const next =
  bump === 'major' ? `${maj + 1}.0.0` : bump === 'minor' ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`;
console.log(`release: ${pkg.version} -> ${next} (${bump})`);

// 1. CHANGELOG gate — release notes must exist first.
const changelog = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8');
if (!changelog.includes(`## [${next}]`)) {
  console.error(`\nABORT: CHANGELOG.md has no "## [${next}]" section.`);
  console.error(`Write the ${next} release notes first, then re-run.`);
  process.exit(1);
}

// 2. clean tree (besides the version files we are about to touch) — avoid
//    sweeping unrelated work into the release commit.
const dirty = execSync('git status --porcelain', { cwd: root, encoding: 'utf8' })
  .split('\n')
  .map((l) => l.slice(3).trim())
  .filter(Boolean)
  .filter((f) => !['package.json', 'web/package.json', 'CHANGELOG.md'].includes(f));
if (dirty.length) {
  console.error('\nABORT: working tree has uncommitted changes besides version/CHANGELOG:');
  for (const f of dirty) console.error(`  ${f}`);
  console.error('Commit or stash them first — a release should be a clean, deliberate cut.');
  process.exit(1);
}

const run = (cmd, cwd = root) => {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd });
};

// 3. verify
run('npm run typecheck');
run('npm run check:encoding');
run('npm run test');
run('npm run build', webRoot);

// 4. bump both manifests
for (const p of [pkgPath, webPkgPath]) {
  writeFileSync(p, readFileSync(p, 'utf8').replace(/"version":\s*"[^"]+"/, `"version": "${next}"`));
}
console.log(`\nbumped package.json + web/package.json -> ${next}`);

// 5. commit + tag
run('git add package.json web/package.json CHANGELOG.md');
run(`git commit -m "release: v${next}"`);
run(`git tag v${next}`);

// 6. push
run('git push origin main');
run(`git push origin v${next}`);

console.log(`\n✓ Released v${next} (committed, tagged, pushed).`);
console.log(`Deploy to the live instance per RELEASE.md (pull + build:web + restart).`);
