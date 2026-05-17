// lib/engine.js — engine selection + status.json engine_metrics record building.
//
// SRP: owns the mapping from a resolved engine name ('fast' | 'standard') to:
//   - the engine_metrics record persisted to status.json (AC-6)
//   - the FAST-mode time-budget check (AC-5)
//   - small helpers used by bin/mmd.js to keep its main flow flat.
//
// We deliberately keep this module thin in v0.2: --standard/--deep specifics
// are forward-compat scaffolding (handled by argv-parser.resolveEngine), and
// dream-bench consumption of engine_metrics lands in v0.2b.
//
// Public API:
//   - buildEngineRecord(engine) -> { engine, engine_metrics }
//   - withDuration(record, durationSeconds) -> record
//   - fastBudgetExceeded(elapsedSeconds, env?) -> boolean
//   - DEFAULT_FAST_BUDGET_MIN

export const DEFAULT_FAST_BUDGET_MIN = 12;

/**
 * Build the initial engine record for status.json (AC-6).
 *
 * The shape is the seed of the dream-bench (v0.2b) and tool-choice telemetry
 * (scoping §6.5b). The CLI fills in what it can determine locally:
 *  - duration_seconds: 0 at start; the orchestrator overwrites it post-run.
 *  - party_mode_rounds: the INTENDED count we instruct auto-dev to honor
 *    (1× for fast, 3× for standard). The actual count observed by auto-dev
 *    is not surfaced back to the CLI in v0.2 — that wiring is v0.2b.
 *  - phase2_skipped / phase2_skip_reason: left null because the CLI cannot
 *    determine whether auto-dev actually skipped Phase 2; the workflow
 *    decides this from the spec heuristic. Recording null keeps the shape
 *    explicit so dream-bench can later distinguish "not measured" from
 *    "measured false".
 *
 * @param {'fast'|'standard'} engine
 * @returns {{ engine: string, engine_metrics: { duration_seconds: number, party_mode_rounds: number, phase2_skipped: boolean|null, phase2_skip_reason: string|null } }}
 */
export function buildEngineRecord(engine) {
  if (engine !== 'fast' && engine !== 'standard') {
    // Forward-compat: future 'deep' will land here once v0.2d ships.
    // Fail loudly rather than silently coercing — ai-coding.md §I.
    throw new TypeError(`buildEngineRecord: unsupported engine "${engine}"`);
  }
  return {
    engine,
    engine_metrics: {
      duration_seconds: 0,
      party_mode_rounds: engine === 'fast' ? 1 : 3,
      phase2_skipped: null,
      phase2_skip_reason: null,
    },
  };
}

/**
 * Return a new record with the observed wall-clock duration. Pure — does not
 * mutate the input.
 *
 * @param {{ engine: string, engine_metrics: object }} record
 * @param {number} durationSeconds
 */
export function withDuration(record, durationSeconds) {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
    throw new TypeError(
      `withDuration: durationSeconds must be a non-negative finite number; got ${durationSeconds}`,
    );
  }
  return {
    ...record,
    engine_metrics: {
      ...record.engine_metrics,
      duration_seconds: Math.round(durationSeconds * 10) / 10,
    },
  };
}

/**
 * AC-5: returns true once elapsed > the FAST budget. The orchestrator uses
 * this for the soft warning — it does NOT kill the subprocess.
 *
 * Budget = MMD_FAST_MAX_MINUTES (env, positive number) OR 12 by default.
 * Invalid values (non-numeric, <=0) fall back to the default — be forgiving
 * here per error-handling.md §III (graceful degradation on env config).
 *
 * @param {number} elapsedSeconds
 * @param {NodeJS.ProcessEnv} [env]
 */
export function fastBudgetExceeded(elapsedSeconds, env = process.env) {
  const raw = env.MMD_FAST_MAX_MINUTES;
  const parsed = Number(raw);
  const minutes = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_FAST_BUDGET_MIN;
  return elapsedSeconds > minutes * 60;
}
