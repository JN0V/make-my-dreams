// lib/conductor/checkpoint.js — externalized phase checkpoint + handoff notes
// that make the auto-dev orchestrator stateless and resumable (SPEC_V012A,
// Conductor step B.1 / ADR-050).
//
// The gap these primitives close: auto-dev (MMD's own orchestrator skill) runs
// inside ONE `claude -p` process with no externalized record of "which phase is
// done". A kill — crash, Ctrl-C, or (step C) a 70%-context handoff — loses the
// whole orchestration and restarts from Phase 1, re-doing the spec. These
// primitives give the orchestrator the §4.2 stateless property: each phase
// transition writes a machine-readable checkpoint.json + a human handoff/<N>.md
// note, so a fresh successor can recover "phases 1..N done, continue at N+1".
//
// Placement: under the existing run-local `.mmd/local/` area (gitignored,
// ephemeral run state — NOT a committed deliverable), mirroring the
// ensureLayout conventions in lib/state.js.
//
// On-disk format is snake_case (what the auto-dev heredoc — an LLM — writes by
// hand): `{ last_completed_phase, spec_frozen, spec_path }`. The JS API is
// camelCase. readCheckpoint normalizes disk → API so both producers (the JS
// writeCheckpoint AND the LLM-authored file) round-trip identically.
//
// Public API (injected-fs for testability, NEVER throws — AC-1):
//   - writeCheckpoint(dir, {lastCompletedPhase, specFrozen, specPath}, {fs?}) -> boolean
//   - readCheckpoint(dir, {fs?})                  -> checkpoint object | null
//   - writeHandoffNote(dir, n, text, {fs?})       -> boolean
//   - isResumable(checkpoint, {totalPhases})      -> boolean
//   - decideResume({checkpoint, totalPhases, processAlive, statusState}) -> {action, reason}
//   - checkpointPath(dir) / handoffDir(dir)       -> path helpers (pure)
//
// Constitution: §VI (never fabricate — readCheckpoint returns null, never a
// guessed object), §II KISS (thin fs over pure logic), §VIII not applicable
// (run-state files, not target-project analysis).

import * as nodeFs from 'node:fs';
import path from 'node:path';

// Run-local, gitignored (.mmd/local/ is ignored — see lib/state.js + .gitignore).
const LOCAL_DIR = path.join('.mmd', 'local');
const CHECKPOINT_FILE = 'checkpoint.json';
const HANDOFF_SUBDIR = 'handoff';

/** Absolute (relative to `dir`) path of the checkpoint file. Pure. */
export function checkpointPath(dir) {
  return path.join(String(dir ?? '.'), LOCAL_DIR, CHECKPOINT_FILE);
}

/** Directory holding the numbered handoff notes. Pure. */
export function handoffDir(dir) {
  return path.join(String(dir ?? '.'), LOCAL_DIR, HANDOFF_SUBDIR);
}

/**
 * Persist the phase checkpoint. Writes snake_case to disk so an LLM-authored
 * checkpoint.json (the auto-dev heredoc) and this writer share one format.
 * NEVER throws — returns false on any failure (best-effort run state).
 *
 * @param {string} dir  run root (demoDir for greenfield, cwd for --here)
 * @param {{lastCompletedPhase:number, specFrozen?:boolean, specPath?:string|null}} checkpoint
 * @param {{fs?:object}} [deps]
 * @returns {boolean} true iff written
 */
