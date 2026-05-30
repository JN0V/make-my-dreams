// @integration tests for install-mmd.sh Phase 7 (Ralph Loop) — SPEC_V02M AC-3.
//
// Tagged @integration (per AC-3) because the phase shells out to a `claude`
// binary; we substitute a fake `claude` on PATH whose `plugin list` output and
// exit code are configurable, covering: present, absent, install-on-accept,
// and the "plugins unsupported / claude too old" pre-check skip.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const INSTALLER = path.join(REPO_ROOT, 'install-mmd.sh');

/** Extract the Phase 7 (Ralph Loop) block into a runnable temp script. */
function extractPhase7() {
  const src = readFileSync(INSTALLER, 'utf8');
  const startIdx = src.indexOf('# PHASE 7: Ralph Loop');
  const endIdx = src.indexOf('# PHASE 8:');
  if (startIdx < 0 || endIdx < 0) {
    throw new Error('install-mmd.sh: Phase 7 (Ralph Loop) markers not found');
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
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-installer-phase7-'));
  const scriptPath = path.join(dir, 'phase7.sh');
  writeFileSync(scriptPath, helpers);
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

/**
 * Create a fake `claude` whose `plugin list` behavior is configurable:
 *   mode='present'     -> list includes ralph-loop, exit 0
 *   mode='absent'      -> list empty, exit 0; `plugin install` exits 0 and a
 *                         marker flips the subsequent list to include ralph-loop
 *   mode='unsupported' -> `plugin list` exits 1 (Claude too old)
 */
function fakeClaude(mode) {
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-fake-claude-'));
  const bin = path.join(dir, 'claude');
  const marker = path.join(dir, 'installed');
  let script = '#!/usr/bin/env bash\n';
  script += 'if [ "$1" = "plugin" ] && [ "$2" = "list" ]; then\n';
  if (mode === 'unsupported') {
    script += '  echo "error: unknown command plugin" >&2; exit 1\n';
  } else if (mode === 'present') {
    script += '  echo "ralph-loop@1.0.0  enabled"; exit 0\n';
  } else {
    // absent, but flips to present once the install marker exists
    script += `  if [ -f "${marker}" ]; then echo "ralph-loop@1.0.0  enabled"; else echo "(no plugins)"; fi; exit 0\n`;
  }
  script += 'fi\n';
  script += 'if [ "$1" = "plugin" ] && [ "$2" = "install" ]; then\n';
  script += `  touch "${marker}"; exit 0\n`;
  script += 'fi\n';
  script += 'exit 0\n';
  writeFileSync(bin, script);
  chmodSync(bin, 0o755);
  return dir;
}

test('@integration install-mmd phase 7: ralph-loop present reports present + functional', () => {
  const phase7 = extractPhase7();
  const fakeDir = fakeClaude('present');
  try {
    const r = spawnSync('bash', [phase7], {
      encoding: 'utf8',
      timeout: 15000,
      env: { PATH: `${fakeDir}:/usr/bin:/bin` },
    });
    assert.equal(r.status, 0, `expected exit 0; stdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stdout, /present \+ functional/i);
    assert.match(r.stdout, /ralph-loop/);
  } finally {
    rmSync(path.dirname(phase7), { recursive: true, force: true });
    rmSync(fakeDir, { recursive: true, force: true });
  }
});

test('@integration install-mmd phase 7: ralph-loop absent + non-interactive warns and continues (exit 0)', () => {
  const phase7 = extractPhase7();
  const fakeDir = fakeClaude('absent');
  try {
    const r = spawnSync('bash', [phase7], {
      encoding: 'utf8',
      timeout: 15000,
      env: { PATH: `${fakeDir}:/usr/bin:/bin` },
    });
    assert.equal(r.status, 0, `expected exit 0; stdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stdout, /NOT installed/i);
    assert.match(r.stdout, /MMD_AUTO_INSTALL_RALPH_LOOP=1/);
  } finally {
    rmSync(path.dirname(phase7), { recursive: true, force: true });
    rmSync(fakeDir, { recursive: true, force: true });
  }
});

test('@integration install-mmd phase 7: ralph-loop absent + auto-install verifies via re-list', () => {
  const phase7 = extractPhase7();
  const fakeDir = fakeClaude('absent');
  try {
    const r = spawnSync('bash', [phase7], {
      encoding: 'utf8',
      timeout: 15000,
      env: { PATH: `${fakeDir}:/usr/bin:/bin`, MMD_AUTO_INSTALL_RALPH_LOOP: '1' },
    });
    assert.equal(r.status, 0, `expected exit 0; stdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stdout, /installed and verified/i);
  } finally {
    rmSync(path.dirname(phase7), { recursive: true, force: true });
    rmSync(fakeDir, { recursive: true, force: true });
  }
});

test('@integration install-mmd phase 7: ralph-loop absent + MMD_REQUIRE_RALPH_LOOP=1 exits 1', () => {
  const phase7 = extractPhase7();
  const fakeDir = fakeClaude('absent');
  try {
    const r = spawnSync('bash', [phase7], {
      encoding: 'utf8',
      timeout: 15000,
      env: { PATH: `${fakeDir}:/usr/bin:/bin`, MMD_REQUIRE_RALPH_LOOP: '1' },
    });
    assert.equal(r.status, 1, `expected exit 1; stdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stdout, /Ralph Loop is required \(MMD_REQUIRE_RALPH_LOOP=1\)/);
  } finally {
    rmSync(path.dirname(phase7), { recursive: true, force: true });
    rmSync(fakeDir, { recursive: true, force: true });
  }
});

test('@integration install-mmd phase 7: claude plugin list errors -> pre-check skip, no error', () => {
  const phase7 = extractPhase7();
  const fakeDir = fakeClaude('unsupported');
  try {
    const r = spawnSync('bash', [phase7], {
      encoding: 'utf8',
      timeout: 15000,
      // Even with REQUIRE set, the pre-check skip must NOT exit non-zero (AC-3).
      env: { PATH: `${fakeDir}:/usr/bin:/bin`, MMD_REQUIRE_RALPH_LOOP: '1' },
    });
    assert.equal(r.status, 0, `expected exit 0 on plugin-unsupported skip; stdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stdout, /Claude Code 2\.1\+ for plugin support\. Skipping/);
  } finally {
    rmSync(path.dirname(phase7), { recursive: true, force: true });
    rmSync(fakeDir, { recursive: true, force: true });
  }
});

test('@integration install-mmd phase 7: claude CLI absent -> skip cleanly (exit 0)', () => {
  const phase7 = extractPhase7();
  try {
    // PATH without claude (it lives in ~/.local/bin, absent from /usr/bin:/bin).
    const r = spawnSync('bash', [phase7], {
      encoding: 'utf8',
      timeout: 15000,
      env: { PATH: '/usr/bin:/bin' },
    });
    assert.equal(r.status, 0, `expected exit 0; stdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stdout, /claude CLI not found/i);
  } finally {
    rmSync(path.dirname(phase7), { recursive: true, force: true });
  }
});
