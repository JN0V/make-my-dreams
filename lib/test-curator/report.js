// lib/test-curator/report.js — the Test Curator's PURE, LANGUAGE-NEUTRAL report
// builder (SPEC_V076 AC-2, made polyglot in SPEC_V080 AC-3).
//
// SRP (universal.md §I.S): turn a NORMALIZED corpus (adapter output: entries with
// {file,line,title,stratum,body,targets} + per-file metrics + the analyzed
// stacks' capability flags) into the markdown of docs/test-health.md. Pure: no
// I/O, no gathering, no language syntax. Same inputs → same bytes (deterministic).
// Never throws — junk corpus → an honest minimal report, never a crash.
//
// §VIII (technology-agnostic): this core knows NOTHING about any language. It
// never references `test(`/`it(`, `@`-tags, `import`/`require`, or any other
// syntax — those live in the adapters. The `stratum` VALUE comes from the
// adapter (JS from `@`-tags, Python from pytest markers, …); the core only
// COUNTS strata. When an adapter declares a capability false, the core renders an
// HONEST "not available for the <stack> adapter" note rather than a silent empty
// that would read as "clean" (§VI).
//
// Human-readable first (universal §VII): the report leads with prose a newcomer
// understands and labels every figure as an ADVISORY HEURISTIC, not an audit.

import { nearDuplicatePairs, targetClusters, DEFAULT_SIMILARITY } from './redundancy.js';

// Default split thresholds. Exported so the bin (which reads the env overrides)
// reuses the SAME numbers — single source of truth (DRY, universal §III).
export const DEFAULT_MAX_LINES = 500;
export const DEFAULT_MAX_TESTS = 60;

// The testing.md §V fast-feedback band for @smoke (5–10 critical-path tests).
// Exported so the bin's stdout summary reuses the SAME band (universal §III DRY).
export const SMOKE_BAND_MIN = 5;
export const SMOKE_BAND_MAX = 10;

// The four canonical strata the report tabulates. These are a shared VOCABULARY
// (a stratum value), not a language syntax — each adapter maps its own convention
// onto them (or onto null). Naming the four is not a JS assumption.
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
 * @param {*} v
 * @param {number} fallback
 * @returns {number}
 */
