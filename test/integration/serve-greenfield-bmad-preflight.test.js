// @integration — the greenfield/serve BMAD preflight (field-bug fix).
//
// Running `mmdream serve` or `mmdream "<dream>"` from a directory WITHOUT BMAD used
// to dead-end on a cryptic "Unknown command: /bmad-product-brief" (the Dream
// Catcher's scoping call). Now both fail fast with an honest, actionable message
// and exit 8 — BEFORE spawning anything.
//
// The preflight runs only on a REAL run: when MMD_AUTODEV_CMD is set (the test
// fake-spawn seam) it is skipped, which is why the rest of the suite — full of
// greenfield runs in BMAD-less temp dirs with MMD_AUTODEV_CMD — stays green.
//
// HOME is sandboxed so the global ~/.claude/skills check is deterministic
// (otherwise it would depend on the dev machine's real ~/.claude).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');

function runInBareDir(args, extraEnv = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-bare-'));
  const home = mkdtempSync(path.join(tmpdir(), 'mmd-home-')); // no ~/.claude/skills here
  try {
    const r = spawnSync('node', [MMD, ...args], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 20000,
      env: {
        PATH: process.env.PATH,
        HOME: home,
        // No MMD_AUTODEV_CMD → REAL run → preflight is active.
        ...extraEnv,
      },
    });
    return { ...r, dir };
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
}

test('@integration mmdream serve in a BMAD-less dir → exit 8 + honest message (not the raw "Unknown command")', () => {
  const r = runInBareDir(['serve']);
  assert.equal(r.status, 8, `expected exit 8; stdout=${r.stdout}\nstderr=${r.stderr}`);
  assert.match(r.stderr, /bmad-product-brief/);
  assert.match(r.stderr, /install-mmd\.sh \./);
  assert.doesNotMatch(r.stderr, /Unknown command/);
  assert.doesNotMatch(r.stdout, /Starting Make My Dreams server/); // failed BEFORE boot
});

test('@integration greenfield `mmdream "<dream>"` in a BMAD-less dir → exit 8 + honest message', () => {
  const r = runInBareDir(['a tiny drawing app']);
  assert.equal(r.status, 8, `expected exit 8; stdout=${r.stdout}\nstderr=${r.stderr}`);
  assert.match(r.stderr, /bmad-product-brief/);
  assert.match(r.stderr, /greenfield/);
});

test('@integration MMD_SKIP_SETUP=1 bypasses the preflight (greenfield no longer exits 8 on the check)', () => {
  // With the bypass, the preflight does not fire. The run then proceeds and
  // fails LATER for a different reason (no real claude), so we only assert it is
  // NOT the preflight's exit 8 with the BMAD message.
  const r = runInBareDir(['a tiny drawing app'], { MMD_SKIP_SETUP: '1' });
  const blockedByPreflight = r.status === 8 && /bmad-product-brief/.test(r.stderr);
  assert.equal(blockedByPreflight, false, `preflight should be bypassed; stderr=${r.stderr}`);
});
