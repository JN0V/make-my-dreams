// test/unit/documentalist-promote-lesson.test.js — @unit + @integration
// SPEC_V02I AC-4.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  promoteLesson,
  nextAdrNumber,
  appendPromotion,
  buildPromotionAdr,
  buildModuleAppendBlock,
} from '../../lib/documentalist/promote-lesson.js';

test('@unit nextAdrNumber returns max+1 zero-padded', () => {
  assert.equal(nextAdrNumber(['001-a.md', '013-z.md', 'README.md']), '014');
  assert.equal(nextAdrNumber([]), '001');
});

test('@unit appendPromotion adds the section once, before a Version footer', () => {
  const mod = `# Module\n\nBody.\n\n---\n\n*Version: 1.0.0 | foo*\n`;
  const lesson = { id: 'L-005', title: 'Tests read source', rule: 'read from source.' };
  const once = appendPromotion(mod, lesson);
  assert.match(once, /## Promoted from lessons-learned/);
  assert.match(once, /### L-005 — Tests read source/);
  // Footer stays last.
  assert.match(once, /\*Version: 1\.0\.0 \| foo\*\s*$/);
  // Second promotion does NOT duplicate the section heading.
  const twice = appendPromotion(once, { id: 'L-006', title: 'Two', rule: 'two.' });
  assert.equal((twice.match(/## Promoted from lessons-learned/g) || []).length, 1);
  assert.match(twice, /### L-006 — Two/);
});

test('@unit buildModuleAppendBlock + buildPromotionAdr embed id/title/rule', () => {
  const lesson = { id: 'L-008', title: 'Branch cleanup', rule: 'merge before delete.' };
  assert.match(buildModuleAppendBlock(lesson), /### L-008 — Branch cleanup[\s\S]*merge before delete\./);
  const adr = buildPromotionAdr({ adrNumber: '014', lesson, targetModule: 'commit-git.md', date: '2026-05-30' });
  assert.match(adr, /# ADR-014: Promote L-008 into commit-git\.md/);
  assert.match(adr, /Date: 2026-05-30/);
  assert.match(adr, /merge before delete\./);
});

test('@unit promoteLesson dryRun returns a plan and touches no files', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'mmd-promote-dry-'));
  const plan = (async () =>
    promoteLesson(
      { id: 'L-005', title: 'T', rule: 'r', targetModule: 'testing.md' },
      root,
      { dryRun: true },
    ))();
  return plan.then((p) => {
    assert.equal(p.action, 'promote');
    assert.equal(p.targetModule, 'testing.md');
    assert.match(p.adrPath, /001-lesson-L-005-promoted\.md$/);
    assert.equal(existsSync(path.join(root, 'docs')), false);
  });
});

test('@integration promoteLesson appends module, removes lesson, writes ADR', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'mmd-promote-'));
  mkdirSync(path.join(root, '.specify', 'memory', 'constitution'), { recursive: true });
  mkdirSync(path.join(root, 'docs', 'adr'), { recursive: true });
  const modulePath = path.join(root, '.specify', 'memory', 'constitution', 'testing.md');
  const lessonsPath = path.join(root, 'docs', 'lessons-learned.md');
  writeFileSync(modulePath, `# Testing\n\n---\n\n*Version: 1.0.0*\n`, 'utf8');
  writeFileSync(
    lessonsPath,
    `# Lessons\n\n---\n\n## L-005 — Hardcoded versions\n\n**Status**: active\n**Rule**: read from source.\n**To promote if**: 5 reuses (counter: 5) — promote to testing.md\n\n---\n`,
    'utf8',
  );
  writeFileSync(path.join(root, 'docs', 'adr', '013-prior.md'), '# ADR-013\n', 'utf8');

  const result = await promoteLesson(
    { id: 'L-005', title: 'Hardcoded versions', rule: 'read from source.', targetModule: 'testing.md', promoteLine: '**To promote if**: 5 reuses (counter: 5)' },
    root,
    { lessonsPath, date: '2026-05-30' },
  );

  assert.equal(result.action, 'promoted');
  assert.equal(result.errors, undefined);
  assert.match(readFileSync(modulePath, 'utf8'), /### L-005 — Hardcoded versions/);
  assert.doesNotMatch(readFileSync(lessonsPath, 'utf8'), /## L-005/);
  const adr = readdirSync(path.join(root, 'docs', 'adr')).find((f) => f === '014-lesson-L-005-promoted.md');
  assert.ok(adr, 'ADR-014 created');
});

test('@integration promoteLesson reports errors best-effort when a target is missing', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'mmd-promote-err-'));
  // No .specify dir → module append fails, but the call still resolves.
  mkdirSync(path.join(root, 'docs', 'adr'), { recursive: true });
  writeFileSync(path.join(root, 'docs', 'lessons-learned.md'), '## L-005 — x\n\n---\n', 'utf8');
  const result = await promoteLesson(
    { id: 'L-005', title: 'x', rule: 'r', targetModule: 'testing.md' },
    root,
    { lessonsPath: path.join(root, 'docs', 'lessons-learned.md'), date: '2026-05-30' },
  );
  assert.equal(result.action, 'promoted');
  assert.ok(Array.isArray(result.errors) && result.errors.length >= 1);
});
