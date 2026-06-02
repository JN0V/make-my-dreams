// lib/test-curator/redundancy.js — the Test Curator's PURE redundancy detector
// (SPEC_V077 AC-2). The second face of `mmd test-health`: find tests that likely
// OVERLAP, so the corpus can be pruned.
//
// SRP (universal.md §I.S): pure decisions about structural similarity + target
// clustering. No I/O, no rendering (that is report.js), no gathering (the bin).
// Pure, deterministic, never throws — junk in → empty out (ai-coding §I).
//
// Method (ADR-041): **clustering by target + structural similarity**, explicitly
// NOT coverage. Coverage-based redundancy needs an instrumented run — slow,
// non-deterministic, and it would break the pure/read-only contract; a coverage
// mode stays a deferred opt-in. Structural similarity (token-shingle Jaccard over
// the test body) is exactly computable from source text, deterministic, fast.
//
// DETECT-BEFORE-CUT (non-negotiable): these are CANDIDATES, never deletions. A
// similar-looking test may still document a distinct intent — the human decides.
//
// Bounded (no global quadratic blow-up): nearDuplicatePairs compares tests ONLY
// within the same file (the tightest scope; same file ⇒ same target cluster, so
// the within-cluster bound is automatically satisfied). The cross-file
// "most-tested module" view comes from targetClusters with zero pairwise work.

// Defaults, exported so the bin (which reads the env override) reuses the SAME
// number — single source of truth (DRY, universal §III).
export const DEFAULT_SIMILARITY = 0.9;

// k-gram shingle size over the token stream. 3 is the usual structural-similarity
// default: long enough that incidental single-token matches don't inflate Jaccard,
// short enough to catch near-identical bodies.
const SHINGLE_K = 3;

// Precision floor: a body with fewer than this many tokens is too trivial to
// judge as a meaningful duplicate (two empty stub bodies are not redundancy worth
// flagging). Skipping them avoids crying wolf (precision-first, no false alarms).
const MIN_TOKENS = 8;

/**
 * Coerce a similarity threshold to a number in (0, 1], else fall back. Mirrors
 * the bin's env validation so the pure function is robust standalone.
 * @param {*} v
 * @param {number} fallback
 * @returns {number}
 */
function similarityOr(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : fallback;
}

/**
 * Normalize a test body into a token stream for structural comparison: strip
 * comments, then tokenize into identifier/number tokens and single-char symbol
 * tokens (whitespace is implicitly dropped). Deterministic, never throws.
 *
 * @param {string} body
 * @returns {string[]} token list
 */
export function tokenizeBody(body) {
  if (typeof body !== 'string' || body.length === 0) return [];
  // Strip block then line comments (order matters: do block first).
  const noComments = body
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
  // Identifiers/keywords/numbers as whole tokens; every other non-space char as
  // its own symbol token. This captures STRUCTURE (call shape, operators) while
  // ignoring whitespace differences.
  const matches = noComments.match(/[A-Za-z_$][A-Za-z0-9_$]*|\d+|[^\s\w$]/g);
  return matches || [];
}

/**
 * Build the set of k-gram shingles (joined token windows) for a token list.
 * Fewer than k tokens → a single shingle of the whole list (so short-but-equal
 * bodies still compare). Deterministic.
 *
 * @param {string[]} tokens
 * @param {number} [k]
 * @returns {Set<string>}
 */
function shingles(tokens, k = SHINGLE_K) {
  const set = new Set();
  if (tokens.length === 0) return set;
  if (tokens.length < k) {
    set.add(tokens.join(''));
    return set;
  }
  for (let i = 0; i + k <= tokens.length; i += 1) {
    set.add(tokens.slice(i, i + k).join(''));
  }
  return set;
}

/**
 * Jaccard similarity of two shingle sets: |A∩B| / |A∪B|. Two empty sets → 0
 * (we never report a "match" between two bodies that produced no shingles).
 * @param {Set<string>} a
 * @param {Set<string>} b
 * @returns {number} in [0, 1]
 */
