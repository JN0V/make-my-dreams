// @integration — SPEC_V06A AC-3/AC-6 regression: the FULL runHereMode guard path.
//
// Phase-4 review F1 found a real defect: the first-run setup writes files but
// does NOT commit them, so the very next clean-tree check (validateHereTarget)
// aborted the run with exit 4 — AC-6 ("a green --here on a fresh repo") could
// never pass. The AC-3 unit/integration tests inject a no-op runner and every
// other here-mode suite sets MMD_SKIP_SETUP=1, so the real setup→commit→
// git-validate→branch→autodev sequence was never exercised.
//
// This test drives that sequence end-to-end with a FAKE setup (MMD_SETUP_CMD,
// which materializes a constitution + adv command without committing, exactly
// like install-mmd.sh) and a FAKE autodev, on a fresh non-MMD repo. It asserts
// the run proceeds past the clean-tree check to the slice branch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import path from 'node:path';

import { buildSubprocessEnv } from '../../lib/invoke-autodev.js';

const SKIP_ON_WINDOWS = platform() === 'win32';
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');
const FAKE_AUTODEV = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-autodev-here.sh');
const FAKE_SETUP = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-setup.sh');

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

/** A fresh, clean, committed Node repo with NO MMD setup (brownfield). */
function makeFreshRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-setup-flow-'));
  git(['init', '-q', '-b', 'main'], dir);
  writeFileSync(path.join(dir, 'package.json'), '{\n  "name": "fresh",\n  "version": "1.0.0"\n}\n');
  writeFileSync(path.join(dir, 'index.js'), 'export const x = 1;\n');
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], dir);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], dir);
  return dir;
}

function runMmd(args, cwd, extraEnv = {}) {
  const env = {
    ...buildSubprocessEnv(process.env),
    MMD_AUTODEV_CMD: FAKE_AUTODEV,
    MMD_REALITY_CHECK_BACKEND: 'skip',
    MMD_SETUP_CMD: FAKE_SETUP, // testing seam: stand in for install-mmd.sh
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
    ...extraEnv,
  };
  return spawnSync('node', [MMD, ...args], { cwd, env, encoding: 'utf8', timeout: 60000 });
}

test('@integration first-run setup on a fresh repo: setup → commit → clean-tree → slice branch → autodev (AC-3/AC-6)',
  { skip: SKIP_ON_WINDOWS }, () => {
  const dir = makeFreshRepo();
  try {
    // Non-TTY (spawned) → the guard auto-runs MMD_SETUP_CMD, commits its output,
    // then the run proceeds. --skip-onboarding isolates this from the discovery
    // gate (which runs AFTER the guard and would otherwise fire exit 5).
    const r = runMmd(['--here', '--skip-onboarding', 'add a tiny hello helper'], dir);

    // It MUST get past validateHereTarget (exit 4) — the F1 regression — and run.
    assert.notEqual(r.status, 4, `regressed to exit 4 (dirty tree): ${r.stderr}`);
    assert.notEqual(r.status, 8, `setup/commit failed: ${r.stderr}`);
    assert.equal(r.status, 0, `expected green run, got ${r.status}. stderr: ${r.stderr}`);

    // The setup was committed on the base branch (clean tree before the check).
    const log = git(['log', '--oneline'], dir);
    assert.match(log, /MMD first-run setup/, 'setup commit missing from history');

    // The materialized constitution exists and was committed (never overwritten later).
    assert.ok(existsSync(path.join(dir, '.specify', 'memory', 'constitution.md')));

    // Auto-dev ran on the SLICE branch (proves the run proceeded all the way).
    const branchFile = path.join(dir, '.mmd', 'local', 'runs', 'here-branch.txt');
    assert.ok(existsSync(branchFile), 'autodev never ran (no here-branch.txt)');
    assert.match(readFileSync(branchFile, 'utf8'), /^slice\/here-/);

    // The cheat-sheet printed once after setup (AC-4 surfaced on first run).
    assert.match(r.stdout, /MMD_TIMEOUT_MS=0/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration first-run setup: an already-set-up repo is a no-op (no setup commit, constitution untouched)',
  { skip: SKIP_ON_WINDOWS }, () => {
  const dir = makeFreshRepo();
  try {
    // Pre-install MMD's markers + a constitution with sentinel content.
    mkdirSync(path.join(dir, '.specify', 'memory'), { recursive: true });
    const sentinel = '# MY OWN CONSTITUTION — do not touch\n';
    writeFileSync(path.join(dir, '.specify', 'memory', 'constitution.md'), sentinel);
    mkdirSync(path.join(dir, '.claude', 'commands'), { recursive: true });
    writeFileSync(path.join(dir, '.claude', 'commands', 'bmad-adv-auto-dev.md'), 'cmd\n');
    git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], dir);
    git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'pre-set-up'], dir);

    const r = runMmd(['--here', '--skip-onboarding', 'add a tiny hello helper'], dir);
    assert.equal(r.status, 0, `expected green run, got ${r.status}. stderr: ${r.stderr}`);

    // No first-run setup commit (the guard was a no-op).
    assert.doesNotMatch(git(['log', '--oneline'], dir), /MMD first-run setup/);
    // "Elle reste": the existing constitution is byte-for-byte untouched.
    assert.equal(readFileSync(path.join(dir, '.specify', 'memory', 'constitution.md'), 'utf8'), sentinel);
    // No cheat-sheet on an already-ready repo (AC-4: printed only after setup).
    assert.doesNotMatch(r.stdout, /MMD_TIMEOUT_MS=0/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
