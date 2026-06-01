// @integration tests for the install-mmd.sh step that materializes the tracked
// /mmd operator slash command into .claude/commands/mmd.md (v0.7.5).
//
// Strategy mirrors install-mmd.test.js: we do NOT run the full installer (it
// spawns heavy `npx bmad-method` work). Instead we EXTRACT the single step block
// (delimited by the MMD_SLASH_COMMAND_MATERIALIZE_BEGIN/END sentinels in
// install-mmd.sh), wrap it in a synthetic helper preamble, and run it against a
// temp $TARGET with MMD_SRC_DIR pointed at the real repo (the dependency-
// injection seam the step relies on — MMD_SRC_DIR is resolved once near the top
// of the installer from BASH_SOURCE; the test supplies it directly). We assert
// the file is materialized, matches the tracked source byte-for-byte, that a
// second run is idempotent, and that a MISSING source degrades gracefully
// (honest warn + skip, never a fabricated file — universal §VI).
//
// Tagged @integration because it runs bash, touches the filesystem, and reads
// the real tracked source — outside @unit's pure-logic constraint.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const INSTALLER = path.join(REPO_ROOT, 'install-mmd.sh');
const TRACKED_SOURCE = path.join(REPO_ROOT, 'assets', 'claude-commands', 'mmd.md');

/**
 * Extract the "/mmd command materialization" step from install-mmd.sh into a
 * runnable temp script, with the standard helper preamble the other install
 * tests use. The step is delimited by the BEGIN/END sentinels; if they move,
 * this throws loudly (so the test fails honestly rather than silently passing
 * on an empty slice).
 *
 * @returns {string} path to a temp script
 */
function extractMmdCommandStep() {
  const src = readFileSync(INSTALLER, 'utf8');
  const startMarker = '# >>> MMD_SLASH_COMMAND_MATERIALIZE_BEGIN';
  const endMarker = '# >>> MMD_SLASH_COMMAND_MATERIALIZE_END';
  const startIdx = src.indexOf(startMarker);
  const endIdx = src.indexOf(endMarker);
  if (startIdx < 0 || endIdx < 0) {
    throw new Error('install-mmd.sh: MMD_SLASH_COMMAND_MATERIALIZE sentinels not found');
  }
  const step = src.slice(startIdx, endIdx + endMarker.length);
  const helpers = `#!/usr/bin/env bash
set -euo pipefail
RED=''; GREEN=''; YELLOW=''; CYAN=''; BOLD=''; NC=''
ok()   { printf "  OK %s\\n" "$1"; }
warn() { printf "  WARN %s\\n" "$1"; }
fail() { printf "  FAIL %s\\n" "$1"; }
info() { printf "  INFO %s\\n" "$1"; }
header() { printf "\\n=== %s ===\\n" "$1"; }
TARGET="\${1:-\$(pwd)}"
mkdir -p "$TARGET/.claude/commands"
${step}
exit 0
`;
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-installer-cmdstep-'));
  const scriptPath = path.join(dir, 'cmdstep.sh');
  writeFileSync(scriptPath, helpers);
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

test('@integration install step materializes assets/claude-commands/mmd.md → .claude/commands/mmd.md', () => {
  const step = extractMmdCommandStep();
  try {
    const target = mkdtempSync(path.join(tmpdir(), 'mmd-target-'));
    try {
      const r = spawnSync('bash', [step, target], {
        encoding: 'utf8',
        timeout: 15000,
        env: { PATH: '/usr/bin:/bin', HOME: target, MMD_SRC_DIR: REPO_ROOT },
      });
      assert.equal(r.status, 0, `step should exit 0; stdout=${r.stdout}\nstderr=${r.stderr}`);
      const dest = path.join(target, '.claude', 'commands', 'mmd.md');
      assert.ok(existsSync(dest), 'mmd.md must be materialized under .claude/commands/');
      // Byte-for-byte: the installed command IS the tracked source (no drift).
      assert.equal(
        readFileSync(dest, 'utf8'),
        readFileSync(TRACKED_SOURCE, 'utf8'),
        'materialized .claude/commands/mmd.md must match the tracked source exactly',
      );
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  } finally {
    rmSync(path.dirname(step), { recursive: true, force: true });
  }
});

test('@integration install step is idempotent — a second run leaves the same file', () => {
  const step = extractMmdCommandStep();
  try {
    const target = mkdtempSync(path.join(tmpdir(), 'mmd-target-'));
    try {
      const env = { PATH: '/usr/bin:/bin', HOME: target, MMD_SRC_DIR: REPO_ROOT };
      const first = spawnSync('bash', [step, target], { encoding: 'utf8', timeout: 15000, env });
      assert.equal(first.status, 0, `first run should exit 0; stderr=${first.stderr}`);
      const dest = path.join(target, '.claude', 'commands', 'mmd.md');
      const after1 = readFileSync(dest, 'utf8');
      const second = spawnSync('bash', [step, target], { encoding: 'utf8', timeout: 15000, env });
      assert.equal(second.status, 0, `second run should exit 0; stderr=${second.stderr}`);
      assert.equal(readFileSync(dest, 'utf8'), after1, 'a re-run must not change the materialized file');
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  } finally {
    rmSync(path.dirname(step), { recursive: true, force: true });
  }
});

test('@integration install step degrades gracefully when the source is absent (honest skip, no file)', () => {
  const step = extractMmdCommandStep();
  try {
    const target = mkdtempSync(path.join(tmpdir(), 'mmd-target-'));
    const emptySrc = mkdtempSync(path.join(tmpdir(), 'mmd-emptysrc-'));
    try {
      // Point MMD_SRC_DIR at a dir with NO assets/claude-commands/mmd.md.
      const r = spawnSync('bash', [step, target], {
        encoding: 'utf8',
        timeout: 15000,
        env: { PATH: '/usr/bin:/bin', HOME: target, MMD_SRC_DIR: emptySrc },
      });
      // Step must NOT fail the install (best-effort, universal §VI) and must NOT
      // fabricate the command file from nothing.
      assert.equal(r.status, 0, `missing source must not fail the step; stderr=${r.stderr}`);
      assert.match(r.stdout, /not found|skip/i, 'must log an honest skip when the source is absent');
      assert.ok(
        !existsSync(path.join(target, '.claude', 'commands', 'mmd.md')),
        'must not create mmd.md when the tracked source is missing',
      );
    } finally {
      rmSync(target, { recursive: true, force: true });
      rmSync(emptySrc, { recursive: true, force: true });
    }
  } finally {
    rmSync(path.dirname(step), { recursive: true, force: true });
  }
});
