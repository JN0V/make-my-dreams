#!/usr/bin/env node
// bin/test-curator/test-health.js — `mmd test-health` entry point (SPEC_V076
// AC-3, made POLYGLOT in SPEC_V080 AC-4). The Test Curator's corpus-health
// subcommand: detect the target's stack(s), resolve the matching adapter(s), run
// them, aggregate into the normalized corpus, build the report, and write EXACTLY
// docs/test-health.md — OR, when NO adapter matches the detected stack, REFUSE
// HONESTLY (§VIII): name the detected stack + the supported list, exit non-zero,
// write NO report, fabricate NO numbers.
//
// SRP (universal.md §I.S): orchestrate detect → resolve → discover → aggregate →
// build → write. The discovery (adapters/*) and the analysis (lib/test-curator/
// {redundancy,report}.js) are pure and language-neutral; this file wires the real
// fs + git. The §VIII gate (detect-and-refuse) is the heart of this slice — it is
// the rule that would have stopped the JS-only bug.
//
// READ-ONLY CONTRACT (SPEC §4): writes EXACTLY docs/test-health.md and NOTHING
// else; NEVER edits/moves/deletes a test. On an honest refusal it writes nothing.
//
// Deterministic over LLM (ADR-040): no claude spawn.
//
// Exit codes (mirror the document-* family + the new §VIII refusal):
//   0  ok (report written, or printed under --dry-run)
//   2  user/argv error
//   3  cannot write the report file
//   5  cannot list git-tracked files (not a git repo / git failed)
//   6  no Test Curator adapter for the detected stack (honest §VIII refusal)

import { cwd as processCwd, stdout, stderr, env } from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

import {
  resolveAdapters,
  detectStackNames,
  supportedStackNames,
  MANIFEST_STACKS,
} from '../../lib/test-curator/adapters/index.js';
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
  keepRealTargets,
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

const USAGE = `mmd test-health — the Test Curator's POLYGLOT test-corpus health review (SPEC_V080)

Usage:
  mmd test-health [--dry-run]
  mmd test-health --help

Behavior:
  Detects the target repo's stack(s) from its manifests (package.json → JavaScript,
  pyproject.toml/setup.py/requirements.txt → Python, …), runs every MATCHING Test
  Curator adapter, aggregates the discovered tests into a language-neutral corpus,
  and writes a regenerable test-health report to ${REPORT_REL_PATH}.

  The report surfaces: the stratification distribution, the UNTAGGED tests (a
  testing.md §V violation) with file:line, a smoke-subset health line, the
  OVERSIZED test files (split candidates), and redundancy candidates (near-
  duplicate pairs + most-tested modules). Capability-aware: an adapter that can't
  extract test bodies has its near-duplicate section marked honestly unavailable
  rather than silently empty.

  POLYGLOT (§VIII): a language-neutral core + per-technology adapters. When NO
  adapter matches the detected stack (e.g. a Rust-only repo today), it REFUSES
  honestly — naming the detected stack + the supported list, exit 6, NO report
  written, NO fabricated numbers. Running a JS scanner over a Rust repo would
  fabricate measurements; the gate stops that.

  READ-ONLY beyond that one file: it NEVER edits, moves, or deletes a test.
  Deterministic (no LLM).

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
  5  cannot list git-tracked files (not a git repo / git failed)
  6  no Test Curator adapter for the detected stack (honest §VIII refusal)

mmd ${VERSION}
`;

// The manifest files we probe for, to compute repo signals (manifest presence).
const KNOWN_MANIFESTS = Object.keys(MANIFEST_STACKS);

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
 * Resolve an env-overridable integer threshold: a positive integer override wins,
 * else the default. Returns the resolved value + whether a junk override was
 * ignored (so the caller can log an honest fallback note).
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
 * the default. Same honest-fallback contract as resolveThreshold.
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
 * Compute the repo's signals: which KNOWN manifest files are present at the root.
 * PURE-ish (existsSync only). The adapters' matches() consume {manifests}.
 *
 * @param {string} root
 * @returns {{ manifests: string[] }}
 */
