// @unit tests for lib/conductor/handoff.js — the PURE decision logic of the
// v0.13.a cooperative auto-handoff (SPEC_V013A AC-1, ADR-051). Mirrors the
// alignment-gate / checkpoint pure-helper suites: deterministic, never-throws,
// every branch + the cap boundary + null-safety asserted without a spawn.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  decideHandoff,
  parseMaxHandoffs,
  shouldForceHandoff,
  parseHandoffGraceMs,
} from '../../lib/conductor/handoff.js';

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

// ── a missing / phase-0 checkpoint is NOT resumable → finish (v0.13.1) ───────
// LIVE FINDING: the original v0.13.a code treated "requested + null checkpoint"
// as a handoff ("not a fabricated finish"), and a real `--auto-handoff` run
// exposed the bug — a trivial run that COMPLETED without ever writing a
// checkpoint relaunched wasteful successors up to the cap (each found the work
// already done). A handoff only makes sense with genuine mid-pipeline progress
// (lastCompletedPhase >= 1, a real boundary reached). No checkpoint / phase 0 →
// there is nothing to resume TO → finish (the exit code reports done/failed).

test('@unit v0.13.1: null checkpoint + requested → finish (no resumable progress, not a false handoff)', () => {
  const r = decideHandoff({
    checkpoint: null,
    handoffRequested: true,
    handoffsSoFar: 0,
    maxHandoffs: 3,
    totalPhases: TOTAL,
  });
  assert.equal(r.action, 'finish');
  assert.match(r.reason, /no resumable checkpoint/);
});

test('@unit v0.13.1: phase-0 checkpoint + requested → finish (no boundary reached yet)', () => {
  const r = decideHandoff({
    checkpoint: { lastCompletedPhase: 0 },
    handoffRequested: true,
    handoffsSoFar: 0,
    maxHandoffs: 3,
    totalPhases: TOTAL,
  });
  assert.equal(r.action, 'finish');
  assert.match(r.reason, /no resumable checkpoint/);
});

test('@unit v0.13.1: phase-1 checkpoint (real boundary) + requested + under cap → handoff', () => {
  const r = decideHandoff({
    checkpoint: { lastCompletedPhase: 1 },
    handoffRequested: true,
    handoffsSoFar: 0,
    maxHandoffs: 3,
    totalPhases: TOTAL,
  });
  assert.equal(r.action, 'handoff');
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

// ── v0.14.b: shouldForceHandoff — the PURE enforce gate (SPEC_V014B AC-2) ─────

const FORCE_BASE = {
  pct: 0.75,
  threshold: 0.70,
  lastCompletedPhase: 2,
  phaseAtSpawn: 1,
  handoffsSoFar: 0,
  maxHandoffs: 3,
};

test('@unit AC-2: all three gates met → true (over threshold + new boundary + under cap)', () => {
  assert.equal(shouldForceHandoff(FORCE_BASE), true);
});

test('@unit AC-2: pct exactly at threshold → true (>= is inclusive)', () => {
  assert.equal(shouldForceHandoff({ ...FORCE_BASE, pct: 0.70, threshold: 0.70 }), true);
});

test('@unit AC-2: under the threshold → false', () => {
  assert.equal(shouldForceHandoff({ ...FORCE_BASE, pct: 0.69 }), false);
});

test('@unit AC-2: no NEW boundary since spawn (lastCompletedPhase === phaseAtSpawn) → false', () => {
  // The inherited checkpoint: the successor must NOT enforce until IT completes
  // a new phase, else it re-kills instantly on the resume it just started.
  assert.equal(shouldForceHandoff({ ...FORCE_BASE, lastCompletedPhase: 1, phaseAtSpawn: 1 }), false);
});

test('@unit AC-2: checkpoint went BACKWARD (last < spawn) → false', () => {
  assert.equal(shouldForceHandoff({ ...FORCE_BASE, lastCompletedPhase: 0, phaseAtSpawn: 1 }), false);
});

test('@unit AC-2: at the cap (handoffsSoFar === maxHandoffs) → false (final un-enforced run)', () => {
  assert.equal(shouldForceHandoff({ ...FORCE_BASE, handoffsSoFar: 3, maxHandoffs: 3 }), false);
});

test('@unit AC-2: one below the cap → true; one above → false', () => {
  assert.equal(shouldForceHandoff({ ...FORCE_BASE, handoffsSoFar: 2, maxHandoffs: 3 }), true);
  assert.equal(shouldForceHandoff({ ...FORCE_BASE, handoffsSoFar: 5, maxHandoffs: 3 }), false);
});

test('@unit AC-2: a fresh first spawn (phaseAtSpawn 0) enforces once a real boundary lands', () => {
  assert.equal(shouldForceHandoff({ ...FORCE_BASE, lastCompletedPhase: 1, phaseAtSpawn: 0 }), true);
  // …but NOT while still at phase 0 (no boundary reached yet).
  assert.equal(shouldForceHandoff({ ...FORCE_BASE, lastCompletedPhase: 0, phaseAtSpawn: 0 }), false);
});

test('@unit AC-2: shouldForceHandoff never throws on null/undefined/odd input → false', () => {
  assert.doesNotThrow(() => shouldForceHandoff());
  assert.doesNotThrow(() => shouldForceHandoff(null));
  assert.doesNotThrow(() => shouldForceHandoff({}));
  assert.equal(shouldForceHandoff(), false);
  assert.equal(shouldForceHandoff(null), false);
  assert.equal(shouldForceHandoff({}), false);
  // Hostile field types collapse to a safe false (never a kill on junk).
  assert.equal(
    shouldForceHandoff({
      pct: Symbol('x'), threshold: 'junk', lastCompletedPhase: {}, phaseAtSpawn: [],
      handoffsSoFar: NaN, maxHandoffs: null,
    }),
    false,
  );
  // A valid decision with a missing handoffsSoFar treats it as 0 → still true.
  assert.equal(
    shouldForceHandoff({ pct: 0.8, threshold: 0.7, lastCompletedPhase: 2, phaseAtSpawn: 1, maxHandoffs: 3 }),
    true,
  );
});

// ── v0.14.b: parseHandoffGraceMs ────────────────────────────────────────────

test('@unit AC-3: parseHandoffGraceMs honors a valid non-negative integer (incl. 0)', () => {
  assert.equal(parseHandoffGraceMs('5000'), 5000);
  assert.equal(parseHandoffGraceMs(0), 0);     // 0 honored: terminate immediately on fire
  assert.equal(parseHandoffGraceMs('0'), 0);
});

test('@unit AC-3: parseHandoffGraceMs falls back to 15000 on junk/empty/negative/float', () => {
  assert.equal(parseHandoffGraceMs(undefined), 15000);
  assert.equal(parseHandoffGraceMs(null), 15000);
  assert.equal(parseHandoffGraceMs(''), 15000);
  assert.equal(parseHandoffGraceMs('   '), 15000);
  assert.equal(parseHandoffGraceMs('abc'), 15000);
  assert.equal(parseHandoffGraceMs('-1'), 15000);
  assert.equal(parseHandoffGraceMs('1.5'), 15000);
});

test('@unit AC-3: parseHandoffGraceMs honors a custom (sane) fallback; never throws', () => {
  assert.equal(parseHandoffGraceMs(undefined, 3000), 3000);
  assert.equal(parseHandoffGraceMs(undefined, -5), 15000); // junk fallback degrades
  assert.doesNotThrow(() => parseHandoffGraceMs(Symbol('x')));
  assert.doesNotThrow(() => parseHandoffGraceMs({}));
});
