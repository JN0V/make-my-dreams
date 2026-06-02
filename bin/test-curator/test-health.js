#!/usr/bin/env node
// bin/test-curator/test-health.js — `mmd test-health` entry point (SPEC_V076
// AC-3). The Test Curator's corpus-health subcommand: gather the git-tracked
// test files, scan them, build a test-health report, and write EXACTLY ONE file
// — docs/test-health.md — then print a short summary.
//
// SRP (universal.md §I.S): orchestrate the gather → scan → build → write flow
// only. The judgment (scan.js) and the render (report.js) are pure and live in
// lib/test-curator/; this file is a thin coordinator that wires the real fs +
// git, mirroring bin/documentalist/document-review.js (the Test Curator is the
// test analog of the Documentalist).
//
// READ-ONLY CONTRACT (SPEC §4, the safety heart): this command writes EXACTLY
// docs/test-health.md and NOTHING else. It NEVER edits, moves, or deletes a
// test. An integration test asserts no other tracked path changes.
//
// Deterministic over LLM (ADR-040): no claude spawn. The value is a trustworthy,
// regenerable dashboard, not a fuzzy opinion.
//
// Exit codes (mirror the document-* family):
//   0  ok (report written, or printed under --dry-run)
//   2  user/argv error
//   3  cannot write the report file
//   5  cannot list git-tracked test files (not a git repo / git failed)

import { cwd as processCwd, stdout, stderr, env } from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

import { scanTestCorpus } from '../../lib/test-curator/scan.js';
import {
  buildTestHealthReport,
  DEFAULT_MAX_LINES,
  DEFAULT_MAX_TESTS,
  SMOKE_BAND_MIN,
  SMOKE_BAND_MAX,
} from '../../lib/test-curator/report.js';
import {
  nearDuplicatePairs,
  targetClusters,
  DEFAULT_SIMILARITY,
} from '../../lib/test-curator/redundancy.js';

const PKG_PATH = fileURLToPath(new URL('../../package.json', import.meta.url));
let VERSION = '0.0.0';
try {
  VERSION = JSON.parse(readFileSync(PKG_PATH, 'utf8')).version;
} catch {
  // package.json unreadable — version stays a placeholder, never crashes.
}

// The ONE file this command writes. Repo-root-relative.
export const REPORT_REL_PATH = path.join('docs', 'test-health.md');

const USAGE = `mmd test-health — the Test Curator's test-corpus health review (SPEC_V076)

Usage:
  mmd test-health [--dry-run]
  mmd test-health --help

Behavior:
  Gathers the git-tracked test files (*.test.js, excluding test/fixtures/ — those
  are inputs to the discover tests, not MMD's own corpus), scans them for the
  stratification tag in each test title (@smoke/@unit/@integration/@e2e), and
  writes a regenerable test-health report to ${REPORT_REL_PATH}. Prints a summary.

  The report surfaces: the stratification distribution, the UNTAGGED tests (a
  testing.md §V violation) with file:line, a smoke-subset health line, and the
  OVERSIZED test files (split candidates). It is the test analog of
  'mmd document-review' — detect-and-report only, a clearly-labelled HEURISTIC.

  READ-ONLY beyond that one file: it NEVER edits, moves, or deletes a test. The
  report is a dashboard — regenerate it after material test changes; do not
  hand-edit it. Deterministic (no LLM).

Flags:
  --dry-run      Print the report to stdout; write nothing.
  --help, -h     Print this usage and exit 0.

Environment:
  MMD_TEST_FILE_MAX_LINES   Oversized-file line threshold (default ${DEFAULT_MAX_LINES}).
  MMD_TEST_FILE_MAX_TESTS   Oversized-file test-count threshold (default ${DEFAULT_MAX_TESTS}).
  MMD_TEST_DUP_SIMILARITY   Near-duplicate similarity threshold in (0,1] (default ${DEFAULT_SIMILARITY}).
  (A junk / out-of-range value falls back to the default with an honest note.)

Exit codes:
  0  ok (written, or printed under --dry-run)
  2  user/argv error
  3  cannot write ${REPORT_REL_PATH}
  5  cannot list git-tracked test files (not a git repo / git failed)

mmd ${VERSION}
`;

