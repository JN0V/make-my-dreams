// @integration tests for the REAL `mmdream --here --resume` (SPEC_V012A AC-4,
// ADR-050): continue an interrupted run from its externalized checkpoint via
// the existing invokeAutodev seam, with a fake auto-dev standing in.
//
// We set up an interrupted-run shape by hand on a git repo:
//   - a slice branch + an in_progress status.json
//   - a resumable checkpoint (last_completed_phase 2 of 4)
//   - the gitignored .mmd/local/ run area
// then assert `--here --resume` RELAUNCHES the fake auto-dev (relaunch marker
// appears), and that a COMPLETE checkpoint (or none) is an honest no-op with no
// relaunch — never a fabricated continuation (§VI).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync,
} from 'node:fs';
import { tmpdir, platform } from 'node:os';
import path from 'node:path';

import { buildSubprocessEnv } from '../../lib/invoke-autodev.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');
const FIXTURE_HERE = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-autodev-here.sh');
const SKIP_ON_WINDOWS = platform() === 'win32';

function makeTmp() {
  return mkdtempSync(path.join(tmpdir(), 'mmd-here-resume-'));
}

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

/** A clean git repo on a slice branch, with an interrupted-run .mmd/ state. */
function initInterruptedRun(dir, { lastCompletedPhase, state = 'in_progress' }) {
  mkdirSync(dir, { recursive: true });
  git(['init', '-q', '-b', 'main'], dir);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init', '-q'], dir);
  git(['checkout', '-q', '-b', 'slice/interrupted-run'], dir);

  const shared = path.join(dir, '.mmd', 'shared');
  const local = path.join(dir, '.mmd', 'local');
  mkdirSync(shared, { recursive: true });
  mkdirSync(path.join(local, 'runs'), { recursive: true });
  mkdirSync(path.join(local, 'handoff'), { recursive: true });

  writeFileSync(
    path.join(shared, 'status.json'),
    JSON.stringify({
      slice_id: 'interrupted-run',
      dream: 'add a widget to the dashboard',
      state,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      tasks: [{ id: 'auto-dev', state: state === 'done' ? 'done' : 'in_progress' }],
    }),
  );
  writeFileSync(
    path.join(local, 'checkpoint.json'),
    JSON.stringify({ last_completed_phase: lastCompletedPhase, spec_frozen: true, spec_path: '.mmd/shared/slice.md' }),
  );
  writeFileSync(path.join(local, 'handoff', '1.md'), '# Phase 1 — spec produced\n');
  if (lastCompletedPhase >= 2) writeFileSync(path.join(local, 'handoff', '2.md'), '# Phase 2 — spec frozen\n');
  return dir;
}

function runResumeHere(cwd) {
  const env = {
    ...buildSubprocessEnv(process.env),
    MMD_AUTODEV_CMD: FIXTURE_HERE,
    MMD_REALITY_CHECK_BACKEND: 'skip',
    MMD_SKIP_SETUP: '1',
    MMD_SKIP_ALIGN: '1', // the alignment gate is exercised separately; keep resume focused
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  };
  return spawnSync('node', [MMD, '--here', '--resume'], { cwd, env, encoding: 'utf8', timeout: 30000 });
}

test('@integration AC-4: --here --resume on an incomplete run RELAUNCHES auto-dev', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    initInterruptedRun(tmp, { lastCompletedPhase: 2, state: 'in_progress' });
    const r = runResumeHere(tmp);
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}`);
    assert.match(r.stdout, /Resuming from phase 3/i, 'announces the resume from phase 3');
    assert.match(r.stdout, /Relaunching auto-dev/i);
    // The fake auto-dev ran in-place (it drops a marker) → relaunch happened.
    assert.ok(
      existsSync(path.join(tmp, '.mmd', 'local', 'runs', 'here-marker')),
      'fake auto-dev relaunch marker present → auto-dev was relaunched',
    );
    // It ran on the slice branch, not main.
    const branch = readFileSync(path.join(tmp, '.mmd', 'local', 'runs', 'here-branch.txt'), 'utf8').trim();
    assert.equal(branch, 'slice/interrupted-run');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration AC-4: --here --resume on a COMPLETE run is an honest no-op (no relaunch)', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    // last_completed_phase 4 of 4 → not resumable.
    initInterruptedRun(tmp, { lastCompletedPhase: 4, state: 'done' });
    const r = runResumeHere(tmp);
    assert.equal(r.status, 0, `expected honest no-op exit 0; stderr=${r.stderr}`);
    assert.match(r.stdout, /nothing to resume/i);
    assert.ok(
      !existsSync(path.join(tmp, '.mmd', 'local', 'runs', 'here-marker')),
      'no relaunch marker → auto-dev was NOT relaunched on a complete run',
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration AC-4: --here --resume with NO checkpoint reports no resumable run (no relaunch)', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    mkdirSync(tmp, { recursive: true });
    git(['init', '-q', '-b', 'main'], tmp);
    git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init', '-q'], tmp);
    const r = runResumeHere(tmp);
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}`);
    assert.match(r.stdout, /no resumable run/i);
    assert.ok(!existsSync(path.join(tmp, '.mmd', 'local', 'runs', 'here-marker')));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
