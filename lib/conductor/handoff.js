// lib/conductor/handoff.js — the PURE decision logic for the v0.13.a cooperative
// auto-handoff at 70% (SPEC_V013A AC-1, ADR-051) AND the v0.14.b HYBRID enforce
// backstop (SPEC_V014B AC-2, ADR-053). The Conductor's step C: connect the
// v0.5.b context monitor (which SEES 70% but did nothing) to the v0.12.a resume
// mechanism, so MMD hands off to a FRESH successor when the orchestrator's
// context fills.
//
// v0.13.a was COOPERATIVE-ONLY: `decideHandoff` classifies the case where the
// orchestrator obeyed the incitation and exited cleanly at a boundary (the
// post-exit path). A live run proved the LLM does NOT reliably obey — it ran
// past ≥2 boundaries to ~120% context with 0 handoffs. v0.14.b ADDS
// `shouldForceHandoff`: the "enforce a kill now?" gate the abort seam checks on
// each monitor tick, for the case where the agent IGNORES the incitation and
// keeps running over the threshold. Cooperative first (gentlest), enforce as a
// backstop — and the enforce is a graceful SIGTERM AT a checkpoint, so no
// committed work is lost (§4.2 "any level can be killed and recreated from the
// files").
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

  // v0.13.1 (live finding): a handoff only makes sense when a real phase boundary
  // was reached — a RESUMABLE checkpoint (lastCompletedPhase >= 1). A null/phase-0
  // checkpoint means the run either COMPLETED without phases (a trivial / direct
  // edit) or never reached the first boundary: there is nothing to resume TO, so a
  // relaunch is a wasteful no-op (the false-handoff bug a live `--auto-handoff` run
  // surfaced — it relaunched successors that found the work already done) or a bare
  // retry. Finish instead; the normal completion path (exit code) then reports
  // done/failed. Handoff is reserved for genuine mid-pipeline progress.
  if (!(Number.isFinite(phase) && phase >= 1)) {
    return {
      action: 'finish',
      reason: 'no resumable checkpoint (no phase boundary reached) — nothing to hand off to a successor',
    };
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
 * v0.14.b — the PURE enforce decision (SPEC_V014B AC-2, ADR-053). The HYBRID
 * auto-handoff keeps the cooperative incitation (decideHandoff classifies the
 * clean-exit case post-exit) AND adds an MMD-side ENFORCE backstop for the live
 * finding that the LLM orchestrator does NOT obey the "exit cleanly at the
 * boundary" instruction: a real run advanced ≥2 phase boundaries to ~120%
 * context with 0 cooperative handoffs. So MMD watches, and when the orchestrator
 * IGNORES the incitation — it advances the checkpoint (a NEW phase boundary)
 * while OVER the threshold and is STILL ALIVE — MMD terminates it at that
 * checkpoint (after a grace) and relaunches resume.
 *
 * This predicate is the "should MMD enforce a kill now?" gate, checked on each
 * monitor tick by the abort seam in lib/invoke-autodev.js. It is true iff ALL of:
 *   - `pct >= threshold`              the orchestrator is over the context budget
 *   - `lastCompletedPhase > phaseAtSpawn`  a NEW boundary was reached since THIS
 *                                     successor launched — proof the agent
 *                                     reached a phase boundary and kept going
 *                                     (it ignored the marker), not the inherited
 *                                     checkpoint (which would re-kill instantly)
 *   - `handoffsSoFar < maxHandoffs`   still under the bound (at the cap, the
 *                                     final successor runs un-enforced)
 *
 * PURE (no fs/spawn/env/Date) + NEVER throws on any (incl. null / odd-typed)
 * input — any non-finite/garbage field collapses to a safe `false` (never an
 * enforced kill on junk), exactly like decideHandoff above. The caller supplies
 * the live `pct` (from the monitor) and a freshly-read `lastCompletedPhase`
 * (polled readCheckpoint); this function only DECIDES.
 *
 * @param {{
 *   pct: number,
 *   threshold: number,
 *   lastCompletedPhase: number,
 *   phaseAtSpawn: number,
 *   handoffsSoFar: number,
 *   maxHandoffs: number,
 * }} args
 * @returns {boolean}
 */
export function shouldForceHandoff(args) {
  const {
    pct,
    threshold,
    lastCompletedPhase,
    phaseAtSpawn,
    handoffsSoFar,
    maxHandoffs,
  } = args || {};

  const p = safeNumber(pct);
  const t = safeNumber(threshold);
  const last = safeNumber(lastCompletedPhase);
  const spawn = safeNumber(phaseAtSpawn);
  const max = safeNumber(maxHandoffs);
  // A non-finite pct/threshold/phase/cap → never enforce (safe default: a junk
  // reading must not trigger a kill). handoffsSoFar is allowed to be missing →
  // treated as 0 (no handoffs used yet).
  if (![p, t, last, spawn, max].every(Number.isFinite)) return false;

  if (!(p >= t)) return false;            // under the threshold — leave it alone
  if (!(last > spawn)) return false;       // no NEW boundary since this spawn
  const soFar = Number.isFinite(safeNumber(handoffsSoFar)) ? safeNumber(handoffsSoFar) : 0;
  if (!(soFar < max)) return false;        // at/over the cap — final un-enforced run
  return true;
}

/**
 * v0.14.b — parse MMD_HANDOFF_GRACE_MS: the "incite-first" grace window (ms) the
 * abort seam waits AFTER `shouldForceHandoff` fires, giving the agent a last
 * chance to exit cooperatively (Path A) before MMD terminates the process group
 * (Path B). Returns a non-negative INTEGER; anything else (absent, empty,
 * non-integer, negative, junk) → `fallback` (default 15000 = 15s, a small
 * window). A `0` is honored (terminate as soon as the predicate fires — useful
 * for tests). PURE + NEVER throws.
 *
 * @param {string|number|undefined|null} raw
 * @param {number} [fallback=15000]
 * @returns {number} a non-negative integer (ms)
 */
export function parseHandoffGraceMs(raw, fallback = 15000) {
  const fb = Number.isInteger(fallback) && fallback >= 0 ? fallback : 15000;
  if (raw === undefined || raw === null) return fb;
  const s = String(raw).trim();
  if (s === '') return fb;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0) return fb;
  return n;
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
