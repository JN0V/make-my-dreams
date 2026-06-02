// Anchor tests for the install one-liner fix (field bug, 2026-06-02):
//
//   1. `curl … | bash` makes stdin a pipe, not a terminal, so every `[ -t 0 ]`
//      prompt in install.sh AND install-mmd.sh silently took its non-interactive
//      branch — installing NEITHER bun NOR gStack. The fix reconnects stdin to
//      the controlling terminal (`exec < /dev/tty`) at the top of BOTH scripts
//      when stdin is not a TTY but a terminal exists.
//   2. The end-of-install "Next steps" / "Usage" displays were stale (pre-v0.3):
//      they pointed at `/bmad-adv-auto-dev` and BOOTSTRAP v0.0/v0.1, never the
//      current `mmd serve` / `mmd "<dream>"` / `mmd --here` / `/mmd` surface.
//
// These are PURE FILE-CONTENT anchors (no script execution) — fast, deterministic,
// and they lock the fix against regression without needing a pseudo-terminal.
// They mirror the project's existing anchor-test discipline (L-009/L-023): pin
// the exact guard + the exact post-install guidance so a future edit can't
// silently re-break the piped install or re-introduce the stale display.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const INSTALL_SH = readFileSync(path.join(REPO_ROOT, 'install.sh'), 'utf8');
const INSTALL_MMD_SH = readFileSync(path.join(REPO_ROOT, 'install-mmd.sh'), 'utf8');

// The exact guard both scripts use to make a piped install interactive. Matching
// the whole condition (not just `/dev/tty`) ensures the no-op-in-true-CI safety
// is preserved: it only redirects when stdin is NOT a tty AND a terminal exists.
const TTY_RECONNECT = /if \[ ! -t 0 \] && \[ -r \/dev\/tty \]; then\s*\n\s*exec < \/dev\/tty\s*\n\s*fi/;

test('@unit install.sh reconnects stdin to the terminal when piped', () => {
  assert.match(INSTALL_SH, TTY_RECONNECT,
    'install.sh must reconnect stdin to /dev/tty when piped — else curl|bash installs neither bun nor gStack');
});

test('@unit install-mmd.sh reconnects stdin to the terminal when piped', () => {
  assert.match(INSTALL_MMD_SH, TTY_RECONNECT,
    'install-mmd.sh must reconnect stdin to /dev/tty when piped — else its bun/pillar prompts silently skip');
});

test('@unit the tty reconnect is a no-op in true non-interactive contexts (CI safety)', () => {
  // The `[ -r /dev/tty ]` half of the guard is what keeps CI / the test suite
  // safe (no controlling terminal → no redirect → existing MMD_AUTO_INSTALL_*
  // path applies). If someone drops that half, the suite could hang on a read.
  for (const [name, src] of [['install.sh', INSTALL_SH], ['install-mmd.sh', INSTALL_MMD_SH]]) {
    assert.ok(src.includes('[ -r /dev/tty ]'),
      `${name} must guard the reconnect on /dev/tty being readable (CI safety)`);
  }
});

test('@unit install.sh "Next steps" lead with the current mmd CLI surface, not the stale /bmad-adv-auto-dev', () => {
  // The post-install guidance must point at today's entry points.
  assert.match(INSTALL_SH, /mmd serve/, 'install.sh should suggest `mmd serve`');
  assert.match(INSTALL_SH, /mmd --here/, 'install.sh should suggest `mmd --here`');
  assert.match(INSTALL_SH, /\/mmd /, 'install.sh should mention the /mmd operator command');
  assert.match(INSTALL_SH, /npm install -g \./, 'install.sh should tell the user how to put mmd on PATH');
  // The old primary "try this" line must be gone (the slash-command may still be
  // mentioned as a low-level alternative, but never as the headline next step).
  assert.doesNotMatch(INSTALL_SH, /try:\s*\n\s*printf "      \$\{CYAN\}\/bmad-adv-auto-dev/,
    'install.sh must not present /bmad-adv-auto-dev as the primary next step');
  assert.doesNotMatch(INSTALL_SH, /BOOTSTRAP\.md.*v0\.0 and v0\.1/,
    'install.sh must not point newcomers at the v0.0/v0.1 bootstrap walk-through as the next step');
});

test('@unit install-mmd.sh end-of-install display leads with the mmd CLI', () => {
  assert.match(INSTALL_MMD_SH, /mmd serve/, 'install-mmd.sh summary should suggest `mmd serve`');
  assert.match(INSTALL_MMD_SH, /mmd --here/, 'install-mmd.sh summary should suggest `mmd --here`');
  assert.match(INSTALL_MMD_SH, /npm install -g \./, 'install-mmd.sh summary should tell the user how to put mmd on PATH');
  // The stale "Coming phases" list (FAST engine / Onboarder / Conductor /
  // Worktrees as future) described already-shipped work — it must be gone.
  assert.doesNotMatch(INSTALL_MMD_SH, /Coming phases/,
    'install-mmd.sh must not list already-shipped capabilities as "Coming phases"');
});
