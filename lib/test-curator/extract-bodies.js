// lib/test-curator/extract-bodies.js — the Test Curator's PURE body + target
// extractor (SPEC_V077 AC-1). Feeds the redundancy face: per-test BODY (for
// structural similarity) and per-file TARGETS (the lib/bin modules a test file
// imports, for clustering).
//
// SRP (universal.md §I.S): pure string extraction only — no I/O, no decisions
// about what is "redundant" (that is redundancy.js). Pure, deterministic, never
// throws — junk in → empty-ish out, never a crash (ai-coding §I honesty: an
// extractor that threw on one odd file would hide the whole corpus's signal).
//
// Both functions are deliberately HEURISTIC, not a real parser (KISS, the
// vanilla-stack / no-dep convention — L-024): a brace-depth scan that skips
// strings and comments is "robust enough" for an advisory corpus scanner.
// Documented residuals: an options-object argument (`test('x', {…}, fn)`) would
// have its object captured as the body; `${…}` interpolation braces inside a
// template literal are not counted (the whole template is skipped). Acceptable
// for an advisory heuristic; a real AST parser is not worth a permanent dep.

/**
 * Advance past a string literal starting at the opening quote `content[i]`.
 * Handles backslash escapes. For a template literal (backtick) the WHOLE span is
 * skipped, so any `{`/`}` (including `${…}` interpolation) inside it is ignored —
 * a deliberate heuristic simplification.
 *
 * @param {string} content
 * @param {number} i index of the opening quote
 * @param {string} quote the quote char
 * @returns {number} index just AFTER the closing quote (or content.length if unterminated)
 */
function skipString(content, i, quote) {
  const n = content.length;
  let j = i + 1;
  while (j < n) {
    const ch = content[j];
    if (ch === '\\') { j += 2; continue; }
    if (ch === quote) return j + 1;
    j += 1;
  }
  return j; // unterminated — best-effort
}

/**
 * Extract the body of a test callback: the code between the FIRST `{` at/after
 * `fromIndex` (skipping strings + comments so a brace inside the title literal
 * never opens the body) and its matching `}` (brace-depth scan, strings and
 * comments skipped throughout so braces inside them don't shift the depth).
 *
 * PURE, never throws. An unterminated body (no matching close) → best-effort:
 * everything from the opening brace to end-of-content. No opening brace found →
 * empty string.
 *
 * @param {string} content the full file source
 * @param {number} [fromIndex] where to start looking (e.g. the test-call offset)
 * @returns {string} the body text between the outer braces (exclusive)
 */
export function extractTestBody(content, fromIndex) {
  if (typeof content !== 'string' || content.length === 0) return '';
  const n = content.length;
  let i = Number.isInteger(fromIndex) && fromIndex > 0 ? fromIndex : 0;
  if (i >= n) return '';

  let depth = 0;
  let started = false;
  let bodyStart = -1;

  while (i < n) {
    const ch = content[i];
    const next = i + 1 < n ? content[i + 1] : '';

    // Line comment — skip to end of line.
    if (ch === '/' && next === '/') {
      while (i < n && content[i] !== '\n') i += 1;
      continue;
    }
    // Block comment — skip to closing */.
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < n && !(content[i] === '*' && content[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    // String / template literal — skip its whole span.
    if (ch === "'" || ch === '"' || ch === '`') {
      i = skipString(content, i, ch);
      continue;
    }
    if (ch === '{') {
      if (!started) { started = true; bodyStart = i + 1; }
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === '}') {
      if (started) {
        depth -= 1;
        if (depth === 0) return content.slice(bodyStart, i);
      }
      i += 1;
      continue;
    }
    i += 1;
  }

  // Unterminated — best-effort partial (honest: never throw, never fabricate).
  return bodyStart >= 0 ? content.slice(bodyStart) : '';
}

// A quoted import/require specifier: `from 'x'`, `import 'x'`, `require('x')`.
// Global so multiple on one line count. We only care about the specifier string.
const SPEC_RE = /\b(?:from|import|require)\b\s*\(?\s*(['"])([^'"]+)\1/g;

// Pull the `lib/…` or `bin/…` tail out of a specifier, normalizing a relative
// prefix away: `../../lib/test-curator/scan.js` → `lib/test-curator/scan.js`.
// A specifier without a lib/ or bin/ segment (node:, external pkg, ./util) → null.
const TARGET_RE = /(?:^|\/)((?:lib|bin)\/[^'"]+)$/;

/**
 * Is this source line a comment line (so an import/require on it is commented
 * out)? Conservative — mirrors scan.js's isCommentLine.
 * @param {string} line
 * @returns {boolean}
 */
function isCommentLine(line) {
  const t = line.trimStart();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

/**
 * Extract the sorted-unique set of PROJECT modules under `lib/` or `bin/` that a
 * test file imports — its "targets" (the production surface it exercises), used
 * to cluster tests by what they test. `node:`/external/`./util` specifiers are
 * ignored. PURE, never throws.
 *
 * @param {string} content the full file source
 * @returns {string[]} sorted unique target module paths (e.g. ['lib/server.js'])
 */
export function extractFileTargets(content) {
  if (typeof content !== 'string' || content.length === 0) return [];
  const set = new Set();
  const lines = content.split('\n');
  for (const line of lines) {
    if (isCommentLine(line)) continue;
    SPEC_RE.lastIndex = 0;
    let m;
    while ((m = SPEC_RE.exec(line)) !== null) {
      const spec = m[2];
      const tm = TARGET_RE.exec(spec);
      if (tm) set.add(tm[1]);
      if (SPEC_RE.lastIndex === m.index) SPEC_RE.lastIndex += 1; // zero-width guard
    }
  }
  return [...set].sort();
}
