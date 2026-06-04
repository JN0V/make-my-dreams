// @integration tests for v0.11.a — the ALIGNMENT GATE on the NORMAL run path
// (SPEC_V011A AC-2/AC-3/AC-4). Drives the real `mmd` CLI with a fake claude
// (test/fixtures/fake-autodev-align.sh) that branches on the judge marker and
// emits a deterministic tagged verdict, so the gate's outcome — done / iterate /
// exit-7 / honest-hold — is what the test exercises, never a real claude.
//
// CRITICAL (recursion guard): every test sets MMD_AUTODEV_CMD to the fixture so
// the real claude is NEVER invoked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync,
} from 'node:fs';
import { tmpdir, platform } from 'node:os';
import path from 'node:path';

import { buildSubprocessEnv } from '../../lib/invoke-autodev.js';
import { slugify } from '../../lib/parse-dream.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');
const FIXTURE = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-autodev-align.sh');

const SKIP_ON_WINDOWS = platform() === 'win32';

function makeTmp(prefix = 'mmd-align-') {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${r.stderr}`);
  return r.stdout;
}

function initCleanRepo(dir) {
  mkdirSync(dir, { recursive: true });
  git(['init', '-q', '-b', 'main'], dir);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init', '-q'], dir);
  return dir;
}

function runHere(args, opts = {}) {
  const env = {
    ...buildSubprocessEnv(process.env),
    MMD_AUTODEV_CMD: FIXTURE,
    MMD_REALITY_CHECK_BACKEND: 'skip',
    MMD_SKIP_SETUP: '1',
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
    ...(opts.env || {}),
  };
  return spawnSync('node', [MMD, ...args], { cwd: opts.cwd, env, encoding: 'utf8', timeout: 120000 });
}

const DREAM = 'add a small greeting feature to the app';

function readHereStatus(cwd) {
  return JSON.parse(readFileSync(path.join(cwd, '.mmd', 'shared', 'status.json'), 'utf8'));
}
function coderCount(cwd) {
  const p = path.join(cwd, '.mmd', 'local', 'runs', 'coder-count');
  return existsSync(p) ? Number(readFileSync(p, 'utf8').trim()) : 0;
}

// ── AC-2: gate on the normal --here path (default-on) ─────────────────────────

test('@integration v0.11.a AC-2: --here all-MET → slice done + status.json.judge.overall === met, gate ran', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    initCleanRepo(tmp);
    const r = runHere(['--here', DREAM], { cwd: tmp });
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}\nstdout=${r.stdout}`);
    assert.match(r.stdout, /Alignment gate — grading the implementation against WHAT WAS ASKED/);
    assert.match(r.stdout, /Alignment gate: ALIGNED/);

    const status = readHereStatus(tmp);
    assert.equal(status.state, 'done');
    assert.ok(status.judge, 'status.json must carry the judge verdict on a clean --here run');
    assert.equal(status.judge.overall, 'met');
    assert.ok(Array.isArray(status.judge.verdicts) && status.judge.verdicts.length >= 1);
    // No iteration on an aligned first verdict → exactly one coder attempt.
    assert.equal(coderCount(tmp), 1);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration v0.11.a AC-2: --here MMD_SKIP_ALIGN=1 → gate does NOT run, behavior is today\'s (done, no judge)', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    initCleanRepo(tmp);
    const r = runHere(['--here', DREAM], { cwd: tmp, env: { MMD_SKIP_ALIGN: '1' } });
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}`);
    // The gate never announces itself.
    assert.doesNotMatch(r.stdout, /Alignment gate/);
    const status = readHereStatus(tmp);
    assert.equal(status.state, 'done');
    assert.equal(status.judge, undefined, 'no judge recorded when the gate is opted out');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── AC-4: bounded iterate-on-gap + honest gap report ──────────────────────────

test('@integration v0.11.a AC-4: --here gap → re-launch with feedback → closes → done (iters default 1)', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    initCleanRepo(tmp);
    const r = runHere(['--here', DREAM], { cwd: tmp, env: { MMD_FAKE_ALIGN_GAP_THEN_MET: '1' } });
    assert.equal(r.status, 0, `expected exit 0 after the gap closed; stderr=${r.stderr}\nstdout=${r.stdout}`);
    // The gate detected a gap and re-launched once.
    assert.match(r.stdout, /re-launching auto-dev \(iteration 1\/1\)/);
    assert.match(r.stdout, /Alignment gate: ALIGNED/);
    const status = readHereStatus(tmp);
    assert.equal(status.state, 'done');
    assert.equal(status.judge.overall, 'met');
    // Two coder attempts: the initial + one iterate re-launch.
    assert.equal(coderCount(tmp), 2);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration v0.11.a AC-4: --here persistent gap → exit 7, NOT done, judge recorded', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    initCleanRepo(tmp);
    const r = runHere(['--here', DREAM], { cwd: tmp, env: { MMD_FAKE_ALIGN_NOTMET: '1' } });
    assert.equal(r.status, 7, `expected exit 7 (behavioral-gap); got ${r.status}; stderr=${r.stderr}`);
    assert.match(r.stderr, /ALIGNMENT GAP/);
    assert.match(r.stderr, /OVERALL: not-met/);
    assert.match(r.stderr, /AC 2: not-met/);
    assert.match(r.stderr, /Exit 7 \(behavioral-gap\)/);
    const status = readHereStatus(tmp);
    assert.equal(status.state, 'failed');
    assert.equal(status.judge.overall, 'not-met');
    // Default iters=1: initial coder + one re-launch (both still not-met) = 2.
    assert.equal(coderCount(tmp), 2);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration v0.11.a AC-4: MMD_ALIGN_MAX_ITERS=0 + gap → exit 7 immediately, NO re-launch (one coder attempt)', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    initCleanRepo(tmp);
    const r = runHere(['--here', DREAM], { cwd: tmp, env: { MMD_FAKE_ALIGN_NOTMET: '1', MMD_ALIGN_MAX_ITERS: '0' } });
    assert.equal(r.status, 7, `expected exit 7; got ${r.status}; stderr=${r.stderr}`);
    assert.doesNotMatch(r.stdout, /re-launching auto-dev/);
    const status = readHereStatus(tmp);
    assert.equal(status.state, 'failed');
    // Gate-but-never-iterate: only the initial coder ran.
    assert.equal(coderCount(tmp), 1);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration v0.11.a AC-4: --here uncertain verdict → honest hold (done, judge uncertain), NO iterate', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    initCleanRepo(tmp);
    const r = runHere(['--here', DREAM], { cwd: tmp, env: { MMD_FAKE_ALIGN_UNCERTAIN: '1' } });
    // Uncertain is the SACRED fallback: NOT a gap, never a fabricated pass, but
    // the change IS on the branch → done with an honest "UNVERIFIED" note.
    assert.equal(r.status, 0, `expected exit 0 (honest hold); got ${r.status}; stderr=${r.stderr}`);
    assert.match(r.stdout, /Alignment gate: UNVERIFIED/);
    assert.doesNotMatch(r.stdout, /re-launching auto-dev/);
    const status = readHereStatus(tmp);
    assert.equal(status.state, 'done');
    assert.equal(status.judge.overall, 'uncertain');
    // No blind iterate on uncertain → exactly one coder attempt.
    assert.equal(coderCount(tmp), 1);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── AC-3: gate on the greenfield path ─────────────────────────────────────────

function runGreenfield(args, opts = {}) {
  const env = {
    ...buildSubprocessEnv(process.env),
    MMD_AUTODEV_CMD: FIXTURE,
    MMD_REALITY_CHECK_BACKEND: 'skip',
    ...(opts.env || {}),
  };
  return spawnSync('node', [MMD, ...args], { cwd: opts.cwd, env, encoding: 'utf8', timeout: 120000 });
}

test('@integration v0.11.a AC-3: greenfield all-MET → done + status.json.judge', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp('mmd-align-gf-');
  try {
    const dream = 'a tiny greeting page';
    const slug = slugify(dream);
    const r = runGreenfield([dream], { cwd: tmp });
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}\nstdout=${r.stdout}`);
    assert.match(r.stdout, /Alignment gate: ALIGNED/);
    const status = JSON.parse(
      readFileSync(path.join(tmp, 'demo', slug, '.mmd', 'shared', 'status.json'), 'utf8'),
    );
    assert.equal(status.state, 'done');
    assert.ok(status.judge, 'greenfield status.json carries the judge verdict');
    assert.equal(status.judge.overall, 'met');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration v0.11.a AC-3: greenfield MMD_SKIP_ALIGN=1 → no gate, done, no judge', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp('mmd-align-gf-');
  try {
    const dream = 'a tiny greeting page';
    const slug = slugify(dream);
    const r = runGreenfield([dream], { cwd: tmp, env: { MMD_SKIP_ALIGN: '1' } });
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}`);
    assert.doesNotMatch(r.stdout, /Alignment gate/);
    const status = JSON.parse(
      readFileSync(path.join(tmp, 'demo', slug, '.mmd', 'shared', 'status.json'), 'utf8'),
    );
    assert.equal(status.state, 'done');
    assert.equal(status.judge, undefined);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
