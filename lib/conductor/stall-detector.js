// lib/conductor/stall-detector.js — pure stall detector (SPEC_V02J AC-1).
//
// SRP (universal.md §I.S): decide whether a slice is stalled, and on which
// signals, from three deterministic inputs: status.json, the slice branch's
// last-commit epoch, and the tails/headers of recent run logs.
//
// Purity & testability (SPEC §5 risk "Detector deterministic"):
//   - NO ambient Date.now() inside — the clock is injected (`now`, default
//     Date.now), so the same inputs always yield the same output.
//   - fs reads are injectable (`readFileFn`, `globFn`) so tests drive the
//     function without touching the real filesystem.
//   - git is injected too (`gitLastCommitEpochFn`) — defaults to a spawnSync
//     of `git log <branch> --format='%at' -1`.
//
// Performance (SPEC §1 + §5): sub-100ms — reads one small JSON file, runs one
// git command, and reads the head+tail of a bounded number of log files.
//
// error-handling.md §III: a missing status.json / missing branch / missing
// logs are NOT thrown — they are EXPECTED states (a fresh slice has no
// commits; a never-run slice has no logs). They produce evidence fields set to
// null and simply do not raise the corresponding signal. Only genuinely
// unexpected errors (EACCES, malformed-but-present JSON) are surfaced via the
// evidence.errors[] array rather than crashing, so the detector always returns
// a well-formed result for `mmd unblock` to act on.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { STALL_SIGNALS } from './stall-signals.js';

const SECONDS_PER_MIN = 60;

/**
 * Default thresholds, overridable via env then via the `thresholds` arg.
 * (SPEC AC-1: MMD_STALL_MIN_NOCOMMIT=10, MMD_STALL_MAX_RETRIES=3,
 *  MMD_STALL_DURATION_BUDGET_FACTOR=2.0, MMD_STALL_ERROR_PATTERN_REGEX.)
 */
export const DEFAULT_THRESHOLDS = Object.freeze({
  minNoCommitMin: 10,
  maxRetries: 3,
  durationBudgetFactor: 2.0,
  // Default error pattern: common fatal markers seen in run logs (L-016
  // "subprocess timed out", generic errors/fatals). Overridable via env.
  errorPatternRegex: '(subprocess timed out|FATAL|Error:|Traceback|panic:)',
  // How stale (in minutes) an explicit heartbeat in status.json may be before
  // we raise heartbeat-stale. Only fires when status.json carries a heartbeat.
  heartbeatStaleMin: 10,
  // Assumed per-engine budget (seconds) used as the baseline for
  // duration-exceeded-budget when status.json carries no explicit budget.
  // 1800s = the L-016 30-min default. duration > factor * budget → signal.
  engineBudgetSeconds: 1800,
});

/**
 * Resolve effective thresholds: defaults < env < explicit arg.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {Partial<typeof DEFAULT_THRESHOLDS>} [override]
 * @returns {typeof DEFAULT_THRESHOLDS}
 */
export function resolveThresholds(env = process.env, override = {}) {
  const num = (v, fallback) => {
    if (v === undefined || v === null || v === '') return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const fromEnv = {
    minNoCommitMin: num(env.MMD_STALL_MIN_NOCOMMIT, DEFAULT_THRESHOLDS.minNoCommitMin),
    maxRetries: num(env.MMD_STALL_MAX_RETRIES, DEFAULT_THRESHOLDS.maxRetries),
    durationBudgetFactor: num(
      env.MMD_STALL_DURATION_BUDGET_FACTOR,
      DEFAULT_THRESHOLDS.durationBudgetFactor,
    ),
    errorPatternRegex:
      env.MMD_STALL_ERROR_PATTERN_REGEX && env.MMD_STALL_ERROR_PATTERN_REGEX.length > 0
        ? env.MMD_STALL_ERROR_PATTERN_REGEX
        : DEFAULT_THRESHOLDS.errorPatternRegex,
    heartbeatStaleMin: num(env.MMD_STALL_HEARTBEAT_STALE_MIN, DEFAULT_THRESHOLDS.heartbeatStaleMin),
    engineBudgetSeconds: num(env.MMD_STALL_ENGINE_BUDGET_SECONDS, DEFAULT_THRESHOLDS.engineBudgetSeconds),
  };
  return Object.freeze({ ...fromEnv, ...stripUndefined(override) });
}

function stripUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Default git accessor: epoch (seconds) of the last commit on `branch`, or
 * null when the branch has no commits / git is unavailable. Never throws.
 *
 * @param {string} repoRoot
 * @param {string} branch
 * @returns {number|null}
 */
function defaultGitLastCommitEpoch(repoRoot, branch) {
  try {
    const r = spawnSync('git', ['log', branch, '--format=%at', '-1'], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 5000,
    });
    if (r.status !== 0) return null;
    const line = (r.stdout || '').trim().split('\n')[0];
    const epoch = Number(line);
    return Number.isFinite(epoch) && epoch > 0 ? epoch : null;
  } catch {
    return null;
  }
}

