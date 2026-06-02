// test/unit/autolearn-validated-reuse.test.js — @unit
// SPEC_V090 AC-1: the deterministic validated-reuse counter.
//
// validatedReuses(records) — records are per-run { runId, injectedLessonIds, state }.
// Returns, per lesson, the count of DISTINCT runs where the lesson was injected
// AND state === 'done'. A failed/missing-state run contributes 0; multiple
// injections within one run count once; pure; never throws; empty → empty.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validatedReuses } from '../../lib/autolearn/validated-reuse.js';

test('@unit empty input → empty result', () => {
  const out = validatedReuses([]);
  assert.ok(out instanceof Map);
  assert.equal(out.size, 0);
});

test('@unit a done run that injected a lesson counts 1', () => {
  const out = validatedReuses([
    { runId: 'r1', injectedLessonIds: ['L-019'], state: 'done' },
  ]);
  assert.equal(out.get('L-019').count, 1);
  assert.deepEqual(out.get('L-019').runIds, ['r1']);
});

test('@unit a failed run contributes 0', () => {
  const out = validatedReuses([
    { runId: 'r1', injectedLessonIds: ['L-019'], state: 'failed' },
  ]);
  assert.equal(out.size, 0);
});

test('@unit a missing-state run contributes 0', () => {
  const out = validatedReuses([
    { runId: 'r1', injectedLessonIds: ['L-019'] },
    { runId: 'r2', injectedLessonIds: ['L-019'], state: null },
    { runId: 'r3', injectedLessonIds: ['L-019'], state: 'in_progress' },
  ]);
  assert.equal(out.size, 0);
});

test('@unit distinct done runs accumulate', () => {
  const out = validatedReuses([
    { runId: 'r1', injectedLessonIds: ['L-019'], state: 'done' },
    { runId: 'r2', injectedLessonIds: ['L-019'], state: 'done' },
    { runId: 'r3', injectedLessonIds: ['L-019'], state: 'done' },
  ]);
  assert.equal(out.get('L-019').count, 3);
  assert.deepEqual(out.get('L-019').runIds, ['r1', 'r2', 'r3']);
});

test('@unit multiple injections within ONE run count once', () => {
  const out = validatedReuses([
    { runId: 'r1', injectedLessonIds: ['L-019', 'L-019', 'L-019'], state: 'done' },
  ]);
  assert.equal(out.get('L-019').count, 1);
});

test('@unit the SAME runId appearing twice counts once (defensive dedup)', () => {
  const out = validatedReuses([
    { runId: 'r1', injectedLessonIds: ['L-019'], state: 'done' },
    { runId: 'r1', injectedLessonIds: ['L-019'], state: 'done' },
  ]);
  assert.equal(out.get('L-019').count, 1);
});

test('@unit failed runs do not count toward a lesson also seen in done runs', () => {
  const out = validatedReuses([
    { runId: 'r1', injectedLessonIds: ['L-019'], state: 'done' },
    { runId: 'r2', injectedLessonIds: ['L-019'], state: 'failed' },
    { runId: 'r3', injectedLessonIds: ['L-019'], state: 'done' },
  ]);
  assert.equal(out.get('L-019').count, 2);
  assert.deepEqual(out.get('L-019').runIds, ['r1', 'r3']);
});

test('@unit multiple lessons tallied independently', () => {
  const out = validatedReuses([
    { runId: 'r1', injectedLessonIds: ['L-001', 'L-019'], state: 'done' },
    { runId: 'r2', injectedLessonIds: ['L-019'], state: 'done' },
    { runId: 'r3', injectedLessonIds: ['L-001'], state: 'failed' },
  ]);
  assert.equal(out.get('L-001').count, 1);
  assert.equal(out.get('L-019').count, 2);
});

test('@unit a run with no runId is skipped (cannot be deduplicated reproducibly)', () => {
  const out = validatedReuses([
    { injectedLessonIds: ['L-019'], state: 'done' },
    { runId: '', injectedLessonIds: ['L-019'], state: 'done' },
  ]);
  assert.equal(out.size, 0);
});

test('@unit never throws on odd / non-array / junk input', () => {
  assert.doesNotThrow(() => validatedReuses(null));
  assert.doesNotThrow(() => validatedReuses(undefined));
  assert.doesNotThrow(() => validatedReuses('nope'));
  assert.doesNotThrow(() => validatedReuses([null, 42, 'x', {}, { state: 'done' }]));
  assert.equal(validatedReuses(null).size, 0);
  assert.equal(validatedReuses([{ runId: 'r', injectedLessonIds: 'not-array', state: 'done' }]).size, 0);
});

test('@unit non-string lesson ids inside a run are ignored', () => {
  const out = validatedReuses([
    { runId: 'r1', injectedLessonIds: ['L-019', 5, null, '', {}], state: 'done' },
  ]);
  assert.equal(out.size, 1);
  assert.equal(out.get('L-019').count, 1);
});