function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const s of small) if (large.has(s)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Round a similarity to 2 decimals for stable, readable reporting.
 * @param {number} n
 * @returns {number}
 */
function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Find near-duplicate test pairs by structural similarity, BOUNDED to within the
 * same file. PURE, deterministic, never throws.
 *
 * @param {Array<{ title?: string, file?: string, line?: number, body?: string }>} tests
 * @param {{ threshold?: number }} [opts]
 * @returns {Array<{ a: {file,line,title}, b: {file,line,title}, similarity: number }>}
 *   sorted by similarity desc, then by location for stable output.
 */
export function nearDuplicatePairs(tests, opts = {}) {
  const threshold = similarityOr(opts && opts.threshold, DEFAULT_SIMILARITY);
  if (!Array.isArray(tests) || tests.length === 0) return [];

  // Group tests by file (the bound). Precompute each test's shingle set once.
  const byFile = new Map();
  for (const t of tests) {
    if (!t || typeof t !== 'object') continue;
    const file = String(t.file == null ? '' : t.file);
    const tokens = tokenizeBody(typeof t.body === 'string' ? t.body : '');
    if (tokens.length < MIN_TOKENS) continue; // precision floor — skip trivial bodies
    const entry = {
      file,
      line: Number.isFinite(t.line) ? t.line : 0,
      title: String(t.title == null ? '' : t.title),
      sh: shingles(tokens),
    };
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push(entry);
  }

  const pairs = [];
  // Deterministic file order.
  for (const file of [...byFile.keys()].sort()) {
    const group = byFile.get(file);
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const sim = jaccard(group[i].sh, group[j].sh);
        if (sim >= threshold) {
          // Order the two locations by line for stable output.
          const [a, b] = group[i].line <= group[j].line
            ? [group[i], group[j]] : [group[j], group[i]];
          pairs.push({
            a: { file: a.file, line: a.line, title: a.title },
            b: { file: b.file, line: b.line, title: b.title },
            similarity: round2(sim),
          });
        }
      }
    }
  }

  // Sort by similarity desc, then by file/line for determinism.
  pairs.sort((x, y) =>
    (y.similarity - x.similarity) ||
    String(x.a.file).localeCompare(String(y.a.file)) ||
    (x.a.line - y.a.line) ||
    (x.b.line - y.b.line));
  return pairs;
}

/**
 * Group test files by the lib/bin module(s) they import (their targets) and
 * report each cluster's test-file count and total test count. The cross-file
 * "are we over-testing this module?" view — surfaces OVER-TEST candidates with
 * zero pairwise comparison. PURE, deterministic, never throws.
 *
 * @param {Array<{ file?: string, targets?: string[] }>} tests
 * @returns {Array<{ module: string, fileCount: number, testCount: number }>}
 *   sorted by testCount desc, then fileCount desc, then module asc.
 */
export function targetClusters(tests) {
  if (!Array.isArray(tests) || tests.length === 0) return [];
  // module → { files: Set<file>, testCount }
  const clusters = new Map();
  for (const t of tests) {
    if (!t || typeof t !== 'object') continue;
    const file = String(t.file == null ? '' : t.file);
    const targets = Array.isArray(t.targets) ? t.targets : [];
    for (const mod of targets) {
      const key = String(mod);
      if (!clusters.has(key)) clusters.set(key, { files: new Set(), testCount: 0 });
      const c = clusters.get(key);
      c.files.add(file);
      c.testCount += 1;
    }
  }
  const out = [];
  for (const [module, c] of clusters) {
    out.push({ module, fileCount: c.files.size, testCount: c.testCount });
  }
  out.sort((a, b) =>
    (b.testCount - a.testCount) ||
    (b.fileCount - a.fileCount) ||
    String(a.module).localeCompare(String(b.module)));
  return out;
}

/**
 * Drop a test's `targets` that don't resolve to a REAL repo file — the
 * extractor's import/require regex also matches *fixture strings* inside a test
 * body (e.g. an import-graph test that builds a fake `lib/a.js` as data), which
 * would otherwise pollute the "most-tested modules" cluster table with phantom
 * modules (`lib/a.js`, `lib/x.js`, …). PURE: the real-file check is INJECTED
 * (`isRealTarget`), so this stays fs-free and unit-testable; the subcommand
 * passes `existsSync`. Returns new test objects (no mutation). A missing/odd
 * predicate → keep all (back-compat).
 *
 * @param {Array<{targets?: string[]}>} tests
 * @param {(module: string) => boolean} isRealTarget
 * @returns {Array<object>}
 */
export function keepRealTargets(tests, isRealTarget) {
  if (!Array.isArray(tests)) return [];
  if (typeof isRealTarget !== 'function') return tests;
  return tests.map((t) => {
    if (!t || typeof t !== 'object' || !Array.isArray(t.targets)) return t;
    return { ...t, targets: t.targets.filter((m) => isRealTarget(String(m))) };
  });
}