/**
 * Default run-log accessor: returns up to `maxFiles` recent `.log` files'
 * combined head+tail text from `<repoRoot>/.mmd/local/runs/`. Bounded read so
 * the detector stays sub-100ms even with large logs.
 *
 * @param {string} repoRoot
 * @param {number} maxFiles
 * @returns {string} concatenated head+tail text of recent logs (empty if none)
 */
function defaultReadRunLogs(repoRoot, maxFiles = 5) {
  const runsDir = path.join(repoRoot, '.mmd', 'local', 'runs');
  let names;
  try {
    if (!existsSync(runsDir)) return '';
    names = readdirSync(runsDir).filter((n) => n.endsWith('.log'));
  } catch {
    return '';
  }
  // Newest-first by name (timestamps sort lexicographically), bounded.
  names.sort().reverse();
  const chunks = [];
  for (const name of names.slice(0, maxFiles)) {
    const full = path.join(runsDir, name);
    try {
      const raw = readFileSync(full, 'utf8');
      chunks.push(headTail(raw));
    } catch {
      // Unreadable single log — skip, don't fail the whole detection.
    }
  }
  return chunks.join('\n');
}

/** Head (first 4KB) + tail (last 4KB) of a string — bounds the scan size. */
function headTail(text, bound = 4096) {
  if (text.length <= bound * 2) return text;
  return `${text.slice(0, bound)}\n...\n${text.slice(-bound)}`;
}

/**
 * Read + parse status.json. Returns { status, error } — never throws. ENOENT
 * is an expected fresh-slice state (status:null, error:null). A present but
 * malformed file yields status:null + an error string for the evidence trail.
 *
 * @param {string} statusJsonPath
 * @param {(p: string) => string} readFileFn
 * @returns {{ status: object|null, error: string|null }}
 */
function readStatusJson(statusJsonPath, readFileFn) {
  if (typeof statusJsonPath !== 'string' || statusJsonPath.length === 0) {
    return { status: null, error: null };
  }
  let raw;
  try {
    raw = readFileFn(statusJsonPath);
  } catch (err) {
    if (err && err.code === 'ENOENT') return { status: null, error: null };
    return { status: null, error: `status.json read failed: ${err.message}` };
  }
  try {
    return { status: JSON.parse(raw), error: null };
  } catch (err) {
    return { status: null, error: `status.json malformed: ${err.message}` };
  }
}

/**
 * Pure-ish stall detector. Deterministic given its injected dependencies.
 *
 * @param {{
 *   statusJsonPath: string,
 *   sliceBranch: string,
 *   repoRoot: string,
 *   thresholds?: Partial<typeof DEFAULT_THRESHOLDS>,
 *   env?: NodeJS.ProcessEnv,
 *   now?: () => number,                       // ms since epoch (default Date.now)
 *   readFileFn?: (p: string) => string,       // default readFileSync utf8
 *   gitLastCommitEpochFn?: (repoRoot: string, branch: string) => number|null,
 *   readRunLogsFn?: (repoRoot: string) => string,
 * }} opts
 * @returns {{ stalled: boolean, signals: string[], evidence: object }}
 */
