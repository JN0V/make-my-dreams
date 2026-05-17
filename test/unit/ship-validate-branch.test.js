// @unit tests for lib/ship/validate-branch.js — pure predicates + the
// fs-touching validateShipTarget against a temp git repo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  isProtectedBranch,
  isAllowedBranchPrefix,
  validateBranchName,
  validateShipTarget,
  PROTECTED_BRANCHES,
  ALLOWED_BRANCH_PREFIXES,
} from '../../lib/ship/validate-branch.js';

// --- pure predicate tests ---------------------------------------------------

test('@unit isProtectedBranch: main and master are protected', () => {
  assert.equal(isProtectedBranch('main'), true);
  assert.equal(isProtectedBranch('master'), true);
  assert.equal(isProtectedBranch('slice/foo'), false);
  assert.equal(isProtectedBranch(''), false);
  assert.equal(isProtectedBranch(null), false);
});

test('@unit isAllowedBranchPrefix: slice/, feat/, fix/, docs/, chore/ are allowed', () => {
  assert.equal(isAllowedBranchPrefix('slice/foo'), true);
  assert.equal(isAllowedBranchPrefix('feat/bar'), true);
  assert.equal(isAllowedBranchPrefix('fix/baz'), true);
  assert.equal(isAllowedBranchPrefix('docs/x'), true);
  assert.equal(isAllowedBranchPrefix('chore/y'), true);
  assert.equal(isAllowedBranchPrefix('main'), false);
  assert.equal(isAllowedBranchPrefix('release/1.0'), false);
  assert.equal(isAllowedBranchPrefix(''), false);
});

test('@unit validateBranchName: empty/whitespace/leading-dash rejected with exit 4', () => {
  for (const bad of ['', '   ', '-x', '\t']) {
    const r = validateBranchName(bad);
    assert.equal(r.ok, false);
    assert.equal(r.exitCode, 4);
  }
});

test('@unit validateBranchName: main rejected with exit 4 and helpful message', () => {
  const r = validateBranchName('main');
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 4);
  assert.match(r.message, /protected/);
});

test('@unit validateBranchName: master rejected with exit 4', () => {
  const r = validateBranchName('master');
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 4);
});

test('@unit validateBranchName: release/1.0 rejected (not an allowed prefix)', () => {
  const r = validateBranchName('release/1.0');
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 4);
  assert.match(r.message, /prefix/);
});

test('@unit validateBranchName: slice/foo accepted', () => {
  const r = validateBranchName('slice/foo');
  assert.equal(r.ok, true);
  assert.equal(r.name, 'slice/foo');
});

test('@unit validateBranchName: feat/bar accepted', () => {
  const r = validateBranchName('feat/bar');
  assert.equal(r.ok, true);
});

test('@unit PROTECTED_BRANCHES is frozen', () => {
  assert.ok(Object.isFrozen(PROTECTED_BRANCHES));
});

test('@unit ALLOWED_BRANCH_PREFIXES is frozen and contains the spec set', () => {
  assert.ok(Object.isFrozen(ALLOWED_BRANCH_PREFIXES));
  for (const expected of ['slice/', 'feat/', 'fix/', 'docs/', 'chore/']) {
    assert.ok(ALLOWED_BRANCH_PREFIXES.includes(expected));
  }
});

// --- async tests (temp git repos) ------------------------------------------

function makeTmpRepo(branchName = 'main') {
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-ship-validate-'));
  spawnSync('git', ['init', '-q', '-b', branchName], { cwd: dir });
  spawnSync(
    'git',
    ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init', '-q'],
    { cwd: dir },
  );
  return dir;
}

test('@unit validateShipTarget: non-git-repo cwd exits 3', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'mmd-ship-nogit-'));
  try {
    const r = await validateShipTarget(tmp);
    assert.equal(r.ok, false);
    assert.equal(r.exitCode, 3);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@unit validateShipTarget: current branch=main exits 4 (protected)', async () => {
  const repo = makeTmpRepo('main');
  try {
    const r = await validateShipTarget(repo);
    assert.equal(r.ok, false);
    assert.equal(r.exitCode, 4);
    assert.match(r.message, /protected|main/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('@unit validateShipTarget: slice/* branch resolves with sha + base', async () => {
  const repo = makeTmpRepo('main');
  try {
    spawnSync('git', ['checkout', '-q', '-b', 'slice/test-1779999999'], { cwd: repo });
    const r = await validateShipTarget(repo);
    assert.equal(r.ok, true);
    assert.equal(r.branch, 'slice/test-1779999999');
    assert.equal(r.baseBranch, 'main');
    assert.match(r.sha, /^[0-9a-f]{40}$/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('@unit validateShipTarget: explicit branch argument overrides current branch', async () => {
  const repo = makeTmpRepo('main');
  try {
    // We pass an explicit branch (validateBranchName check); cwd current branch is irrelevant.
    const r = await validateShipTarget(repo, { branch: 'feat/explicit' });
    assert.equal(r.ok, true);
    assert.equal(r.branch, 'feat/explicit');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('@unit validateShipTarget: explicit branch=main exits 4', async () => {
  const repo = makeTmpRepo('main');
  try {
    spawnSync('git', ['checkout', '-q', '-b', 'slice/foo'], { cwd: repo });
    const r = await validateShipTarget(repo, { branch: 'main' });
    assert.equal(r.ok, false);
    assert.equal(r.exitCode, 4);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('@unit validateShipTarget: custom baseBranch is honored', async () => {
  const repo = makeTmpRepo('main');
  try {
    spawnSync('git', ['checkout', '-q', '-b', 'slice/x'], { cwd: repo });
    const r = await validateShipTarget(repo, { baseBranch: 'develop' });
    assert.equal(r.ok, true);
    assert.equal(r.baseBranch, 'develop');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
