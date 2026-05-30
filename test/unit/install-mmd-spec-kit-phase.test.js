// @unit tests for install-mmd.sh Phase 5 (Spec Kit) — SPEC_V02M AC-1.
//
// Strategy mirrors the established install-mmd.test.js pattern: extract the
// self-contained Phase 5 block by its `# PHASE 5:` / `# PHASE 6:` markers,
// wrap it with neutral helpers, and drive it under a controlled HOME / PATH so
// it never touches the developer's real environment. The detection + decision
// logic (command -v specify + user input + MMD_* env vars) is pure enough to
// tag @unit even though it executes via bash.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const INSTALLER = path.join(REPO_ROOT, 'install-mmd.sh');

/** Extract the Phase 5 (Spec Kit) block into a runnable temp script. */
function extractPhase5() {
  const src = readFileSync(INSTALLER, 'utf8');
  const startIdx = src.indexOf('# PHASE 5: Spec Kit');
  const endIdx = src.indexOf('# PHASE 6:');
  if (startIdx < 0 || endIdx < 0) {
    throw new Error('install-mmd.sh: Phase 5 (Spec Kit) markers not found');
  }
  const phase = src.slice(startIdx, endIdx);
  const helpers = `#!/usr/bin/env bash
set -euo pipefail
RED=''; GREEN=''; YELLOW=''; CYAN=''; BOLD=''; NC=''
ok()   { printf "  OK %s\\n" "$1"; }
warn() { printf "  WARN %s\\n" "$1"; }
fail() { printf "  FAIL %s\\n" "$1"; }
info() { printf "  INFO %s\\n" "$1"; }
header() { printf "\\n=== %s ===\\n" "$1"; }
TARGET="\${1:-\$(pwd)}"
${phase}
exit 0
`;
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-installer-phase5-'));
  const scriptPath = path.join(dir, 'phase5.sh');
  writeFileSync(scriptPath, helpers);
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

/** Create a fake `specify` on a fresh bin dir; returns the bin dir for PATH. */
function fakeSpecify(versionLine) {
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-fake-specify-'));
  const bin = path.join(dir, 'specify');
  writeFileSync(bin, `#!/usr/bin/env bash\nif [ "$1" = "--version" ]; then echo "${versionLine}"; exit 0; fi\nexit 0\n`);
  chmodSync(bin, 0o755);
  return dir;
}

test('@unit install-mmd phase 5: specify absent + non-interactive warns and continues (exit 0)', () => {
  const phase5 = extractPhase5();
  try {
    const r = spawnSync('bash', [phase5], {
      encoding: 'utf8',
      timeout: 15000,
      env: { PATH: '/usr/bin:/bin' },
    });
    assert.equal(r.status, 0, `expected exit 0; stdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stdout, /NOT installed/i);
    assert.match(r.stdout, /MMD_AUTO_INSTALL_SPEC_KIT=1/);
  } finally {
    rmSync(path.dirname(phase5), { recursive: true, force: true });
  }
});

test('@unit install-mmd phase 5: specify absent + MMD_REQUIRE_SPEC_KIT=1 exits 1', () => {
  const phase5 = extractPhase5();
  try {
    const r = spawnSync('bash', [phase5], {
      encoding: 'utf8',
      timeout: 15000,
      env: { PATH: '/usr/bin:/bin', MMD_REQUIRE_SPEC_KIT: '1' },
    });
    assert.equal(r.status, 1, `expected exit 1; stdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stdout, /Spec Kit is required \(MMD_REQUIRE_SPEC_KIT=1\)/);
  } finally {
    rmSync(path.dirname(phase5), { recursive: true, force: true });
  }
});

test('@unit install-mmd phase 5: specify present + functional reports present + functional', () => {
  const phase5 = extractPhase5();
  const fakeDir = fakeSpecify('specify 1.42.0-fake');
  try {
    const r = spawnSync('bash', [phase5], {
      encoding: 'utf8',
      timeout: 15000,
      env: { PATH: `${fakeDir}:/usr/bin:/bin` },
    });
    assert.equal(r.status, 0, `expected exit 0; stdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stdout, /present \+ functional/i);
    assert.match(r.stdout, /1\.42\.0-fake/);
  } finally {
    rmSync(path.dirname(phase5), { recursive: true, force: true });
    rmSync(fakeDir, { recursive: true, force: true });
  }
});
