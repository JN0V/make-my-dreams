// @integration tests for the wip-uncommitted-since-N-min stall signal flowing
// through `mmd unblock` — SPEC_V02N AC-4.
//
// Builds a REAL slice repo with a dirty worktree and a stale last commit so the
// production detector (real git accessors, no injection) fires the signal, then
// asserts:
//   - `mmd unblock --dry-run` lists the signal + worktreeDirty/wipUncommittedMin
//   - `mmd unblock --help` lists the new signal in the closed-enum block
//   - a full `mmd unblock` session (fake claude) renders the signal in the
//     `## Stall signals` markdown AND the WIP-salvage hint reaches the prompt
//
// NEVER spawns real claude — MMD_UNBLOCK_CMD points at the fake fixture, and
// MMD_FAKE_5WHYS_DUMP_PROMPT=1 echoes the received prompt so we can prove the
// hint landed (mirrors test/integration/unblock-five-whys-fake.test.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildSubprocessEnv } from '../../lib/invoke-autodev.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');
const FAKE = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-claude-five-whys.sh');

const SLICE = 'slice/wip-salvage';
// Comfortably older than both the no-commit (10) and wip (15) thresholds so the
// test is robust against wall-clock drift during the run.
const OLD_DATE = '2 hours ago';

function git(dir, args) {
  const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd: dir, encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
}

/** A slice repo whose last commit is ~2h old AND whose worktree is dirty. */
function makeDirtyStaleRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-wip-salvage-'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['commit', '--allow-empty', '-m', 'init', '-q', `--date=${OLD_DATE}`]);
  git(dir, ['checkout', '-q', '-b', SLICE]);
  mkdirSync(path.join(dir, '.mmd', 'shared'), { recursive: true });
  writeFileSync(
    path.join(dir, '.mmd', 'shared', 'status.json'),
    JSON.stringify({ state: 'in_progress', dream: 'implement something' }, null, 2),
  );
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'seed', '-q', `--date=${OLD_DATE}`]);
  // Make the tree dirty: an uncommitted file = WIP at risk of loss.
  writeFileSync(path.join(dir, 'wip.txt'), 'uncommitted work in progress\n');
  return dir;
}

function runMmd(args, opts = {}) {
  const env = {
    ...buildSubprocessEnv(process.env),
    MMD_UNBLOCK_CMD: FAKE,
    MMD_COMPOSER_DISABLED: '1', // isolate from the live lessons file.
    ...(opts.env || {}),
  };
  return spawnSync('node', [MMD, ...args], {
    cwd: opts.cwd, env, encoding: 'utf8', timeout: 30000,
  });
}

test('@integration unblock --dry-run lists wip-uncommitted-since-N-min + evidence', () => {
  const dir = makeDirtyStaleRepo();
  try {
    const r = runMmd(['unblock', '--dry-run'], { cwd: dir });
    // A detected stall in --dry-run exits 8 (per AC-3 exit-code table).
    assert.equal(r.status, 8, `stdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stdout, /wip-uncommitted-since-N-min/);
    assert.match(r.stdout, /"worktreeDirty":\s*true/);
    assert.match(r.stdout, /"wipUncommittedMin":\s*[0-9]/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration unblock --help lists the new signal in the closed enum', () => {
  const r = runMmd(['unblock', '--help']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Stall signals \(closed enum\)/);
  assert.match(r.stdout, /- wip-uncommitted-since-N-min/);
});

test('@integration full session renders the signal in markdown + WIP-salvage hint in prompt', () => {
  const dir = makeDirtyStaleRepo();
  try {
    const r = runMmd(['unblock'], {
      cwd: dir,
      env: { MMD_FAKE_5WHYS_ACTION: 'escalate-to-user', MMD_FAKE_5WHYS_DUMP_PROMPT: '1' },
    });
    // escalate-to-user → exit 6.
    assert.equal(r.status, 6, `stdout=${r.stdout}\nstderr=${r.stderr}`);

    const dir5 = path.join(dir, '.mmd', 'shared', '5-whys');
    const files = readdirSync(dir5).filter((f) => f.endsWith('.md'));
    assert.ok(files.length >= 1, 'expected a 5-whys session file');
    const md = readFileSync(path.join(dir5, files[0]), 'utf8');

    // AC-4: the signal appears under the `## Stall signals` section.
    assert.match(md, /## Stall signals[\s\S]*- wip-uncommitted-since-N-min/);
    // AC-4: the WIP-salvage hint (escalate-to-user + git stash push -u) reached
    // the prompt — the fake dumped it into the session log captured in the md.
    assert.match(md, /git stash push -u -m "wip-salvage slice\/wip-salvage"/);
    assert.match(md, /is the appropriate recommended action/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
