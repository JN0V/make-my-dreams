// @integration end-to-end tests for the FAST engine (mmd --fast).
// Per testing.md §V budget: < 5 s total. Uses the fixture-based MMD_AUTODEV_CMD
// recursion-guard so the real `claude` CLI is never invoked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildSubprocessEnv } from '../../lib/invoke-autodev.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');
const FIXTURE_OK = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-autodev.sh');
const FIXTURE_ENV = path.join(REPO_ROOT, 'test', 'fixtures', 'echo-env.sh');

function makeTmp() {
  return mkdtempSync(path.join(tmpdir(), 'mmd-fast-'));
}

function runMmd(args, opts = {}) {
  const baseEnv = buildSubprocessEnv(process.env);
  const env = {
    ...baseEnv,
    MMD_AUTODEV_CMD: opts.autodevCmd ?? FIXTURE_OK,
    MMD_REALITY_CHECK_BACKEND: 'skip',
    ...(opts.env || {}),
  };
  return spawnSync('node', [MMD, ...args], {
    cwd: opts.cwd,
    env,
    encoding: 'utf8',
    timeout: 30000,
  });
}

function readStatusJson(tmp, slug) {
  const p = path.join(tmp, 'demo', slug, '.mmd', 'shared', 'status.json');
  return JSON.parse(readFileSync(p, 'utf8'));
}

