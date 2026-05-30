// @integration tests for `mmd unblock --dry-run` + routing — SPEC_V02J AC-3, DoD §3.
//
// Strategy: temp git repo on a slice/* branch, drop in a fixture status.json,
// drive bin/mmd.js via spawnSync. NEVER spawns real claude (dry-run path).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync, copyFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildSubprocessEnv } from '../../lib/invoke-autodev.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');
const FIX = path.join(REPO_ROOT, 'test', 'fixtures', 'stuck-slices');

function git(dir, args) {
  const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd: dir, encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

/** Make a slice-branch repo and seed it with a fixture's status.json. */
function makeSliceRepo(fixtureName, { stale = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-unblock-'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['commit', '--allow-empty', '-m', 'init', '-q']);
  git(dir, ['checkout', '-q', '-b', 'slice/test-unblock']);
  mkdirSync(path.join(dir, '.mmd', 'shared'), { recursive: true });
  copyFileSync(
    path.join(FIX, fixtureName, '.mmd', 'shared', 'status.json'),
    path.join(dir, '.mmd', 'shared', 'status.json'),
  );
  // Seed a run log if the fixture has one.
  const fixLog = path.join(FIX, fixtureName, '.mmd', 'local', 'runs', 'run.log');
  try {
    mkdirSync(path.join(dir, '.mmd', 'local', 'runs'), { recursive: true });
    copyFileSync(fixLog, path.join(dir, '.mmd', 'local', 'runs', 'run.log'));
  } catch { /* fixture has no run log — fine */ }
  // Commit so the slice branch has a real last-commit time.
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'seed slice state', '-q']);
  if (stale) {
    // Rewrite the last commit's date far in the past so no-commit-since-N-min fires.
    spawnSync('git', [
      '-c', 'user.email=t@t', '-c', 'user.name=t',
      'commit', '--amend', '--no-edit', '--date=2020-01-01T00:00:00',
    ], { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_COMMITTER_DATE: '2020-01-01T00:00:00' } });
  }
  return dir;
}

function runMmd(args, opts = {}) {
  const env = { ...buildSubprocessEnv(process.env), ...(opts.env || {}) };
  return spawnSync('node', [MMD, ...args], {
    cwd: opts.cwd, env, encoding: 'utf8', timeout: 30000,
  });
}

test('@integration mmd unblock --help exits 0 with usage anchors', () => {
  const r = runMmd(['unblock', '--help']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /mmd unblock/);
  assert.match(r.stdout, /--dry-run/);
  assert.match(r.stdout, /--force/);
  assert.match(r.stdout, /no-commit-since-N-min/);
  assert.match(r.stdout, /escalate-to-user/);
  assert.match(r.stdout, /011-five-whys-escalation\.md/);
});

test('@integration unblock on a non-slice branch exits 4', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-unblock-main-'));
  try {
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['commit', '--allow-empty', '-m', 'init', '-q']);
    const r = runMmd(['unblock'], { cwd: dir });
    assert.equal(r.status, 4, `expected 4; stderr=${r.stderr}`);
    assert.match(r.stderr, /not a slice branch/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration unblock with explicit non-slice branch exits 4', () => {
  const dir = makeSliceRepo('fresh-not-stalled');
  try {
    const r = runMmd(['unblock', 'feat/x'], { cwd: dir });
    assert.equal(r.status, 4, r.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration unblock --dry-run on a stalled fixture exits 8 + prints signals', () => {
  const dir = makeSliceRepo('timeout-stall', { stale: true });
  try {
    const r = runMmd(['unblock', '--dry-run'], { cwd: dir });
    assert.equal(r.status, 8, `expected 8; stdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stdout, /stalled: true/);
    assert.match(r.stdout, /state-failed-explicit/);
    assert.match(r.stdout, /evidence/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration unblock --dry-run on the retry-loop fixture exits 8 + retry-count-exceeded', () => {
  // F5 (Phase-4 review): the spec-mandated retry-loop fixture (4 failed task
  // attempts) was previously unreferenced by any test. It surfaces the
  // retry-count-exceeded signal purely from status.json (no stale commit).
  const dir = makeSliceRepo('retry-loop');
  try {
    const r = runMmd(['unblock', '--dry-run'], { cwd: dir });
    assert.equal(r.status, 8, `expected 8; stdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stdout, /stalled: true/);
    assert.match(r.stdout, /retry-count-exceeded/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration unblock --dry-run on the no-commit-30min fixture exits 8 + no-commit signal', () => {
  // F5 (Phase-4 review): the spec-mandated no-commit-30min fixture was
  // previously unreferenced. With a stale last commit it surfaces the pure
  // no-commit-since-N-min signal.
  const dir = makeSliceRepo('no-commit-30min', { stale: true });
  try {
    const r = runMmd(['unblock', '--dry-run'], { cwd: dir });
    assert.equal(r.status, 8, `expected 8; stdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stdout, /stalled: true/);
    assert.match(r.stdout, /no-commit-since-N-min/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration unblock --force --dry-run runs the detector (honest output, F2)', () => {
  // F2 (Phase-4 review): --force --dry-run must still run the detector — it
  // never spawns claude, so reporting empty/"not stalled" would be dishonest.
  const dir = makeSliceRepo('timeout-stall', { stale: true });
  try {
    const r = runMmd(['unblock', '--force', '--dry-run'], { cwd: dir });
    assert.equal(r.status, 8, `expected 8; stdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stdout, /stalled: true/);
    assert.match(r.stdout, /state-failed-explicit/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration unblock --dry-run on a fresh fixture exits 0 (not stalled)', () => {
  const dir = makeSliceRepo('fresh-not-stalled');
  try {
    const r = runMmd(['unblock', '--dry-run'], { cwd: dir });
    assert.equal(r.status, 0, `expected 0; stdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stdout, /stalled: false/);
    assert.match(r.stdout, /No stall detected/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration unblock (no flags) on a fresh fixture exits 5', () => {
  const dir = makeSliceRepo('fresh-not-stalled');
  try {
    const r = runMmd(['unblock'], { cwd: dir });
    assert.equal(r.status, 5, `expected 5; stdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stdout, /no stall detected/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration unblock unknown flag exits 2', () => {
  const dir = makeSliceRepo('fresh-not-stalled');
  try {
    const r = runMmd(['unblock', '--bogus'], { cwd: dir });
    assert.equal(r.status, 2, r.stdout);
    assert.match(r.stderr, /unknown unblock arg|--bogus/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration unblock --dry-run runs in under 5 seconds (DoD §3)', () => {
  const dir = makeSliceRepo('timeout-stall', { stale: true });
  try {
    const t0 = Date.now();
    const r = runMmd(['unblock', '--dry-run'], { cwd: dir });
    const elapsed = Date.now() - t0;
    assert.equal(r.status, 8, r.stderr);
    assert.ok(elapsed < 5000, `dry-run took ${elapsed}ms`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
