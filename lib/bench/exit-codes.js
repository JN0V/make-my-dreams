// lib/bench/exit-codes.js — pure-function classification of a bench run's
// overall exit code from the per-dream metrics array.
//
// Spec: SPEC_V02B AC-6.
//   0 — all dreams passed their reality check (or, in dry-run, all fake-autodev
//       runs succeeded).
//   6 — at least one dream's reality check failed but NO dream's auto-dev
//       crashed (subprocess exited 0 but the produced PWA didn't pass the
//       check).
//   7 — at least one dream's auto-dev crashed (subprocess non-zero exit). A
//       crash is the strictly worse failure mode; if both a crash AND a
//       reality-check fail happen in the same run, the crash dominates.
//
// SRP (universal.md §I.S): this file owns the metrics[] → exit-code mapping
// and NOTHING else. The mapping is pure, deterministic, side-effect-free.
//
// Constants are exported so consumers (bin/mmd.js, tests, future Conductor)
// reference symbolic names rather than magic numbers (universal.md §II KISS
// + observability.md §IV named-constants rule).

export const EXIT_OK = 0;
export const EXIT_REALITY_CHECK_FAIL = 6;
export const EXIT_AUTODEV_CRASH = 7;

/**
 * Classify a bench run. `metrics` is an array of per-dream metric objects in
 * the canonical shape produced by `lib/bench/metrics.js#serializeMetrics`.
 *
 * Required fields per metric (extra fields are ignored — universal.md §I.I
 * Interface Segregation: only the keys we actually consume are coupled):
 *   - `exit_code` (number) — auto-dev subprocess exit. Non-zero means crash.
 *   - `reality_check.passed` (boolean) — false means the PWA failed the check.
 *
 * @param {Array<{exit_code:number, reality_check:{passed:boolean}}>} metrics
 * @returns {0|6|7}
 */
export function classifyBenchExit(metrics) {
  if (!Array.isArray(metrics)) {
    throw new TypeError('classifyBenchExit: metrics must be an array');
  }
  let anyCrash = false;
  let anyRealityFail = false;
  for (const m of metrics) {
    if (!m || typeof m !== 'object') {
      throw new TypeError('classifyBenchExit: every metric must be an object');
    }
    if (typeof m.exit_code !== 'number') {
      throw new TypeError('classifyBenchExit: metric.exit_code must be a number');
    }
    if (!m.reality_check || typeof m.reality_check.passed !== 'boolean') {
      throw new TypeError('classifyBenchExit: metric.reality_check.passed must be a boolean');
    }
    if (m.exit_code !== 0) {
      anyCrash = true;
    } else if (m.reality_check.passed === false) {
      anyRealityFail = true;
    }
  }
  if (anyCrash) return EXIT_AUTODEV_CRASH;
  if (anyRealityFail) return EXIT_REALITY_CHECK_FAIL;
  return EXIT_OK;
}

/**
 * Return the list of dream ids that contributed to a non-zero exit code, in
 * input order. Useful for the stderr message AC-6 demands.
 *
 * @param {Array<{dream_id:string, exit_code:number, reality_check:{passed:boolean}}>} metrics
 * @returns {string[]}
 */
export function failingDreamIds(metrics) {
  const ids = [];
  for (const m of metrics) {
    if (m.exit_code !== 0 || m.reality_check.passed === false) {
      ids.push(m.dream_id);
    }
  }
  return ids;
}
