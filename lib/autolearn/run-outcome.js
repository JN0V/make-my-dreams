// lib/autolearn/run-outcome.js — the durable injection↔outcome correlation that
// makes validated reuse reproducible (SPEC_V090 AC-2, the "crux" per §5 hint 2).
//
// The problem: the composer.json sidecar records WHICH lessons were injected
// (at injection time) but NOT the run's final state. status.json holds the
// state but is overwritten every run, so it is not a per-run durable record.
//
// The mechanism: every run already writes `<runId>.log` + `<runId>.composer.json`
// co-located under `.mmd/local/runs/`. We add a sibling `<runId>.outcome.json`
// = { run_id, state, ts } written by the run-completion path (bin/mmd.js). The
// shared basename IS the runId, so validatedReuses can join injection ids to the
// run's state without any extra registry. All three files share one key.
//
// Idempotent crediting: a separate `.mmd/local/credited-runs.json` records, per
// lesson, the run ids already counted toward its counter — so re-running
// `document-lessons` never double-counts a run (AC-2). All writes are
// best-effort observability (never throw into the run path, universal §VI).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * The per-run id = the run-log basename without its `.log` extension. This is
 * the shared key across `<runId>.log` / `<runId>.composer.json` /
 * `<runId>.outcome.json`. Pure.
 *
 * @param {string} logPath
 * @returns {string}
 */
export function runIdForLog(logPath) {
  const base = path.basename(String(logPath));
  return base.endsWith('.log') ? base.slice(0, -'.log'.length) : base;
}

/** The outcome.json path that sits next to a run log. Pure. */
export function outcomePathForLog(logPath) {
  return path.join(path.dirname(String(logPath)), `${runIdForLog(logPath)}.outcome.json`);
}

/** The outcome.json path that sits next to a composer.json sidecar. Pure. */
export function outcomePathForComposer(composerPath) {
  const p = String(composerPath);
  if (p.endsWith('.composer.json')) {
    return p.slice(0, -'.composer.json'.length) + '.outcome.json';
  }
  return `${p}.outcome.json`;
}

/**
 * Build the durable run-outcome record. Pure.
 * @param {{ runId: string, state: string, ts?: string }} args
 */
export function buildRunOutcome({ runId, state, ts }) {
  return {
    run_id: String(runId),
    state: String(state),
    ts: ts || new Date().toISOString(),
  };
}

/**
 * Persist `<runId>.outcome.json` next to a run log. Best-effort: any I/O error
 * is swallowed (returns null) — the outcome record is observability for the
 * autolearning loop, NEVER load-bearing for the run itself (error-handling §III).
 *
 * @param {string} logPath
 * @param {{ state: string, ts?: string }} args
 * @returns {string|null} the path written, or null on failure
 */
export function writeRunOutcomeSync(logPath, { state, ts } = {}) {
  try {
    const outPath = outcomePathForLog(logPath);
    mkdirSync(path.dirname(outPath), { recursive: true });
    const rec = buildRunOutcome({ runId: runIdForLog(logPath), state, ts });
    writeFileSync(outPath, JSON.stringify(rec, null, 2) + '\n', 'utf8');
    return outPath;
  } catch {
    return null;
  }
}

/**
 * Read the run state recorded for a composer.json sidecar (via its sibling
 * outcome.json). Returns null on any missing/malformed file — a run with no
 * recorded outcome is a missing-state run (contributes 0 validated reuses).
 * Never throws.
 *
 * @param {string} composerPath
 * @returns {string|null}
 */
export function readRunStateForComposerSync(composerPath) {
  try {
    const j = JSON.parse(readFileSync(outcomePathForComposer(composerPath), 'utf8'));
    return j && typeof j.state === 'string' ? j.state : null;
  } catch {
    return null;
  }
}

// ── Idempotent credited-runs store ────────────────────────────────────────────

/** Path of the durable per-lesson credited-runs record. */
export function creditedRunsPath(repoRoot) {
  return path.join(repoRoot, '.mmd', 'local', 'credited-runs.json');
}

/**
 * Read the credited-runs record `{ <lessonId>: [runId, ...] }`. Missing or
 * malformed → `{}` (back-compat: a fresh repo has credited nothing). Never throws.
 *
 * @param {string} repoRoot
 * @returns {Record<string, string[]>}
 */
export function readCreditedRunsSync(repoRoot) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(creditedRunsPath(repoRoot), 'utf8'));
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out = {};
  for (const [id, arr] of Object.entries(parsed)) {
    if (Array.isArray(arr)) out[id] = arr.filter((x) => typeof x === 'string');
  }
  return out;
}

/** Persist the credited-runs record. Creates `.mmd/local/` if missing. */
export function writeCreditedRunsSync(repoRoot, record) {
  const p = creditedRunsPath(repoRoot);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(record, null, 2) + '\n', 'utf8');
  return p;
}

/**
 * Merge newly-credited run ids into the existing record (set union per lesson).
 * Pure; deterministic (sorted-by-insertion sets); never throws.
 *
 * @param {Record<string, string[]>} existing
 * @param {Record<string, string[]>} newlyCredited
 * @returns {Record<string, string[]>}
 */
export function mergeCredited(existing, newlyCredited) {
  const out = {};
  for (const [id, arr] of Object.entries(existing || {})) {
    out[id] = [...new Set((arr || []).filter((x) => typeof x === 'string'))];
  }
  for (const [id, arr] of Object.entries(newlyCredited || {})) {
    const set = new Set(out[id] || []);
    for (const r of arr || []) if (typeof r === 'string') set.add(r);
    out[id] = [...set];
  }
  return out;
}