export function detectSignals(root) {
  const manifests = KNOWN_MANIFESTS.filter((m) => {
    try {
      return existsSync(path.join(root, m));
    } catch {
      return false;
    }
  });
  return { manifests };
}

/**
 * List ALL git-tracked files as repo-relative paths (sorted, deterministic).
 * Returns null on a git failure (not a repo), so the caller can exit honestly.
 * The adapters filter this list to their OWN test files (language-specific glob).
 *
 * @param {string} root
 * @returns {string[]|null}
 */
function listTrackedFiles(root) {
  let listed;
  try {
    listed = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', timeout: 20000 });
  } catch {
    return null; // not a git repo / git failed
  }
  return listed.split('\n').map((s) => s.trim()).filter(Boolean).sort();
}

/**
 * Assemble the final report file: the generated-by banner + title + version
 * line, then the pure report body.
 *
 * @param {string} body  buildTestHealthReport output
 * @returns {string}
 */
function wrapReport(body) {
  return [
    '<!-- GENERATED by `mmd test-health` — regenerate after material test changes; do NOT hand-edit. -->',
    '# MMD Test Health',
    '',
    `_MMD ${VERSION} · generated by \`mmd test-health\` — the Test Curator (polyglot, detect-and-report only)._`,
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

  // Gather the tracked file list (the adapters filter it). Not a git repo → exit 5.
  const trackedFiles = listTrackedFiles(root);
  if (trackedFiles === null) {
    stderr.write(
      `error: cannot list git-tracked files at ${root} (not a git repo, or git failed).\n` +
      '  mmd test-health scans the corpus via `git ls-files`; it needs a git repo.\n',
    );
    return 5;
  }

  // ── §VIII gate: detect the stack(s), resolve adapters, or REFUSE honestly. ──
  const signals = detectSignals(root);
  const matched = resolveAdapters(signals);
  const detected = detectStackNames(signals);
  const supported = supportedStackNames();

  if (matched.length === 0) {
    // No adapter for the detected stack → honest refusal (§VIII / §VI). NO report
    // written, NO fabricated numbers. Running the wrong language's scanner here
    // would fabricate a measurement — exactly the bug this slice fixes.
    const detectedClause = detected.length
      ? `detected stack: ${detected.join(', ')}`
      : 'no recognized stack manifest found (looked for package.json, pyproject.toml, setup.py, requirements.txt, Cargo.toml, go.mod)';
    stderr.write(
      `error: no Test Curator adapter for the ${detected.length ? 'detected stack' : 'target repo'} — not analyzing.\n` +
      `  ${detectedClause}.\n` +
      `  Supported stacks: ${supported.join(', ')}.\n` +
      '  Refusing rather than running a stack-mismatched scanner that would fabricate numbers\n' +
      '  (constitution §VIII technology-agnostic analysis / §VI failure honesty). No report written.\n' +
      `  Adding a stack is a new adapter (lib/test-curator/adapters/), not a rewrite.\n`,
    );
    return 6;
  }

  // ── Run every matching adapter, aggregate into the normalized corpus. ──
  const readFile = (rel) => {
    try {
      return readFileSync(path.join(root, rel), 'utf8');
    } catch {
      return null; // unreadable → the adapter records a zero-metric file (honest)
    }
  };
  let tests = [];
  let files = [];
  const stacks = [];
  const analyzedNames = [];
  for (const adapter of matched) {
    let out;
    try {
      out = adapter.discoverTests({ repoRoot: root, files: trackedFiles, readFile });
    } catch (err) {
      // An adapter that throws must not crash the whole run (ai-coding §I) — name
      // it honestly and continue with the others.
      stderr.write(`note: the ${adapter.displayName} adapter failed during discovery (${err.message}); skipping it.\n`);
      continue;
    }
    const entries = out && Array.isArray(out.entries) ? out.entries : [];
    const fileMetrics = out && Array.isArray(out.files) ? out.files : [];
    tests = tests.concat(entries);
    files = files.concat(fileMetrics);
    stacks.push({
      id: adapter.id,
      displayName: adapter.displayName,
      supportsBodies: adapter.supportsBodies === true,
      supportsStratification: adapter.supportsStratification === true,
      supportsCoverage: adapter.supportsCoverage === true,
      stratumConventionLabel: typeof adapter.stratumConventionLabel === 'string' ? adapter.stratumConventionLabel : '',
    });
    analyzedNames.push(adapter.displayName);
  }

  // Precision: the JS target extractor's import/require regex also matches fixture
  // strings inside test bodies (e.g. an import-graph test that builds a fake
  // `lib/a.js` as data); the Python adapter emits both `mod.py` and
  // `mod/__init__.py` candidates. Keep only targets that resolve to a real file.
  tests = keepRealTargets(tests, (m) => existsSync(path.join(root, m)));

  const body = buildTestHealthReport({ tests, files, stacks }, {
    maxLines: ml.value, maxTests: mt.value, dupSimilarity: ds.value,
  });
  const report = wrapReport(body);

  // Honestly note any DETECTED-but-unsupported stacks (a mixed repo): we analyzed
  // the supported ones and are skipping the rest, named.
  const unsupported = detected.filter((d) => !analyzedNames.includes(d));

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

  // Summary (honest counts from the aggregated corpus).
  const byStratum = { smoke: 0, unit: 0, integration: 0, e2e: 0, untagged: 0 };
  for (const t of tests) {
    const s = t && typeof t.stratum === 'string' ? t.stratum : null;
    if (s && Object.prototype.hasOwnProperty.call(byStratum, s)) byStratum[s] += 1;
    else byStratum.untagged += 1;
  }
  const untagged = byStratum.untagged;
  const oversized = files.filter((f) => f.lineCount > ml.value || f.testCount > mt.value).length;
  const smoke = byStratum.smoke;
  const dupPairs = nearDuplicatePairs(tests, { threshold: ds.value }).length;
  const clusters = targetClusters(tests);
  const topCluster = clusters[0]
    ? `${clusters[0].module} (${clusters[0].testCount} tests across ${clusters[0].fileCount} files)`
    : 'none';
  const smokeNote = smoke === 0
    ? 'none'
    : (smoke < SMOKE_BAND_MIN ? 'looks thin'
      : (smoke <= SMOKE_BAND_MAX ? 'within §V band' : 'above §V band'));
  const anyBodies = stacks.some((s) => s.supportsBodies);
  stdout.write(
    `Test-health report written to ${REPORT_REL_PATH}\n` +
    `  Analyzed stack(s): ${analyzedNames.join(', ') || 'none'}.\n` +
    (unsupported.length
      ? `  Detected but UNSUPPORTED (no adapter yet, not analyzed): ${unsupported.join(', ')}. Supported: ${supported.join(', ')}.\n`
      : '') +
    `  Corpus: ${tests.length} tests across ${files.length} files (git-tracked; heuristic).\n` +
    `  Stratification: ${byStratum.unit} unit · ${byStratum.integration} integration · ${smoke} smoke · ${byStratum.e2e} e2e · ${untagged} untagged.\n` +
    `  Smoke: ${smoke} test${smoke === 1 ? '' : 's'} — ${smokeNote} (advisory).\n` +
    `  Untagged: ${untagged} test${untagged === 1 ? '' : 's'}${untagged ? ' violate testing.md §V (listed in the report)' : ''}.\n` +
    `  Oversized: ${oversized} file${oversized === 1 ? '' : 's'} over the split thresholds (> ${ml.value} lines or > ${mt.value} tests).\n` +
    (anyBodies
      ? `  Redundancy: ${dupPairs} near-duplicate pair${dupPairs === 1 ? '' : 's'} (within-file, similarity ≥ ${ds.value}); most-tested module: ${topCluster}. Advisory — DETECT-BEFORE-CUT, nothing deleted.\n`
      : `  Redundancy: near-duplicate (body-similarity) detection not available for the analyzed stack(s) (no body extractor yet); most-tested module: ${topCluster}. Advisory.\n`) +
    '  Read-only: nothing else in the repo was modified. Regenerate after material test changes.\n',
  );
  return 0;
}
