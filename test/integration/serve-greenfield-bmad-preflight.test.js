// @integration — first-run setup on the greenfield / serve paths (field-bug fix).
//
// Running `mmdream serve` or `mmdream "<dream>"` from a directory WITHOUT BMAD used
// to dead-end on a cryptic "Unknown command: /bmad-product-brief" (the Dream
// Catcher's scoping call). MMD targets people who never open a terminal, so the
// fix is NOT an error telling them to run a shell command — it AUTO-RUNS first-run
// setup (install-mmd.sh) on first launch, the same guard `mmdream --here` uses,
// then proceeds. A genuine setup FAILURE aborts honestly (exit 8).
//
// MMD_SETUP_CMD points the setup runner at a FAKE installer so these tests drive
// the decision offline (no `npx bmad-method`). The auto-setup is gated on a REAL
// run — skipped when MMD_AUTODEV_CMD is set (the fake-spawn seam) — which is why
// the 31 MMD_AUTODEV_CMD-using greenfield/serve tests stay green untouched.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');

/** Write a fake install-mmd.sh that just exits with `code` (offline, instant). */
function fakeInstaller(dir, code) {
  const p = path.join(dir, 'fake-install.sh');
  writeFileSync(p, `#!/usr/bin/env bash\necho "[fake-install] ran on $1"\nexit ${code}\n`);
  chmodSync(p, 0o755);
  return p;
}

function bareEnv(extra) {
  return { PATH: process.env.PATH, HOME: mkdtempSync(path.join(tmpdir(), 'mmd-home-')), ...extra };
}

test('@integration serve in a BMAD-less dir AUTO-RUNS first-run setup, then boots (no error to the user)', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-bare-'));
  const installer = fakeInstaller(dir, 0); // setup "succeeds"
  const proc = spawn('node', [MMD, 'serve'], {
    cwd: dir,
    env: bareEnv({ MMD_SETUP_CMD: installer, MMD_SERVE_PORT: '0', MMD_SERVE_ALLOW_RANDOM: '1', MMD_SERVE_NO_OPEN: '1' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  proc.stdout.on('data', (d) => { out += d; });
  proc.stderr.on('data', (d) => { out += d; });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout; output so far:\n${out}`)), 8000);
      proc.stdout.on('data', () => {
        if (/Starting Make My Dreams server/.test(out)) { clearTimeout(timer); resolve(); }
      });
      proc.on('exit', (code) => { clearTimeout(timer); reject(new Error(`serve exited early (code ${code}); output:\n${out}`)); });
    });
    assert.match(out, /auto-running first-run setup/i, 'serve should auto-run setup (non-TTY), not error');
    assert.match(out, /\[fake-install\] ran on/, 'the setup runner (install-mmd.sh) should have been invoked');
    assert.match(out, /Starting Make My Dreams server/, 'serve should PROCEED to boot after setup');
    assert.doesNotMatch(out, /Unknown command/);
  } finally {
    proc.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration serve setup FAILURE → honest abort (exit 8), never boots', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-bare-'));
  const installer = fakeInstaller(dir, 1); // setup "fails"
  try {
    const r = spawnSync('node', [MMD, 'serve'], {
      cwd: dir, encoding: 'utf8', timeout: 15000,
      env: bareEnv({ MMD_SETUP_CMD: installer, MMD_SERVE_PORT: '0', MMD_SERVE_ALLOW_RANDOM: '1', MMD_SERVE_NO_OPEN: '1' }),
    });
    assert.equal(r.status, 8, `expected exit 8 on setup failure; stdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stdout + r.stderr, /first-run setup .*exited with code 1|will not proceed/i);
    assert.doesNotMatch(r.stdout, /Starting Make My Dreams server/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration greenfield `mmdream "<dream>"` in a BMAD-less dir runs setup; a setup FAILURE aborts (exit 8) before any claude call', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-bare-'));
  const installer = fakeInstaller(dir, 1); // setup "fails" → abort before the Dream Catcher
  try {
    const r = spawnSync('node', [MMD, 'a tiny drawing app'], {
      cwd: dir, encoding: 'utf8', timeout: 15000,
      env: bareEnv({ MMD_SETUP_CMD: installer }), // NO MMD_AUTODEV_CMD → real run → setup gate active
    });
    assert.equal(r.status, 8, `expected exit 8 on setup failure; stdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stdout + r.stderr, /first-run setup|will not proceed/i);
    assert.doesNotMatch(r.stdout + r.stderr, /Unknown command/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration a SECONDARY command (mmdream bench) also auto-runs setup; a setup FAILURE aborts (exit 8)', () => {
  // bench runs auto-dev (BMAD) per dream → it must auto-install too. A real bench
  // is gated behind MMD_BENCH_REAL=1; with a failing fake installer and NO
  // MMD_AUTODEV_CMD (real run), it reaches the setup guard and aborts at exit 8
  // BEFORE loading dreams — proving the secondary-command wiring fires.
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-bare-'));
  const installer = fakeInstaller(dir, 1);
  try {
    const r = spawnSync('node', [MMD, 'bench'], {
      cwd: dir, encoding: 'utf8', timeout: 15000,
      env: bareEnv({ MMD_SETUP_CMD: installer, MMD_BENCH_REAL: '1' }), // no MMD_AUTODEV_CMD → real run
    });
    assert.equal(r.status, 8, `expected exit 8 on setup failure; stdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stdout + r.stderr, /first-run setup|will not proceed/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration MMD_SKIP_SETUP=1 bypasses the auto-setup (no install-mmd.sh spawn)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-bare-'));
  const installer = fakeInstaller(dir, 1); // would fail IF it ran — but bypass means it must NOT run
  try {
    const r = spawnSync('node', [MMD, 'a tiny drawing app'], {
      cwd: dir, encoding: 'utf8', timeout: 15000,
      env: bareEnv({ MMD_SETUP_CMD: installer, MMD_SKIP_SETUP: '1' }),
    });
    // With the bypass the setup never runs, so we never see its failure / exit 8-from-setup.
    assert.doesNotMatch(r.stdout + r.stderr, /\[fake-install\] ran on/, 'setup runner must NOT be spawned when bypassed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
