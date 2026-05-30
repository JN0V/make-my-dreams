// test/integration/document-lessons-e2e.test.js — @integration
// SPEC_V02I AC-5: end-to-end `mmd document-lessons` over fixture composer
// audits + a fixture lessons file. Spawns the real CLI.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MMD = fileURLToPath(new URL('../../bin/mmd.js', import.meta.url));

function setupRepo({ counter = 1, promoteIfN = 5, inject = ['L-900'] } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'mmd-doclessons-'));
  mkdirSync(path.join(root, '.mmd', 'local', 'runs'), { recursive: true });
  mkdirSync(path.join(root, 'docs', 'adr'), { recursive: true });
  mkdirSync(path.join(root, '.specify', 'memory', 'constitution'), { recursive: true });
  writeFileSync(
    path.join(root, '.specify', 'memory', 'constitution', 'testing.md'),
    `# Testing\n\n---\n\n*Version: 1.0.0*\n`,
    'utf8',
  );
  const lessonsPath = path.join(root, 'docs', 'lessons-learned.md');
  writeFileSync(
    lessonsPath,
    `# Lessons\n\n---\n\n## L-900 — fixture lesson\n\n**Status**: active\n` +
      `**Rule**: fixture rule body.\n` +
      `**To promote if**: ${promoteIfN} reuses validated (counter: ${counter}) — promote to testing.md\n` +
      `**Keywords for matching**: fixture\n\n---\n`,
    'utf8',
  );
  writeFileSync(
    path.join(root, '.mmd', 'local', 'runs', 'r1.composer.json'),
    JSON.stringify({ composer_version: 'v0.2e', matched: inject.map((id) => ({ id, score: 1 })) }),
    'utf8',
  );
  return { root, lessonsPath };
}

function run(root, args, env = {}) {
  return spawnSync(process.execPath, [MMD, 'document-lessons', ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('@integration --help prints usage with flags + exit codes, exit 0', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'mmd-doclessons-help-'));
  const r = run(root, ['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /--dry-run/);
  assert.match(r.stdout, /--since/);
  assert.match(r.stdout, /5 {2}no composer\.json found/);
  assert.match(r.stdout, /MODIFIES docs\/lessons-learned\.md/);
});

test('@integration exit 5 when no composer audits exist', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'mmd-doclessons-empty-'));
  mkdirSync(path.join(root, 'docs'), { recursive: true });
  writeFileSync(path.join(root, 'docs', 'lessons-learned.md'), '# Lessons\n', 'utf8');
  const r = run(root, [], { MMD_LESSONS_FILE: path.join(root, 'docs', 'lessons-learned.md') });
  assert.equal(r.status, 5);
});

test('@integration --dry-run modifies nothing, exit 0', () => {
  const { root, lessonsPath } = setupRepo({ counter: 1, promoteIfN: 5 });
  const before = readFileSync(lessonsPath, 'utf8');
  const r = run(root, ['--dry-run'], { MMD_LESSONS_FILE: lessonsPath });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /would increment 1 counter/);
  assert.equal(readFileSync(lessonsPath, 'utf8'), before, 'lessons file unchanged');
});

test('@integration real run increments the counter, exit 0', () => {
  const { root, lessonsPath } = setupRepo({ counter: 1, promoteIfN: 5 });
  const r = run(root, [], { MMD_LESSONS_FILE: lessonsPath });
  assert.equal(r.status, 0);
  assert.match(readFileSync(lessonsPath, 'utf8'), /\(counter: 2\)/);
});

test('@integration real run auto-promotes at threshold (module + removal + ADR)', () => {
  const { root, lessonsPath } = setupRepo({ counter: 4, promoteIfN: 5 });
  const r = run(root, [], { MMD_LESSONS_FILE: lessonsPath });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /will promote 1 lesson/);
  // Removed from lessons-learned.md.
  assert.doesNotMatch(readFileSync(lessonsPath, 'utf8'), /## L-900/);
  // Appended to the constitution module.
  const mod = readFileSync(path.join(root, '.specify', 'memory', 'constitution', 'testing.md'), 'utf8');
  assert.match(mod, /### L-900 — fixture lesson/);
  // ADR written.
  const adr = readdirSync(path.join(root, 'docs', 'adr')).find((f) => /lesson-L-900-promoted\.md$/.test(f));
  assert.ok(adr, 'promotion ADR created');
});

test('@integration idempotent: re-running with no new audits keeps counter stable on promote', () => {
  // After a promotion the lesson is gone, so a second run finds nothing to do.
  const { root, lessonsPath } = setupRepo({ counter: 4, promoteIfN: 5 });
  run(root, [], { MMD_LESSONS_FILE: lessonsPath });
  const r2 = run(root, [], { MMD_LESSONS_FILE: lessonsPath });
  assert.equal(r2.status, 0);
  assert.match(r2.stdout, /will promote 0 lesson/);
});
