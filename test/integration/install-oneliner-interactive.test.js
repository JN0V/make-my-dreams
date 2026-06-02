// Anchor + mechanism tests for the install one-liner interactivity (field bug,
// 2026-06-02, then its first-fix regression).
//
// THE BUG (round 1): `curl … | install.sh | bash` makes stdin a pipe, so every
// `[ -t 0 ]` prompt in install.sh / install-mmd.sh silently skipped — installing
// NEITHER bun NOR gStack.
//
// THE FIRST FIX WAS WORSE (round 2): it put `exec < /dev/tty` at the TOP of both
// scripts. For install.sh that is CATASTROPHIC: install.sh is run PIPED, so bash
// reads the script itself from fd 0 (the pipe); `exec < /dev/tty` permanently
// reassigns fd 0, and bash then reads the REST OF THE SCRIPT from the keyboard
// → the install halts. (It was invisible in CI/tests because they have no
// /dev/tty, so the `[ -r /dev/tty ]` guard skipped the exec.)
//
// THE CORRECT FIX:
//   • install.sh (always PIPED): NO top-level exec. A per-command helper
//     `ask_tty` reads one answer via `read … < /dev/tty`, which does NOT disturb
//     the stream bash reads the script from. Pipe-safe by construction.
//   • install-mmd.sh (always a FILE argument: `bash install-mmd.sh`): bash reads
//     the script from the FILE, not fd 0, so a top-level `exec < /dev/tty` is
//     safe THERE and conveniently covers all five prompts at once.
//
// These tests pin that asymmetry (content anchors) AND prove the underlying
// mechanism deterministically with a stand-in file (no /dev/tty needed), so the
// regression can never silently come back.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const INSTALL_SH = readFileSync(path.join(REPO_ROOT, 'install.sh'), 'utf8');
const INSTALL_MMD_SH = readFileSync(path.join(REPO_ROOT, 'install-mmd.sh'), 'utf8');

// A view with whole-line `#` comments stripped — so assertions about what the
// script DOES are not fooled by comment prose that mentions a pattern in order
// to warn against it (e.g. "we MUST NOT do `exec < /dev/tty`").
const codeOnly = (src) => src.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const INSTALL_SH_CODE = codeOnly(INSTALL_SH);

// ── install.sh: pipe-safe, NEVER exec ──────────────────────────────────────

test('@unit install.sh never uses `exec < /dev/tty` (it is run PIPED — exec would halt the script)', () => {
  assert.doesNotMatch(INSTALL_SH_CODE, /exec\s*<\s*\/dev\/tty/,
    'install.sh is piped via curl|bash; `exec < /dev/tty` reassigns fd 0 and bash then reads the rest of the script from the keyboard. Use per-command `read < /dev/tty` instead.');
});

test('@unit install.sh defines an ask_tty helper that reads per-command from /dev/tty', () => {
  assert.match(INSTALL_SH, /ask_tty\s*\(\)\s*\{/, 'install.sh should define ask_tty()');
  assert.match(INSTALL_SH, /read -r REPLY < \/dev\/tty/,
    'ask_tty must read from /dev/tty PER COMMAND (pipe-safe), not via exec');
});

test('@unit install.sh gStack prompt goes through ask_tty (so it works under curl|bash)', () => {
  assert.match(INSTALL_SH, /if ask_tty "    Install gStack now\? \[Y\/n\] "; then/,
    'the gStack prompt must use ask_tty so a piped install can still answer it');
});

// ── install-mmd.sh: exec is safe BECAUSE it is a file-argument invocation ───

test('@unit install-mmd.sh keeps the top-level /dev/tty reconnect, guarded on a readable terminal', () => {
  assert.match(INSTALL_MMD_SH, /if \[ ! -t 0 \] && \[ -r \/dev\/tty \]; then\s*\n\s*exec < \/dev\/tty\s*\n\s*fi/,
    'install-mmd.sh (a file-arg invocation) may reconnect fd 0 once; the [ -r /dev/tty ] guard keeps CI a no-op');
});

test('@unit install-mmd.sh documents that its exec is safe ONLY because it is invoked as a file argument', () => {
  assert.match(INSTALL_MMD_SH, /FILE ARGUMENT/,
    'the comment must explain WHY exec is safe here (file-arg) so nobody copies it into a piped script');
});

// ── Display currency anchors (unchanged from the first fix) ─────────────────

test('@unit install.sh "Next steps" lead with the current mmd CLI surface', () => {
  assert.match(INSTALL_SH, /mmd serve/);
  assert.match(INSTALL_SH, /mmd --here/);
  assert.match(INSTALL_SH, /\/mmd /);
  assert.match(INSTALL_SH, /npm install -g \./);
  assert.doesNotMatch(INSTALL_SH, /BOOTSTRAP\.md.*v0\.0 and v0\.1/);
});

test('@unit install-mmd.sh end-of-install display leads with the mmd CLI', () => {
  assert.match(INSTALL_MMD_SH, /mmd serve/);
  assert.match(INSTALL_MMD_SH, /mmd --here/);
  assert.match(INSTALL_MMD_SH, /npm install -g \./);
  assert.doesNotMatch(INSTALL_MMD_SH, /Coming phases/);
});

// ── Mechanism proof (deterministic, no /dev/tty needed) ─────────────────────
// We reproduce the EXACT failure mode with a regular file standing in for the
// terminal: pipe a tiny script into `bash` and check whether the line AFTER the
// prompt still runs. `read < FILE` is pipe-safe (AFTER runs); `exec < FILE`
// breaks the piped script (AFTER never runs). This locks the lesson regardless
// of whether the CI box has a controlling terminal.

test('@integration mechanism: per-command `read < file` keeps a PIPED script running (the pattern install.sh uses)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-tty-'));
  try {
    const standin = path.join(dir, 'standin');
    writeFileSync(standin, ''); // EOF, like a terminal with no queued input
    const script = `echo BEFORE\nread -r X < ${standin}\necho AFTER\n`;
    const r = spawnSync('bash', { input: script, encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /BEFORE/);
    assert.match(r.stdout, /AFTER/, 'per-command redirect must NOT break the piped script — AFTER must run');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration mechanism: top-level `exec < file` BREAKS a PIPED script (why install.sh must not do it)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-tty-'));
  try {
    const standin = path.join(dir, 'standin');
    writeFileSync(standin, ''); // EOF
    const script = `echo BEFORE\nexec < ${standin}\necho AFTER\n`;
    const r = spawnSync('bash', { input: script, encoding: 'utf8' });
    assert.match(r.stdout, /BEFORE/);
    assert.doesNotMatch(r.stdout, /AFTER/,
      'exec reassigns fd 0; bash then reads the rest of the piped script from the stand-in (EOF) — AFTER must NOT run. This is exactly the bug the round-1 fix introduced in install.sh.');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
