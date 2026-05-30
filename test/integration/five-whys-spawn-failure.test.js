// @integration — SPEC_V02K AC-5 (qa High-1): prove the L-016 sacred-fallback
// guarantee for the 5-Whys spawn-failure branch end-to-end. When `claude -p`
// cannot be spawned, OR exits non-zero without a parseable result, `mmd unblock`
// MUST return recommended_action:"escalate-to-user" (exit 6) and never throw.
//
// NEVER spawns real claude — MMD_UNBLOCK_CMD points at a missing binary or the
// fake fixture.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, rmSync, mkdirSync, copyFileSync, readdirSync, readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildSubprocessEnv } from '../../lib/invoke-autodev.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');
const FIX = path.join(REPO_ROOT, 'test', 'fixtures', 'stuck-slices');
const FAKE = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-claude-five-whys.sh');

function git(dir, args) {
  const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd: dir, encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
}

function makeSliceRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-5whys-spawnfail-'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['commit', '--allow-empty', '-m', 'init', '-q']);
  git(dir, ['checkout', '-q', '-b', 'slice/test-spawnfail']);
  mkdirSync(path.join(dir, '.mmd', 'shared'), { recursive: true });
  copyFileSync(
    path.join(FIX, 'fresh-not-stalled', '.mmd', 'shared', 'status.json'),
    path.join(dir, '.mmd', 'shared', 'status.json'),
  );
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'seed', '-q']);
  return dir;
}

function runMmd(args, opts = {}) {
  const env = {
    ...buildSubprocessEnv(process.env),
    MMD_COMPOSER_DISABLED: '1',
    ...(opts.env || {}),
  };
  return spawnSync('node', [MMD, ...args], { cwd: opts.cwd, env, encoding: 'utf8', timeout: 30000 });
}

function readSessionMd(dir) {
  const dir5 = path.join(dir, '.mmd', 'shared', '5-whys');
  const files = readdirSync(dir5).filter((f) => f.endsWith('.md'));
  assert.ok(files.length >= 1, 'expected a 5-whys session file');
  return readFileSync(path.join(dir5, files[0]), 'utf8');
}

test('@integration AC-5: genuine spawn failure (missing claude) → escalate-to-user (exit 6)', () => {
  const dir = makeSliceRepo();
  try {
    const r = runMmd(['unblock', '--force'], {
      cwd: dir,
      env: { MMD_UNBLOCK_CMD: path.join(dir, 'no-such-claude-binary-xyz') },
    });
    assert.equal(r.status, 6, `stdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stdout, /recommended_action:\s*escalate-to-user/);
    assert.match(r.stdout, /parse_ok:\s*false/);
    // evidence[] (in the session md) describes the spawn error.
    const md = readSessionMd(dir);
    assert.match(md, /spawn failed|not found/i);
    assert.match(md, /escalate-to-user/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration AC-5: fake claude exits non-zero without JSON → escalate-to-user (exit 6)', () => {
  const dir = makeSliceRepo();
  try {
    const r = runMmd(['unblock', '--force'], {
      cwd: dir,
      env: { MMD_UNBLOCK_CMD: FAKE, MMD_FAKE_5WHYS_EXIT: '1' },
    });
    assert.equal(r.status, 6, `stdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stdout, /recommended_action:\s*escalate-to-user/);
    assert.match(r.stdout, /parse_ok:\s*false/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
