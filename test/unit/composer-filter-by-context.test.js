// @unit tests for lib/composer/filter-by-context.js — SPEC_V02L AC-2.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { filterLessonsByContext } from '../../lib/composer/filter-by-context.js';

const LESSONS = [
  { id: 'L-A', appliesTo: ['*'] },
  { id: 'L-B', appliesTo: ['mmd --here', 'mmd ship'] },
  { id: 'L-C', appliesTo: ['mmd qa'] },
  { id: 'L-D', appliesTo: ['mmd discover'] },
  { id: 'L-E' /* no appliesTo → universal */ },
];

test('@unit filter: subcommand keeps universal + exact matches only', () => {
  const out = filterLessonsByContext(LESSONS, { subcommand: 'mmd qa' });
  assert.deepEqual(out.map((l) => l.id), ['L-A', 'L-C', 'L-E']);
});

test('@unit filter: another subcommand selects a different subset', () => {
  const out = filterLessonsByContext(LESSONS, { subcommand: 'mmd --here' });
  assert.deepEqual(out.map((l) => l.id), ['L-A', 'L-B', 'L-E']);
});

test('@unit filter: lesson with no appliesTo is treated as universal', () => {
  const out = filterLessonsByContext([{ id: 'L-X' }], { subcommand: 'mmd cso' });
  assert.deepEqual(out.map((l) => l.id), ['L-X']);
});

test('@unit filter: no context → full set returned (back-compat)', () => {
  assert.equal(filterLessonsByContext(LESSONS, null).length, LESSONS.length);
  assert.equal(filterLessonsByContext(LESSONS, undefined).length, LESSONS.length);
  assert.equal(filterLessonsByContext(LESSONS, {}).length, LESSONS.length);
  assert.equal(filterLessonsByContext(LESSONS, { subcommand: '   ' }).length, LESSONS.length);
});

test('@unit filter: returns a new array, never mutates input', () => {
  const out = filterLessonsByContext(LESSONS, { subcommand: 'mmd qa' });
  assert.notEqual(out, LESSONS);
  assert.equal(LESSONS.length, 5, 'input length unchanged');
});

test('@unit filter: subcommand with no matches → only universal lessons', () => {
  const out = filterLessonsByContext(LESSONS, { subcommand: 'mmd nonexistent' });
  assert.deepEqual(out.map((l) => l.id), ['L-A', 'L-E']);
});

test('@unit filter: non-array input throws TypeError', () => {
  assert.throws(() => filterLessonsByContext('nope', { subcommand: 'mmd qa' }), TypeError);
});
