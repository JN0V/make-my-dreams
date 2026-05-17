// @integration tests for `mmd ship` — AC-3 (help/routing), AC-5 (dry-run).
//
// Strategy: set up a temp git repo, copy in the script + patterns + a minimal
// bin/ship.js entry, then drive bin/mmd.js via spawnSync.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildSubprocessEnv } from '../../lib/invoke-autodev.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');

/** Initialize a clean repo on a slice/* branch so `mmd ship` accepts it. */
function makeShipReadyRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-ship-dry-'));
  const git = (args) => {
    const r = spawnSync(
      'git',
      ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args],
      { cwd: dir, encoding: 'utf8' },
    );
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}\n${r.stdout}`);
    return r.stdout;
  };
  git(['init', '-q', '-b', 'main']);
  git(['commit', '--allow-empty', '-m', 'init', '-q']);
  git(['checkout', '-q', '-b', 'slice/test-ship-1779999999']);
  // A second commit so the slice has something to "ship".
  writeFileSync(path.join(dir, 'CHANGELOG.md'), '# changes\n');
  git(['add', 'CHANGELOG.md']);
  git(['commit', '-m', 'docs: seed changelog', '-q']);
  return dir;
}

function runMmd(args, opts = {}) {
  const baseEnv = buildSubprocessEnv(process.env);
  const env = {
    ...baseEnv,
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
    ...(opts.env || {}),
  };
  return spawnSync('node', [MMD, ...args], {
    cwd: opts.cwd,
    env,
    encoding: 'utf8',
    timeout: 30000,
  });
}

test('mmd ship --help exits 0 and prints usage anchors', () => {
  const r = runMmd(['ship', '--help']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /mmd ship/i);
  assert.match(r.stdout, /--dry-run/);
  assert.match(r.stdout, /<branch>/);
});

test('mmd ship outside a git repo exits 3', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'mmd-ship-nogit-'));
  try {
    const r = runMmd(['ship'], { cwd: tmp });
    assert.equal(r.status, 3, `expected exit 3; stderr=${r.stderr}\nstdout=${r.stdout}`);
    assert.match(r.stderr, /not a git repository|git repository/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('mmd ship on main (protected) exits 4', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-ship-main-'));
  try {
    const git = (args) => spawnSync(
      'git',
      ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args],
      { cwd: dir, encoding: 'utf8' },
    );
    git(['init', '-q', '-b', 'main']);
    git(['commit', '--allow-empty', '-m', 'init', '-q']);
    const r = runMmd(['ship'], { cwd: dir });
    assert.equal(r.status, 4, `expected exit 4 on main; stderr=${r.stderr}\nstdout=${r.stdout}`);
    assert.match(r.stderr, /protected/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mmd ship --dry-run on a slice branch exits 0 and prints prompt + env + cmd', () => {
  const dir = makeShipReadyRepo();
  try {
    const r = runMmd(['ship', '--dry-run'], { cwd: dir });
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}\nstdout=${r.stdout}`);
    // The dry-run preview contains the slice branch, base, sha.
    assert.match(r.stdout, /slice\/test-ship-1779999999/);
    assert.match(r.stdout, /main/);
    // The planned subprocess command.
    assert.match(r.stdout, /claude/);
    // The PATH env preview must include ~/.bun/bin.
    assert.match(r.stdout, /PATH=.*\.bun\/bin/);
    // The exit-0 marker.
    assert.match(r.stdout, /Exit 0|PASSED/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mmd ship --dry-run on an unknown subcommand-style flag is rejected', () => {
  const dir = makeShipReadyRepo();
  try {
    const r = runMmd(['ship', '--bogus'], { cwd: dir });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /unknown ship arg|--bogus/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mmd ship --dry-run on a feat/* branch is accepted', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-ship-feat-'));
  try {
    const git = (args) => {
      const r = spawnSync(
        'git',
        ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args],
        { cwd: dir, encoding: 'utf8' },
      );
      if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
    };
    git(['init', '-q', '-b', 'main']);
    git(['commit', '--allow-empty', '-m', 'init', '-q']);
    git(['checkout', '-q', '-b', 'feat/something']);
    const r = runMmd(['ship', '--dry-run'], { cwd: dir });
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}`);
    assert.match(r.stdout, /feat\/something/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mmd ship --dry-run runs in under 5 seconds (DoD §3)', () => {
  const dir = makeShipReadyRepo();
  try {
    const t0 = Date.now();
    const r = runMmd(['ship', '--dry-run'], { cwd: dir });
    const elapsedMs = Date.now() - t0;
    assert.equal(r.status, 0, r.stderr);
    assert.ok(elapsedMs < 5000, `dry-run took ${elapsedMs}ms (>5000ms budget)`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mmd ship --dry-run with explicit <branch> argument honors it', () => {
  const dir = makeShipReadyRepo();
  try {
    // We're on slice/test-... but pass an explicit feat/* branch.
    const r = runMmd(['ship', '--dry-run', 'feat/explicit'], { cwd: dir });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /feat\/explicit/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mmd ship --dry-run with explicit main argument exits 4', () => {
  const dir = makeShipReadyRepo();
  try {
    const r = runMmd(['ship', '--dry-run', 'main'], { cwd: dir });
    assert.equal(r.status, 4, r.stderr);
    assert.match(r.stderr, /protected/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
