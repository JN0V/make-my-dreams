// @unit tests for lib/conductor/alignment-gate.js — the PURE aggregation +
// feedback helpers of the v0.11.a alignment gate (SPEC_V011A AC-1, plus the
// iters-math piece of AC-4). Mirrors the judge/5-Whys parser unit tests: the
// helpers are pure, deterministic, and NEVER throw, so the math + wording are
// asserted without a real claude or any spawn.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregateAlignment,
  buildGapFeedback,
  parseMaxIters,
} from '../../lib/conductor/alignment-gate.js';

// ── aggregateAlignment ───────────────────────────────────────────────────────

test('@unit AC-1: all-MET verdict → aligned, no gaps', () => {
  const verdict = {
    overall: 'met',
    verdicts: [
      { ac: '1', status: 'met', reason: 'ok' },
      { ac: '2', status: 'met', reason: 'ok' },
    ],
  };
  const r = aggregateAlignment(verdict);
  assert.equal(r.aligned, true);
  assert.deepEqual(r.gapAcs, []);
});

test('@unit AC-1: one NOT-MET → not aligned, gapAcs lists exactly that AC', () => {
  const verdict = {
    overall: 'not-met',
    verdicts: [
      { ac: '1', status: 'met', reason: 'the counter renders' },
      { ac: '2', status: 'not-met', reason: 'the minus button is missing' },
    ],
  };
  const r = aggregateAlignment(verdict);
  assert.equal(r.aligned, false);
  assert.equal(r.gapAcs.length, 1);
  assert.deepEqual(r.gapAcs[0], { ac: '2', reason: 'the minus button is missing' });
});

test('@unit AC-1: uncertain verdict → not aligned and NO gapAcs (honest-hold, not iterate)', () => {
  // An uncertain AC is deliberately NOT a gap item: the caller must take the
  // sacred-fallback branch, never the iterate branch.
  const verdict = {
    overall: 'uncertain',
    verdicts: [{ ac: '1', status: 'uncertain', reason: 'insufficient evidence' }],
  };
  const r = aggregateAlignment(verdict);
  assert.equal(r.aligned, false);
  assert.deepEqual(r.gapAcs, []);
});

test('@unit AC-1: a NOT-MET overall mixing uncertain + not-met collects ONLY the not-met ACs', () => {
  const verdict = {
    overall: 'not-met',
    verdicts: [
      { ac: '1', status: 'uncertain', reason: 'cannot tell' },
      { ac: '2', status: 'not-met', reason: 'wrong output' },
      { ac: '3', status: 'met', reason: 'fine' },
    ],
  };
  const r = aggregateAlignment(verdict);
  assert.equal(r.aligned, false);
  assert.equal(r.gapAcs.length, 1);
  assert.equal(r.gapAcs[0].ac, '2');
});

test('@unit AC-1: empty / odd / malformed verdicts → safe {aligned:false, gapAcs:[]}, never throws', () => {
  for (const bad of [
    {},
    { overall: 'uncertain', verdicts: [] },
    { overall: null, verdicts: null },
    { verdicts: [{}] },
    null,
    undefined,
    42,
    'nope',
    { overall: 'MET' /* uppercase tolerated */, verdicts: [] },
  ]) {
    const r = aggregateAlignment(bad);
    assert.equal(typeof r.aligned, 'boolean');
    assert.ok(Array.isArray(r.gapAcs));
  }
  // The uppercase 'MET' case is still recognized as aligned (normalized).
  assert.equal(aggregateAlignment({ overall: 'MET', verdicts: [] }).aligned, true);
});

// ── buildGapFeedback ─────────────────────────────────────────────────────────

test('@unit AC-1: buildGapFeedback restates the goal and names each unmet AC + reason', () => {
  const dream = 'a counter app with plus and minus buttons';
  const gapAcs = [
    { ac: '2', reason: 'the minus button is missing' },
    { ac: '4', reason: 'no reset' },
  ];
  const f = buildGapFeedback({ gapAcs, dream });
  // Restates the goal (counters constraint decay — should appear at least twice).
  const occurrences = f.split(dream).length - 1;
  assert.ok(occurrences >= 2, `dream should be restated at least twice; got ${occurrences}`);
  // Names each unmet AC and its reason.
  assert.match(f, /AC 2: the minus button is missing/);
  assert.match(f, /AC 4: no reset/);
  // Frames it as a correction pass, not a fresh task.
  assert.match(f, /ALIGNMENT GAP/);
});

test('@unit AC-1: buildGapFeedback degrades safely on empty/odd input, never throws', () => {
  assert.doesNotThrow(() => buildGapFeedback());
  assert.doesNotThrow(() => buildGapFeedback({}));
  assert.doesNotThrow(() => buildGapFeedback({ gapAcs: null, dream: 42 }));
  const f = buildGapFeedback({ gapAcs: [], dream: 'd' });
  assert.match(f, /no specific acceptance criteria were named/);
});

// ── parseMaxIters (AC-4 iters math) ──────────────────────────────────────────

test('@unit AC-4: parseMaxIters defaults to 1 on absent/empty/junk', () => {
  assert.equal(parseMaxIters(undefined), 1);
  assert.equal(parseMaxIters(null), 1);
  assert.equal(parseMaxIters(''), 1);
  assert.equal(parseMaxIters('  '), 1);
  assert.equal(parseMaxIters('abc'), 1);
  assert.equal(parseMaxIters('1.5'), 1);
  assert.equal(parseMaxIters('-2'), 1);
  assert.equal(parseMaxIters(NaN), 1);
});

test('@unit AC-4: parseMaxIters honors a valid non-negative integer, including 0', () => {
  assert.equal(parseMaxIters('0'), 0, '0 = gate-but-never-iterate (a valid value)');
  assert.equal(parseMaxIters('1'), 1);
  assert.equal(parseMaxIters('3'), 3);
  assert.equal(parseMaxIters(2), 2);
  // A custom fallback is honored when the value is junk.
  assert.equal(parseMaxIters('junk', 2), 2);
});