function thresholdOr(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Coerce a similarity threshold to a number in (0, 1], else fall back.
 * @param {*} v
 * @param {number} fallback
 * @returns {number}
 */
function similarityOr(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : fallback;
}

/**
 * Normalize the `stacks` capability list into a clean array of
 * {displayName, supportsBodies, supportsStratification, supportsCoverage}. A
 * missing/odd value → []. The names of stacks LACKING a given capability are
 * what drive the honest "not available" notes.
 * @param {*} stacks
 * @returns {Array<{displayName:string, supportsBodies:boolean, supportsStratification:boolean, supportsCoverage:boolean}>}
 */
function normStacks(stacks) {
  if (!Array.isArray(stacks)) return [];
  return stacks
    .filter((s) => s && typeof s === 'object')
    .map((s) => ({
      displayName: String(s.displayName == null ? '' : s.displayName),
      supportsBodies: s.supportsBodies === true,
      supportsStratification: s.supportsStratification === true,
      supportsCoverage: s.supportsCoverage === true,
      stratumConventionLabel: typeof s.stratumConventionLabel === 'string' ? s.stratumConventionLabel : '',
    }));
}

// The core's stratification BASELINE is MMD's own testing.md §V convention (the
// `@`-tag in a test title) — that is the standard the report's "untagged is a
// §V violation" framing assumes, and it is an MMD project convention, not a
// language syntax. An adapter whose stratification convention is DIFFERENT (e.g.
// Python's pytest markers) advertises a label that does NOT mention §V; for those
// stacks we render an honest stack-appropriate note rather than cite §V / `@`-tags
// (F2 — §VIII: no language assumption leaks into the core's advice prose).
const SV_CONVENTION_MARKER = 'testing.md §V';

/**
 * Analyzed stratifying stacks whose convention is NOT MMD's testing.md §V `@`-tag
 * convention — i.e. those for which the "§V violation / tag with @…" advice would
 * be wrong. Returns [{displayName, stratumConventionLabel}], sorted by name.
 * Empty for a JS-only run (so the JS report is byte-unchanged — AC-2).
 */
function altConventionStacks(stacks) {
  return stacks
    .filter((s) => s.supportsStratification && s.stratumConventionLabel
      && !s.stratumConventionLabel.includes(SV_CONVENTION_MARKER))
    .map((s) => ({ displayName: s.displayName, label: s.stratumConventionLabel }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** Display names of stacks lacking a capability (sorted-unique), for honest notes. */
function lacking(stacks, cap) {
  const names = new Set();
  for (const s of stacks) if (!s[cap]) names.add(s.displayName);
  return [...names].filter(Boolean).sort();
}

/** Human "A", "A and B", "A, B and C" join for a name list. */
function humanList(names) {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
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
 * Render the "Redundancy candidates" section: near-duplicate test pairs +
 * the most-tested modules (over-test candidates). Capability-aware (§VI): when an
 * analyzed stack can't extract bodies, near-duplicate detection is HONESTLY
 * marked unavailable for it rather than rendered as a silent "no duplicates".
 *
 * @param {Array} tests   normalized entries (carry body|null + targets|null)
 * @param {number} dupSimilarity  the resolved similarity threshold
 * @param {Array} stacks  normalized capability list
 * @returns {string[]} markdown lines
 */
function redundancySection(tests, dupSimilarity, stacks) {
  const lines = [];
  lines.push('## Redundancy candidates (advisory — DETECT-BEFORE-CUT)');
  lines.push('');
  lines.push('> **Heuristic, not an audit.** These are tests that *look* alike or that pile onto ' +
    'one module — worth a glance to see if the corpus can be pruned. A similar-looking test may ' +
    'still document a **distinct intent**, so nothing here is a deletion order: the Test Curator ' +
    'NEVER deletes a test — **the human decides**. Method: structural similarity (token-shingle ' +
    'Jaccard over each test body) + clustering by imported project target. NOT coverage ' +
    '(a coverage mode stays a deferred opt-in). Comparison is bounded to **within-file** (no ' +
    'global quadratic blow-up).');
  lines.push('');

  // ── Near-duplicate pairs ──────────────────────────────────────────────────
  const anyBodies = stacks.length === 0 ? true : stacks.some((s) => s.supportsBodies);
  const noBodyStacks = lacking(stacks, 'supportsBodies');
  lines.push(`### Near-duplicate test pairs (similarity ≥ ${dupSimilarity})`);
  lines.push('');
  if (!anyBodies) {
    // No analyzed stack can extract bodies → honest unavailable, NOT a "✅ none"
    // (which would read as "no duplicates" — a §VI silent-empty trap).
    lines.push(`ℹ️ **Not available for ${humanList(noBodyStacks) || 'the analyzed stack(s)'}.** ` +
      'This adapter has no test-body extractor yet, so body-similarity near-duplicate detection ' +
      'cannot run. Tests are still clustered + stratified below. Honest capability note (not "no duplicates").');
  } else {
    const pairs = nearDuplicatePairs(tests, { threshold: dupSimilarity });
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
    // Even when SOME stack supports bodies, name the ones that don't (mixed repo).
    if (noBodyStacks.length > 0) {
      lines.push('');
      lines.push(`_Note: near-duplicate (body-similarity) detection is **not available** for ` +
        `${humanList(noBodyStacks)} (no body extractor yet); those tests are clustered + stratified, ` +
        'just not compared for body similarity. Honest capability note._');
    }
  }
  lines.push('');

  // ── Most-tested modules (over-test candidates) ────────────────────────────
  const clusters = targetClusters(tests);
  lines.push('### Most-tested modules (over-test candidates)');
  lines.push('');
  if (clusters.length === 0) {
    lines.push('ℹ️ **No project targets detected** in the corpus (no clusters to report). ' +
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
 * @param {object} corpus  the NORMALIZED corpus:
 *   { tests: Array<{file,line,title,stratum,body,targets}>,
 *     files: Array<{path,lineCount,testCount,targets}>,
 *     stacks: Array<{displayName,supportsBodies,supportsStratification,supportsCoverage}> }
 * @param {{ maxLines?: number, maxTests?: number, dupSimilarity?: number }} [thresholds]
 * @returns {string} markdown
 */
export function buildTestHealthReport(corpus, thresholds = {}) {
  const maxLines = thresholdOr(thresholds && thresholds.maxLines, DEFAULT_MAX_LINES);
  const maxTests = thresholdOr(thresholds && thresholds.maxTests, DEFAULT_MAX_TESTS);
  const dupSimilarity = similarityOr(thresholds && thresholds.dupSimilarity, DEFAULT_SIMILARITY);

  const safe = corpus && typeof corpus === 'object' ? corpus : {};
  const tests = Array.isArray(safe.tests) ? safe.tests : [];
  const files = Array.isArray(safe.files) ? safe.files : [];
  const stacks = normStacks(safe.stacks);
  const testCount = tests.length;
  const fileCount = files.length;

  // Count strata from the normalized entries (stratum value, null = untagged) —
  // the core does this GENERICALLY; the stratum value came from the adapter.
  const byStratum = { smoke: 0, unit: 0, integration: 0, e2e: 0 };
  let untaggedCount = 0;
  for (const t of tests) {
    const s = t && typeof t.stratum === 'string' ? t.stratum : null;
    if (s && Object.prototype.hasOwnProperty.call(byStratum, s)) byStratum[s] += 1;
    else untaggedCount += 1;
  }

  const stackNames = stacks.map((s) => s.displayName).filter(Boolean);
  const stacksClause = stackNames.length
    ? ` (analyzed stack${stackNames.length === 1 ? '' : 's'}: ${humanList(stackNames)})`
    : '';
  const noStratStacks = lacking(stacks, 'supportsStratification');
  const altStacks = altConventionStacks(stacks);
  // An honest, stack-appropriate clarifier rendered ONLY when a non-§V-convention
  // stack is analyzed (so a JS-only run is byte-unchanged — AC-2).
  const altNote = altStacks.length
    ? `_Note: ${humanList(altStacks.map((s) => `${s.displayName} stratifies via ${s.label}`))}. ` +
      'The "§V violation / `@`-tag" framing reflects MMD\'s testing.md §V (its JavaScript convention); ' +
      'for a stack with a different convention, "untagged" means no stratum marker was found — tag/mark ' +
      'it per that stack\'s own convention, not necessarily a §V rule violation. Honest capability note._'
    : '';

  const lines = [];

  // Intro — honest advisory framing (universal §VII / ai-coding §I).
  lines.push('> Generated on demand by `mmdream test-health` — the **Test Curator**: test-CORPUS health');
  lines.push('> over time (the test analog of the Documentalist, for tests not docs). It is **detect-and-');
  lines.push('> report only** — strictly read-only, it NEVER modifies a test. Every figure below is an');
  lines.push('> **advisory heuristic**, not an authoritative audit. Distinct from `mmdream qa` (per-change');
  lines.push('> review) and the BMAD TEA (test architecture). POLYGLOT via per-technology adapters');
  lines.push('> (§VIII) — the figures come from the adapter(s) matching the target stack. Regenerate');
  lines.push('> after material test changes.');
  lines.push('');

  if (fileCount === 0) {
    lines.push('## Corpus');
    lines.push('');
    lines.push(`**No tests found** across ${fileCount} scanned file${fileCount === 1 ? '' : 's'}${stacksClause}. ` +
      'Nothing to report (heuristic). If this is unexpected, check the file-gathering glob or the adapter selection.');
    lines.push('');
    lines.push(`_Thresholds: oversized if > ${maxLines} lines OR > ${maxTests} test calls (advisory)._`);
    lines.push('');
    return lines.join('\n');
  }

  // ── Corpus summary ────────────────────────────────────────────────────────
  lines.push('## Corpus');
  lines.push('');
  lines.push(`**${testCount} test${testCount === 1 ? '' : 's'}** across **${fileCount} file${fileCount === 1 ? '' : 's'}**${stacksClause} (heuristic; discovered by the matching adapter(s)).`);
  lines.push('');

  // ── Stratification distribution ─────────────────────────────────────────────
  lines.push('## Stratification distribution (testing.md §V)');
  lines.push('');
  lines.push('| Stratum | Count | Share |');
  lines.push('|---|---:|---:|');
  for (const s of STRATA) {
    const n = byStratum[s] || 0;
    const pct = testCount ? Math.round((n / testCount) * 100) : 0;
    lines.push(`| \`@${s}\` | ${n} | ${pct}% |`);
  }
  const untaggedPct = testCount ? Math.round((untaggedCount / testCount) * 100) : 0;
  lines.push(`| _untagged_ | ${untaggedCount} | ${untaggedPct}% |`);
  lines.push('');
  lines.push(smokeHealthLine(byStratum.smoke || 0));
  lines.push('');
  lines.push('_Counts reflect the stratification value each adapter derived for its tests across ALL ' +
    'scanned files — not which subset your test runner actually executes (e.g. a smoke script may run ' +
    'only one directory). Advisory._');
  if (noStratStacks.length > 0) {
    lines.push('');
    lines.push(`_Note: ${humanList(noStratStacks)} has no stratification convention this adapter reads, ` +
      'so its tests count as untagged here — that is **not** a §V violation for that stack. Honest capability note._');
  }
  if (altNote) {
    lines.push('');
    lines.push(altNote);
  }
  lines.push('');

  // ── Untagged tests (a testing.md §V violation) ──────────────────────────────
  lines.push('## Untagged tests (testing.md §V stratification violation)');
  lines.push('');
  const untaggedTests = tests.filter((t) => t && (typeof t.stratum !== 'string' || t.stratum === null));
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
    if (noStratStacks.length > 0) {
      lines.push('');
      lines.push(`_Some of these may come from ${humanList(noStratStacks)}, which has no stratification ` +
        'convention this adapter reads — for that stack, "untagged" is expected, not a violation. Honest note._');
    }
    if (altNote) {
      lines.push('');
      lines.push(altNote);
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

  // ── Redundancy candidates ───────────────────────────────────────────────────
  for (const l of redundancySection(tests, dupSimilarity, stacks)) lines.push(l);

  return lines.join('\n');
}
