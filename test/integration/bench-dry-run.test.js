// @integration end-to-end test for `mmd bench --dry-run`.
// Spec: SPEC_V02B AC-1 + AC-2 + AC-3 + AC-4 + AC-5 + AC-6 (gate + isolation +
// metrics + aggregate + exit code) in the dry-run path.
//
// CRITICAL: never invoke the real claude CLI. Set MMD_AUTODEV_CMD to the
// fake-autodev fixture and MMD_REALITY_CHECK_BACKEND=skip (mirrors the
// constitution-anchored pattern from test/integration/mmd.test.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  readdirSync,
  existsSync,
  lstatSync,
  cpSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildSubprocessEnv } from '../../lib/invoke-autodev.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');
const FIXTURE_OK = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-autodev.sh');
const BENCH_SRC = path.join(REPO_ROOT, 'bench');

/**
 * Create an isolated working tree with bench/ copied in so the bench harness
 * can read bench/dreams/ + write bench/runs/<run-id>/ without touching the
 * MMD repo.
 */
function makeBenchTmp() {
  const tmp = mkdtempSync(path.join(tmpdir(), 'mmd-bench-'));
  cpSync(BENCH_SRC, path.join(tmp, 'bench'), { recursive: true });
  // Wipe runs/* in the copy so the test's assertions about the count don't
  // race with stale runs from a previous test invocation.
  const runsDir = path.join(tmp, 'bench', 'runs');
  for (const entry of readdirSync(runsDir)) {
    if (entry === 'README.md') continue;
    rmSync(path.join(runsDir, entry), { recursive: true, force: true });
  }
  return tmp;
}

function runBench(args, opts = {}) {
  const baseEnv = buildSubprocessEnv(process.env);
  const env = {
    ...baseEnv,
    MMD_AUTODEV_CMD: opts.autodevCmd ?? FIXTURE_OK,
    MMD_REALITY_CHECK_BACKEND: 'skip',
    MMD_QUIET: '1',
    ...(opts.env || {}),
  };
  return spawnSync('node', [MMD, 'bench', ...args], {
    cwd: opts.cwd,
    env,
    encoding: 'utf8',
    timeout: 30000,
  });
}