export function writeCheckpoint(dir, checkpoint, { fs = nodeFs } = {}) {
  try {
    const target = checkpointPath(dir);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const n = Number(checkpoint?.lastCompletedPhase);
    const payload = {
      last_completed_phase: Number.isFinite(n) ? n : 0,
      spec_frozen: checkpoint?.specFrozen === true,
      spec_path: checkpoint?.specPath != null ? String(checkpoint.specPath) : null,
      updated_at: new Date().toISOString(),
    };
    fs.writeFileSync(target, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    return true;
  } catch {
    return false; // §VI honesty: a failed write is reported via the boolean, never silently faked done.
  }
}

/**
 * Read + normalize the checkpoint. Missing OR malformed → null (never throws,
 * never a fabricated object — AC-1). Accepts both snake_case (on-disk) and
 * camelCase (defensive) field names.
 *
 * @param {string} dir
 * @param {{fs?:object}} [deps]
 * @returns {{lastCompletedPhase:number, specFrozen:boolean, specPath:string|null}|null}
 */
export function readCheckpoint(dir, { fs = nodeFs } = {}) {
  try {
    const raw = fs.readFileSync(checkpointPath(dir), 'utf8');
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    const rawPhase = obj.last_completed_phase ?? obj.lastCompletedPhase;
    const n = Number(rawPhase);
    const frozen = obj.spec_frozen ?? obj.specFrozen;
    const specPath = obj.spec_path ?? obj.specPath;
    return {
      lastCompletedPhase: Number.isFinite(n) ? n : 0,
      specFrozen: frozen === true,
      specPath: specPath != null ? String(specPath) : null,
    };
  } catch {
    return null; // missing/malformed/parse-error all collapse to null.
  }
}

/**
 * Write a numbered, human-readable handoff note (`handoff/<n>.md`) describing
 * what a phase produced + what is next + key context for a successor. NEVER
 * throws — returns false on failure.
 *
 * @param {string} dir
 * @param {number} n  the phase number this note hands off FROM
 * @param {string} text
 * @param {{fs?:object}} [deps]
 * @returns {boolean}
 */
export function writeHandoffNote(dir, n, text, { fs = nodeFs } = {}) {
  try {
    const d = handoffDir(dir);
    fs.mkdirSync(d, { recursive: true });
    const num = Number(n);
    const name = `${Number.isFinite(num) ? num : 0}.md`;
    fs.writeFileSync(path.join(d, name), String(text ?? ''), 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Is this checkpoint resumable? True iff at least one phase is done AND the run
 * is not complete: `1 ≤ lastCompletedPhase < totalPhases`. A 0/absent phase →
 * false (nothing done yet, fresh start). A `=totalPhases` → false (complete).
 * Pure, never throws on any input.
 *
 * @param {*} checkpoint
 * @param {{totalPhases:number}} opts
 * @returns {boolean}
 */
export function isResumable(checkpoint, { totalPhases } = {}) {
  if (!checkpoint || typeof checkpoint !== 'object') return false;
  const n = Number(checkpoint.lastCompletedPhase);
  const total = Number(totalPhases);
  if (!Number.isFinite(n) || !Number.isFinite(total)) return false;
  return n >= 1 && n < total;
}

/**
 * Decide what a `--resume` invocation should do, given the run's externalized
 * state. PURE — it only decides; the caller acts (bin/mmd.js relaunches via
 * invokeAutodev). NEVER fabricates a continuation (§VI): three closed actions.
 *
 *   - 'relaunch' : a resumable checkpoint, the run is not live and not done →
 *                  continue from lastCompletedPhase + 1.
 *   - 'complete' : the run finished (not resumable, or status done) → honest
 *                  "nothing to resume".
 *   - 'none'     : no checkpoint (no resumable run found), or a run appears live.
 *
 * @param {{checkpoint:*, totalPhases:number, processAlive?:boolean, statusState?:string}} args
 * @returns {{action:'relaunch'|'complete'|'none', reason:string}}
 */
export function decideResume({ checkpoint, totalPhases, processAlive = false, statusState } = {}) {
  if (!checkpoint) {
    return { action: 'none', reason: 'no resumable run found (no checkpoint)' };
  }
  if (!isResumable(checkpoint, { totalPhases })) {
    return {
      action: 'complete',
      reason: 'nothing to resume — the last run has no incomplete phase to continue',
    };
  }
  if (processAlive) {
    return {
      action: 'none',
      reason: 'a run appears to be live (auto-dev process still alive) — not relaunching to avoid a double run',
    };
  }
  if (statusState === 'done') {
    return { action: 'complete', reason: 'nothing to resume — last run completed' };
  }
  const next = Number(checkpoint.lastCompletedPhase) + 1;
  return { action: 'relaunch', reason: `resuming from phase ${next} (phases 1-${checkpoint.lastCompletedPhase} already complete)` };
}
