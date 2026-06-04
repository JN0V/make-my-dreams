// @unit tests for lib/conductor/handoff-summary.js — the PURE display utility
// for the Conductor's phase-checkpoint state (SPEC_handoff_summary.md AC-1..8).
// Mirrors the existing conductor pure-helper suites (handoff.js, checkpoint.js):
// deterministic, no I/O, every branch asserted without a spawn.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  summarizeHandoffState,
  HANDOFF_SUMMARY_TOTAL_PHASES,
} from '../../lib/conductor/handoff-summary.js';

// ── AC-1 — exports ────────────────────────────────────────────────────────────

test('@unit AC-1: summarizeHandoffState is exported as a function', () => {
  assert.equal(typeof summarizeHandoffState, 'function');
});

test('@unit AC-1: HANDOFF_SUMMARY_TOTAL_PHASES is exported as 4', () => {
  assert.equal(HANDOFF_SUMMARY_TOTAL_PHASES, 4);
  assert.equal(typeof HANDOFF_SUMMARY_TOTAL_PHASES, 'number');
});

// ── AC-2 — null / undefined checkpoint ───────────────────────────────────────

test('@unit AC-2: null checkpoint returns "No checkpoint — run not started"', () => {
  assert.equal(summarizeHandoffState(null, 0), 'No checkpoint — run not started');
});

test('@unit AC-2: undefined checkpoint returns "No checkpoint — run not started"', () => {
  assert.equal(summarizeHandoffState(undefined, 0), 'No checkpoint — run not started');
});

test('@unit AC-2: null checkpoint with non-zero handoffsSoFar still returns no-checkpoint string', () => {
  assert.equal(summarizeHandoffState(null, 5), 'No checkpoint — run not started');
});

// ── AC-3 — empty / phase-0 / invalid phase checkpoint ────────────────────────

test('@unit AC-3: empty object checkpoint returns "No phase completed yet"', () => {
  assert.equal(summarizeHandoffState({}, 0), 'No phase completed yet');
});

test('@unit AC-3: lastCompletedPhase: 0 treated the same as empty (phase 0 means no boundary reached)', () => {
  assert.equal(summarizeHandoffState({ lastCompletedPhase: 0 }, 0), 'No phase completed yet');
});

test('@unit AC-3: lastCompletedPhase: NaN returns "No phase completed yet"', () => {
  assert.equal(summarizeHandoffState({ lastCompletedPhase: NaN }, 0), 'No phase completed yet');
});

test('@unit AC-3: lastCompletedPhase: "garbage" (string) returns "No phase completed yet"', () => {
  assert.equal(summarizeHandoffState({ lastCompletedPhase: 'garbage' }, 0), 'No phase completed yet');
});

test('@unit AC-3: lastCompletedPhase: -1 (negative) returns "No phase completed yet"', () => {
  assert.equal(summarizeHandoffState({ lastCompletedPhase: -1 }, 0), 'No phase completed yet');
});

// ── AC-4 — phases 1, 2, 3 in-progress ────────────────────────────────────────

test('@unit AC-4: phase 1 returns "Phase 1/4 complete"', () => {
  assert.equal(summarizeHandoffState({ lastCompletedPhase: 1 }, 0), 'Phase 1/4 complete');
});

test('@unit AC-4: phase 2 returns "Phase 2/4 complete"', () => {
  assert.equal(summarizeHandoffState({ lastCompletedPhase: 2 }, 0), 'Phase 2/4 complete');
});

test('@unit AC-4: phase 3 returns "Phase 3/4 complete"', () => {
  assert.equal(summarizeHandoffState({ lastCompletedPhase: 3 }, 0), 'Phase 3/4 complete');
});

// ── AC-5 — handoff count in output ───────────────────────────────────────────

test('@unit AC-5a: handoffsSoFar=0 does not mention handoff', () => {
  const result = summarizeHandoffState({ lastCompletedPhase: 2 }, 0);
  assert.ok(!result.includes('handoff'), `Expected no "handoff" in: ${result}`);
});

