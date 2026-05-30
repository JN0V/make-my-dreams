// test/unit/documentalist-mutate-counters.test.js — @unit
// SPEC_V02I AC-3 (exhaustive: start 0/3/4, delta 0/1/many, threshold 3/5/10,
// missing To-promote-if, milestone skip).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mutateCounters } from '../../lib/documentalist/mutate-counters.js';

const lesson = (over) => ({
  id: 'L-001',
  status: 'active',
  counter: 0,
  promoteIfN: 5,
  targetModule: 'ai-coding.md',
  ...over,
});

const inj = (pairs) => new Map(pairs.map(([id, count]) => [id, { count }]));

test('@unit increments counter by injection count', () => {
  const { updatedLessons, toPromote } = mutateCounters(
    [lesson({ counter: 0 })],
    inj([['L-001', 1]]),
  );
  assert.equal(updatedLessons[0].counter, 1);
  assert.equal(updatedLessons[0].counterDelta, 1);
  assert.equal(toPromote.length, 0);
});

test('@unit increments by many at once', () => {
  const { updatedLessons } = mutateCounters([lesson({ counter: 1 })], inj([['L-001', 3]]));
  assert.equal(updatedLessons[0].counter, 4);
});

test('@unit promotes when reaching threshold exactly', () => {
  const { toPromote } = mutateCounters([lesson({ counter: 4, promoteIfN: 5 })], inj([['L-001', 1]]));
  assert.equal(toPromote.length, 1);
  assert.equal(toPromote[0].id, 'L-001');
});

test('@unit promotes when crossing threshold (3)', () => {
  const { toPromote } = mutateCounters([lesson({ counter: 2, promoteIfN: 3 })], inj([['L-001', 2]]));
  assert.equal(toPromote.length, 1);
});

test('@unit does not promote below threshold (10)', () => {
  const { toPromote } = mutateCounters(
    [lesson({ counter: 3, promoteIfN: 10 })],
    inj([['L-001', 2]]),
  );
  assert.equal(toPromote.length, 0);
});

test('@unit zero injections leaves the lesson unchanged', () => {
  const { updatedLessons, toPromote } = mutateCounters([lesson({ counter: 3 })], inj([]));
  assert.equal(updatedLessons[0].counter, 3);
  assert.equal(updatedLessons[0].counterDelta, 0);
  assert.equal(toPromote.length, 0);
});

test('@unit skips milestone-status lessons even if injected', () => {
  const { updatedLessons, toPromote } = mutateCounters(
    [lesson({ status: 'milestone', counter: 4, promoteIfN: 5 })],
    inj([['L-001', 5]]),
  );
  assert.equal(updatedLessons[0].counter, 4); // unchanged
  assert.equal(updatedLessons[0].counterDelta, 0);
  assert.equal(toPromote.length, 0);
});

test('@unit skips lessons with no parseable To-promote-if metadata', () => {
  const { updatedLessons, toPromote } = mutateCounters(
    [lesson({ counter: null, promoteIfN: null })],
    inj([['L-001', 9]]),
  );
  assert.equal(updatedLessons[0].counterDelta, 0);
  assert.equal(toPromote.length, 0);
});

test('@unit throws on non-array lessons', () => {
  assert.throws(() => mutateCounters(null, inj([])), TypeError);
});
