// @unit tests for lib/composer/parse-lessons.js — SPEC_V02E AC-2.
//
// Strategy:
//   1. Parse synthetic fixtures (minimal/malformed/empty) and assert exact shape.
//   2. Parse the live `docs/lessons-learned.md` and assert at least 9 active
//      lessons + milestone exclusions hold.
//   3. Per L-005 / L-007: NEVER hardcode the lesson count or specific titles —
//      read from the file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { parseLessons } from '../../lib/composer/parse-lessons.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const LIVE = path.join(REPO_ROOT, 'docs', 'lessons-learned.md');
const FIX_MIN = path.join(REPO_ROOT, 'test', 'fixtures', 'composer-lessons', 'minimal.md');
const FIX_MAL = path.join(REPO_ROOT, 'test', 'fixtures', 'composer-lessons', 'malformed.md');
const FIX_EMPTY = path.join(REPO_ROOT, 'test', 'fixtures', 'composer-lessons', 'empty.md');

test('@unit parseLessons: minimal fixture — extracts 4 lessons with correct status', () => {
  const md = readFileSync(FIX_MIN, 'utf8');
  const lessons = parseLessons(md);
  assert.equal(lessons.length, 4);
  assert.deepEqual(lessons.map((l) => [l.id, l.status]), [
    ['L-001', 'active'],
    ['L-002', 'milestone'],
    ['L-003', 'active'],
    ['L-005', 'active'],
  ]);
});

test('@unit parseLessons: extracts comma-separated keywords', () => {
  const md = readFileSync(FIX_MIN, 'utf8');
  const lessons = parseLessons(md);
  const l1 = lessons.find((l) => l.id === 'L-001');
  assert.deepEqual(l1.keywords, ['alpha', 'bravo', 'gamma']);
});

test('@unit parseLessons: tolerates pipe-separated keywords (L-003)', () => {
  const md = readFileSync(FIX_MIN, 'utf8');
  const lessons = parseLessons(md);
  const l3 = lessons.find((l) => l.id === 'L-003');
  assert.deepEqual(l3.keywords, ['git branch -d', 'claude -p', 'mmd --here']);
});

test('@unit parseLessons: extracts rule text (multi-line aware)', () => {
  const md = readFileSync(FIX_MIN, 'utf8');
  const lessons = parseLessons(md);
  const l1 = lessons.find((l) => l.id === 'L-001');
  assert.match(l1.rule, /git checkout/);
});

test('@unit parseLessons: empty fixture — returns []', () => {
  const md = readFileSync(FIX_EMPTY, 'utf8');
  const lessons = parseLessons(md);
  assert.equal(lessons.length, 0);
});

test('@unit parseLessons: malformed fixture — warnings raised, parser does not throw', () => {
  const md = readFileSync(FIX_MAL, 'utf8');
  const warnings = [];
  const lessons = parseLessons(md, { onWarn: (m) => warnings.push(m) });

  // All 5 lessons should be parsed even with field gaps.
  assert.equal(lessons.length, 5);

  // L-100 has no Status — defaults to 'unknown' + emits a warning.
  const l100 = lessons.find((l) => l.id === 'L-100');
  assert.equal(l100.status, 'unknown');
  assert.ok(warnings.some((w) => w.includes('L-100')));

  // L-101 has no Rule but is active — warns (we want rule body for injection).
  const l101 = lessons.find((l) => l.id === 'L-101');
  assert.equal(l101.status, 'active');
  assert.equal(l101.rule, '');
  assert.ok(warnings.some((w) => w.includes('L-101')));

  // L-102 has no Keywords — warns.
  const l102 = lessons.find((l) => l.id === 'L-102');
  assert.deepEqual(l102.keywords, []);
  assert.ok(warnings.some((w) => w.includes('L-102')));

  // L-103 has `**Rule** (parenthetical):` — must still parse.
  const l103 = lessons.find((l) => l.id === 'L-103');
  assert.match(l103.rule, /parenthetical Rule label MUST still parse/);

  // L-104 has pipe-separated keywords.
  const l104 = lessons.find((l) => l.id === 'L-104');
  assert.deepEqual(l104.keywords, ['foo bar', 'baz qux', 'quux']);
});

test('@unit parseLessons: live docs/lessons-learned.md — parses without throwing', () => {
  // L-005 / L-007: never hardcode lesson count or titles. Just verify that
  // at least 9 active lessons are present and ALL milestone lessons are
  // tagged correctly (L-010, L-011, L-013 carry `**Status**: milestone`).
  const md = readFileSync(LIVE, 'utf8');
  const lessons = parseLessons(md);
  const active = lessons.filter((l) => l.status === 'active');
  const milestones = lessons.filter((l) => l.status === 'milestone');
  assert.ok(active.length >= 9, `expected >=9 active lessons; got ${active.length}`);
  assert.ok(milestones.length >= 3, `expected >=3 milestone lessons; got ${milestones.length}`);
  // Every active lesson has at least one keyword (or it would never match).
  for (const l of active) {
    assert.ok(
      Array.isArray(l.keywords) && l.keywords.length > 0,
      `active lesson ${l.id} has no keywords — refresh fixture or live file`,
    );
  }
});

test('@unit parseLessons: throws TypeError on non-string input', () => {
  assert.throws(() => parseLessons(null), TypeError);
  assert.throws(() => parseLessons(42), TypeError);
});
