// @unit tests for lib/ship/validate-branch.js — SPEC_V02F AC-3.
//
// Pure-predicate tests run with no I/O. The validateShipTarget tests spawn
// `git` against a fresh tmp repo, which makes them more expensive than pure
// unit but well under 1s/case. Kept @unit because they exercise critical
// branch-protection logic that should run pre-push.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

test('@unit isProtectedBranch: main/master are protected', () => {
  assert.equal(isProtectedBranch('main'), true);
  assert.equal(isProtectedBranch('master'), true);
});

test('@unit isProtectedBranch: feature branches are not protected', () => {
  assert.equal(isProtectedBranch('slice/foo'), false);
  assert.equal(isProtectedBranch('feat/bar'), false);
  assert.equal(isProtectedBranch(''), false);
  assert.equal(isProtectedBranch(null), false);
  assert.equal(isProtectedBranch(undefined), false);
});

test('@unit isAllowedBranchPrefix: recognized prefixes', () => {
  for (const prefix of ALLOWED_BRANCH_PREFIXES) {
    assert.equal(isAllowedBranchPrefix(`${prefix}thing`), true, `prefix ${prefix} should be allowed`);
  }
});

test('@unit isAllowedBranchPrefix: unrelated names rejected', () => {
  assert.equal(isAllowedBranchPrefix('main'), false);
  assert.equal(isAllowedBranchPrefix('hotfix/foo'), false);
  assert.equal(isAllowedBranchPrefix(''), false);
  assert.equal(isAllowedBranchPrefix(null), false);
});

test('@unit PROTECTED_BRANCHES is frozen', () => {
  assert.ok(Object.isFrozen(PROTECTED_BRANCHES));
});

test('@unit ALLOWED_BRANCH_PREFIXES is frozen', () => {
  assert.ok(Object.isFrozen(ALLOWED_BRANCH_PREFIXES));
});

test('@unit validateBranchName: empty string -> exit 4', () => {
  const r = validateBranchName('');
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 4);
  assert.match(r.message, /empty/);
});

test('@unit validateBranchName: main -> exit 4 with explanation', () => {
  const r = validateBranchName('main');
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 4);
  assert.match(r.message, /protected/);
});

test('@unit validateBranchName: master -> exit 4', () => {
  const r = validateBranchName('master');
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 4);
});

test('@unit validateBranchName: whitespace -> exit 4', () => {
  const r = validateBranchName('bad branch');
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 4);
  assert.match(r.message, /suspicious/);
});

test('@unit validateBranchName: leading dash -> exit 4', () => {
  const r = validateBranchName('-bad');
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 4);
});

test('@unit validateBranchName: non-allowed prefix -> exit 4', () => {
  const r = validateBranchName('hotfix/urgent');
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 4);
  assert.match(r.message, /allowed prefix/);
});

test('@unit validateBranchName: slice/* accepted', () => {
  const r = validateBranchName('slice/here-foo-12345');
  assert.equal(r.ok, true);
  assert.equal(r.name, 'slice/here-foo-12345');
});

test('@unit validateBranchName: feat/fix/docs/chore/refactor/test prefixes accepted', () => {
  for (const p of ['feat/x', 'fix/x', 'docs/x', 'chore/x', 'refactor/x', 'test/x']) {
    const r = validateBranchName(p);
    assert.equal(r.ok, true, `${p} should be accepted`);
  }
});

test('@unit validateBranchName: unicode in name OK if prefixed', () => {
  // Unicode chars after the prefix are technically valid git refs.
  const r = validateBranchName('slice/here-café-12345');
  assert.equal(r.ok, true);
});

test('@unit validateBranchName: non-string types -> exit 4', () => {
  for (const v of [null, undefined, 123, true, [], {}]) {
    const r = validateBranchName(v);
    assert.equal(r.ok, false, `value ${typeof v} should be rejected`);
    assert.equal(r.exitCode, 4);
  }
});

// ── async validateShipTarget tests (require git) ───────────────────────────

function makeTmpRepo(prefix = 'mmd-shipvb-') {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  spawnSync(
    'git',
    ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init', '-q'],
    { cwd: dir },
  );
  return dir;
}

test('@unit validateShipTarget: non-git directory -> exit 3', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'mmd-shipvb-nogit-'));
  try {
    const r = await validateShipTarget(tmp);
    assert.equal(r.ok, false);
    assert.equal(r.exitCode, 3);
    assert.match(r.message, /git repository/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@unit validateShipTarget: missing cwd -> exit 3', async () => {
  const r = await validateShipTarget('');
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 3);
});

test('@unit validateShipTarget: on main (default base) -> exit 4 protected', async () => {
  const repo = makeTmpRepo();
  try {
    const r = await validateShipTarget(repo);
    assert.equal(r.ok, false);
    assert.equal(r.exitCode, 4);
    assert.match(r.message, /protected/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('@unit validateShipTarget: on a slice/* branch -> ok with sha + base', async () => {
  const repo = makeTmpRepo();
  try {
    spawnSync('git', ['checkout', '-q', '-b', 'slice/test'], { cwd: repo });
    writeFileSync(path.join(repo, 'a.txt'), 'x');
    spawnSync('git', ['add', 'a.txt'], { cwd: repo });
    spawnSync(
      'git',
      ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'feat: a'],
      { cwd: repo },
    );
    const r = await validateShipTarget(repo);
    assert.equal(r.ok, true);
    assert.equal(r.branch, 'slice/test');
    assert.equal(r.baseBranch, 'main');
    assert.match(r.sha, /^[0-9a-f]{40}$/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('@unit validateShipTarget: explicit branch arg overrides current branch', async () => {
  const repo = makeTmpRepo();
  try {
    spawnSync('git', ['checkout', '-q', '-b', 'main'], { cwd: repo });
    // Caller passes 'feat/x' even though we're on main — validation runs
    // against the provided name.
    const r = await validateShipTarget(repo, { branch: 'feat/x' });
    assert.equal(r.ok, true);
    assert.equal(r.branch, 'feat/x');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('@unit validateShipTarget: custom baseBranch is honored', async () => {
  const repo = makeTmpRepo();
  try {
    spawnSync('git', ['checkout', '-q', '-b', 'slice/foo'], { cwd: repo });
    const r = await validateShipTarget(repo, { baseBranch: 'develop' });
    assert.equal(r.ok, true);
    assert.equal(r.baseBranch, 'develop');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
