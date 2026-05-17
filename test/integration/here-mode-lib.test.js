// @integration tests for lib/here-mode.js — exercise validateHereTarget +
// createSliceBranch against REAL temp git repos. These are I/O-bound (subprocess
// git invocations) so they live in test/integration/ not test/unit/, per
// testing.md §V.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import path from 'node:path';

import {
  validateHereTarget,
  createSliceBranch,
  generateSliceBranchName,
} from '../../lib/here-mode.js';

const SKIP_ON_WINDOWS = platform() === 'win32';

function makeTmp(prefix = 'mmd-here-lib-') {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${r.stderr}`);
  }
  return r.stdout;
}

function initCleanRepo(dir, branch = 'main') {
  mkdirSync(dir, { recursive: true });
  git(['init', '-q', '-b', branch], dir);
  git(
    ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init', '-q'],
    dir,
  );
}

test('@integration validateHereTarget: returns ok with baseBranch=main + baseSha on a clean repo', { skip: SKIP_ON_WINDOWS }, async () => {
  const tmp = makeTmp();
  try {
    initCleanRepo(tmp);
    const sha = git(['rev-parse', 'HEAD'], tmp).trim();
    const r = await validateHereTarget(tmp);
    assert.equal(r.ok, true);
    assert.equal(r.baseBranch, 'main');
    assert.equal(r.baseSha, sha);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration validateHereTarget: non-git dir → ok:false exitCode:3', { skip: SKIP_ON_WINDOWS }, async () => {
  const tmp = makeTmp();
  try {
    const r = await validateHereTarget(tmp);
    assert.equal(r.ok, false);
    assert.equal(r.exitCode, 3);
    assert.match(r.message, /git repository|git could not run/i);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration validateHereTarget: dirty tree (untracked file) → ok:false exitCode:4', { skip: SKIP_ON_WINDOWS }, async () => {
  const tmp = makeTmp();
  try {
    initCleanRepo(tmp);
    writeFileSync(path.join(tmp, 'unstaged.txt'), 'hi');
    const r = await validateHereTarget(tmp);
    assert.equal(r.ok, false);
    assert.equal(r.exitCode, 4);
    assert.match(r.message, /clean working tree/i);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration validateHereTarget: dirty tree (modified tracked file) → ok:false exitCode:4', { skip: SKIP_ON_WINDOWS }, async () => {
  const tmp = makeTmp();
  try {
    initCleanRepo(tmp);
    writeFileSync(path.join(tmp, 'tracked.txt'), 'v1');
    git(['add', 'tracked.txt'], tmp);
    git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'add', '-q'], tmp);
    writeFileSync(path.join(tmp, 'tracked.txt'), 'v2 modified');
    const r = await validateHereTarget(tmp);
    assert.equal(r.ok, false);
    assert.equal(r.exitCode, 4);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration validateHereTarget: .gitignored untracked file does NOT trigger exit 4', { skip: SKIP_ON_WINDOWS }, async () => {
  const tmp = makeTmp();
  try {
    initCleanRepo(tmp);
    writeFileSync(path.join(tmp, '.gitignore'), 'ignored.txt\n');
    git(['add', '.gitignore'], tmp);
    git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'ignore', '-q'], tmp);
    // This file is ignored — porcelain v1 should NOT show it (default).
    writeFileSync(path.join(tmp, 'ignored.txt'), 'transient');
    const r = await validateHereTarget(tmp);
    assert.equal(r.ok, true, `expected ok:true; got message=${r.message}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration validateHereTarget: works on a repo whose default branch is master', { skip: SKIP_ON_WINDOWS }, async () => {
  const tmp = makeTmp();
  try {
    initCleanRepo(tmp, 'master');
    const sha = git(['rev-parse', 'HEAD'], tmp).trim();
    const r = await validateHereTarget(tmp);
    assert.equal(r.ok, true);
    assert.equal(r.baseBranch, 'master');
    assert.equal(r.baseSha, sha);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration validateHereTarget: HEAD detached → still ok, baseBranch reports detached', { skip: SKIP_ON_WINDOWS }, async () => {
  const tmp = makeTmp();
  try {
    initCleanRepo(tmp);
    const sha = git(['rev-parse', 'HEAD'], tmp).trim();
    git(['-c', 'advice.detachedHead=false', 'checkout', sha], tmp);
    const r = await validateHereTarget(tmp);
    assert.equal(r.ok, true);
    assert.match(r.baseBranch, /detached/i);
    assert.equal(r.baseSha, sha);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration createSliceBranch: creates and switches to slice branch on a clean repo', { skip: SKIP_ON_WINDOWS }, async () => {
  const tmp = makeTmp();
  try {
    initCleanRepo(tmp);
    const name = generateSliceBranchName('add-banner');
    const r = await createSliceBranch(tmp, name);
    assert.equal(r.ok, true);
    assert.equal(r.sliceBranch, name);
    const head = git(['rev-parse', '--abbrev-ref', 'HEAD'], tmp).trim();
    assert.equal(head, name);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration createSliceBranch (AC-3 exit 5): pre-existing branch with same name → ok:false exitCode:5', { skip: SKIP_ON_WINDOWS }, async () => {
  const tmp = makeTmp();
  try {
    initCleanRepo(tmp);
    const name = 'slice/here-pre-existing-1';
    git(['branch', name], tmp);
    const r = await createSliceBranch(tmp, name);
    assert.equal(r.ok, false);
    assert.equal(r.exitCode, 5);
    assert.match(r.message, /already exists|failed/i);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration createSliceBranch: refuses suspicious names (leading dash, whitespace)', { skip: SKIP_ON_WINDOWS }, async () => {
  const tmp = makeTmp();
  try {
    initCleanRepo(tmp);
    const r1 = await createSliceBranch(tmp, '-dangerous');
    assert.equal(r1.ok, false);
    assert.equal(r1.exitCode, 5);
    const r2 = await createSliceBranch(tmp, 'with space');
    assert.equal(r2.ok, false);
    assert.equal(r2.exitCode, 5);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
