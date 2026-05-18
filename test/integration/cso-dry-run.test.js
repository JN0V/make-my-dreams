// @integration tests for `mmd cso` — AC-3 (help/routing), dry-run.

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

function makeCsoRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-cso-dry-'));
  const git = (args) => {
    const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args],
      { cwd: dir, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}\n${r.stdout}`);
  };
  git(['init', '-q', '-b', 'main']);
  git(['commit', '--allow-empty', '-m', 'init', '-q']);
  git(['checkout', '-q', '-b', 'slice/test-cso-1779999999']);
  writeFileSync(path.join(dir, 'src.js'), 'console.log("hi");\n');
  git(['add', 'src.js']);
  git(['commit', '-m', 'feat: seed src', '-q']);
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

test('@smoke @integration mmd cso --help exits 0', () => {
  const r = runMmd(['cso', '--help']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes(`mmd ${PKG.version}`));
});

test('@integration mmd cso --help contains canonical anchors', () => {
  const r = runMmd(['cso', '--help']);
  assert.equal(r.status, 0);
  for (const anchor of [
    'mmd cso',
    '--dry-run',
    '--help',
    '~/.claude/skills/gstack/cso/SKILL.md',
    'MMD_CSO_CMD',
    'MMD_CSO_TIMEOUT_MS',
    'MMD_GSTACK_SKILLS_DIR',
    'gstack',
  ]) {
    assert.ok(r.stdout.includes(anchor), `mmd cso --help missing anchor '${anchor}'`);
  }
});

test('@integration AC-6 — mmd cso --help mentions gstack (≥1)', () => {
  const r = runMmd(['cso', '--help']);
  const matches = (r.stdout.match(/gstack/gi) || []).length;
  assert.ok(matches >= 1);
});

test('@integration mmd cso outside a git repo exits 3', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'mmd-cso-nogit-'));
  try {
    const r = runMmd(['cso', '--dry-run'], { cwd: tmp });
    assert.equal(r.status, 3, r.stderr);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration mmd cso --dry-run on a slice branch exits 0 in <5s', () => {
  const dir = makeCsoRepo();
  try {
    const t0 = Date.now();
    const r = runMmd(['cso', '--dry-run'], { cwd: dir });
    const elapsedMs = Date.now() - t0;
    assert.equal(r.status, 0, `stderr=${r.stderr}\nstdout=${r.stdout}`);
    assert.ok(elapsedMs < 5000, `dry-run took ${elapsedMs}ms (>5000ms budget)`);
    assert.match(r.stdout, /slice\/test-cso-1779999999/);
    assert.match(r.stdout, /PATH=.*\.bun\/bin/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration mmd cso --dry-run prompt mentions security audit categories', () => {
  const dir = makeCsoRepo();
  try {
    const r = runMmd(['cso', '--dry-run'], { cwd: dir });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /secret/i, 'prompt must mention secret scanning');
    assert.match(r.stdout, /dependency|dep audit/i, 'prompt must mention dependency audit');
    assert.match(r.stdout, /lethal trifecta/i, 'prompt must mention lethal trifecta');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration mmd cso --bogus is rejected with exit 2', () => {
  const dir = makeCsoRepo();
  try {
    const r = runMmd(['cso', '--bogus'], { cwd: dir });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /unknown cso arg/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