/**
 * Parse the few test-health flags. Mirrors the document-* contract: boolean
 * flags only, unknown flag → exit 2, no positionals.
 *
 * @param {string[]} rawArgs
 * @returns {{ dryRun: boolean, help: boolean, error: { message: string, exitCode: number }|null }}
 */
export function parseTestHealthArgs(rawArgs) {
  const out = { dryRun: false, help: false, error: null };
  if (!Array.isArray(rawArgs)) {
    out.error = { message: 'parseTestHealthArgs: rawArgs must be an array', exitCode: 2 };
    return out;
  }
  for (const tok of rawArgs) {
    if (tok === '--dry-run') out.dryRun = true;
    else if (tok === '--help' || tok === '-h') out.help = true;
    else {
      out.error = {
        message: `unknown test-health arg: '${tok}'. Run 'mmd test-health --help' to see supported flags.`,
        exitCode: 2,
      };
      return out;
    }
  }
  return out;
}

/**
 * Resolve an env-overridable threshold: a positive integer override wins, else
 * the default. Returns the resolved value + whether a junk override was ignored
 * (so the caller can log an honest fallback note — never silently swallow it).
 *
 * @param {string|undefined} raw
 * @param {number} fallback
 * @returns {{ value: number, ignored: boolean }}
 */
export function resolveThreshold(raw, fallback) {
  if (raw == null || raw === '') return { value: fallback, ignored: false };
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return { value: Math.floor(n), ignored: false };
  return { value: fallback, ignored: true };
}

/**
 * Resolve the near-duplicate similarity override: a number in (0, 1] wins, else
 * the default. Same honest-fallback contract as resolveThreshold but for a
 * fractional ratio (not a positive integer).
 *
 * @param {string|undefined} raw
 * @param {number} fallback
 * @returns {{ value: number, ignored: boolean }}
 */
export function resolveSimilarity(raw, fallback) {
  if (raw == null || raw === '') return { value: fallback, ignored: false };
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0 && n <= 1) return { value: n, ignored: false };
  return { value: fallback, ignored: true };
}

/**
 * Gather the git-tracked test files as {path, content} pairs, excluding the
 * discover fixtures (test/fixtures/ — those are inputs to other tests, not
 * MMD's own corpus). Returns null on a git failure (not a repo), so the caller
 * can exit honestly (never a fabricated empty corpus).
 *
 * @param {string} root
 * @returns {Array<{ path: string, content: string|null }>|null}
 */
function gatherTrackedTestFiles(root) {
  let listed;
  try {
    listed = execFileSync('git', ['ls-files', '*.test.js'], {
      cwd: root, encoding: 'utf8', timeout: 20000,
    });
  } catch {
    return null; // not a git repo / git failed
  }
  const rels = listed
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((p) => !p.includes('test/fixtures/'))
    .sort(); // deterministic order
  return rels.map((rel) => {
    let content = null;
    try {
      content = readFileSync(path.join(root, rel), 'utf8');
    } catch {
      content = null; // unreadable → scan records a zero-metric file (honest)
    }
    return { path: rel, content };
  });
}

/**
 * Assemble the final report file: the generated-by banner + title + version
 * line, then the pure report body. Keeps report.js free of version/date so it
 * stays deterministic and I/O-free.
 *
 * @param {string} body  buildTestHealthReport output
 * @returns {string}
 */
function wrapReport(body) {
  return [
    '<!-- GENERATED by `mmd test-health` — regenerate after material test changes; do NOT hand-edit. -->',
    '# MMD Test Health',
    '',
    `_MMD ${VERSION} · generated by \`mmd test-health\` — the Test Curator (detect-and-report only)._`,
    '',
    body,
  ].join('\n');
}

/**
 * Entry point invoked by bin/mmd.js when argv[0] === 'test-health'.
 *
 * @param {string[]} rawArgs everything AFTER 'test-health'
 * @returns {Promise<number>} exit code
 */