test('@unit AC-5b: handoffsSoFar=1 produces singular "1 handoff so far"', () => {
  assert.equal(
    summarizeHandoffState({ lastCompletedPhase: 2 }, 1),
    'Phase 2/4 complete — 1 handoff so far',
  );
});

test('@unit AC-5d: handoffsSoFar=2 uses plural "2 handoffs" (edge adjacent to singular)', () => {
  const result = summarizeHandoffState({ lastCompletedPhase: 2 }, 2);
  assert.ok(result.includes('2 handoffs'), `Expected "2 handoffs" in: ${result}`);
});

test('@unit AC-5c: handoffsSoFar=3 uses plural "3 handoffs"', () => {
  const result = summarizeHandoffState({ lastCompletedPhase: 2 }, 3);
  assert.ok(result.includes('3 handoffs'), `Expected "3 handoffs" in: ${result}`);
});

test('@unit AC-5a: handoffsSoFar=null treated as 0, no handoff mention', () => {
  const result = summarizeHandoffState({ lastCompletedPhase: 2 }, null);
  assert.ok(!result.includes('handoff'), `Expected no "handoff" in: ${result}`);
});

test('@unit AC-5a: handoffsSoFar=NaN treated as 0, no handoff mention', () => {
  const result = summarizeHandoffState({ lastCompletedPhase: 2 }, NaN);
  assert.ok(!result.includes('handoff'), `Expected no "handoff" in: ${result}`);
});

test('@unit AC-5a: handoffsSoFar=Infinity treated as 0 (not finite), no handoff mention', () => {
  const result = summarizeHandoffState({ lastCompletedPhase: 2 }, Infinity);
  assert.ok(!result.includes('handoff'), `Expected no "handoff" in: ${result}`);
});

// ── AC-6 — run complete ───────────────────────────────────────────────────────

test('@unit AC-6: phase 4 with 0 handoffs returns exact "Run complete (4/4 phases)"', () => {
  assert.equal(summarizeHandoffState({ lastCompletedPhase: 4 }, 0), 'Run complete (4/4 phases)');
});

test('@unit AC-6: phase 4 with 1 handoff returns exact singular complete string', () => {
  assert.equal(
    summarizeHandoffState({ lastCompletedPhase: 4 }, 1),
    'Run complete (4/4 phases) — 1 handoff so far',
  );
});

test('@unit AC-6: phase 4 with 2 handoffs contains "complete", "4/4", "2 handoffs"', () => {
  const result = summarizeHandoffState({ lastCompletedPhase: 4 }, 2);
  assert.ok(result.includes('complete'), `Expected "complete" in: ${result}`);
  assert.ok(result.includes('4/4'), `Expected "4/4" in: ${result}`);
  assert.ok(result.includes('2 handoffs'), `Expected "2 handoffs" in: ${result}`);
});

test('@unit AC-6: phase 99 (overflow) capped at "Run complete (4/4 phases)"', () => {
  assert.equal(summarizeHandoffState({ lastCompletedPhase: 99 }, 0), 'Run complete (4/4 phases)');
});

// ── AC-8 — never throws, hostile inputs, no "NaN" in output ──────────────────

test('@unit AC-8: no arguments does not throw and returns non-empty string', () => {
  let result;
  assert.doesNotThrow(() => { result = summarizeHandoffState(); });
  assert.ok(typeof result === 'string' && result.length > 0, `Expected non-empty string, got: ${result}`);
});

test('@unit AC-8: (null, null) does not throw', () => {
  assert.doesNotThrow(() => { summarizeHandoffState(null, null); });
});

test('@unit AC-8: (Symbol, Symbol) does not throw, returns "No phase completed yet", no "NaN"', () => {
  let result;
  assert.doesNotThrow(() => { result = summarizeHandoffState(Symbol('x'), Symbol('y')); });
  assert.ok(typeof result === 'string' && result.length > 0, `Expected non-empty string, got: ${result}`);
  // Symbol checkpoint is not null/undefined, falls through to phase check where
  // safeNumber(Symbol?.lastCompletedPhase) → NaN → "No phase completed yet"
  assert.equal(result, 'No phase completed yet');
  assert.ok(!result.includes('NaN'), `Output must not contain "NaN": ${result}`);
});