export function detectStall(opts) {
  if (!opts || typeof opts !== 'object') {
    throw new TypeError('detectStall: opts must be an object');
  }
  const {
    statusJsonPath,
    sliceBranch,
    repoRoot,
    env = process.env,
    now = Date.now,
    readFileFn = (p) => readFileSync(p, 'utf8'),
    gitLastCommitEpochFn = defaultGitLastCommitEpoch,
    readRunLogsFn = (root) => defaultReadRunLogs(root),
  } = opts;
  if (typeof sliceBranch !== 'string' || sliceBranch.length === 0) {
    throw new TypeError('detectStall: sliceBranch must be a non-empty string');
  }
  if (typeof repoRoot !== 'string' || repoRoot.length === 0) {
    throw new TypeError('detectStall: repoRoot must be a non-empty string');
  }

  const thresholds = resolveThresholds(env, opts.thresholds || {});
  const nowMs = now();
  const nowSec = Math.floor(nowMs / 1000);

  const signals = [];
  const errors = [];
  const evidence = {
    lastCommitAgeMin: null,
    retryCount: null,
    errorPatternMatched: false,
    errorPatternSample: null,
    durationSeconds: null,
    durationBudgetSeconds: null,
    state: null,
    heartbeatAgeMin: null,
    thresholds,
    errors,
  };

  // ── status.json ──────────────────────────────────────────────────────────
  const { status, error: statusErr } = readStatusJson(statusJsonPath, readFileFn);
  if (statusErr) errors.push(statusErr);

  if (status && typeof status === 'object') {
    evidence.state = typeof status.state === 'string' ? status.state : null;

    // state-failed-explicit
    if (status.state === 'failed') signals.push('state-failed-explicit');

    // retry-count-exceeded — count failed/retried tasks, or an explicit
    // retry_count field if present. Tolerant of either shape.
    const retryCount = extractRetryCount(status);
    evidence.retryCount = retryCount;
    if (Number.isFinite(retryCount) && retryCount > thresholds.maxRetries) {
      signals.push('retry-count-exceeded');
    }

    // duration-exceeded-budget — engine_metrics.duration_seconds vs budget.
    const dur = extractDurationSeconds(status);
    evidence.durationSeconds = dur;
    const budget = extractBudgetSeconds(status, thresholds);
    evidence.durationBudgetSeconds = budget;
    if (
      Number.isFinite(dur) &&
      Number.isFinite(budget) &&
      budget > 0 &&
      dur > thresholds.durationBudgetFactor * budget
    ) {
      signals.push('duration-exceeded-budget');
    }

    // heartbeat-stale — only when an explicit heartbeat timestamp is present.
    const hbAgeMin = extractHeartbeatAgeMin(status, nowMs);
    evidence.heartbeatAgeMin = hbAgeMin;
    if (Number.isFinite(hbAgeMin) && hbAgeMin > thresholds.heartbeatStaleMin) {
      signals.push('heartbeat-stale');
    }
  }

  // ── git last-commit age ────────────────────────────────────────────────────
  let lastCommitEpoch = null;
  try {
    lastCommitEpoch = gitLastCommitEpochFn(repoRoot, sliceBranch);
  } catch (err) {
    errors.push(`git last-commit lookup failed: ${err.message}`);
  }
  if (Number.isFinite(lastCommitEpoch) && lastCommitEpoch > 0) {
    const ageMin = (nowSec - lastCommitEpoch) / SECONDS_PER_MIN;
    evidence.lastCommitAgeMin = round2(ageMin);
    if (ageMin > thresholds.minNoCommitMin) {
      signals.push('no-commit-since-N-min');
    }
  }

  // ── run-log error pattern ──────────────────────────────────────────────────
  let logText = '';
  try {
    logText = readRunLogsFn(repoRoot) || '';
  } catch (err) {
    errors.push(`run-log read failed: ${err.message}`);
  }
  if (logText.length > 0) {
    let re;
    try {
      re = new RegExp(thresholds.errorPatternRegex, 'm');
    } catch (err) {
      errors.push(`invalid error-pattern regex: ${err.message}`);
      re = null;
    }
    if (re) {
      const m = logText.match(re);
      if (m) {
        evidence.errorPatternMatched = true;
        evidence.errorPatternSample = m[0].slice(0, 200);
        signals.push('error-pattern-matched');
      }
    }
  }

  // Deterministic ordering: emit signals in the canonical enum order.
  const ordered = STALL_SIGNALS.filter((s) => signals.includes(s));

  return {
    stalled: ordered.length > 0,
    signals: ordered,
    evidence,
  };
}

// ── status.json field extractors (tolerant of schema drift) ─────────────────

function extractRetryCount(status) {
  if (Number.isFinite(status.retry_count)) return status.retry_count;
  if (Array.isArray(status.tasks)) {
    return status.tasks.filter(
      (t) => t && (t.state === 'failed' || Number.isFinite(t.retries) && t.retries > 0),
    ).length;
  }
  return null;
}

function extractDurationSeconds(status) {
  const m = status.engine_metrics;
  if (m && Number.isFinite(m.duration_seconds)) return m.duration_seconds;
  if (Number.isFinite(status.duration_seconds)) return status.duration_seconds;
  return null;
}

function extractBudgetSeconds(status, thresholds) {
  const m = status.engine_metrics;
  if (m && Number.isFinite(m.budget_seconds) && m.budget_seconds > 0) return m.budget_seconds;
  if (m && Number.isFinite(m.expected_seconds) && m.expected_seconds > 0) return m.expected_seconds;
  return thresholds.engineBudgetSeconds;
}

function extractHeartbeatAgeMin(status, nowMs) {
  const hb = status.heartbeat_at || (status.engine_metrics && status.engine_metrics.heartbeat_at);
  if (typeof hb !== 'string' || hb.length === 0) return null;
  const t = Date.parse(hb);
  if (!Number.isFinite(t)) return null;
  return round2((nowMs - t) / 1000 / SECONDS_PER_MIN);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