test('@integration mmd bench --dry-run exits 0 in under 30s with all 5 dreams green (AC-1 + AC-6 + AC-3)', () => {
  const tmp = makeBenchTmp();
  try {
    const startedNs = process.hrtime.bigint();
    const r = runBench(['--dry-run'], { cwd: tmp });
    const elapsedSec = Number(process.hrtime.bigint() - startedNs) / 1e9;
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}\nstdout=${r.stdout}`);
    assert.ok(
      elapsedSec < 30,
      `bench --dry-run should complete under 30s (mission validation §1); took ${elapsedSec.toFixed(2)}s`,
    );
    // AC-1: must say the 5 dreams started.
    assert.match(r.stdout, /dreams=5/);
    // AC-3: each dream announced.
    for (const id of [
      'kid-01-drawing-camera-overlay',
      'kid-02-drum-pads',
      'kid-03-story-dice',
      'pro-01-csv-viewer',
      'pro-02-markdown-preview',
    ]) {
      assert.match(r.stdout, new RegExp(`starting ${id}`), `${id} not started`);
      assert.match(r.stdout, new RegExp(`${id} done`), `${id} not finished`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration mmd bench --dry-run produces summary.json + report.md + per-dream metrics.json (AC-4 + AC-5)', () => {
  const tmp = makeBenchTmp();
  try {
    const r = runBench(['--dry-run'], { cwd: tmp });
    assert.equal(r.status, 0);
    // Locate the freshly created run dir under bench/runs/.
    const runsRoot = path.join(tmp, 'bench', 'runs');
    const runDirs = readdirSync(runsRoot).filter(
      (e) => e !== 'README.md' && e !== 'latest',
    );
    assert.equal(runDirs.length, 1, 'expected exactly one run dir');
    const runDir = path.join(runsRoot, runDirs[0]);
    // AC-5: summary.json + report.md exist.
    assert.ok(existsSync(path.join(runDir, 'summary.json')), 'summary.json missing');
    assert.ok(existsSync(path.join(runDir, 'report.md')), 'report.md missing');
    const summary = JSON.parse(readFileSync(path.join(runDir, 'summary.json'), 'utf8'));
    assert.equal(summary.dreams_total, 5);
    assert.equal(summary.dreams_passed, 5);
    assert.equal(summary.dreams_failed, 0);
    assert.equal(summary.reality_check.pass_rate, 1);
    assert.ok(summary.mmd_version, 'mmd_version missing');
    assert.ok(summary.mmd_git_sha, 'mmd_git_sha missing');
    // AC-4: every dream has its own metrics.json + run.log + screenshot.png.
    for (const id of [
      'kid-01-drawing-camera-overlay',
      'kid-02-drum-pads',
      'kid-03-story-dice',
      'pro-01-csv-viewer',
      'pro-02-markdown-preview',
    ]) {
      const dreamDir = path.join(runDir, id);
      assert.ok(existsSync(path.join(dreamDir, 'metrics.json')), `${id}/metrics.json missing`);
      assert.ok(existsSync(path.join(dreamDir, 'run.log')), `${id}/run.log missing`);
      assert.ok(existsSync(path.join(dreamDir, 'screenshot.png')), `${id}/screenshot.png missing`);
      const m = JSON.parse(readFileSync(path.join(dreamDir, 'metrics.json'), 'utf8'));
      assert.equal(m.dream_id, id);
      assert.equal(m.exit_code, 0);
      assert.equal(m.reality_check.passed, true);
      assert.equal(m.reality_check.ran, true);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration mmd bench --dry-run updates bench/runs/latest symlink (AC-5)', () => {
  const tmp = makeBenchTmp();
  try {
    const r = runBench(['--dry-run'], { cwd: tmp });
    assert.equal(r.status, 0);
    const latest = path.join(tmp, 'bench', 'runs', 'latest');
    assert.ok(existsSync(latest), 'latest symlink missing');
    const st = lstatSync(latest);
    assert.ok(st.isSymbolicLink(), 'latest must be a symlink');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration mmd bench (no --dry-run, no MMD_BENCH_REAL) exits 2 with gate message (AC-1)', () => {
  const tmp = makeBenchTmp();
  try {
    // Even with MMD_AUTODEV_CMD set, the gate fires BEFORE we look at the env
    // for invocation — the user's intent is "real bench" and they did not
    // confirm with MMD_BENCH_REAL=1.
    const baseEnv = buildSubprocessEnv(process.env);
    const env = {
      ...baseEnv,
      MMD_AUTODEV_CMD: FIXTURE_OK,
      MMD_REALITY_CHECK_BACKEND: 'skip',
    };
    delete env.MMD_BENCH_REAL;
    const r = spawnSync('node', [MMD, 'bench'], {
      cwd: tmp,
      env,
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(r.status, 2, `expected exit 2; got ${r.status}\nstderr=${r.stderr}`);
    assert.match(r.stderr, /Real bench takes hours/);
    assert.match(r.stderr, /MMD_BENCH_REAL=1/);
    assert.match(r.stderr, /--dry-run/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration mmd bench --help exits 0 and lists every documented flag (AC-1)', () => {
  const r = spawnSync('node', [MMD, 'bench', '--help'], {
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /mmd bench/);
  assert.match(r.stdout, /--dry-run/);
  assert.match(r.stdout, /--engine/);
  assert.match(r.stdout, /--dreams/);
  assert.match(r.stdout, /--out-dir/);
  // AC-1 also requires the gate to be documented in --help (operability).
  assert.match(r.stdout, /MMD_BENCH_REAL/);
});

test('@integration mmd bench --dry-run --dreams kid-01-drawing-camera-overlay only runs the filtered dream', () => {
  const tmp = makeBenchTmp();
  try {
    const r = runBench(['--dry-run', '--dreams', 'kid-01-drawing-camera-overlay'], {
      cwd: tmp,
    });
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}\nstdout=${r.stdout}`);
    assert.match(r.stdout, /dreams=1/);
    assert.match(r.stdout, /starting kid-01-drawing-camera-overlay/);
    assert.doesNotMatch(r.stdout, /starting kid-02/);
    assert.doesNotMatch(r.stdout, /starting pro-/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
