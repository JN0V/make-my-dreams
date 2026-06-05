// @integration tests for v0.17.a — the semantic judge is ANCHORED to the FROZEN
// expectation.md (SPEC_V017A AC-2), not the mutable slice.md / in-memory dream.
// A pre-seeded expectation.md carries a sentinel that does NOT appear in the
// dream; the capture fixture records the judge prompt; the test asserts the
// sentinel (the frozen oracle) reached the judge. The real claude is never run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync,
} from 'node:fs';
import { tmpdir, platform } from 'node:os';
import path from 'node:path';

import { buildSubprocessEnv } from '../../lib/invoke-autodev.js';
import { buildExpectationContent } from '../../lib/conductor/expectation.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');
const FIXTURE = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-autodev-capture-judge.sh');
const SKIP_ON_WINDOWS = platform() === 'win32';

function makeTmp() { return mkdtempSync(path.join(tmpdir(), 'mmd-anchor-')); }
function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${r.stderr}`);
  return r.stdout;
}
function initCleanRepo(dir) {
  mkdirSync(dir, { recursive: true });
  git(['init', '-q', '-b', 'main'], dir);
  writeFileSync(path.join(dir, '.gitignore'), '.mmd/\n', 'utf8');
  git(['add', '.gitignore'], dir);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'init', '-q'], dir);
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

test('@integration v0.17.a AC-2: the judge prompt is built from the FROZEN expectation.md, not slice.md', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    initCleanRepo(tmp);
    // The mutable in-memory dream is slice.md/spec material the build can polish.
    // The frozen oracle carries a sentinel that does NOT appear in that dream.
    const DREAM = 'a mutable ask the build could polish into something else';
    const SENTINEL = 'FROZEN-ORACLE-SENTINEL-9f3a';
    // Pre-seed a frozen oracle for THIS dream (v0.20.a: the oracle is stamped with
    // the dream-id, so a same-dream run PRESERVES it; the seeded sentinel survives
    // and reaches the judge). The sentinel proves the judge graded against the
    // FROZEN oracle, not the in-memory dream.
    const expPath = path.join(tmp, '.mmd', 'shared', 'expectation.md');
    mkdirSync(path.dirname(expPath), { recursive: true });
    const seeded = buildExpectationContent(DREAM, undefined)
      .replace(DREAM, `${DREAM}\n\n${SENTINEL}`);
    writeFileSync(expPath, seeded, 'utf8');

    const r = runHere(['--here', DREAM], { cwd: tmp });
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}\nstdout=${r.stdout}`);

    const promptPath = path.join(tmp, '.mmd', 'local', 'runs', 'judge-prompt.txt');
    assert.ok(existsSync(promptPath), 'the judge must have been invoked (prompt captured)');
    const prompt = readFileSync(promptPath, 'utf8');
    // The judge graded against the FROZEN oracle (the sentinel is present).
    assert.match(prompt, new RegExp(SENTINEL), 'judge prompt must contain the frozen expectation.md content');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration v0.17.a AC-2: with no expectation.md present, the judge falls back to the dream (honest, never fabricated)', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    initCleanRepo(tmp);
    // No pre-seed. The run writes expectation.md from the dream at start, so the
    // judge anchor IS the dream content (round-trips through the frozen oracle).
    const DREAM = 'build a unique greeting widget XYZ-anchor-test';
    const r = runHere(['--here', DREAM], { cwd: tmp });
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}`);
    const promptPath = path.join(tmp, '.mmd', 'local', 'runs', 'judge-prompt.txt');
    assert.ok(existsSync(promptPath));
    assert.match(readFileSync(promptPath, 'utf8'), /XYZ-anchor-test/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
