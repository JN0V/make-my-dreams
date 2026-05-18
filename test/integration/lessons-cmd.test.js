// @integration tests for the `mmd lessons` CLI subcommand — SPEC_V02E AC-7.
//
// Strategy: spawn `node bin/mmd.js lessons …` against the live repo and
// assert on stdout + exit code. Validates the full argv → composer → output
// path end-to-end.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const BIN_MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');

function runMmd(args, opts = {}) {
  return spawnSync('node', [BIN_MMD, ...args], {
    cwd: opts.cwd || REPO_ROOT,
    env: opts.env || process.env,
    encoding: 'utf8',
    timeout: 15000,
  });
}

test('@integration mmd lessons --help: exits 0 and prints usage', () => {
  const r = runMmd(['lessons', '--help']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Usage:/);
  assert.match(r.stdout, /mmd lessons match/);
});

test('@integration mmd lessons (default): lists active lessons from the live file', () => {
  const r = runMmd(['lessons']);
  assert.equal(r.status, 0, r.stderr);
  // Live docs/lessons-learned.md must yield at least 9 active lessons.
  const matches = r.stdout.match(/^L-\d+ \|/gm) || [];
  assert.ok(matches.length >= 9, `expected >=9 active rows; got ${matches.length}`);
  // Header columns must be present.
  assert.match(r.stdout, /ID\s+\|\s+KW\s+\|\s+INJ\s+\|\s+TITLE/);
});

test('@integration mmd lessons match "git checkout to switch branches" returns L-003 (DoD §4)', () => {
  const r = runMmd(['lessons', 'match', 'git checkout to switch branches']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^L-003 \|/m);
});

test('@integration mmd lessons --show L-008: prints full lesson body', () => {
  const r = runMmd(['lessons', '--show', 'L-008']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^# L-008/m);
  assert.match(r.stdout, /\*\*Rule\*\*:/);
});

test('@integration mmd lessons --show banana: exits 2 with malformed-id error', () => {
  const r = runMmd(['lessons', '--show', 'banana']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /invalid lesson id/);
});

test('@integration mmd lessons match with no prompt: exits 2', () => {
  const r = runMmd(['lessons', 'match']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /prompt argument is required/);
});

test('@integration mmd lessons: missing docs/lessons-learned.md → exits 3', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'mmd-lessons-missing-'));
  try {
    const r = runMmd(['lessons'], { cwd: tmp });
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stderr, /lessons file not found/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration mmd lessons: MMD_LESSONS_FILE override works for testing', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'mmd-lessons-override-'));
  try {
    const file = path.join(tmp, 'custom.md');
    writeFileSync(
      file,
      `# Lessons\n\n## L-042 — override smoke\n\n**Status**: active\n**Rule**: x.\n**Keywords for matching**: alpha\n`,
      'utf8',
    );
    const r = runMmd(['lessons'], {
      cwd: tmp,
      env: { ...process.env, MMD_LESSONS_FILE: file },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /L-042 \|/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration mmd lessons: composer-injection counts reflect .mmd/local audits', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'mmd-lessons-counts-'));
  try {
    // Seed minimal docs/lessons-learned.md
    const docsDir = path.join(tmp, 'docs');
    mkdirSync(docsDir, { recursive: true });
    writeFileSync(
      path.join(docsDir, 'lessons-learned.md'),
      `# Lessons\n\n## L-001 — alpha\n\n**Status**: active\n**Rule**: x.\n**Keywords for matching**: alpha\n`,
      'utf8',
    );
    // Seed 3 fake composer.json files with L-001 injected.
    const runsDir = path.join(tmp, '.mmd', 'local', 'qa-runs');
    mkdirSync(runsDir, { recursive: true });
    for (let i = 0; i < 3; i++) {
      writeFileSync(
        path.join(runsDir, `${i}.composer.json`),
        JSON.stringify({ injected_count: 1, matched: [{ id: 'L-001' }] }),
        'utf8',
      );
    }
    const r = runMmd(['lessons'], { cwd: tmp });
    assert.equal(r.status, 0, r.stderr);
    // The injection-count column for L-001 should be 3.
    assert.match(r.stdout, /^L-001 \|\s+\d+\s+\|\s+3\s+\|/m);
    assert.match(r.stdout, /Composer activity: 3 run\(s\) audited/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
