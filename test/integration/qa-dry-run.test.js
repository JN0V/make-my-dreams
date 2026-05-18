// @integration tests for `mmd qa` — AC-2 (help/routing), AC-5 (dry-run).
//
// Strategy: set up a temp git repo, drive bin/mmd.js via spawnSync.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildSubprocessEnv } from '../../lib/invoke-autodev.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');
const PKG = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));

function makeQaRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-qa-dry-'));
  const git = (args) => {
    const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args],
      { cwd: dir, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}\n${r.stdout}`);
  };
  git(['init', '-q', '-b', 'main']);
  git(['commit', '--allow-empty', '-m', 'init', '-q']);
  git(['checkout', '-q', '-b', 'slice/test-qa-1779999999']);
  writeFileSync(path.join(dir, 'CHANGELOG.md'), '# changes\n');
  git(['add', 'CHANGELOG.md']);
  git(['commit', '-m', 'docs: seed', '-q']);
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
    timeout: 15000,
  });
}

test('@smoke @integration mmd qa --help exits 0 and ends with the version footer', () => {
  const r = runMmd(['qa', '--help']);
  assert.equal(r.status, 0, r.stderr);
  // L-005: version comes from the same package.json the production code reads.
  assert.ok(
    r.stdout.includes(`mmd ${PKG.version}`),
    `expected 'mmd ${PKG.version}' in output; got: ${r.stdout}`,
  );
});

test('@integration mmd qa --help contains canonical anchors', () => {
  const r = runMmd(['qa', '--help']);
  assert.equal(r.status, 0, r.stderr);
  for (const anchor of [
    'mmd qa',
    '--dry-run',
    '--help',
    '<branch>',
    '~/.claude/skills/gstack/qa/SKILL.md',
    'MMD_QA_TIMEOUT_MS',
    'MMD_QA_CMD',
    'MMD_GSTACK_SKILLS_DIR',
    'gstack',
  ]) {
    assert.ok(
      r.stdout.includes(anchor),
      `mmd qa --help must contain '${anchor}'; got: ${r.stdout}`,
    );
  }
});

test('@integration AC-6 — mmd qa --help mentions gstack (≥1 match)', () => {
  const r = runMmd(['qa', '--help']);
  assert.equal(r.status, 0);
  const matches = (r.stdout.match(/gstack/gi) || []).length;
  assert.ok(matches >= 1, `expected ≥1 gstack mention in qa --help; got ${matches}`);
});

test('@integration mmd qa outside a git repo exits 3', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'mmd-qa-nogit-'));
  try {
    const r = runMmd(['qa', '--dry-run'], { cwd: tmp });
    assert.equal(r.status, 3, `expected exit 3; stderr=${r.stderr}\nstdout=${r.stdout}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration mmd qa --dry-run on a slice branch exits 0 in <5s', () => {
  const dir = makeQaRepo();
  try {
    const t0 = Date.now();
    const r = runMmd(['qa', '--dry-run'], { cwd: dir });
    const elapsedMs = Date.now() - t0;
    assert.equal(r.status, 0, `stderr=${r.stderr}\nstdout=${r.stdout}`);
    assert.ok(elapsedMs < 5000, `dry-run took ${elapsedMs}ms (>5000ms DoD budget)`);
    assert.match(r.stdout, /slice\/test-qa-1779999999/);
    // PATH env preview includes ~/.bun/bin.
    assert.match(r.stdout, /PATH=.*\.bun\/bin/);
    // Exit-0 marker.
    assert.match(r.stdout, /Exit 0|PASSED/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration mmd qa --dry-run works on a non-slice branch (qa is advisory)', () => {
  // Unlike `mmd ship`, qa does NOT enforce the slice/feat/fix/... prefix
  // list — qa is read-only and may run on main.
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-qa-main-'));
  try {
    const git = (args) => spawnSync(
      'git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args],
      { cwd: dir, encoding: 'utf8' },
    );
    git(['init', '-q', '-b', 'main']);
    git(['commit', '--allow-empty', '-m', 'init', '-q']);
    const r = runMmd(['qa', '--dry-run'], { cwd: dir });
    assert.equal(r.status, 0, `qa on main should be allowed; stderr=${r.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration mmd qa --bogus is rejected with exit 2', () => {
  const dir = makeQaRepo();
  try {
    const r = runMmd(['qa', '--bogus'], { cwd: dir });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /unknown qa arg/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration mmd qa --dry-run with explicit <branch> honors it', () => {
  const dir = makeQaRepo();
  try {
    const r = runMmd(['qa', '--dry-run', 'feat/explicit'], { cwd: dir });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /feat\/explicit/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
