// @integration tests for v0.17.a — the FROZEN EXPECTATION oracle (SPEC_V017A
// AC-1). Drives the real `mmd` CLI with the fake-autodev-align fixture so a full
// --here / greenfield run actually writes .mmd/shared/expectation.md at run
// start, and a SECOND run on the same target does NOT overwrite it (immutable,
// anti-drift). The real claude is NEVER invoked (MMD_AUTODEV_CMD=fixture).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync,
} from 'node:fs';
import { tmpdir, platform } from 'node:os';
import path from 'node:path';

import { buildSubprocessEnv } from '../../lib/invoke-autodev.js';
import { slugify } from '../../lib/parse-dream.js';
import { resolveAlignmentAnchor } from '../../lib/conductor/expectation.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');
const FIXTURE = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-autodev-align.sh');
const SKIP_ON_WINDOWS = platform() === 'win32';

function makeTmp(prefix = 'mmd-exp-') {
  return mkdtempSync(path.join(tmpdir(), prefix));
}
function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${r.stderr}`);
  return r.stdout;
}
function initCleanRepo(dir) {
  mkdirSync(dir, { recursive: true });
  git(['init', '-q', '-b', 'main'], dir);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init', '-q'], dir);
  return dir;
}
function runHere(args, opts = {}) {
  const env = {
    ...buildSubprocessEnv(process.env),
    MMD_AUTODEV_CMD: FIXTURE,
    MMD_REALITY_CHECK_BACKEND: 'skip',
    MMD_SKIP_SETUP: '1',
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
    ...(opts.env || {}),
  };
  return spawnSync('node', [MMD, ...args], { cwd: opts.cwd, env, encoding: 'utf8', timeout: 120000 });
}

const DREAM = 'add a small greeting feature to the app';

test('@integration v0.17.a AC-1: --here writes expectation.md at run start with the dream verbatim', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    initCleanRepo(tmp);
    const r = runHere(['--here', DREAM], { cwd: tmp });
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}\nstdout=${r.stdout}`);
    const expPath = path.join(tmp, '.mmd', 'shared', 'expectation.md');
    assert.ok(existsSync(expPath), 'expectation.md must be written at run start');
    const content = readFileSync(expPath, 'utf8');
    assert.match(content, /frozen oracle — do NOT edit/);
    assert.match(content, /## Original dream/);
    assert.match(content, /add a small greeting feature to the app/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration v0.20.a AC-4: a second --here run with a DIFFERENT dream OVERWRITES the stale oracle (v0.19 regression)', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    initCleanRepo(tmp);
    // Gitignore .mmd/ so the seeded oracle below does NOT dirty the working tree
    // (the --here clean-tree check refuses a dirty repo; MMD itself gitignores
    // .mmd/ at run start, so this mirrors a repo that already ran a prior slice).
    writeFileSync(path.join(tmp, '.gitignore'), '.mmd/\n', 'utf8');
    git(['add', '.gitignore'], tmp);
    git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'ignore .mmd', '-q'], tmp);

    const expPath = path.join(tmp, '.mmd', 'shared', 'expectation.md');
    // Seed a stale oracle from a PRIOR slice (old v0.17 format, NO dream-id stamp).
    mkdirSync(path.dirname(expPath), { recursive: true });
    const sentinel = '# Original expectation (frozen oracle — do NOT edit)\n\n## Original dream\nthe ORIGINAL frozen ask\n';
    writeFileSync(expPath, sentinel, 'utf8');

    // A genuinely NEW dream, no --resume → the stale oracle MUST be overwritten so
    // the alignment gate grades THIS dream (the exact v0.19 leak being fixed).
    const r = runHere(['--here', DREAM], { cwd: tmp });
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}`);
    // AC-5: the new-dream overwrite logs an honest line to stdout.
    assert.match(r.stdout, /New dream.*fresh alignment oracle/);
    const content = readFileSync(expPath, 'utf8');
    // The oracle now holds the NEW dream — the build is graded against the right ask.
    assert.match(content, /add a small greeting feature/);
    assert.doesNotMatch(content, /the ORIGINAL frozen ask/);
    // The semantic judge's anchor is therefore the NEW dream's oracle, not the stale one.
    const anchor = resolveAlignmentAnchor(path.dirname(expPath), 'in-memory fallback', {
      readExpectation: (p) => readFileSync(p, 'utf8'),
    });
    assert.match(anchor, /add a small greeting feature/);
    assert.doesNotMatch(anchor, /the ORIGINAL frozen ask/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration v0.20.a AC-4: a second --here run with the SAME dream PRESERVES the oracle (anti-drift)', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    initCleanRepo(tmp);
    writeFileSync(path.join(tmp, '.gitignore'), '.mmd/\n', 'utf8');
    git(['add', '.gitignore'], tmp);
    git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'ignore .mmd', '-q'], tmp);

    const expPath = path.join(tmp, '.mmd', 'shared', 'expectation.md');

    // First run writes a stamped oracle for DREAM.
    const r1 = runHere(['--here', DREAM], { cwd: tmp });
    assert.equal(r1.status, 0, `first run expected exit 0; stderr=${r1.stderr}`);
    assert.ok(existsSync(expPath), 'first run must write expectation.md');
    const after1 = readFileSync(expPath, 'utf8');
    assert.match(after1, /<!-- dream-id: [a-f0-9]{16} -->/, 'oracle carries a dream-id stamp');

    // Return to a clean main so the second --here starts fresh (the first run left
    // the repo on its slice branch + an MMD-managed .gitignore edit; .mmd/ is
    // gitignored so the frozen oracle survives the reset). Delete the slice branch
    // so the same-dream re-run (same slug → same branch name) does not collide.
    const sliceBranch1 = git(['branch', '--show-current'], tmp).trim();
    git(['checkout', '-q', 'main'], tmp);
    git(['reset', '--hard', '-q', 'main'], tmp);
    git(['clean', '-fdq', '-e', '.mmd'], tmp);
    if (sliceBranch1 && sliceBranch1 !== 'main') git(['branch', '-D', '-q', sliceBranch1], tmp);

    // Second run with the SAME dream (no --resume) → preserved byte-for-byte.
    const r2 = runHere(['--here', DREAM], { cwd: tmp });
    assert.equal(r2.status, 0, `second run expected exit 0; stderr=${r2.stderr}`);
    const after2 = readFileSync(expPath, 'utf8');
    assert.equal(after2, after1, 'same-dream re-run preserves the oracle byte-for-byte (anti-drift)');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration v0.20.a AC-4: resolveAlignmentAnchor returns the correct dream after a new-dream overwrite', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    initCleanRepo(tmp);
    writeFileSync(path.join(tmp, '.gitignore'), '.mmd/\n', 'utf8');
    git(['add', '.gitignore'], tmp);
    git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'ignore .mmd', '-q'], tmp);

    const expPath = path.join(tmp, '.mmd', 'shared', 'expectation.md');

    // First dream writes its oracle.
    const firstDream = 'build a markdown previewer';
    const r1 = runHere(['--here', firstDream], { cwd: tmp });
    assert.equal(r1.status, 0, `first run expected exit 0; stderr=${r1.stderr}`);
    assert.match(readFileSync(expPath, 'utf8'), /markdown previewer/);

    // Return to a clean main so the second --here starts fresh.
    git(['checkout', '-q', 'main'], tmp);
    git(['reset', '--hard', '-q', 'main'], tmp);
    git(['clean', '-fdq', '-e', '.mmd'], tmp);

    // A genuinely different SECOND dream overwrites it.
    const r2 = runHere(['--here', DREAM], { cwd: tmp });
    assert.equal(r2.status, 0, `second run expected exit 0; stderr=${r2.stderr}`);

    // The judge's anchor resolves to the SECOND dream's oracle (the v0.19 bug would
    // have anchored to the first dream and "passed" against the wrong criteria).
    const anchor = resolveAlignmentAnchor(path.dirname(expPath), 'in-memory fallback', {
      readExpectation: (p) => readFileSync(p, 'utf8'),
    });
    assert.match(anchor, /add a small greeting feature/);
    assert.doesNotMatch(anchor, /markdown previewer/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration v0.17.a AC-1: greenfield writes expectation.md at run start', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp('mmd-exp-gf-');
  try {
    const dream = 'a tiny greeting page';
    const slug = slugify(dream);
    const env = {
      ...buildSubprocessEnv(process.env),
      MMD_AUTODEV_CMD: FIXTURE,
      MMD_REALITY_CHECK_BACKEND: 'skip',
    };
    const r = spawnSync('node', [MMD, dream], { cwd: tmp, env, encoding: 'utf8', timeout: 120000 });
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}\nstdout=${r.stdout}`);
    const expPath = path.join(tmp, 'demo', slug, '.mmd', 'shared', 'expectation.md');
    assert.ok(existsSync(expPath), 'greenfield expectation.md must be written at run start');
    assert.match(readFileSync(expPath, 'utf8'), /a tiny greeting page/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