export async function runTestHealth(rawArgs) {
  const parsed = parseTestHealthArgs(rawArgs);
  if (parsed.help) {
    stdout.write(USAGE);
    return 0;
  }
  if (parsed.error) {
    stderr.write(`error: ${parsed.error.message}\n`);
    stderr.write(USAGE);
    return parsed.error.exitCode;
  }

  const root = processCwd();

  // Resolve env-overridable thresholds with graceful, HONEST fallback.
  const ml = resolveThreshold(env.MMD_TEST_FILE_MAX_LINES, DEFAULT_MAX_LINES);
  const mt = resolveThreshold(env.MMD_TEST_FILE_MAX_TESTS, DEFAULT_MAX_TESTS);
  const ds = resolveSimilarity(env.MMD_TEST_DUP_SIMILARITY, DEFAULT_SIMILARITY);
  if (ml.ignored) {
    stderr.write(`note: MMD_TEST_FILE_MAX_LINES='${env.MMD_TEST_FILE_MAX_LINES}' is not a positive integer — using default ${DEFAULT_MAX_LINES}.\n`);
  }
  if (mt.ignored) {
    stderr.write(`note: MMD_TEST_FILE_MAX_TESTS='${env.MMD_TEST_FILE_MAX_TESTS}' is not a positive integer — using default ${DEFAULT_MAX_TESTS}.\n`);
  }
  if (ds.ignored) {
    stderr.write(`note: MMD_TEST_DUP_SIMILARITY='${env.MMD_TEST_DUP_SIMILARITY}' is not a number in (0,1] — using default ${DEFAULT_SIMILARITY}.\n`);
  }

  const files = gatherTrackedTestFiles(root);
  if (files === null) {
    stderr.write(
      `error: cannot list git-tracked test files at ${root} (not a git repo, or git failed).\n` +
      '  mmd test-health scans the corpus via `git ls-files`; it needs a git repo.\n',
    );
    return 5;
  }

  const scan = scanTestCorpus(files);
  const body = buildTestHealthReport(scan, {
    maxLines: ml.value, maxTests: mt.value, dupSimilarity: ds.value,
  });
  const report = wrapReport(body);

  if (parsed.dryRun) {
    stdout.write(report);
    if (!report.endsWith('\n')) stdout.write('\n');
    return 0;
  }

  const reportPath = path.join(root, REPORT_REL_PATH);
  try {
    writeFileSync(reportPath, report, 'utf8');
  } catch (err) {
    stderr.write(`error: cannot write ${REPORT_REL_PATH}: ${err.message}\n`);
    return 3;
  }

  // Summary (honest counts from the scan).
  const { byTag } = scan.totals;
  const untagged = byTag.untagged || 0;
  const oversized = scan.files.filter((f) => f.lineCount > ml.value || f.testCount > mt.value).length;
  const smoke = byTag.smoke || 0;
  // Redundancy headline (bounded, deterministic — reuses the same pure functions
  // the report renders, so the summary can't drift from the file).
  const dupPairs = nearDuplicatePairs(scan.tests, { threshold: ds.value }).length;
  const clusters = targetClusters(scan.tests);
  const topCluster = clusters[0]
    ? `${clusters[0].module} (${clusters[0].testCount} tests across ${clusters[0].fileCount} files)`
    : 'none';
  // Reuse the SAME band as the written report (Phase-4 F4 — single source).
  const smokeNote = smoke === 0
    ? 'none'
    : (smoke < SMOKE_BAND_MIN ? 'looks thin'
      : (smoke <= SMOKE_BAND_MAX ? 'within §V band' : 'above §V band'));
  stdout.write(
    `Test-health report written to ${REPORT_REL_PATH}\n` +
    `  Corpus: ${scan.totals.testCount} tests across ${scan.totals.fileCount} files (git-tracked, fixtures excluded; heuristic).\n` +
    `  Stratification: ${byTag.unit} unit · ${byTag.integration} integration · ${smoke} smoke · ${byTag.e2e} e2e · ${untagged} untagged.\n` +
    `  Smoke: ${smoke} test${smoke === 1 ? '' : 's'} — ${smokeNote} (advisory).\n` +
    `  Untagged: ${untagged} test${untagged === 1 ? '' : 's'}${untagged ? ' violate testing.md §V (listed in the report)' : ''}.\n` +
    `  Oversized: ${oversized} file${oversized === 1 ? '' : 's'} over the split thresholds (> ${ml.value} lines or > ${mt.value} tests).\n` +
    `  Redundancy: ${dupPairs} near-duplicate pair${dupPairs === 1 ? '' : 's'} (within-file, similarity ≥ ${ds.value}); most-tested module: ${topCluster}. Advisory — DETECT-BEFORE-CUT, nothing deleted.\n` +
    '  Read-only: nothing else in the repo was modified. Regenerate after material test changes.\n',
  );
  return 0;
}
