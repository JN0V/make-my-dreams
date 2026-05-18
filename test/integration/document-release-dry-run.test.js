// @integration tests for `mmd document-release` — AC-4 (help/routing/refs).

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

function makeRepoWithTag() {
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-dr-dry-'));
  const git = (args) => {
    const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args],
      { cwd: dir, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}\n${r.stdout}`);
  };
  git(['init', '-q', '-b', 'main']);
  git(['commit', '--allow-empty', '-m', 'init', '-q']);
  git(['tag', 'v0.0.1']);
  git(['commit', '--allow-empty', '-m', 'feat: more', '-q']);
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

test('@smoke @integration mmd document-release --help exits 0', () => {
  const r = runMmd(['document-release', '--help']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes(`mmd ${PKG.version}`));
});

test('@integration mmd document-release --help contains canonical anchors', () => {
  const r = runMmd(['document-release', '--help']);
  assert.equal(r.status, 0);
  for (const anchor of [
    'mmd document-release',
    '<from>',
    '<to>',
    '--dry-run',
    '~/.claude/skills/gstack/document-release/SKILL.md',
    'MMD_DOCUMENT_RELEASE_CMD',
    'MMD_GSTACK_SKILLS_DIR',
    'gstack',
  ]) {
    assert.ok(r.stdout.includes(anchor), `missing anchor '${anchor}' in: ${r.stdout}`);
  }
});

test('@integration AC-6 — mmd document-release --help mentions gstack (≥1)', () => {
  const r = runMmd(['document-release', '--help']);
  const matches = (r.stdout.match(/gstack/gi) || []).length;
  assert.ok(matches >= 1);
});

test('@integration mmd document-release outside a git repo exits 3', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'mmd-dr-nogit-'));
  try {
    const r = runMmd(['document-release', '--dry-run'], { cwd: tmp });
    assert.equal(r.status, 3, r.stderr);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration mmd document-release with no tags + no <from> exits 4', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-dr-notags-'));
  try {
    const git = (args) => spawnSync(
      'git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args],
      { cwd: dir, encoding: 'utf8' },
    );
    git(['init', '-q', '-b', 'main']);
    git(['commit', '--allow-empty', '-m', 'init', '-q']);
    const r = runMmd(['document-release', '--dry-run'], { cwd: dir });
    assert.equal(r.status, 4, r.stderr);
    assert.match(r.stderr, /no tags/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration mmd document-release --dry-run with tag + HEAD exits 0 in <5s', () => {
  const dir = makeRepoWithTag();
  try {
    const t0 = Date.now();
    const r = runMmd(['document-release', '--dry-run'], { cwd: dir });
    const elapsedMs = Date.now() - t0;
    assert.equal(r.status, 0, `stderr=${r.stderr}\nstdout=${r.stdout}`);
    assert.ok(elapsedMs < 5000, `dry-run took ${elapsedMs}ms (>5000ms budget)`);
    assert.match(r.stdout, /v0\.0\.1/);
    assert.match(r.stdout, /HEAD/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration mmd document-release --dry-run with explicit refs honors both', () => {
  const dir = makeRepoWithTag();
  try {
    const r = runMmd(['document-release', '--dry-run', 'v0.0.1', 'HEAD'], { cwd: dir });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /From\s*:\s*v0\.0\.1/);
    assert.match(r.stdout, /To\s*:\s*HEAD/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration mmd document-release with invalid <from> exits 4', () => {
  const dir = makeRepoWithTag();
  try {
    const r = runMmd(['document-release', '--dry-run', 'no-such-ref'], { cwd: dir });
    assert.equal(r.status, 4, r.stderr);
    assert.match(r.stderr, /<from>.*not a valid commit|no-such-ref/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration mmd document-release --dry-run prompt mentions the output path', () => {
  const dir = makeRepoWithTag();
  try {
    const r = runMmd(['document-release', '--dry-run'], { cwd: dir });
    assert.equal(r.status, 0);
    // The dry-run preview shows the .md output path.
    assert.match(r.stdout, /document-release-runs/);
    assert.match(r.stdout, /\.md/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration mmd document-release --bogus exits 2', () => {
  const r = runMmd(['document-release', '--bogus']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown document-release arg/);
});