test('@integration AC-1 FAST: mmd --fast "<dream>" runs cleanly and reports the engine', () => {
  const tmp = makeTmp();
  try {
    const r = runMmd(['--fast', 'a tiny app showing hello'], { cwd: tmp });
    assert.equal(r.status, 0, `stderr=${r.stderr}\nstdout=${r.stdout}`);
    assert.match(r.stdout, /Engine: FAST/);
    assert.match(r.stdout, /target <=10 min/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration AC-1 FAST: --fast accepted after the dream (position-independent)', () => {
  const tmp = makeTmp();
  try {
    const r = runMmd(['a tiny app showing hello', '--fast'], { cwd: tmp });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Engine: FAST/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration AC-2: --fast + --standard rejected with exit 2 (mutex)', () => {
  const r = runMmd(['--fast', '--standard', 'dream'], { cwd: makeTmp() });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /mutually exclusive/);
  assert.match(r.stderr, /--fast/);
  assert.match(r.stderr, /--standard/);
  assert.match(r.stderr, /--deep/);
});

test('@integration AC-2: --fast + --deep rejected with exit 2', () => {
  const r = runMmd(['--fast', '--deep', 'dream'], { cwd: makeTmp() });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /mutually exclusive/);
});

test('@integration AC-4 FAST: slice.md is overwritten with the 1-page derived spec', () => {
  const tmp = makeTmp();
  try {
    const r = runMmd(['--fast', 'add a red color button to the drawing app'], { cwd: tmp });
    assert.equal(r.status, 0, r.stderr);
    const sliceMd = readFileSync(
      path.join(tmp, 'demo', 'add-red-color-button-drawing-app', '.mmd', 'shared', 'slice.md'),
      'utf8',
    );
    assert.match(sliceMd, /Acceptance criteria \(heuristic — FAST engine\)/);
    assert.match(sliceMd, /Dream: add a red color button to the drawing app/);
    // The button keyword should produce the button-specific AC.
    assert.match(sliceMd, /button is visible/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration AC-6: status.json records engine="fast" with engine_metrics shape', () => {
  const tmp = makeTmp();
  try {
    const r = runMmd(['--fast', 'a tiny app showing hello'], { cwd: tmp });
    assert.equal(r.status, 0, r.stderr);
    const status = readStatusJson(tmp, 'tiny-app-showing-hello');
    assert.equal(status.engine, 'fast');
    assert.ok(status.engine_metrics, 'engine_metrics missing');
    assert.equal(status.engine_metrics.party_mode_rounds, 1, 'FAST should record 1 PM round');
    assert.ok(
      Number.isFinite(status.engine_metrics.duration_seconds) &&
        status.engine_metrics.duration_seconds >= 0,
      'duration_seconds should be a non-negative number',
    );
    // CLI cannot determine phase2 skipping in v0.2 — null is the explicit "not measured" sentinel.
    assert.equal(status.engine_metrics.phase2_skipped, null);
    assert.equal(status.engine_metrics.phase2_skip_reason, null);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration AC-6: default (no --fast) records engine="standard" with party_mode_rounds=3', () => {
  const tmp = makeTmp();
  try {
    const r = runMmd(['a tiny app showing hello'], { cwd: tmp });
    assert.equal(r.status, 0, r.stderr);
    const status = readStatusJson(tmp, 'tiny-app-showing-hello');
    assert.equal(status.engine, 'standard');
    assert.equal(status.engine_metrics.party_mode_rounds, 3);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration AC-3: MMD_AUTODEV_QUICK=1 is exposed to the subprocess in FAST mode', () => {
  const tmp = makeTmp();
  const capturePath = path.join(tmp, 'env-capture.txt');
  try {
    // echo-env.sh writes the subprocess env dump to $1. In test-mode the
    // fixture receives the dream as the single positional arg, so feeding the
    // capture path through the dream is the simplest assertion path.
    const r = runMmd([capturePath, '--fast'], { cwd: tmp, autodevCmd: FIXTURE_ENV });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(capturePath), 'echo-env should have written the env capture');
    const envDump = readFileSync(capturePath, 'utf8');
    assert.match(envDump, /^MMD_AUTODEV_QUICK=1$/m, `env dump:\n${envDump}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration AC-3: STANDARD mode does NOT set MMD_AUTODEV_QUICK', () => {
  const tmp = makeTmp();
  const capturePath = path.join(tmp, 'env-capture.txt');
  try {
    const r = runMmd([capturePath], { cwd: tmp, autodevCmd: FIXTURE_ENV });
    assert.equal(r.status, 0, r.stderr);
    const envDump = readFileSync(capturePath, 'utf8');
    assert.doesNotMatch(envDump, /MMD_AUTODEV_QUICK/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration AC-5 FAST: budget breach emits warning but does NOT fail the run', () => {
  const tmp = makeTmp();
  try {
    // 0.0001 minutes = 6 ms budget. The fixture invocation alone (Node spawn
    // + bash startup + status.json write) is well above 6 ms, so the soft
    // warning path fires deterministically.
    const r = runMmd(['--fast', 'a tiny app showing hello'], {
      cwd: tmp,
      env: { MMD_FAST_MAX_MINUTES: '0.0001' },
    });
    assert.equal(r.status, 0, `expected success despite warning; stderr=${r.stderr}`);
    assert.match(r.stderr, /FAST mode is taking longer than expected/);
    assert.match(r.stderr, /consider re-running with --standard/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration AC-1: --standard / --deep parse cleanly (forward-compat scaffolding)', () => {
  // These resolve to 'standard' in v0.2 (v0.1 baseline preserved) but must not
  // error. v0.2d gives them distinct semantics.
  const tmp = makeTmp();
  try {
    const r1 = runMmd(['--standard', 'a tiny app'], { cwd: tmp });
    assert.equal(r1.status, 0, r1.stderr);
    const status1 = readStatusJson(tmp, 'tiny-app');
    assert.equal(status1.engine, 'standard');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  const tmp2 = makeTmp();
  try {
    const r2 = runMmd(['--deep', 'a tiny app'], { cwd: tmp2 });
    assert.equal(r2.status, 0, r2.stderr);
    const status2 = readStatusJson(tmp2, 'tiny-app');
    assert.equal(status2.engine, 'standard');
  } finally {
    rmSync(tmp2, { recursive: true, force: true });
  }
});

test('@integration AC-6: status.json on failure still includes engine + duration', () => {
  const FIXTURE_FAIL = path.join(REPO_ROOT, 'test', 'fixtures', 'failing-autodev.sh');
  const tmp = makeTmp();
  try {
    const r = runMmd(['--fast', 'a tiny app'], { cwd: tmp, autodevCmd: FIXTURE_FAIL });
    assert.notEqual(r.status, 0);
    const status = readStatusJson(tmp, 'tiny-app');
    assert.equal(status.state, 'failed');
    assert.equal(status.engine, 'fast');
    assert.ok(status.engine_metrics.duration_seconds >= 0);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
