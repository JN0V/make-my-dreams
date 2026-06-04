// lib/conductor/handoff-summary.js — PURE display utility for the Conductor's
// phase-checkpoint state. Produces a single human-readable one-line status
// string combining the checkpoint's lastCompletedPhase and the handoffsSoFar
// counter tracked in bin/mmd.js's runHandoffLoop.
//
// ZERO IMPORTS — fully self-contained by design (non-negotiable). The module
// can be used in any context without worrying about module resolution, early-boot
// paths, or circular dependencies. If the no-import constraint is ever lifted, the
// shared safeNumber helper could be extracted to lib/conductor/coerce.js — YAGNI.
//
// NEVER THROWS on any input (null, undefined, Symbol, NaN, Array, …). Every code
// path returns a non-empty string. The output MUST NOT contain "NaN".
//
// Intended call sites: Conductor log lines, status.json notes, notify payloads.
// The returned string is for HUMAN DISPLAY ONLY — callers must not parse it.

/**
 * The total number of phases in the auto-dev pipeline. Exported so test files
 * can reference it without embedding a magic literal.
 */
export const HANDOFF_SUMMARY_TOTAL_PHASES = 4;

/**
 * Coerce a value to a number without throwing. Handles Symbol, object, and
 * bigint inputs by returning NaN — raw Number(aSymbol) throws a TypeError.
 * Mirrors the safeNumber helper in handoff.js and checkpoint.js.
 *
 * @param {*} v
 * @returns {number}
 */
function safeNumber(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' || typeof v === 'boolean' || v == null) return Number(v);
  return NaN; // symbols, objects, bigints → not a number
}

/**
 * Return a short human-readable one-line status string describing the
 * Conductor's current phase-checkpoint state and how many handoffs have
 * occurred. Designed for log lines, status.json notes, and notify payloads.
 *
 * PURE — no I/O, no side effects, no imports. NEVER throws on any input.
 * The returned string is for HUMAN DISPLAY ONLY — callers must not parse it.
 *
 * @param {object|null|undefined} checkpoint
 *   The checkpoint object as returned by readCheckpoint() — shape
 *   { lastCompletedPhase?: number, specFrozen?: boolean, specPath?: string|null }
 *   — or null/undefined if no checkpoint exists.
 * @param {number} [handoffsSoFar=0]
 *   How many automatic handoffs have occurred so far in this run (from the
 *   runHandoffLoop counter in bin/mmd.js). Non-finite or missing → treated as 0.
 * @returns {string} A non-empty one-line summary (never empty, never throws).
 */
export function summarizeHandoffState(checkpoint, handoffsSoFar) {
  // Guard: null/undefined checkpoint means no run has started yet.
  // `== null` catches both null and undefined.
  if (checkpoint == null) {
    return 'No checkpoint — run not started';
  }

  // Extract and validate the phase number. Optional chaining handles the case
  // where checkpoint is a non-object (Symbol, number, array) — safeNumber then
  // produces NaN, which fails the isFinite+>=1 guard below.
  const phase = safeNumber(checkpoint?.lastCompletedPhase);
  if (!(Number.isFinite(phase) && phase >= 1)) {
    return 'No phase completed yet';
  }

  // Normalize handoffsSoFar: non-finite or < 1 → treat as 0 (no suffix shown).
  const coerced = safeNumber(handoffsSoFar);
  const h = (Number.isFinite(coerced) && coerced >= 1) ? coerced : 0;

  // Build the optional handoff suffix. Singular for exactly 1, plural for N > 1.
  const suffix = h >= 1
    ? (h === 1 ? ' — 1 handoff so far' : ` — ${h} handoffs so far`)
    : '';

  // Complete: phase reached or exceeded TOTAL_PHASES. Display is always capped
  // at TOTAL_PHASES/TOTAL_PHASES — the raw phase value above the total is not shown.
  if (phase >= HANDOFF_SUMMARY_TOTAL_PHASES) {
    return `Run complete (${HANDOFF_SUMMARY_TOTAL_PHASES}/${HANDOFF_SUMMARY_TOTAL_PHASES} phases)${suffix}`;
  }

  return `Phase ${phase}/${HANDOFF_SUMMARY_TOTAL_PHASES} complete${suffix}`;
}
