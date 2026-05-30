// @unit tests for lib/here-mode/extract-file-refs.js — SPEC_V02H AC-1.
//
// Pure function, no I/O. Exhaustive per AC-1: zero refs, single, multiple,
// duplicate, and edge cases (backticks, quotes, surrounding punctuation).
// Per testing.md §V: < 100 ms total.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractFileRefs } from '../../lib/here-mode/extract-file-refs.js';

test('@unit extractFileRefs: empty / non-string input → []', () => {
  assert.deepEqual(extractFileRefs(''), []);
  assert.deepEqual(extractFileRefs(undefined), []);
  assert.deepEqual(extractFileRefs(null), []);
  assert.deepEqual(extractFileRefs(42), []);
});

test('@unit extractFileRefs: no documented reference → []', () => {
  assert.deepEqual(extractFileRefs('add a banner and refactor the parser'), []);
  // A bare ".md" word or an undocumented extension is not matched.
  assert.deepEqual(extractFileRefs('see notes.txt and CHANGELOG'), []);
});

test('@unit extractFileRefs: single SPEC_*.md reference', () => {
  assert.deepEqual(extractFileRefs('implement v0.2.h per SPEC_V02H.md'), ['SPEC_V02H.md']);
});

test('@unit extractFileRefs: docs/*.md reference', () => {
  assert.deepEqual(
    extractFileRefs('read docs/lessons-learned.md for context'),
    ['docs/lessons-learned.md'],
  );
});

test('@unit extractFileRefs: docs/adr/*.md is matched by the general docs pattern', () => {
  assert.deepEqual(
    extractFileRefs('per docs/adr/012-composer-categorization.md'),
    ['docs/adr/012-composer-categorization.md'],
  );
});

test('@unit extractFileRefs: .specify/memory/*.md reference', () => {
  assert.deepEqual(
    extractFileRefs('load .specify/memory/constitution.md first'),
    ['.specify/memory/constitution.md'],
  );
  // nested path under .specify/memory
  assert.deepEqual(
    extractFileRefs('see .specify/memory/constitution/ai-coding.md'),
    ['.specify/memory/constitution/ai-coding.md'],
  );
});

test('@unit extractFileRefs: whole-name root tokens', () => {
  assert.deepEqual(extractFileRefs('update MAKE_MY_DREAMS.md'), ['MAKE_MY_DREAMS.md']);
  assert.deepEqual(extractFileRefs('see PROBLEMS.md'), ['PROBLEMS.md']);
  assert.deepEqual(extractFileRefs('read BOOTSTRAP.md'), ['BOOTSTRAP.md']);
  assert.deepEqual(extractFileRefs('the CLAUDE.md file'), ['CLAUDE.md']);
  assert.deepEqual(extractFileRefs('add a banner to README.md'), ['README.md']);
  assert.deepEqual(extractFileRefs('bump package.json version'), ['package.json']);
});

test('@unit extractFileRefs: multiple distinct references, ordered by first appearance', () => {
  const dream =
    'implement SPEC_V02H.md, read docs/lessons-learned.md and load ' +
    '.specify/memory/constitution.md then bump package.json';
  assert.deepEqual(extractFileRefs(dream), [
    'SPEC_V02H.md',
    'docs/lessons-learned.md',
    '.specify/memory/constitution.md',
    'package.json',
  ]);
});

test('@unit extractFileRefs: duplicate reference returned once (dedup, first position kept)', () => {
  const dream = 'edit SPEC_V02H.md then re-read SPEC_V02H.md before SPEC_V02H.md ships';
  assert.deepEqual(extractFileRefs(dream), ['SPEC_V02H.md']);
});

test('@unit extractFileRefs: deterministic across repeated calls (shared regex state safe)', () => {
  const dream = 'per SPEC_V02H.md and docs/lessons-learned.md';
  const first = extractFileRefs(dream);
  const second = extractFileRefs(dream);
  assert.deepEqual(first, second);
  assert.deepEqual(first, ['SPEC_V02H.md', 'docs/lessons-learned.md']);
});

test('@unit extractFileRefs: edge case — path inside backticks', () => {
  assert.deepEqual(extractFileRefs('see `SPEC_V02H.md` now'), ['SPEC_V02H.md']);
  assert.deepEqual(
    extractFileRefs('load `.specify/memory/constitution.md`'),
    ['.specify/memory/constitution.md'],
  );
  assert.deepEqual(extractFileRefs('open `docs/lessons-learned.md`.'), ['docs/lessons-learned.md']);
});

test('@unit extractFileRefs: edge case — path inside quotes', () => {
  assert.deepEqual(extractFileRefs('the spec "SPEC_V02H.md" is frozen'), ['SPEC_V02H.md']);
  assert.deepEqual(extractFileRefs("read 'README.md' please"), ['README.md']);
});

test('@unit extractFileRefs: edge case — surrounding punctuation (comma, period, paren)', () => {
  assert.deepEqual(extractFileRefs('(SPEC_V02H.md),'), ['SPEC_V02H.md']);
  assert.deepEqual(extractFileRefs('per SPEC_V02H.md.'), ['SPEC_V02H.md']);
  assert.deepEqual(extractFileRefs('files: docs/lessons-learned.md; package.json.'), [
    'docs/lessons-learned.md',
    'package.json',
  ]);
});

test('@unit extractFileRefs: does NOT match mid-token false positives', () => {
  // `mydocs/foo.md` must not match the docs/ pattern (boundary protects it).
  assert.deepEqual(extractFileRefs('mydocs/foo.md'), []);
  // `XREADME.md` must not match the README token.
  assert.deepEqual(extractFileRefs('XREADME.md'), []);
  // `package.jsonx` must not match (trailing boundary).
  assert.deepEqual(extractFileRefs('package.jsonx'), []);
});
