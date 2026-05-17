// lib/bench/metrics.js — per-dream metric serializer + Phase 4 findings parser.
//
// Spec: SPEC_V02B AC-4. The canonical metrics.json shape is the contract
// between the bench harness and downstream consumers (v0.5b autolearning,
// future v0.3+ CI dashboard). Shape MUST stay backward-compatible: new keys
// MAY be added, existing keys MUST NOT change type or meaning without a
// scoping update (observability.md §IV — "metrics shape is canonical").
//
// SRP: pure transformations — string→count, object→json-string. No I/O. All
// I/O (reading log files, writing metrics.json) is the caller's job in
// run-one.js or in the unit test.

/**
 * Phase 4 of auto-dev (adversarial code review) emits headings of the shape
 * `## Finding F<digit>`. Count them in a captured log. Best-effort per spec:
 * if the log is unparseable (binary, truncated mid-codepoint, …), return
 * `null` so the metric reflects "we tried and could not measure" rather than
 * silently returning 0 (which would lie about the absence of findings).
 *
 * Constitution: ai-coding.md §I (honest AI failure reporting) drives the
 * null-on-failure choice — fabricating a zero would be dishonest.
 *
 * @param {string|Buffer|null|undefined} logContent
 * @returns {number|null}
 */
export function countPhase4Findings(logContent) {
  if (logContent === null || logContent === undefined) return null;
  let s;
  try {
    s = typeof logContent === 'string' ? logContent : Buffer.from(logContent).toString('utf8');
  } catch {
    return null;
  }
  // Phase 4 headings look like `## Finding F1`, `## Finding F12`. Use a strict
  // regex with multiline mode + a word boundary after the digits to avoid
  // matching `## Finding F1A` (an unrelated rev marker).
  const re = /^##\s+Finding\s+F\d+\b/gm;
  const matches = s.match(re);
  return matches ? matches.length : 0;
}

/**
 * Build a metrics.json payload. All fields per AC-4. Caller supplies the
 * inputs; this function performs ONLY shape validation + JSON serialization
 * (or, when `asJSON` is false, returns the object).
 *
 * @param {object} args
 * @param {string} args.dream_id
 * @param {'fast'|'standard'|'deep'} args.engine
 * @param {string} args.started_at           ISO-8601
 * @param {string} args.ended_at             ISO-8601
 * @param {number} args.duration_seconds
 * @param {number} args.exit_code
 * @param {{ran:boolean,passed:boolean,screenshot_path:string|null,console_errors_count:number}} args.reality_check
 * @param {number} args.commits_count
 * @param {number|null} args.phase4_findings_count
 * @param {string} args.log_path
 * @param {boolean} [args.asJSON=false]      if true returns serialized JSON
 * @returns {object|string}
 */
export function serializeMetrics(args) {
  const required = [
    'dream_id',
    'engine',
    'started_at',
    'ended_at',
    'duration_seconds',
    'exit_code',
    'reality_check',
    'commits_count',
    'log_path',
  ];
  for (const k of required) {
    if (!(k in args)) {
      throw new TypeError(`serializeMetrics: missing required field '${k}'`);
    }
  }
  if (typeof args.dream_id !== 'string' || args.dream_id.length === 0) {
    throw new TypeError('serializeMetrics: dream_id must be a non-empty string');
  }
  if (typeof args.engine !== 'string') {
    throw new TypeError('serializeMetrics: engine must be a string');
  }
  if (typeof args.duration_seconds !== 'number' || args.duration_seconds < 0) {
    throw new TypeError('serializeMetrics: duration_seconds must be a non-negative number');
  }
  if (typeof args.exit_code !== 'number') {
    throw new TypeError('serializeMetrics: exit_code must be a number');
  }
  if (!args.reality_check || typeof args.reality_check !== 'object') {
    throw new TypeError('serializeMetrics: reality_check must be an object');
  }
  const rc = args.reality_check;
  if (typeof rc.ran !== 'boolean' || typeof rc.passed !== 'boolean') {
    throw new TypeError('serializeMetrics: reality_check.ran/passed must be booleans');
  }
  if (typeof rc.console_errors_count !== 'number') {
    throw new TypeError('serializeMetrics: reality_check.console_errors_count must be a number');
  }
  if (typeof args.commits_count !== 'number' || args.commits_count < 0) {
    throw new TypeError('serializeMetrics: commits_count must be a non-negative number');
  }
  if (
    args.phase4_findings_count !== null &&
    args.phase4_findings_count !== undefined &&
    typeof args.phase4_findings_count !== 'number'
  ) {
    throw new TypeError('serializeMetrics: phase4_findings_count must be a number or null');
  }

  const payload = {
    dream_id: args.dream_id,
    engine: args.engine,
    started_at: args.started_at,
    ended_at: args.ended_at,
    duration_seconds: args.duration_seconds,
    exit_code: args.exit_code,
    reality_check: {
      ran: rc.ran,
      passed: rc.passed,
      screenshot_path: rc.screenshot_path ?? null,
      console_errors_count: rc.console_errors_count,
    },
    commits_count: args.commits_count,
    phase4_findings_count:
      args.phase4_findings_count === undefined ? null : args.phase4_findings_count,
    log_path: args.log_path,
  };

  return args.asJSON ? `${JSON.stringify(payload, null, 2)}\n` : payload;
}
