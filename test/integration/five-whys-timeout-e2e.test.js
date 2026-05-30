// @integration — SPEC_V02K AC-6 (qa High-2): prove the L-006 hang-protection
// timeout fires end-to-end. With MMD_FIVEWHYS_TIMEOUT_MS=200 and a fake claude
// that sleeps 2s, the runner MUST kill the child well before the 2s sleep and
// fall back to recommended_action:"escalate-to-user" (exit 6) with "timeout" in
// the evidence.

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
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-5whys-timeout-'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['commit', '--allow-empty', '-m', 'init', '-q']);
  git(dir, ['checkout', '-q', '-b', 'slice/test-timeout']);
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

test('@integration AC-6: subprocess timeout fires → escalate-to-user with timeout evidence (exit 6)', () => {
  const dir = makeSliceRepo();
  try {
    const t0 = Date.now();
    const r = runMmd(['unblock', '--force'], {
      cwd: dir,
      env: {
        MMD_UNBLOCK_CMD: FAKE,
        MMD_FIVEWHYS_TIMEOUT_MS: '200',
        MMD_FAKE_5WHYS_SLEEP: '2',
      },
    });
    const elapsed = Date.now() - t0;
    assert.equal(r.status, 6, `stdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stdout, /recommended_action:\s*escalate-to-user/);
    const md = readSessionMd(dir);
    assert.match(md, /timeout|timed out/i, 'evidence should mention the timeout');
    // The kill fires at ~200ms; allow generous headroom for node spawn overhead
    // but assert it is well under the 2s the fake would otherwise sleep — i.e.
    // the timeout genuinely fired rather than the fake completing.
    assert.ok(elapsed < 1900, `expected timeout kill well under 2s, got ${elapsed}ms`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
