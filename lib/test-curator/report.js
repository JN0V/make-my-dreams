// lib/test-curator/report.js — the Test Curator's PURE report builder
// (SPEC_V076 AC-2).
//
// SRP (universal.md §I.S): turn a scan result (from scan.js) into the markdown
// of docs/test-health.md. Pure: no I/O, no gathering, no decisions about WHICH
// files to scan. Same inputs → same bytes (deterministic). Never throws — junk
// scan → an honest minimal report, never a crash (ai-coding §I).
//
// Human-readable first (universal §VII): the report leads with prose a newcomer
// understands and labels every figure as an ADVISORY HEURISTIC, not an audit.
// It is the test analog of docs/coherence-review.md — a regenerable dashboard
// for the tired maintainer at 2 a.m., not a parser artifact. Detect-and-report
// only: it names corpus-health smells; it never tells you they're bugs and
// never edits a test.

// Default split thresholds. Exported so the bin (which reads the env overrides)
// reuses the SAME numbers — single source of truth (DRY, universal §III).
export const DEFAULT_MAX_LINES = 500;
export const DEFAULT_MAX_TESTS = 60;

// The testing.md §V fast-feedback band for @smoke (5–10 critical-path tests).
// Below the floor → thin; within → usable; above → may have outgrown its budget.
// Exported so the bin's stdout summary reuses the SAME band as the written report
// (single source of truth — Phase-4 F4, universal §III DRY).
export const SMOKE_BAND_MIN = 5;
export const SMOKE_BAND_MAX = 10;

// AC-3 (v0.7.7): the redundancy face. report.js computes the candidates from the
// scan (bodies + targets attached by scan.js) via the pure redundancy module and
// renders them — keeping the bin a thin coordinator (it only injects the env
// threshold). DRY: the threshold default lives in redundancy.js.
import { nearDuplicatePairs, targetClusters, DEFAULT_SIMILARITY } from './redundancy.js';

const STRATA = ['smoke', 'unit', 'integration', 'e2e'];

// How many candidates to LIST before an honest "+N more" note (never a silent
// truncation — universal §VI). The full counts are always stated.
const MAX_PAIRS_LISTED = 30;
const MAX_CLUSTERS_LISTED = 15;