test('@unit AC-8: (42, 0) number checkpoint does not throw, returns "No phase completed yet"', () => {
  let result;
  assert.doesNotThrow(() => { result = summarizeHandoffState(42, 0); });
  assert.equal(result, 'No phase completed yet');
  assert.ok(!result.includes('NaN'), `Output must not contain "NaN": ${result}`);
});

test('@unit AC-8: ([], []) array checkpoint does not throw, returns non-empty string', () => {
  let result;
  assert.doesNotThrow(() => { result = summarizeHandoffState([], []); });
  assert.ok(typeof result === 'string' && result.length > 0, `Expected non-empty string, got: ${result}`);
  assert.ok(!result.includes('NaN'), `Output must not contain "NaN": ${result}`);
});

test('@unit AC-8: Symbol lastCompletedPhase and Symbol handoffsSoFar do not throw', () => {
  let result;
  assert.doesNotThrow(() => {
    result = summarizeHandoffState({ lastCompletedPhase: Symbol('x') }, Symbol('y'));
  });
  assert.ok(typeof result === 'string' && result.length > 0, `Expected non-empty string, got: ${result}`);
  assert.ok(!result.includes('NaN'), `Output must not contain "NaN": ${result}`);
});

test('@unit AC-8: object lastCompletedPhase and object handoffsSoFar do not throw', () => {
  let result;
  assert.doesNotThrow(() => {
    result = summarizeHandoffState({ lastCompletedPhase: {} }, {});
  });
  assert.ok(typeof result === 'string' && result.length > 0, `Expected non-empty string, got: ${result}`);
  assert.ok(!result.includes('NaN'), `Output must not contain "NaN": ${result}`);
});

test('@unit AC-8: Infinity handoffsSoFar does not throw and output has no "handoff"', () => {
  let result;
  assert.doesNotThrow(() => {
    result = summarizeHandoffState({ lastCompletedPhase: 2 }, Infinity);
  });
  assert.ok(!result.includes('handoff'), `Expected no "handoff" in: ${result}`);
  assert.ok(!result.includes('NaN'), `Output must not contain "NaN": ${result}`);
});

test('@unit AC-8: -Infinity handoffsSoFar does not throw and output has no "handoff"', () => {
  let result;
  assert.doesNotThrow(() => {
    result = summarizeHandoffState({ lastCompletedPhase: 2 }, -Infinity);
  });
  assert.ok(!result.includes('handoff'), `Expected no "handoff" in: ${result}`);
  assert.ok(!result.includes('NaN'), `Output must not contain "NaN": ${result}`);
});

// Compound hostile: every hostile case must return non-empty string with no "NaN"
test('@unit AC-8: all hostile-input outputs are non-empty strings without "NaN"', () => {
  const hostileCases = [
    [null, NaN],
    [undefined, Symbol('y')],
    [Symbol('x'), Symbol('y')],
    [42, 0],
    [[], []],
    [{ lastCompletedPhase: Symbol('x') }, Symbol('y')],
    [{ lastCompletedPhase: {} }, {}],
    [{ lastCompletedPhase: NaN }, NaN],
    [{ lastCompletedPhase: Infinity }, Infinity],
    [{ lastCompletedPhase: -Infinity }, -Infinity],
    [{ lastCompletedPhase: 2 }, Infinity],
    [{ lastCompletedPhase: 2 }, -Infinity],
  ];

  for (const [cp, h] of hostileCases) {
    let result;
    assert.doesNotThrow(
      () => { result = summarizeHandoffState(cp, h); },
      `Should not throw for checkpoint=${String(cp)}, handoffsSoFar=${String(h)}`,
    );
    assert.ok(typeof result === 'string' && result.length > 0,
      `Expected non-empty string for checkpoint=${String(cp)}, handoffsSoFar=${String(h)}, got: ${result}`);
    assert.ok(!result.includes('NaN'),
      `Output must not contain "NaN" for checkpoint=${String(cp)}, handoffsSoFar=${String(h)}: ${result}`);
  }
});
