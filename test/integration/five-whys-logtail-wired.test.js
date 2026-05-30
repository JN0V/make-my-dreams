// @integration — SPEC_V02K AC-7 (qa High-3): prove the run-log tail is wired
// into the 5-Whys prompt end-to-end. A known marker placed in the slice's
// latest .mmd/local/runs/*.log MUST reach the prompt
// (safeReadLogTail → context.logTail → buildFiveWhysPrompt) and therefore the
// fake claude that dumps the prompt it received — guarding against a silent
// regression back to logTail:''.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, rmSync, mkdirSync, copyFileSync, writeFileSync, readdirSync, readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildSubprocessEnv } from '../../lib/invoke-autodev.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');
const FIX = path.join(REPO_ROOT, 'test', 'fixtures', 'stuck-slices');
const FAKE = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-claude-five-whys.sh');
const MARKER = 'MARKER_LOG_TAIL_42';

function git(dir, args) {
  const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd: dir, encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
}

function makeSliceRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-5whys-logtail-'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['commit', '--allow-empty', '-m', 'init', '-q']);
  git(dir, ['checkout', '-q', '-b', 'slice/test-logtail']);
  mkdirSync(path.join(dir, '.mmd', 'shared'), { recursive: true });
  copyFileSync(
    path.join(FIX, 'fresh-not-stalled', '.mmd', 'shared', 'status.json'),
    path.join(dir, '.mmd', 'shared', 'status.json'),
  );
  // Seed a run log carrying the marker under .mmd/local/runs/ (where
  // safeReadLogTail / readRecentRunLogs looks).
  const runsDir = path.join(dir, '.mmd', 'local', 'runs');
  mkdirSync(runsDir, { recursive: true });
  writeFileSync(
    path.join(runsDir, 'run.log'),
    `phase 1: starting\n${MARKER}\nphase 1: still working\n`,
    'utf8',
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

test('@integration AC-7: the run-log tail reaches the 5-Whys prompt end-to-end', () => {
  const dir = makeSliceRepo();
  try {
    const r = runMmd(['unblock', '--force'], {
      cwd: dir,
      env: { MMD_UNBLOCK_CMD: FAKE, MMD_FAKE_5WHYS_DUMP_PROMPT: '1' },
    });
    // Default fake action is continue-with-hint → exit 8.
    assert.equal(r.status, 8, `stdout=${r.stdout}\nstderr=${r.stderr}`);
    const dir5 = path.join(dir, '.mmd', 'shared', '5-whys');
    const files = readdirSync(dir5).filter((f) => f.endsWith('.md'));
    assert.ok(files.length >= 1, 'expected a 5-whys session file');
    const md = readFileSync(path.join(dir5, files[0]), 'utf8');
    // The dumped prompt (embedded in the session log) must contain the marker —
    // proving safeReadLogTail → context.logTail → prompt is wired.
    assert.match(md, new RegExp(MARKER),
      'the run-log marker must reach the prompt (logTail wiring must not regress to "")');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