// Escape a markdown table cell — a literal pipe would break the column layout.
function cell(s) {
  return String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/**
 * Coerce a threshold to a positive integer, else fall back to the default.
 * Mirrors the bin's env validation so the pure function is robust on its own.
 * @param {*} v
 * @param {number} fallback
 * @returns {number}
 */
function thresholdOr(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Render the smoke-health line (count + an honest thin/usable heuristic against
 * the testing.md §V 5–10 fast-feedback band).
 * @param {number} smoke
 * @returns {string}
 */
function smokeHealthLine(smoke) {
  if (smoke === 0) {
    return `**Smoke health:** 0 \`@smoke\` tests — there is **no fast-feedback subset** ` +
      `(testing.md §V expects 5–10 critical-path tests). Advisory.`;
  }
  if (smoke < SMOKE_BAND_MIN) {
    return `**Smoke health:** ${smoke} \`@smoke\` test${smoke === 1 ? '' : 's'} — **looks THIN** ` +
      `for a fast-feedback subset (below the testing.md §V band of ${SMOKE_BAND_MIN}–${SMOKE_BAND_MAX}). Advisory heuristic.`;
  }
  if (smoke <= SMOKE_BAND_MAX) {
    return `**Smoke health:** ${smoke} \`@smoke\` tests — **within the testing.md §V fast-feedback band ` +
      `(${SMOKE_BAND_MIN}–${SMOKE_BAND_MAX})**; looks usable. Advisory heuristic.`;
  }
  return `**Smoke health:** ${smoke} \`@smoke\` tests — **above the §V band (${SMOKE_BAND_MIN}–${SMOKE_BAND_MAX})**; ` +
    `the fast-feedback subset may have grown beyond its budget (re-tag the slow ones). Advisory heuristic.`;
}

/**
 * Coerce a similarity threshold to a number in (0, 1], else fall back. Mirrors
 * the redundancy module's own validation so the report is robust standalone.
 * @param {*} v
 * @param {number} fallback
 * @returns {number}
 */
function similarityOr(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : fallback;
}

/**
 * Render the "Redundancy candidates" section: near-duplicate test pairs +
 * the most-tested modules (over-test candidates). DETECT-BEFORE-CUT framing —
 * advisory, never an instruction to delete. Pure.
 *
 * @param {Array} tests   scan.tests (carry body + targets)
 * @param {number} dupSimilarity  the resolved similarity threshold
 * @returns {string[]} markdown lines
 */
function redundancySection(tests, dupSimilarity) {
  const lines = [];
  lines.push('## Redundancy candidates (advisory — DETECT-BEFORE-CUT)');
  lines.push('');
  lines.push('> **Heuristic, not an audit.** These are tests that *look* alike or that pile onto ' +
    'one module — worth a glance to see if the corpus can be pruned. A similar-looking test may ' +
    'still document a **distinct intent**, so nothing here is a deletion order: the Test Curator ' +
    'NEVER deletes a test — **the human decides**. Method: structural similarity (token-shingle ' +
    'Jaccard over each test body) + clustering by imported `lib/`/`bin/` target. NOT coverage ' +
    '(a coverage mode stays a deferred opt-in). Comparison is bounded to **within-file** (no ' +
    'global quadratic blow-up).');
  lines.push('');

  // ── Near-duplicate pairs ──────────────────────────────────────────────────
  const pairs = nearDuplicatePairs(tests, { threshold: dupSimilarity });
  lines.push(`### Near-duplicate test pairs (similarity ≥ ${dupSimilarity})`);
  lines.push('');
  if (pairs.length === 0) {
    lines.push(`✅ **No near-duplicate test pairs** at or above ${dupSimilarity} similarity ` +
      '(within-file). Nothing flagged. Advisory heuristic.');
  } else {
    lines.push(`⚠️ **${pairs.length} near-duplicate pair${pairs.length === 1 ? '' : 's'}** ` +
      `(within-file, similarity ≥ ${dupSimilarity}). Each pair MAY be two tests of the same thing — ` +
      'review whether one is redundant (it may not be). Advisory:');
    lines.push('');
    const shown = pairs.slice(0, MAX_PAIRS_LISTED);
    for (const p of shown) {
      lines.push(`- \`${cell(p.a.file)}:${p.a.line}\` ↔ \`${cell(p.b.file)}:${p.b.line}\` ` +
        `— **${p.similarity}** similar`);
    }
    if (pairs.length > shown.length) {
      lines.push('');
      lines.push(`_…and ${pairs.length - shown.length} more pair(s) not listed (showing the top ${MAX_PAIRS_LISTED} by similarity). Honest cap, not a silent truncation._`);
    }
  }
  lines.push('');

  // ── Most-tested modules (over-test candidates) ────────────────────────────
  const clusters = targetClusters(tests);
  lines.push('### Most-tested modules (over-test candidates)');
  lines.push('');
  if (clusters.length === 0) {
    lines.push('ℹ️ **No `lib/`/`bin/` targets detected** in the corpus (no clusters to report). ' +
      'Advisory heuristic.');
  } else {
    lines.push('_The modules with the most tests pointing at them. A large cluster is not wrong ' +
      '(a critical module SHOULD be well-tested) — it is just where redundancy, if any, is most ' +
      'likely. Advisory:_');
    lines.push('');
    lines.push('| Target module | Tests | Files |');
    lines.push('|---|---:|---:|');
    const shown = clusters.slice(0, MAX_CLUSTERS_LISTED);
    for (const c of shown) {
      lines.push(`| \`${cell(c.module)}\` | ${c.testCount} | ${c.fileCount} |`);
    }
    if (clusters.length > shown.length) {
      lines.push('');
      lines.push(`_…and ${clusters.length - shown.length} more module(s) not listed (showing the top ${MAX_CLUSTERS_LISTED} by test count). Honest cap, not a silent truncation._`);
    }
  }
  lines.push('');

  return lines;
}

/**
 * Build the test-health report markdown. PURE, deterministic, never throws.
 *
 * @param {object} scan  output of scanTestCorpus
 * @param {{ maxLines?: number, maxTests?: number, dupSimilarity?: number }} [thresholds]
 * @returns {string} markdown
 */
export function buildTestHealthReport(scan, thresholds = {}) {
  const maxLines = thresholdOr(thresholds && thresholds.maxLines, DEFAULT_MAX_LINES);
  const maxTests = thresholdOr(thresholds && thresholds.maxTests, DEFAULT_MAX_TESTS);
  const dupSimilarity = similarityOr(thresholds && thresholds.dupSimilarity, DEFAULT_SIMILARITY);

  const safe = scan && typeof scan === 'object' ? scan : {};
  const tests = Array.isArray(safe.tests) ? safe.tests : [];
  const files = Array.isArray(safe.files) ? safe.files : [];
  const byTag = (safe.totals && safe.totals.byTag) || { smoke: 0, unit: 0, integration: 0, e2e: 0, untagged: 0 };
  const testCount = tests.length;
  const fileCount = files.length;

  const lines = [];

  // Intro — honest advisory framing (universal §VII / ai-coding §I).
  lines.push('> Generated on demand by `mmd test-health` — the **Test Curator**: test-CORPUS health');
  lines.push('> over time (the test analog of the Documentalist, for tests not docs). It is **detect-and-');
  lines.push('> report only** — strictly read-only, it NEVER modifies a test. Every figure below is an');
  lines.push('> **advisory heuristic**, not an authoritative audit. Distinct from `mmd qa` (per-change');
  lines.push('> review) and the BMAD TEA (test architecture). Regenerate after material test changes.');
  lines.push('');

  if (fileCount === 0) {
    lines.push('## Corpus');
    lines.push('');
    lines.push(`**No tests found** across ${fileCount} scanned file${fileCount === 1 ? '' : 's'}. ` +
      'Nothing to report (heuristic). If this is unexpected, check the file-gathering glob.');
    lines.push('');
    lines.push(`_Thresholds: oversized if > ${maxLines} lines OR > ${maxTests} test calls (advisory)._`);
    lines.push('');
    return lines.join('\n');
  }

  // ── Corpus summary ────────────────────────────────────────────────────────
  lines.push('## Corpus');
  lines.push('');
  lines.push(`**${testCount} test${testCount === 1 ? '' : 's'}** across **${fileCount} file${fileCount === 1 ? '' : 's'}** (heuristic count of \`test(\`/\`it(\` calls).`);
  lines.push('');

  // ── Stratification distribution ─────────────────────────────────────────────
  lines.push('## Stratification distribution (testing.md §V)');
  lines.push('');
  lines.push('| Stratum | Count | Share |');
  lines.push('|---|---:|---:|');
  for (const s of STRATA) {
    const n = byTag[s] || 0;
    const pct = testCount ? Math.round((n / testCount) * 100) : 0;
    lines.push(`| \`@${s}\` | ${n} | ${pct}% |`);
  }
  const untagged = byTag.untagged || 0;
  const untaggedPct = testCount ? Math.round((untagged / testCount) * 100) : 0;
  lines.push(`| _untagged_ | ${untagged} | ${untaggedPct}% |`);
  lines.push('');
  lines.push(smokeHealthLine(byTag.smoke || 0));
  lines.push('');
  lines.push('_Counts reflect the stratification tag present in each test title across ALL scanned ' +
    'files — not which subset your test runner actually executes (e.g. a smoke script may run only ' +
    'one directory). Advisory._');
  lines.push('');

  // ── Untagged tests (a testing.md §V violation) ──────────────────────────────
  lines.push('## Untagged tests (testing.md §V stratification violation)');
  lines.push('');
  const untaggedTests = tests.filter((t) => t && t.tag === 'untagged');
  if (untaggedTests.length === 0) {
    lines.push('✅ **No untagged tests** — every test carries a stratification tag (`@smoke`/`@unit`/`@integration`/`@e2e`). Good.');
  } else {
    lines.push(`⚠️ **${untaggedTests.length} untagged test${untaggedTests.length === 1 ? '' : 's'}** ` +
      '— each violates the testing.md §V rule that every test belongs to exactly one stratum. ' +
      'Tag them (`@smoke`/`@unit`/`@integration`/`@e2e`). Advisory:');
    lines.push('');
    for (const t of untaggedTests) {
      lines.push(`- \`${cell(t.file)}:${t.line}\` — ${cell(t.title)}`);
    }
  }
  lines.push('');

  // ── Oversized files (split candidates) ──────────────────────────────────────
  lines.push('## Oversized test files (split candidates)');
  lines.push('');
  lines.push(`_Threshold: > ${maxLines} lines OR > ${maxTests} test calls (advisory; override with \`MMD_TEST_FILE_MAX_LINES\` / \`MMD_TEST_FILE_MAX_TESTS\`)._`);
  lines.push('');
  const oversized = files
    .filter((f) => f && (f.lineCount > maxLines || f.testCount > maxTests))
    .sort((a, b) => (b.lineCount - a.lineCount) || (b.testCount - a.testCount) || String(a.path).localeCompare(String(b.path)));
  if (oversized.length === 0) {
    lines.push('✅ **No oversized files** — all scanned test files are within the thresholds. Good.');
  } else {
    lines.push('| File | Lines | Test calls | Over |');
    lines.push('|---|---:|---:|---|');
    for (const f of oversized) {
      const over = [];
      if (f.lineCount > maxLines) over.push('lines');
      if (f.testCount > maxTests) over.push('tests');
      lines.push(`| \`${cell(f.path)}\` | ${f.lineCount} | ${f.testCount} | ${over.join(' + ')} |`);
    }
    lines.push('');
    lines.push('_Split candidates — consider breaking each into focused sibling files. Advisory heuristic; large is not always wrong._');
  }
  lines.push('');

  // ── Redundancy candidates (v0.7.7) ──────────────────────────────────────────
  for (const l of redundancySection(tests, dupSimilarity)) lines.push(l);

  return lines.join('\n');
}
