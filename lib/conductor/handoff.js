// lib/conductor/handoff.js — the PURE decision logic for the v0.13.a cooperative
// auto-handoff at 70% (SPEC_V013A AC-1, ADR-051). The Conductor's step C: connect
// the v0.5.b context monitor (which SEES 70% but did nothing) to the v0.12.a
// resume mechanism, so MMD hands off to a FRESH successor when the orchestrator's
// context fills — cooperatively, never a forced kill.
//
// WHY a separate pure module (universal §I.S SRP, §II KISS): the loop that
// actually spawns auto-dev + relaunches resume lives in bin/mmd.js where the
// seams are. This module only DECIDES — given the externalized run state (the
// v0.12.a checkpoint), whether a handoff was requested (the marker), and how many
// handoffs already happened — which of three closed actions the loop should take.
// Pure (no fs, no spawn, no env, no Date) and NEVER throws on any input, exactly
// like alignment-gate.js and checkpoint.js's decideResume — so the unit suite can
// assert every branch without a real claude.
//
// The three closed actions (no fourth — §VI honesty: never a fabricated state):
//   - 'finish'    : the checkpoint is COMPLETE (all phases done) OR no handoff was
//                   requested → the run is done as today; proceed to the alignment
//                   gate. This is the safe default that prevents an infinite loop:
//                   a clean exit with no request marker always finishes.
//   - 'handoff'   : the checkpoint is INCOMPLETE, a handoff WAS requested, and we
//                   are still under the cap → relaunch a fresh successor in resume
//                   mode (the caller logs, fires the `handoff` notify, clears the
//                   marker, spins a fresh monitor, and relaunches).
//   - 'cap-final' : INCOMPLETE + requested but the cap is reached → the caller
//                   launches ONE final successor with handoff DISABLED (it runs to
//                   done or fails naturally) and logs the cap honestly. Progress is
//                   never infinitely deferred (SPEC §1 "bounded + honest").

/**
 * Coerce to a finite number WITHOUT throwing — mirrors checkpoint.js's safeNumber
 * (raw `Number(aSymbol)` throws a TypeError). Keeps the never-throws contract
 * honest even for a hostile field (a Symbol lastCompletedPhase).
 */
function safeNumber(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' || typeof v === 'boolean' || v == null) return Number(v);
  return NaN; // symbols, objects, bigints → not a phase number
}

/**
 * Decide the auto-handoff action from the externalized run state. PURE +
 * NEVER throws on any (incl. null / odd-typed) input.
 *
 * Rules (SPEC_V013A AC-1):
 *   - 'finish'    when the checkpoint is COMPLETE (`lastCompletedPhase >=
 *                 totalPhases`) OR `!handoffRequested`.
 *   - 'handoff'   when INCOMPLETE + requested + `handoffsSoFar < maxHandoffs`.
 *   - 'cap-final' when INCOMPLETE + requested + `handoffsSoFar >= maxHandoffs`.
 *
 * A missing / unreadable checkpoint counts as INCOMPLETE (lastCompletedPhase 0):
 * the orchestrator stopped before its first phase boundary checkpoint, so if a
 * handoff was requested we relaunch rather than declare a fabricated completion.
 * A non-finite totalPhases is treated as "never complete" so the request signal,
 * not a garbage threshold, drives the decision.
 *
 * @param {{
 *   checkpoint: {lastCompletedPhase?: number}|null|undefined,
 *   handoffRequested: boolean,
 *   handoffsSoFar: number,
 *   maxHandoffs: number,
 *   totalPhases: number,
 * }} args
 * @returns {{action: 'finish'|'handoff'|'cap-final', reason: string}}
 */
export function decideHandoff(args) {
  // Tolerate a null/undefined arg (the `= {}` default only catches undefined).
  const {
    checkpoint,
    handoffRequested,
    handoffsSoFar,
    maxHandoffs,
    totalPhases,
  } = args || {};

  const requested = handoffRequested === true;
  if (!requested) {
    return { action: 'finish', reason: 'no handoff requested — the orchestrator completed or stopped on its own' };
  }

  const phase = safeNumber(checkpoint && typeof checkpoint === 'object' ? checkpoint.lastCompletedPhase : NaN);
  const total = safeNumber(totalPhases);
  // Complete iff we have a finite total AND the checkpoint reached it. A
  // non-finite total → never "complete" (the request signal decides).
  const complete = Number.isFinite(phase) && Number.isFinite(total) && phase >= total;
  if (complete) {
    return { action: 'finish', reason: `checkpoint complete (phase ${phase}/${total}) — nothing to hand off` };
  }

  const so = safeNumber(handoffsSoFar);
  const max = safeNumber(maxHandoffs);
  const soFar = Number.isFinite(so) ? so : 0;
  // A non-finite/garbage cap clamps to the documented default minimum so a junk
  // env value can never produce an unbounded handoff chain.
  const cap = Number.isFinite(max) && max >= 1 ? max : 1;

  const phaseLabel = Number.isFinite(phase) && phase >= 1 ? `phase ${phase}` : 'no phase boundary reached yet';
  if (soFar < cap) {
    return {
      action: 'handoff',
      reason: `handoff requested at ${phaseLabel}; ${soFar}/${cap} handoffs used — relaunching a fresh successor in resume mode`,
    };
  }
  return {
    action: 'cap-final',
    reason: `handoff cap reached (${soFar}/${cap}) — launching one final successor with handoff disabled`,
  };
}

/**
 * Parse the MMD_MAX_HANDOFFS env value into a bounded handoff cap. Returns an
 * INTEGER ≥ 1; anything else (absent, empty, non-integer, negative, zero, junk)
 * → `fallback` (default 3). A `0` is deliberately clamped to the fallback rather
 * than honored: "zero handoffs" would make `--auto-handoff` a silent no-op that
 * never relaunches yet still pays the stream-json cost — a confusing footgun, so
 * the documented minimum meaningful cap is 1 and junk falls back to the default.
 * PURE + NEVER throws.
 *
 * @param {string|number|undefined|null} raw
 * @param {number} [fallback=3]
 * @returns {number} an integer ≥ 1
 */
export function parseMaxHandoffs(raw, fallback = 3) {
  const fb = Number.isInteger(fallback) && fallback >= 1 ? fallback : 3;
  if (raw === undefined || raw === null) return fb;
  const s = String(raw).trim();
  if (s === '') return fb;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1) return fb;
  return n;
}
