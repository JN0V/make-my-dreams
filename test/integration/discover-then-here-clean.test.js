// @integration — SPEC_V06B AC-3: the discover→`mmd --here` friction fix.
//
// After `mmd discover`, the tree is dirtied only by MMD scratch (.mmd/,
// mmd-discovery-report.md, .gitignore). The first-run guard's dirty-tree
// preflight must treat that as clean (so no manual stash is needed), while a
// real user change still refuses with exit 4 (F7 intact).
//
// Coverage split (L-009 honesty): the "proceeds" half is exercised by bridging
// the REAL post-discover `git status --porcelain` through the same predicate the
// preflight uses (running the full --here would shell out to install-mmd.sh).
// The "user-dirtied → exit 4" half is a real `mmd --here` spawn — it refuses at
// the preflight, before any setup runner is invoked, so it is cheap + faithful.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { isTreeCleanIgnoringMmd } from '../../lib/onboarding/mmd-managed.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');

function git(dir, ...args) {
  return spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8' });
}

function porcelain(dir) {
  return spawnSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' }).stdout;
}

// A minimal real (non-MMD, not-set-up) repo, then `mmd discover` on it.
function makeDiscoveredRepo(tag) {
  const dir = mkdtempSync(path.join(tmpdir(), `mmd-d2h-${tag}-`));
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0' }));
  writeFileSync(path.join(dir, 'index.js'), 'console.log(1);\n');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  const r = spawnSync('node', [MMD, 'discover', '.'], { cwd: dir, encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 0, `discover failed: ${r.stderr}`);
  return dir;
}

test('@integration discover gitignores its scratch (idempotent, marked block)', () => {
  const dir = makeDiscoveredRepo('gi');
  try {
    const gi1 = readFileSync(path.join(dir, '.gitignore'), 'utf8');
    assert.match(gi1, /# MMD discovery scratch \(auto-added by mmd discover\)/);
    assert.match(gi1, /^\.mmd\/$/m);
    assert.match(gi1, /^mmd-discovery-report\.md$/m);

    // Idempotent: a second discover must not duplicate the block.
    const r2 = spawnSync('node', [MMD, 'discover', '.'], { cwd: dir, encoding: 'utf8', timeout: 30000 });
    assert.equal(r2.status, 0, `2nd discover failed: ${r2.stderr}`);
    const gi2 = readFileSync(path.join(dir, '.gitignore'), 'utf8');
    const occurrences = gi2.split('# MMD discovery scratch').length - 1;
    assert.equal(occurrences, 1, 'the marked block must appear exactly once');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration post-discover tree is MMD-only dirty → counts as clean (friction fix)', () => {
  const dir = makeDiscoveredRepo('clean');
  try {
    const p = porcelain(dir);
    // .mmd/ and the report are now gitignored → the only dirty path is .gitignore.
    assert.equal(isTreeCleanIgnoringMmd(p), true, `post-discover porcelain not MMD-only:\n${p}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration a real user change after discover → preflight refuses with exit 4 (F7)', () => {
  const dir = makeDiscoveredRepo('f7');
  try {
    // A genuine user edit on top of the MMD scratch.
    writeFileSync(path.join(dir, 'index.js'), 'console.log("changed by the user");\n');
    const p = porcelain(dir);
    assert.equal(isTreeCleanIgnoringMmd(p), false, 'a user change must NOT count as clean');

    // The real guard refuses at the preflight, before any setup runner spawns.
    const r = spawnSync('node', [MMD, '--here', 'tweak the greeting'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, MMD_SKIP_GROUNDING: '1' },
    });
    assert.equal(r.status, 4, `expected exit 4, got ${r.status}; stderr: ${r.stderr}`);
    assert.match(r.stderr, /clean working tree/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
