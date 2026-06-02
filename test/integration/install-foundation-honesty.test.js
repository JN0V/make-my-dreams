// Anchor tests for the install "foundation + honesty" polish (2026-06-02).
//
// Decision (Sébastien): the stacks MMD stands on are the FOUNDATION, not timid
// extras. bun + gStack power `mmd qa` / `mmd cso` / `mmd document-release`, so:
//   1. the interactive prompts DEFAULT TO INSTALL ([Y/n], not [y/N]);
//   2. any skip/decline/non-interactive path is HONEST — it NAMES the commands
//      that become unavailable, never a silent half-working install (§VI);
//   3. the framing calls them foundation, and drops the retired `mmd ship` /
//      `/ship` references.
//
// Pure file-content anchors — fast, deterministic. The actual non-interactive
// honest-message behavior is additionally exercised in install-mmd.test.js
// (bun phase 0) and install.sh runs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const INSTALL_SH = readFileSync(path.join(REPO_ROOT, 'install.sh'), 'utf8');
const INSTALL_MMD_SH = readFileSync(path.join(REPO_ROOT, 'install-mmd.sh'), 'utf8');

// ── Default to install (foundation, not an afterthought) ───────────────────

test('@unit install-mmd.sh bun prompt defaults to install ([Y/n])', () => {
  assert.match(INSTALL_MMD_SH, /Install bun now\? \[Y\/n\]/,
    'bun is foundation — the prompt default must be install, not skip');
});

test('@unit install-mmd.sh gStack prompt defaults to install ([Y/n])', () => {
  assert.match(INSTALL_MMD_SH, /Install gStack now\? \[Y\/n\]/,
    'gStack is foundation — the prompt default must be install, not skip');
});

test('@unit install.sh gStack prompt defaults to install ([Y/n])', () => {
  assert.match(INSTALL_SH, /Install gStack now\? \[Y\/n\]/);
});

// ── Honest gating: a skip NAMES what it disables (no silent half-working MMD) ─

test('@unit install-mmd.sh names the disabled commands when bun is absent', () => {
  assert.match(INSTALL_MMD_SH, /UNAVAILABLE/);
  // the three gStack-backed commands must be named so the user knows the cost
  assert.match(INSTALL_MMD_SH, /mmd qa/);
  assert.match(INSTALL_MMD_SH, /mmd cso/);
  assert.match(INSTALL_MMD_SH, /mmd document-release/);
});

test('@unit install-mmd.sh names the disabled commands when gStack is absent', () => {
  // The gStack block prints a loud "UNAVAILABLE" line naming the three commands.
  const gstackBlock = INSTALL_MMD_SH.slice(INSTALL_MMD_SH.indexOf('gStack is NOT installed'));
  assert.match(gstackBlock, /UNAVAILABLE/);
  assert.match(gstackBlock, /mmd qa.*mmd cso.*mmd document-release|mmd qa', 'mmd cso/);
});

test('@unit install.sh is honest on every gStack skip path (env-skip, decline, non-interactive)', () => {
  // Each of the three not-installed paths must say UNAVAILABLE + name commands.
  const occurrences = (INSTALL_SH.match(/UNAVAILABLE/g) || []).length;
  assert.ok(occurrences >= 3, `expected ≥3 honest UNAVAILABLE notices on the gStack skip paths, got ${occurrences}`);
  assert.match(INSTALL_SH, /mmd qa.*mmd cso.*mmd document-release/);
});

// ── Foundation framing, no retired-command references ──────────────────────

test('@unit the install scripts frame bun/gStack as the foundation MMD stands on', () => {
  assert.match(INSTALL_MMD_SH, /foundation MMD stands on/);
  assert.match(INSTALL_SH, /foundation MMD stands on/);
});

test('@unit the install scripts do not present the retired `mmd ship` / `/ship` as a capability', () => {
  assert.doesNotMatch(INSTALL_SH, /mmd ship|\/ship/, 'install.sh must not reference the retired ship command');
  // install-mmd.sh prose may say "ships a gate"/"ships as a plugin"; only the
  // capability forms `mmd ship` / `/ship` are forbidden.
  assert.doesNotMatch(INSTALL_MMD_SH, /mmd ship\b|\/ship\b/,
    'install-mmd.sh must not reference the retired ship command as a capability');
});
