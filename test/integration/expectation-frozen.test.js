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

test('@integration v0.17.a AC-1: a second --here run does NOT overwrite an existing expectation.md (immutable)', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    initCleanRepo(tmp);
    // Gitignore .mmd/ so the seeded oracle below does NOT dirty the working tree
    // (the --here clean-tree check refuses a dirty repo; MMD itself gitignores
    // .mmd/ at run start, so this mirrors a resume on an already-set-up repo).
    writeFileSync(path.join(tmp, '.gitignore'), '.mmd/\n', 'utf8');
    git(['add', '.gitignore'], tmp);
    git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'ignore .mmd', '-q'], tmp);

    const expPath = path.join(tmp, '.mmd', 'shared', 'expectation.md');
    // Seed a pre-existing oracle that records a DIFFERENT original ask.
    mkdirSync(path.dirname(expPath), { recursive: true });
    const sentinel = '# Original expectation (frozen oracle — do NOT edit)\n\n## Original dream\nthe ORIGINAL frozen ask\n';
    writeFileSync(expPath, sentinel, 'utf8');

    const r = runHere(['--here', DREAM], { cwd: tmp });
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}`);
    const content = readFileSync(expPath, 'utf8');
    // The seeded oracle survives untouched — the build cannot move the goalposts.
    assert.match(content, /the ORIGINAL frozen ask/);
    assert.doesNotMatch(content, /add a small greeting feature/);
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
