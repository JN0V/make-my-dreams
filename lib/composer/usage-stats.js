// lib/composer/usage-stats.js — aggregate composer audit trails into stats.
//
// SPEC_V02E AC-6 + AC-7: shared logic for `mmd lessons` (per-lesson injection
// counts) and `scripts/audit-pillars.sh --with-composer` (per-slice rollup).
//
// Reads every `*.composer.json` under `.mmd/local/<*>-runs/` (the layout that
// invoke-autodev + invoke-claude both write to). Pure with respect to the
// filesystem snapshot — no caching, no mutation.

import { readdir, readFile } from 'node:fs/promises';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { readRunStateForComposerSync } from '../autolearn/run-outcome.js';
import { validatedReuses } from '../autolearn/validated-reuse.js';

const MMD_LOCAL = path.join('.mmd', 'local');

/**
 * Find every `*.composer.json` file under the project's `.mmd/local/` tree.
 * Returns absolute paths sorted lexicographically (deterministic).
 *
 * Tolerates missing `.mmd/local/` (returns []).
 *
 * @param {string} repoRoot
 * @returns {Promise<string[]>}
 */
export async function findComposerAudits(repoRoot) {
  const root = path.join(repoRoot, MMD_LOCAL);
  if (!existsSync(root)) return [];
  const results = [];
  await walk(root, results);
  return results.sort();
}

export function findComposerAuditsSync(repoRoot) {
  const root = path.join(repoRoot, MMD_LOCAL);
  if (!existsSync(root)) return [];
  const results = [];
  walkSync(root, results);
  return results.sort();
}

async function walk(dir, out) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.composer.json')) {
      out.push(full);
    }
  }
}

function walkSync(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSync(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.composer.json')) {
      out.push(full);
    }
  }
}

/**
 * Parse every composer.json under repoRoot/.mmd/local/ and aggregate:
 *   - totalRuns: how many composer.json files (one per claude -p invocation)
 *   - autoInjectedRuns: runs where at least one lesson was injected
 *   - avgInjectedPerRun: number (totalInjected / totalRuns)
 *   - perLessonCount: Map<lessonId, count>
 *   - top: [{ id, count }, ...] sorted desc by count
 *
 * Malformed audits are skipped silently — observability files are best-effort.
 *
 * @param {string} repoRoot
 * @returns {Promise<{
 *   totalRuns: number,
 *   autoInjectedRuns: number,
 *   totalInjections: number,
 *   avgInjectedPerRun: number,
 *   perLessonCount: Record<string, number>,
 *   top: Array<{ id: string, count: number }>,
 * }>}
 */
export async function aggregateComposerUsage(repoRoot) {
  const audits = await findComposerAudits(repoRoot);
  return aggregateFiles(audits, (p) => readFile(p, 'utf8'));
}

export function aggregateComposerUsageSync(repoRoot) {
  const audits = findComposerAuditsSync(repoRoot);
  let totalRuns = 0;
  let autoInjectedRuns = 0;
  let totalInjections = 0;
  const perLessonCount = {};
  for (const auditPath of audits) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(auditPath, 'utf8'));
    } catch {
      continue;
    }
    totalRuns++;
    const matched = Array.isArray(parsed.matched) ? parsed.matched : [];
    if (matched.length > 0) autoInjectedRuns++;
    totalInjections += matched.length;
    for (const lesson of matched) {
      if (lesson && typeof lesson.id === 'string') {
        perLessonCount[lesson.id] = (perLessonCount[lesson.id] || 0) + 1;
      }
    }
  }
  const top = Object.entries(perLessonCount)
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.id.localeCompare(b.id, 'en')));
  return {
    totalRuns,
    autoInjectedRuns,
    totalInjections,
    avgInjectedPerRun: totalRuns > 0 ? totalInjections / totalRuns : 0,
    perLessonCount,
    top,
  };
}

/**
 * Build the per-run records `validatedReuses` consumes, by joining each
 * composer.json audit (which lessons were injected) with its sibling
 * outcome.json (the run's final state). SPEC_V090 AC-2 — this is where the
 * "injection ↔ outcome" correlation is read; the validated-reuse count is then
 * a pure function of these records.
 *
 * runId precedence: the audit's own `run_id` (stamped since v0.9.0) → legacy
 * `runId` → the file basename (so older audits still correlate by co-located
 * filename). A composer.json with no recorded outcome → `state: null`
 * (missing-state → contributes 0 validated reuses, honestly).
 *
 * @param {string} repoRoot
 * @returns {Array<{ runId: string, injectedLessonIds: string[], state: string|null }>}
 */
export function buildRunRecordsSync(repoRoot) {
  const audits = findComposerAuditsSync(repoRoot);
  return recordsFromAuditPaths(audits, (p) => readFileSync(p, 'utf8'));
}

export async function buildRunRecords(repoRoot) {
  const audits = await findComposerAudits(repoRoot);
  // Outcome reads are cheap sync reads (one small JSON per run); keep the join
  // in the shared sync helper rather than duplicating it.
  return recordsFromAuditPaths(audits, (p) => readFileSync(p, 'utf8'));
}

/**
 * Aggregate the per-lesson validated-reuse counts for a repo. Convenience
 * wrapper: buildRunRecordsSync → validatedReuses. Returns a Map keyed by lesson
 * id → { count, runIds }.
 *
 * @param {string} repoRoot
 * @returns {Map<string, { count: number, runIds: string[] }>}
 */
export function aggregateValidatedReusesSync(repoRoot) {
  return validatedReuses(buildRunRecordsSync(repoRoot));
}

function recordsFromAuditPaths(audits, readRaw) {
  const records = [];
  for (const auditPath of audits) {
    let parsed;
    try {
      parsed = JSON.parse(readRaw(auditPath));
    } catch {
      continue;
    }
    const runId =
      (typeof parsed.run_id === 'string' && parsed.run_id) ||
      (typeof parsed.runId === 'string' && parsed.runId) ||
      path.basename(auditPath).replace(/\.composer\.json$/, '');
    const matched = Array.isArray(parsed.matched) ? parsed.matched : [];
    const injectedLessonIds = matched
      .filter((m) => m && typeof m.id === 'string')
      .map((m) => m.id);
    const state = readRunStateForComposerSync(auditPath);
    records.push({ runId, injectedLessonIds, state });
  }
  return records;
}

async function aggregateFiles(audits, readFn) {
  let totalRuns = 0;
  let autoInjectedRuns = 0;
  let totalInjections = 0;
  const perLessonCount = {};
  for (const auditPath of audits) {
    let raw;
    try {
      raw = await readFn(auditPath);
    } catch {
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    totalRuns++;
    const matched = Array.isArray(parsed.matched) ? parsed.matched : [];
    if (matched.length > 0) autoInjectedRuns++;
    totalInjections += matched.length;
    for (const lesson of matched) {
      if (lesson && typeof lesson.id === 'string') {
        perLessonCount[lesson.id] = (perLessonCount[lesson.id] || 0) + 1;
      }
    }
  }
  const top = Object.entries(perLessonCount)
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.id.localeCompare(b.id, 'en')));
  return {
    totalRuns,
    autoInjectedRuns,
    totalInjections,
    avgInjectedPerRun: totalRuns > 0 ? totalInjections / totalRuns : 0,
    perLessonCount,
    top,
  };
}
