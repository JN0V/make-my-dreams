// @integration tests for v0.17.a — the DUAL-FACE alignment gate (SPEC_V017A
// AC-4): both the deterministic face (Reality Check — does it WORK?) and the
// semantic judge (does it fulfil the ask?) must pass; a deterministic FAIL drives
// the bounded iterate loop and, unresolved, exits 7 with the FAILING FACE recorded
// in status.json.judge.face. The real claude is NEVER invoked (fake fixture).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync,
} from 'node:fs';
import { tmpdir, platform } from 'node:os';
import path from 'node:path';

import { buildSubprocessEnv } from '../../lib/invoke-autodev.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');
const FIXTURE = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-autodev-align.sh');
const SKIP_ON_WINDOWS = platform() === 'win32';

function makeTmp() { return mkdtempSync(path.join(tmpdir(), 'mmd-dual-')); }
function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${r.stderr}`);
  return r.stdout;
}
function initCleanRepo(dir, pkg) {
  mkdirSync(dir, { recursive: true });
  git(['init', '-q', '-b', 'main'], dir);
  writeFileSync(path.join(dir, '.gitignore'), '.mmd/\n', 'utf8');
  if (pkg) writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');
  git(['add', '-A'], dir);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'init', '-q'], dir);
  return dir;
}
function runHere(args, opts = {}) {
  const env = {
    ...buildSubprocessEnv(process.env),
    MMD_AUTODEV_CMD: FIXTURE,
    MMD_SKIP_SETUP: '1',
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
    ...(opts.env || {}),
  };
  return spawnSync('node', [MMD, ...args], { cwd: opts.cwd, env, encoding: 'utf8', timeout: 120000 });
}
function readHereStatus(cwd) {
  return JSON.parse(readFileSync(path.join(cwd, '.mmd', 'shared', 'status.json'), 'utf8'));
}

const DREAM = 'add a small greeting feature to the app';

test('@integration v0.17.a AC-4: deterministic FAIL (tests red) → exit 7, status records face=deterministic', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    // A project whose test command ALWAYS fails → the deterministic face FAILs
    // even though the semantic judge (default fixture) grades MET.
    initCleanRepo(tmp, { name: 'x', version: '1.0.0', scripts: { test: 'node -e "process.exit(1)"' } });
    const r = runHere(['--here', '--skip-onboarding', DREAM], { cwd: tmp, env: { MMD_ALIGN_MAX_ITERS: '0' } });
    assert.equal(r.status, 7, `expected exit 7 (deterministic gap); got ${r.status}; stderr=${r.stderr}\nstdout=${r.stdout}`);
    assert.match(r.stderr, /ALIGNMENT GAP/);
    assert.match(r.stderr, /deterministic face is unsatisfied/);
    const status = readHereStatus(tmp);
    assert.equal(status.state, 'failed');
    assert.equal(status.judge.face, 'deterministic', 'status.json must record the failing face');
    assert.match(status.judge.deterministic_reason, /tests red/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration v0.17.a AC-4: deterministic gap → iterate once → still red → exit 7 (bounded iterate on the deterministic face)', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    initCleanRepo(tmp, { name: 'x', version: '1.0.0', scripts: { test: 'node -e "process.exit(1)"' } });
    const r = runHere(['--here', '--skip-onboarding', DREAM], { cwd: tmp }); // default MMD_ALIGN_MAX_ITERS=1
    assert.equal(r.status, 7, `expected exit 7; got ${r.status}; stderr=${r.stderr}`);
    // The deterministic gap drove a re-launch.
    assert.match(r.stdout, /re-launching auto-dev \(iteration 1\/1\)/);
    assert.match(r.stdout, /deterministic/);
    const status = readHereStatus(tmp);
    assert.equal(status.state, 'failed');
    assert.equal(status.judge.face, 'deterministic');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration v0.17.a AC-4: both faces pass (tests green + judge MET) → done', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    // A passing test command → deterministic PASS; default fixture → semantic MET.
    initCleanRepo(tmp, { name: 'x', version: '1.0.0', scripts: { test: 'node -e "process.exit(0)"' } });
    const r = runHere(['--here', '--skip-onboarding', DREAM], { cwd: tmp });
    assert.equal(r.status, 0, `expected exit 0 (both faces pass); got ${r.status}; stderr=${r.stderr}\nstdout=${r.stdout}`);
    assert.match(r.stdout, /deterministic face: PASS/);
    assert.match(r.stdout, /Alignment gate: ALIGNED/);
    const status = readHereStatus(tmp);
    assert.equal(status.state, 'done');
    assert.equal(status.judge.overall, 'met');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration v0.17.a AC-4: MMD_SKIP_ALIGN=1 → the WHOLE dual-face gate is off (done, no judge, tests not gated)', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    // Even with a failing test command, SKIP_ALIGN bypasses the gate entirely.
    initCleanRepo(tmp, { name: 'x', version: '1.0.0', scripts: { test: 'node -e "process.exit(1)"' } });
    const r = runHere(['--here', '--skip-onboarding', DREAM], { cwd: tmp, env: { MMD_SKIP_ALIGN: '1', MMD_REALITY_CHECK_BACKEND: 'skip' } });
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}\nstdout=${r.stdout}`);
    assert.doesNotMatch(r.stdout, /Alignment gate/);
    const status = readHereStatus(tmp);
    assert.equal(status.state, 'done');
    assert.equal(status.judge, undefined);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
