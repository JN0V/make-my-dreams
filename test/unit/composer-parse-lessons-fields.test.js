// @unit tests for lib/composer/parse-lessons.js Category + Applies to fields.
// SPEC_V02L AC-1: parser tolerates the new annotations and defaults sensibly
// when they are absent or malformed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { parseLessons } from '../../lib/composer/parse-lessons.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const LIVE = path.join(REPO_ROOT, 'docs', 'lessons-learned.md');

function lesson(md, withFields) {
  const block = `## L-100 — fixture lesson

**Status**: active
**Rule**: do the thing.
${withFields}
**Keywords for matching**: alpha, bravo
`;
  return parseLessons(`# fixture\n\n---\n\n${block}\n---\n`).find((l) => l.id === 'L-100');
}

test('@unit parse: Category + Applies to present → parsed as trimmed arrays', () => {
  const l = lesson(
    null,
    '**Category**: git, subprocess-control , observability\n**Applies to**: mmd --here, mmd ship',
  );
  assert.deepEqual(l.category, ['git', 'subprocess-control', 'observability']);
  assert.deepEqual(l.appliesTo, ['mmd --here', 'mmd ship']);
});

test('@unit parse: both fields absent → defaults (uncategorized / *)', () => {
  const l = lesson(null, '');
  assert.deepEqual(l.category, ['uncategorized']);
  assert.deepEqual(l.appliesTo, ['*']);
});

test('@unit parse: only Category present → appliesTo defaults to *', () => {
  const l = lesson(null, '**Category**: testing');
  assert.deepEqual(l.category, ['testing']);
  assert.deepEqual(l.appliesTo, ['*']);
});

test('@unit parse: only Applies to present → category defaults to uncategorized', () => {
  const l = lesson(null, '**Applies to**: mmd qa');
  assert.deepEqual(l.category, ['uncategorized']);
  assert.deepEqual(l.appliesTo, ['mmd qa']);
});

test('@unit parse: malformed (present but empty) → defaults', () => {
  const l = lesson(null, '**Category**:   \n**Applies to**: ,  , ');
  assert.deepEqual(l.category, ['uncategorized']);
  assert.deepEqual(l.appliesTo, ['*']);
});

test('@unit parse: quoted commas are NOT split', () => {
  const l = lesson(null, '**Category**: "foo, bar", baz\n**Applies to**: mmd --here');
  assert.deepEqual(l.category, ['foo, bar', 'baz']);
});

test('@unit parse: field names are case-insensitive', () => {
  const l = lesson(null, '**category**: git\n**applies TO**: mmd ship');
  assert.deepEqual(l.category, ['git']);
  assert.deepEqual(l.appliesTo, ['mmd ship']);
});

test('@unit parse: fields placed BEFORE Keywords parse correctly', () => {
  // splitCsvField + collectFields must not bleed into the next field.
  const md = `# fixture

---

## L-101 — fields before keywords

**Status**: active
**Category**: git
**Applies to**: mmd --here
**Rule**: keep order tolerant.
**Keywords for matching**: alpha, bravo

---
`;
  const l = parseLessons(md).find((x) => x.id === 'L-101');
  assert.deepEqual(l.category, ['git']);
  assert.deepEqual(l.appliesTo, ['mmd --here']);
  assert.deepEqual(l.keywords, ['alpha', 'bravo']);
});

test('@unit parse: fields placed AFTER Keywords parse correctly', () => {
  const md = `# fixture

---

## L-102 — fields after keywords

**Status**: active
**Rule**: keep order tolerant.
**Keywords for matching**: alpha, bravo
**Category**: git, observability
**Applies to**: mmd ship, mmd qa

---
`;
  const l = parseLessons(md).find((x) => x.id === 'L-102');
  assert.deepEqual(l.category, ['git', 'observability']);
  assert.deepEqual(l.appliesTo, ['mmd ship', 'mmd qa']);
  assert.deepEqual(l.keywords, ['alpha', 'bravo']);
});

test('@unit parse: live lessons file — every lesson has category + appliesTo arrays', () => {
  const md = readFileSync(LIVE, 'utf8');
  const lessons = parseLessons(md);
  assert.ok(lessons.length > 0, 'expected lessons to parse');
  for (const l of lessons) {
    assert.ok(Array.isArray(l.category) && l.category.length > 0, `${l.id} category`);
    assert.ok(Array.isArray(l.appliesTo) && l.appliesTo.length > 0, `${l.id} appliesTo`);
  }
});
