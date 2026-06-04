// @unit tests for lib/conductor/handoff.js — the PURE decision logic of the
// v0.13.a cooperative auto-handoff (SPEC_V013A AC-1, ADR-051). Mirrors the
// alignment-gate / checkpoint pure-helper suites: deterministic, never-throws,
// every branch + the cap boundary + null-safety asserted without a spawn.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decideHandoff, parseMaxHandoffs } from '../../lib/conductor/handoff.js';

const TOTAL = 4; // the auto-dev pipeline has 4 phases

// ── decideHandoff: the three closed actions ─────────────────────────────────

test('@unit AC-1: incomplete + requested + under cap → handoff', () => {
  const r = decideHandoff({
    checkpoint: { lastCompletedPhase: 1 },
    handoffRequested: true,
    handoffsSoFar: 0,
    maxHandoffs: 3,
    totalPhases: TOTAL,
  });
  assert.equal(r.action, 'handoff');
  assert.match(r.reason, /phase 1/);
});

test('@unit AC-1: complete checkpoint → finish (even if a marker lingers)', () => {
  const r = decideHandoff({
    checkpoint: { lastCompletedPhase: 4 },
    handoffRequested: true,
    handoffsSoFar: 0,
    maxHandoffs: 3,
    totalPhases: TOTAL,
  });
  assert.equal(r.action, 'finish');
  assert.match(r.reason, /complete/i);
});

test('@unit AC-1: no handoff requested → finish (the safe default, prevents loops)', () => {
  const r = decideHandoff({
    checkpoint: { lastCompletedPhase: 2 },
    handoffRequested: false,
    handoffsSoFar: 0,
    maxHandoffs: 3,
    totalPhases: TOTAL,
  });
  assert.equal(r.action, 'finish');
  assert.match(r.reason, /no handoff requested/i);
});

test('@unit AC-1: incomplete + requested + cap reached → cap-final', () => {
  const r = decideHandoff({
    checkpoint: { lastCompletedPhase: 3 },
    handoffRequested: true,
    handoffsSoFar: 3,
    maxHandoffs: 3,
    totalPhases: TOTAL,
  });
  assert.equal(r.action, 'cap-final');
  assert.match(r.reason, /cap reached/i);
});

// ── the cap boundary (the off-by-one that matters most) ─────────────────────

test('@unit AC-1: handoffsSoFar === maxHandoffs-1 still handoffs (under cap)', () => {
  const r = decideHandoff({
    checkpoint: { lastCompletedPhase: 2 },
    handoffRequested: true,
    handoffsSoFar: 2,
    maxHandoffs: 3,
    totalPhases: TOTAL,
  });
  assert.equal(r.action, 'handoff');
});

test('@unit AC-1: handoffsSoFar beyond the cap → cap-final (never an extra handoff)', () => {
  const r = decideHandoff({
    checkpoint: { lastCompletedPhase: 1 },
    handoffRequested: true,
    handoffsSoFar: 99,
    maxHandoffs: 3,
    totalPhases: TOTAL,
  });
  assert.equal(r.action, 'cap-final');
});

test('@unit AC-1: maxHandoffs=1 → first stop handoffs, second stop caps', () => {
  const first = decideHandoff({
    checkpoint: { lastCompletedPhase: 1 }, handoffRequested: true,
    handoffsSoFar: 0, maxHandoffs: 1, totalPhases: TOTAL,
  });
  assert.equal(first.action, 'handoff');
  const second = decideHandoff({
    checkpoint: { lastCompletedPhase: 2 }, handoffRequested: true,
    handoffsSoFar: 1, maxHandoffs: 1, totalPhases: TOTAL,
  });
  assert.equal(second.action, 'cap-final');
});

// ── a missing checkpoint counts as incomplete ───────────────────────────────

test('@unit AC-1: null checkpoint + requested + under cap → handoff (not a fabricated finish)', () => {
  const r = decideHandoff({
    checkpoint: null,
    handoffRequested: true,
    handoffsSoFar: 0,
    maxHandoffs: 3,
    totalPhases: TOTAL,
  });
  assert.equal(r.action, 'handoff');
  assert.match(r.reason, /no phase boundary reached yet/);
});

// ── never throws on hostile / odd input ─────────────────────────────────────

test('@unit AC-1: decideHandoff never throws on null/undefined/odd input', () => {
  assert.doesNotThrow(() => decideHandoff());
  assert.doesNotThrow(() => decideHandoff(null));
  assert.doesNotThrow(() => decideHandoff({}));
  assert.doesNotThrow(() =>
    decideHandoff({ checkpoint: { lastCompletedPhase: Symbol('x') }, handoffRequested: true, handoffsSoFar: NaN, maxHandoffs: 'junk', totalPhases: null }),
  );
  // With no requested flag, the default is finish.
  assert.equal(decideHandoff({}).action, 'finish');
  // A garbage cap clamps to 1 so a single handoff still happens, never unbounded.
  const r = decideHandoff({ checkpoint: { lastCompletedPhase: 1 }, handoffRequested: true, handoffsSoFar: 0, maxHandoffs: 'junk', totalPhases: TOTAL });
  assert.equal(r.action, 'handoff');
});

test('@unit AC-1: non-finite totalPhases → request signal decides (never "complete")', () => {
  const r = decideHandoff({
    checkpoint: { lastCompletedPhase: 9 },
    handoffRequested: true,
    handoffsSoFar: 0,
    maxHandoffs: 3,
    totalPhases: NaN,
  });
  assert.equal(r.action, 'handoff');
});

// ── parseMaxHandoffs ────────────────────────────────────────────────────────

test('@unit AC-1: parseMaxHandoffs honors a valid integer ≥ 1', () => {
  assert.equal(parseMaxHandoffs('5'), 5);
  assert.equal(parseMaxHandoffs(2), 2);
  assert.equal(parseMaxHandoffs('1'), 1);
});

test('@unit AC-1: parseMaxHandoffs falls back to 3 on junk / empty / negative / zero / float', () => {
  assert.equal(parseMaxHandoffs(undefined), 3);
  assert.equal(parseMaxHandoffs(null), 3);
  assert.equal(parseMaxHandoffs(''), 3);
  assert.equal(parseMaxHandoffs('   '), 3);
  assert.equal(parseMaxHandoffs('abc'), 3);
  assert.equal(parseMaxHandoffs('-2'), 3);
  assert.equal(parseMaxHandoffs('0'), 3); // 0 clamps to fallback (documented: never a silent no-op)
  assert.equal(parseMaxHandoffs('2.5'), 3);
});

test('@unit AC-1: parseMaxHandoffs honors a custom fallback, but only a sane one', () => {
  assert.equal(parseMaxHandoffs(undefined, 5), 5);
  assert.equal(parseMaxHandoffs('junk', 2), 2);
  // A junk fallback itself degrades to 3.
  assert.equal(parseMaxHandoffs(undefined, 0), 3);
  assert.equal(parseMaxHandoffs(undefined, -1), 3);
});

test('@unit AC-1: parseMaxHandoffs never throws', () => {
  assert.doesNotThrow(() => parseMaxHandoffs(Symbol('x')));
  assert.doesNotThrow(() => parseMaxHandoffs({}));
  assert.doesNotThrow(() => parseMaxHandoffs([]));
});
