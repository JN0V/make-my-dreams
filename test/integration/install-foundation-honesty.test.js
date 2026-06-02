// Anchor tests for the install "foundation + honesty" polish (2026-06-02).
//
// Decision (Sébastien): the stacks MMD stands on are the FOUNDATION, not timid
// extras. bun + gStack power `mmdream qa` / `mmdream cso` / `mmdream document-release`, so:
//   1. the interactive prompts DEFAULT TO INSTALL ([Y/n], not [y/N]);
//   2. any skip/decline/non-interactive path is HONEST — it NAMES the commands
//      that become unavailable, never a silent half-working install (§VI);
//   3. the framing calls them foundation, and drops the retired `mmdream ship` /
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

// ── Default to install EVEN NON-INTERACTIVELY (the curl|bash fix) ──────────
// The bug Sébastien hit: a piped `curl … | bash` had no terminal, so bun/gStack
// fell to a non-interactive SKIP. A foundation does not ask permission to be the
// foundation: the non-interactive branch must INSTALL by default. The install
// commands themselves need no terminal — only the (now optional) prompt did.

test('@unit install-mmd.sh installs bun by default when there is no terminal (not skip)', () => {
  assert.match(INSTALL_MMD_SH, /Non-interactive — installing bun \(foundation\)/,
    'a curl|bash with no /dev/tty must still install bun (foundation), not skip it');
});

test('@unit install-mmd.sh installs gStack by default when there is no terminal (not skip)', () => {
  assert.match(INSTALL_MMD_SH, /Non-interactive — installing gStack \(foundation\)/);
});

test('@unit install.sh installs gStack by default when there is no terminal (not skip)', () => {
  assert.match(INSTALL_SH, /Non-interactive — installing gStack \(foundation\)/);
});

test('@unit the escape hatch is an OPT-OUT env var, not the price of entry', () => {
  // Foundation installs by default; MMD_SKIP_* is how an advanced user opts out.
  assert.match(INSTALL_MMD_SH, /MMD_SKIP_BUN/, 'install-mmd.sh must offer MMD_SKIP_BUN as the opt-out');
  assert.match(INSTALL_MMD_SH, /MMD_SKIP_GSTACK/, 'install-mmd.sh must offer MMD_SKIP_GSTACK as the opt-out');
  assert.match(INSTALL_SH, /MMD_SKIP_GSTACK/, 'install.sh must honor MMD_SKIP_GSTACK');
});

// ── Honest gating: a skip NAMES what it disables (no silent half-working MMD) ─

test('@unit install-mmd.sh names the disabled commands when bun is absent', () => {
  assert.match(INSTALL_MMD_SH, /UNAVAILABLE/);
  // the three gStack-backed commands must be named so the user knows the cost
  assert.match(INSTALL_MMD_SH, /mmdream qa/);
  assert.match(INSTALL_MMD_SH, /mmdream cso/);
  assert.match(INSTALL_MMD_SH, /mmdream document-release/);
});

test('@unit install-mmd.sh names the disabled commands when gStack is absent', () => {
  // The gStack block prints a loud "UNAVAILABLE" line naming the three commands.
  const gstackBlock = INSTALL_MMD_SH.slice(INSTALL_MMD_SH.indexOf('gStack is NOT installed'));
  assert.match(gstackBlock, /UNAVAILABLE/);
  assert.match(gstackBlock, /mmdream qa.*mmdream cso.*mmdream document-release|mmdream qa', 'mmdream cso/);
});

test('@unit install.sh is honest on every gStack skip path (env-skip, decline, non-interactive)', () => {
  // Each of the three not-installed paths must say UNAVAILABLE + name commands.
  const occurrences = (INSTALL_SH.match(/UNAVAILABLE/g) || []).length;
  assert.ok(occurrences >= 3, `expected ≥3 honest UNAVAILABLE notices on the gStack skip paths, got ${occurrences}`);
  assert.match(INSTALL_SH, /mmdream qa.*mmdream cso.*mmdream document-release/);
});

// ── gStack install uses the real, resolvable source ───────────────────────
// `https://gstack.dev/install.sh` does NOT resolve; the canonical source is the
// GitHub repo + `bun install`. Both scripts must agree on it.

test('@unit neither install script references the non-resolving gstack.dev host', () => {
  assert.doesNotMatch(INSTALL_MMD_SH, /gstack\.dev/, 'install-mmd.sh must not use the non-resolving gstack.dev host');
  assert.doesNotMatch(INSTALL_SH, /gstack\.dev/, 'install.sh must not use the non-resolving gstack.dev host');
});

test('@unit install-mmd.sh installs gStack from github.com/garrytan/gstack via bun install', () => {
  assert.match(INSTALL_MMD_SH, /git clone --depth=1 https:\/\/github\.com\/garrytan\/gstack\.git/,
    'gStack must be installed by cloning the real repo');
  assert.match(INSTALL_MMD_SH, /bun install/, 'and running bun install in it');
});

// ── Foundation framing, no retired-command references ──────────────────────

test('@unit the install scripts frame bun/gStack as the foundation MMD stands on', () => {
  assert.match(INSTALL_MMD_SH, /foundation MMD stands on/);
  assert.match(INSTALL_SH, /foundation MMD stands on/);
});

test('@unit the install scripts do not present the retired `mmdream ship` / `/ship` as a capability', () => {
  assert.doesNotMatch(INSTALL_SH, /mmdream ship|\/ship/, 'install.sh must not reference the retired ship command');
  // install-mmd.sh prose may say "ships a gate"/"ships as a plugin"; only the
  // capability forms `mmdream ship` / `/ship` are forbidden.
  assert.doesNotMatch(INSTALL_MMD_SH, /mmdream ship\b|\/ship\b/,
    'install-mmd.sh must not reference the retired ship command as a capability');
});
