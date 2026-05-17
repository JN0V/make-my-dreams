// @integration tests for install-mmd.sh — SPEC_V02F AC-1 + AC-2 functional install.
//
// Strategy: we do NOT exercise the full installer (it spawns `npx bmad-method`
// which is heavy + network-dependent). Instead we drive ONLY the Phase 0 bun
// detection and Phase 6 gStack functional verify by extracting them or by
// running the installer with environment toggles that short-circuit BMAD work.
//
// Tagged @integration because the script touches HOME, env, $PATH, runs git
// and reads files — none of which fit @unit's pure-logic constraint.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const INSTALLER = path.join(REPO_ROOT, 'install-mmd.sh');

/**
 * Extract Phase 0 (bun detection) from install-mmd.sh into a temp script.
 * The phase runs in isolation — useful to assert its behavior under a
 * controlled HOME / PATH without invoking BMAD.
 *
 * @returns {string} path to a temp script
 */
function extractPhase0() {
  const src = readFileSync(INSTALLER, 'utf8');
  const startMarker = '# PHASE 0:';
  const endMarker = '# PHASE 1:';
  const startIdx = src.indexOf(startMarker);
  const endIdx = src.indexOf(endMarker);
  if (startIdx < 0 || endIdx < 0) {
    throw new Error('install-mmd.sh: PHASE 0 markers not found');
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
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-installer-phase0-'));
  const scriptPath = path.join(dir, 'phase0.sh');
  writeFileSync(scriptPath, helpers);
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function extractPhase6() {
  const src = readFileSync(INSTALLER, 'utf8');
  const startMarker = '# PHASE 6:';
  const endMarker = '# PHASE 7:';
  const startIdx = src.indexOf(startMarker);
  const endIdx = src.indexOf(endMarker);
  if (startIdx < 0 || endIdx < 0) {
    throw new Error('install-mmd.sh: PHASE 6 markers not found');
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
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-installer-phase6-'));
  const scriptPath = path.join(dir, 'phase6.sh');
  writeFileSync(scriptPath, helpers);
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

test('@integration install-mmd phase 0: bun absent + non-interactive stdin warns and continues', () => {
  const phase0 = extractPhase0();
  try {
    // Sandbox HOME so the test never touches the developer's real ~/.bun.
    const fakeHome = mkdtempSync(path.join(tmpdir(), 'mmd-fakehome-'));
    try {
      // Reduce PATH so `bun` is definitely absent.
      const minimalPath = '/usr/bin:/bin';
      const r = spawnSync('bash', [phase0, fakeHome], {
        cwd: fakeHome,
        encoding: 'utf8',
        timeout: 15000,
        env: {
          PATH: minimalPath,
          HOME: fakeHome,
        },
        // No TTY: stdin is the default node spawn pipe — `[ -t 0 ]` is false.
      });
      assert.equal(r.status, 0, `phase 0 should not fail when bun is absent + no MMD_REQUIRE_GSTACK; stderr=${r.stderr}\nstdout=${r.stdout}`);
      assert.match(r.stdout, /NOT installed/i);
      assert.match(r.stdout, /MMD_AUTO_INSTALL_BUN=1/);
    } finally {
      rmSync(fakeHome, { recursive: true, force: true });
    }
  } finally {
    rmSync(path.dirname(phase0), { recursive: true, force: true });
  }
});

test('@integration install-mmd phase 0: bun absent + MMD_REQUIRE_GSTACK=1 exits 1', () => {
  const phase0 = extractPhase0();
  try {
    const fakeHome = mkdtempSync(path.join(tmpdir(), 'mmd-fakehome-'));
    try {
      const r = spawnSync('bash', [phase0, fakeHome], {
        cwd: fakeHome,
        encoding: 'utf8',
        timeout: 15000,
        env: {
          PATH: '/usr/bin:/bin',
          HOME: fakeHome,
          MMD_REQUIRE_GSTACK: '1',
        },
      });
      assert.equal(r.status, 1, `expected exit 1 when MMD_REQUIRE_GSTACK=1 + no bun; got ${r.status}\nstdout=${r.stdout}\nstderr=${r.stderr}`);
      assert.match(r.stdout, /bun is required for gStack integration/);
    } finally {
      rmSync(fakeHome, { recursive: true, force: true });
    }
  } finally {
    rmSync(path.dirname(phase0), { recursive: true, force: true });
  }
});

test('@integration install-mmd phase 0: bun present at $HOME/.bun/bin/bun is detected via the file fallback', () => {
  const phase0 = extractPhase0();
  try {
    const fakeHome = mkdtempSync(path.join(tmpdir(), 'mmd-fakehome-'));
    try {
      // Drop a fake `bun` binary at $HOME/.bun/bin/bun that responds to --version.
      const fakeBunDir = path.join(fakeHome, '.bun', 'bin');
      mkdirSync(fakeBunDir, { recursive: true });
      const fakeBun = path.join(fakeBunDir, 'bun');
      writeFileSync(fakeBun, '#!/usr/bin/env bash\necho "1.99.0-fake"\n');
      chmodSync(fakeBun, 0o755);

      const r = spawnSync('bash', [phase0, fakeHome], {
        cwd: fakeHome,
        encoding: 'utf8',
        timeout: 15000,
        env: {
          PATH: '/usr/bin:/bin', // bun NOT on PATH
          HOME: fakeHome,
        },
      });
      assert.equal(r.status, 0, `expected exit 0; stdout=${r.stdout}\nstderr=${r.stderr}`);
      assert.match(r.stdout, /1\.99\.0-fake/);
      // The "NOT on shell PATH" warning is part of the AC-1 fallback messaging.
      assert.match(r.stdout, /NOT on shell PATH/);
    } finally {
      rmSync(fakeHome, { recursive: true, force: true });
    }
  } finally {
    rmSync(path.dirname(phase0), { recursive: true, force: true });
  }
});

test('@integration install-mmd phase 6: gStack absent + non-interactive stdin warns and continues', () => {
  const phase6 = extractPhase6();
  try {
    const fakeHome = mkdtempSync(path.join(tmpdir(), 'mmd-fakehome-'));
    try {
      const r = spawnSync('bash', [phase6, fakeHome], {
        cwd: fakeHome,
        encoding: 'utf8',
        timeout: 15000,
        env: {
          PATH: '/usr/bin:/bin',
          HOME: fakeHome,
        },
      });
      assert.equal(r.status, 0, `expected exit 0; stdout=${r.stdout}\nstderr=${r.stderr}`);
      assert.match(r.stdout, /gStack is NOT installed|NOT installed|gstack/i);
    } finally {
      rmSync(fakeHome, { recursive: true, force: true });
    }
  } finally {
    rmSync(path.dirname(phase6), { recursive: true, force: true });
  }
});

test('@integration install-mmd phase 6: gStack absent + MMD_REQUIRE_GSTACK=1 exits 1', () => {
  const phase6 = extractPhase6();
  try {
    const fakeHome = mkdtempSync(path.join(tmpdir(), 'mmd-fakehome-'));
    try {
      const r = spawnSync('bash', [phase6, fakeHome], {
        cwd: fakeHome,
        encoding: 'utf8',
        timeout: 15000,
        env: {
          PATH: '/usr/bin:/bin',
          HOME: fakeHome,
          MMD_REQUIRE_GSTACK: '1',
        },
      });
      assert.equal(r.status, 1, `expected exit 1; stdout=${r.stdout}\nstderr=${r.stderr}`);
      assert.match(r.stdout, /not installed/i);
    } finally {
      rmSync(fakeHome, { recursive: true, force: true });
    }
  } finally {
    rmSync(path.dirname(phase6), { recursive: true, force: true });
  }
});

test('@integration install-mmd phase 6: gStack present-but-broken + MMD_REQUIRE_GSTACK=1 exits 2', () => {
  const phase6 = extractPhase6();
  try {
    const fakeHome = mkdtempSync(path.join(tmpdir(), 'mmd-fakehome-'));
    try {
      // Simulate gStack presence by creating a stub structure WITHOUT a working
      // gstack-config binary (it will be missing entirely → PRESENT_BROKEN per
      // AC-2). The gstack dir exists.
      const gstackDir = path.join(fakeHome, '.claude', 'skills', 'gstack');
      mkdirSync(gstackDir, { recursive: true });
      // No `bin/gstack-config` written → script falls into PRESENT_BROKEN.

      const r = spawnSync('bash', [phase6, fakeHome], {
        cwd: fakeHome,
        encoding: 'utf8',
        timeout: 15000,
        env: {
          PATH: '/usr/bin:/bin',
          HOME: fakeHome,
          MMD_REQUIRE_GSTACK: '1',
        },
      });
      assert.equal(r.status, 2, `expected exit 2 (broken gstack); got ${r.status}\nstdout=${r.stdout}\nstderr=${r.stderr}`);
      assert.match(r.stdout, /PRESENT BUT BROKEN/i);
    } finally {
      rmSync(fakeHome, { recursive: true, force: true });
    }
  } finally {
    rmSync(path.dirname(phase6), { recursive: true, force: true });
  }
});

test('@integration install-mmd phase 6: gStack present + functional gstack-config produces OK', () => {
  const phase6 = extractPhase6();
  try {
    const fakeHome = mkdtempSync(path.join(tmpdir(), 'mmd-fakehome-'));
    try {
      // Fake a fully functional gStack: provide a gstack-config that echoes
      // a value when called with "get proactive".
      const binDir = path.join(fakeHome, '.claude', 'skills', 'gstack', 'bin');
      mkdirSync(binDir, { recursive: true });
      const stub = path.join(binDir, 'gstack-config');
      writeFileSync(
        stub,
        '#!/usr/bin/env bash\nif [ "$1" = "get" ] && [ "$2" = "proactive" ]; then echo "true"; exit 0; fi\nexit 1\n',
      );
      chmodSync(stub, 0o755);

      const r = spawnSync('bash', [phase6, fakeHome], {
        cwd: fakeHome,
        encoding: 'utf8',
        timeout: 15000,
        env: {
          PATH: '/usr/bin:/bin',
          HOME: fakeHome,
        },
      });
      assert.equal(r.status, 0, `expected exit 0; stdout=${r.stdout}\nstderr=${r.stderr}`);
      assert.match(r.stdout, /present \+ functional/i);
    } finally {
      rmSync(fakeHome, { recursive: true, force: true });
    }
  } finally {
    rmSync(path.dirname(phase6), { recursive: true, force: true });
  }
});
