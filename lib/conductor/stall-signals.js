// lib/conductor/stall-signals.js — closed enum of stall signal labels (SPEC_V02J AC-1).
//
// SRP (universal.md §I.S): this module owns ONLY the closed vocabulary of stall
// signals + tiny helpers over it. No I/O, no env reads, no Date. Pure.
//
// The detector (stall-detector.js) emits signals drawn EXCLUSIVELY from this
// enum so downstream consumers (unblock.js, future Conductor) can switch on a
// known, finite set. KISS (universal.md §II): a frozen array + two predicates.

/**
 * The closed set of stall signal labels. Order is informational only — the
 * detector sorts its emitted signals deterministically (see stall-detector.js).
 *
 * @type {readonly string[]}
 */
export const STALL_SIGNALS = Object.freeze([
  'no-commit-since-N-min',
  'retry-count-exceeded',
  'error-pattern-matched',
  'duration-exceeded-budget',
  'state-failed-explicit',
  'heartbeat-stale',
]);

/**
 * @param {string} signal
 * @returns {boolean} true iff `signal` is a member of the closed enum.
 */
export function isStallSignal(signal) {
  return typeof signal === 'string' && STALL_SIGNALS.includes(signal);
}

/**
 * Validate that every member of `signals` is a known stall signal. Used by the
 * detector as a self-check (fail-fast on a typo'd label) and by tests.
 *
 * @param {string[]} signals
 * @returns {string[]} the subset of `signals` that are NOT in the enum (empty = all valid)
 */
export function unknownSignals(signals) {
  if (!Array.isArray(signals)) return [];
  return signals.filter((s) => !isStallSignal(s));
}
