// @unit tests for install-mmd.sh Phase 6 (OpenSpec) — SPEC_V02M AC-2.
//
// Same extraction strategy as the Spec Kit phase test: pull the Phase 6 block
// out by its `# PHASE 6:` / `# PHASE 7:` markers and drive it under a
// controlled PATH. AC-2 is "identical shape to AC-1" with the openspec command,
// `npm install -g openspec`, and the MMD_*_OPENSPEC env vars.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const INSTALLER = path.join(REPO_ROOT, 'install-mmd.sh');

/** Extract the Phase 6 (OpenSpec) block into a runnable temp script. */
function extractPhase6() {
  const src = readFileSync(INSTALLER, 'utf8');
  const startIdx = src.indexOf('# PHASE 6: OpenSpec');
  const endIdx = src.indexOf('# PHASE 7:');
  if (startIdx < 0 || endIdx < 0) {
    throw new Error('install-mmd.sh: Phase 6 (OpenSpec) markers not found');
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
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-installer-phase6os-'));
  const scriptPath = path.join(dir, 'phase6.sh');
  writeFileSync(scriptPath, helpers);
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

/** Create a fake `openspec` that responds to --version. */
function fakeOpenspec(versionLine) {
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-fake-openspec-'));
  const bin = path.join(dir, 'openspec');
  writeFileSync(bin, `#!/usr/bin/env bash\nif [ "$1" = "--version" ]; then echo "${versionLine}"; exit 0; fi\nif [ "$1" = "help" ]; then echo "openspec help text"; exit 0; fi\nexit 0\n`);
  chmodSync(bin, 0o755);
  return dir;
}

test('@unit install-mmd phase 6: openspec absent + non-interactive warns and continues (exit 0)', () => {
  const phase6 = extractPhase6();
  try {
    const r = spawnSync('bash', [phase6], {
      encoding: 'utf8',
      timeout: 15000,
      env: { PATH: '/usr/bin:/bin' },
    });
    assert.equal(r.status, 0, `expected exit 0; stdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stdout, /NOT installed/i);
    assert.match(r.stdout, /MMD_AUTO_INSTALL_OPENSPEC=1/);
  } finally {
    rmSync(path.dirname(phase6), { recursive: true, force: true });
  }
});

test('@unit install-mmd phase 6: openspec absent + MMD_REQUIRE_OPENSPEC=1 exits 1', () => {
  const phase6 = extractPhase6();
  try {
    const r = spawnSync('bash', [phase6], {
      encoding: 'utf8',
      timeout: 15000,
      env: { PATH: '/usr/bin:/bin', MMD_REQUIRE_OPENSPEC: '1' },
    });
    assert.equal(r.status, 1, `expected exit 1; stdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stdout, /OpenSpec is required \(MMD_REQUIRE_OPENSPEC=1\)/);
  } finally {
    rmSync(path.dirname(phase6), { recursive: true, force: true });
  }
});

test('@unit install-mmd phase 6: openspec present + functional reports present + functional', () => {
  const phase6 = extractPhase6();
  const fakeDir = fakeOpenspec('openspec 0.9.0-fake');
  try {
    const r = spawnSync('bash', [phase6], {
      encoding: 'utf8',
      timeout: 15000,
      env: { PATH: `${fakeDir}:/usr/bin:/bin` },
    });
    assert.equal(r.status, 0, `expected exit 0; stdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stdout, /present \+ functional/i);
    assert.match(r.stdout, /0\.9\.0-fake/);
  } finally {
    rmSync(path.dirname(phase6), { recursive: true, force: true });
    rmSync(fakeDir, { recursive: true, force: true });
  }
});
