// test/unit/documentalist-mutate-counters.test.js — @unit
// SPEC_V090 AC-2: the counter rises by VALIDATED REUSES not-yet-credited (not
// raw injections), and crediting is idempotent (an already-credited run is not
// re-counted). Covers: start 0/3/4, delta 0/1/many, threshold 3/5/10, missing
// To-promote-if, milestone skip, and the idempotent already-credited case.

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

// validated-reuse input: lesson id → { count, runIds }
const vr = (pairs) =>
  new Map(pairs.map(([id, runIds]) => [id, { count: runIds.length, runIds }]));

test('@unit increments counter by validated reuses (one done run)', () => {
  const { updatedLessons, toPromote, newlyCreditedRuns } = mutateCounters(
    [lesson({ counter: 0 })],
    vr([['L-001', ['r1']]]),
  );
  assert.equal(updatedLessons[0].counter, 1);
  assert.equal(updatedLessons[0].counterDelta, 1);
  assert.equal(updatedLessons[0].validatedReuseTotal, 1);
  assert.deepEqual(newlyCreditedRuns['L-001'], ['r1']);
  assert.equal(toPromote.length, 0);
});

test('@unit increments by many distinct runs at once', () => {
  const { updatedLessons } = mutateCounters(
    [lesson({ counter: 1 })],
    vr([['L-001', ['r1', 'r2', 'r3']]]),
  );
  assert.equal(updatedLessons[0].counter, 4);
});

test('@unit promotes when reaching threshold exactly', () => {
  const { toPromote } = mutateCounters(
    [lesson({ counter: 4, promoteIfN: 5 })],
    vr([['L-001', ['r1']]]),
  );
  assert.equal(toPromote.length, 1);
  assert.equal(toPromote[0].id, 'L-001');
});

test('@unit promotes when crossing threshold (3)', () => {
  const { toPromote } = mutateCounters(
    [lesson({ counter: 2, promoteIfN: 3 })],
    vr([['L-001', ['r1', 'r2']]]),
  );
  assert.equal(toPromote.length, 1);
});

test('@unit does not promote below threshold (10)', () => {
  const { toPromote } = mutateCounters(
    [lesson({ counter: 3, promoteIfN: 10 })],
    vr([['L-001', ['r1', 'r2']]]),
  );
  assert.equal(toPromote.length, 0);
});

test('@unit zero validated reuses leaves the lesson unchanged', () => {
  const { updatedLessons, toPromote, newlyCreditedRuns } = mutateCounters(
    [lesson({ counter: 3 })],
    vr([]),
  );
  assert.equal(updatedLessons[0].counter, 3);
  assert.equal(updatedLessons[0].counterDelta, 0);
  assert.equal(updatedLessons[0].validatedReuseTotal, 0);
  assert.equal(Object.keys(newlyCreditedRuns).length, 0);
  assert.equal(toPromote.length, 0);
});

test('@unit IDEMPOTENT: an already-credited run is not re-counted', () => {
  // The lesson was reused in r1, r2, r3 (all done) — but r1, r2 were credited
  // in a prior document-lessons run. Only r3 is new → +1, not +3.
  const { updatedLessons, newlyCreditedRuns } = mutateCounters(
    [lesson({ counter: 2 })],
    vr([['L-001', ['r1', 'r2', 'r3']]]),
    { creditedRuns: { 'L-001': ['r1', 'r2'] } },
  );
  assert.equal(updatedLessons[0].counter, 3);
  assert.equal(updatedLessons[0].counterDelta, 1);
  assert.equal(updatedLessons[0].validatedReuseTotal, 3); // total is still 3
  assert.deepEqual(newlyCreditedRuns['L-001'], ['r3']);
});

test('@unit IDEMPOTENT: all runs already credited → no change (second run no-op)', () => {
  const { updatedLessons, toPromote, newlyCreditedRuns } = mutateCounters(
    [lesson({ counter: 3 })],
    vr([['L-001', ['r1', 'r2', 'r3']]]),
    { creditedRuns: { 'L-001': ['r1', 'r2', 'r3'] } },
  );
  assert.equal(updatedLessons[0].counter, 3);
  assert.equal(updatedLessons[0].counterDelta, 0);
  assert.equal(Object.keys(newlyCreditedRuns).length, 0);
  assert.equal(toPromote.length, 0);
});

test('@unit skips milestone-status lessons even if reused', () => {
  const { updatedLessons, toPromote } = mutateCounters(
    [lesson({ status: 'milestone', counter: 4, promoteIfN: 5 })],
    vr([['L-001', ['r1', 'r2', 'r3', 'r4', 'r5']]]),
  );
  assert.equal(updatedLessons[0].counter, 4); // unchanged
  assert.equal(updatedLessons[0].counterDelta, 0);
  assert.equal(toPromote.length, 0);
});

test('@unit skips lessons with no parseable To-promote-if metadata', () => {
  const { updatedLessons, toPromote } = mutateCounters(
    [lesson({ counter: null, promoteIfN: null })],
    vr([['L-001', ['r1', 'r2', 'r3']]]),
  );
  assert.equal(updatedLessons[0].counterDelta, 0);
  assert.equal(toPromote.length, 0);
});

test('@unit a lesson reused only in failed runs gets nothing (empty validated map)', () => {
  // validatedReuses already excludes failed runs, so they never reach here:
  // an absent entry means zero validated reuses → no increment.
  const { updatedLessons, toPromote } = mutateCounters([lesson({ counter: 0 })], vr([]));
  assert.equal(updatedLessons[0].counterDelta, 0);
  assert.equal(toPromote.length, 0);
});

test('@unit accepts a plain-object validatedByLesson and creditedRuns Map', () => {
  const { updatedLessons } = mutateCounters(
    [lesson({ counter: 0 })],
    { 'L-001': { count: 2, runIds: ['r1', 'r2'] } },
    { creditedRuns: new Map([['L-001', ['r1']]]) },
  );
  assert.equal(updatedLessons[0].counter, 1); // only r2 is new
});

test('@unit throws on non-array lessons', () => {
  assert.throws(() => mutateCounters(null, vr([])), TypeError);
});
