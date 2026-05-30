// @integration tests for `mmd unblock --force` end-to-end with the fake-claude
// 5-Whys fixture — SPEC_V02J AC-2/AC-3, DoD §4 (each of the 5 action types).
//
// NEVER spawns real claude — MMD_UNBLOCK_CMD points at the fixture (DoD §4 +
// SPEC §5 risk #6).

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

function makeSliceRepo(fixtureName) {
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-unblock-force-'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['commit', '--allow-empty', '-m', 'init', '-q']);
  git(dir, ['checkout', '-q', '-b', 'slice/test-force']);
  mkdirSync(path.join(dir, '.mmd', 'shared'), { recursive: true });
  copyFileSync(
    path.join(FIX, fixtureName, '.mmd', 'shared', 'status.json'),
    path.join(dir, '.mmd', 'shared', 'status.json'),
  );
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'seed', '-q']);
  return dir;
}

function runMmd(args, opts = {}) {
  const env = {
    ...buildSubprocessEnv(process.env),
    MMD_UNBLOCK_CMD: FAKE,
    MMD_COMPOSER_DISABLED: '1', // isolate from the live lessons file for these.
    ...(opts.env || {}),
  };
  return spawnSync('node', [MMD, ...args], {
    cwd: opts.cwd, env, encoding: 'utf8', timeout: 30000,
  });
}

const ACTION_EXIT = {
  'escalate-to-user': 6,
  'abandon-approach': 7,
  'continue-with-hint': 8,
  'task-actually-complete': 8,
  'false-positive-stall': 8,
};

for (const [action, exitCode] of Object.entries(ACTION_EXIT)) {
  test(`@integration unblock --force returns action '${action}' → exit ${exitCode}`, () => {
    const dir = makeSliceRepo('fresh-not-stalled'); // --force skips detector
    try {
      const r = runMmd(['unblock', '--force'], {
        cwd: dir,
        env: { MMD_FAKE_5WHYS_ACTION: action },
      });
      assert.equal(r.status, exitCode, `stdout=${r.stdout}\nstderr=${r.stderr}`);
      assert.match(r.stdout, new RegExp(`recommended_action:\\s*${action}`));
      // The session markdown file was written.
      const dir5 = path.join(dir, '.mmd', 'shared', '5-whys');
      const files = readdirSync(dir5).filter((f) => f.endsWith('.md'));
      assert.ok(files.length >= 1, 'expected a 5-whys session file');
      const md = readFileSync(path.join(dir5, files[0]), 'utf8');
      assert.match(md, new RegExp(action));
      assert.match(md, /Full session log/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('@integration unblock --force prose-only output falls back to escalate-to-user (exit 6)', () => {
  const dir = makeSliceRepo('fresh-not-stalled');
  try {
    const r = runMmd(['unblock', '--force'], {
      cwd: dir,
      env: { MMD_FAKE_5WHYS_ACTION: 'prose' },
    });
    assert.equal(r.status, 6, `stdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stdout, /recommended_action:\s*escalate-to-user/);
    assert.match(r.stdout, /parse_ok:\s*false/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration unblock --force malformed JSON falls back to escalate-to-user (exit 6)', () => {
  const dir = makeSliceRepo('fresh-not-stalled');
  try {
    const r = runMmd(['unblock', '--force'], {
      cwd: dir,
      env: { MMD_FAKE_5WHYS_ACTION: 'malformed' },
    });
    assert.equal(r.status, 6, `stdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stdout, /escalate-to-user/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration fake-claude received the correct spawn signature (PATH includes ~/.bun/bin)', () => {
  const dir = makeSliceRepo('fresh-not-stalled');
  try {
    const r = runMmd(['unblock', '--force'], {
      cwd: dir,
      env: { MMD_FAKE_5WHYS_ACTION: 'continue-with-hint' },
    });
    assert.equal(r.status, 8, r.stderr);
    const dir5 = path.join(dir, '.mmd', 'shared', '5-whys');
    const files = readdirSync(dir5).filter((f) => f.endsWith('.md'));
    const md = readFileSync(path.join(dir5, files[0]), 'utf8');
    assert.match(md, /\.bun\/bin/, 'PATH forced to include ~/.bun/bin in session log');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
