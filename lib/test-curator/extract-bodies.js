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
// extractTestBody is callback-aware (Phase-4 F1/F2): it only treats a `{` as the
// body once it has passed the callback marker (`=>` or `function`) at the call's
// own paren level, so a destructured parameter (`({a,b}) => {…}`) and an options
// object (`test('x', {…}, fn)`) are skipped, NOT mistaken for the body — and a
// bare callback reference (`test('x', fn)`) or an expression-body arrow
// (`() => foo()`) yields '' (no inline block body) instead of running forward
// into the NEXT test and manufacturing a false near-duplicate.
// Documented residuals (a real AST parser is not worth a permanent dep):
// `${…}` interpolation braces inside a template literal are not counted (the
// whole template is skipped); a default-valued arrow PARAMETER (`(cb = () => {})
// => …`) can confuse the marker scan (an exotic pattern, effectively absent from
// test files).

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

/** Is `ch` a JS identifier char? (undefined → false, so edges are safe.) */
function isWordChar(ch) {
  return ch !== undefined && /[A-Za-z0-9_$]/.test(ch);
}

/**
 * Skip a balanced `{ … }` block starting at `content[i] === '{'`, honoring
 * strings and comments. Used to step over a non-body brace group (an options
 * object or a destructured parameter) without mistaking it for the body.
 *
 * @param {string} content
 * @param {number} i index of the opening `{`
 * @returns {number} index just AFTER the matching `}` (or content.length)
 */
function skipBraceBlock(content, i) {
  const n = content.length;
  let depth = 0;
  while (i < n) {
    const ch = content[i];
    const next = i + 1 < n ? content[i + 1] : '';
    if (ch === '/' && next === '/') { while (i < n && content[i] !== '\n') i += 1; continue; }
    if (ch === '/' && next === '*') { i += 2; while (i < n && !(content[i] === '*' && content[i + 1] === '/')) i += 1; i += 2; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { i = skipString(content, i, ch); continue; }
    if (ch === '{') { depth += 1; i += 1; continue; }
    if (ch === '}') { depth -= 1; i += 1; if (depth === 0) return i; continue; }
    i += 1;
  }
  return i; // unbalanced — best-effort
}

/**
 * Extract the body of a test callback: the code between the callback's opening
 * `{` and its matching `}`. Callback-aware (see file header): the body brace is
 * the `{` reached AFTER the callback marker (`=>`/`function`) at the call's own
 * paren level; a destructured param / options object is skipped; a bare-ref or
 * expression-body callback yields '' (no inline block).
 *
 * PURE, never throws. An unterminated body (no matching close) → best-effort:
 * everything from the opening brace to end-of-content.
 *
 * @param {string} content the full file source
 * @param {number} [fromIndex] where to start looking (e.g. the test-call offset)
 * @returns {string} the body text between the braces (exclusive), or ''
 */
export function extractTestBody(content, fromIndex) {
  if (typeof content !== 'string' || content.length === 0) return '';
  const n = content.length;
  let i = Number.isInteger(fromIndex) && fromIndex > 0 ? fromIndex : 0;
  if (i >= n) return '';

  // ── Phase 1: locate the callback body's opening brace. ──
  let sawMarker = false;   // passed '=>' or the 'function' keyword
  let localParen = 0;      // paren depth since the marker (the param list lives here)
  let callOpened = false;  // saw the test call's own '('
  let callDepth = 0;       // paren depth of the test call itself
  let bodyOpen = -1;

  while (i < n) {
    const ch = content[i];
    const next = i + 1 < n ? content[i + 1] : '';

    if (ch === '/' && next === '/') { while (i < n && content[i] !== '\n') i += 1; continue; }
    if (ch === '/' && next === '*') { i += 2; while (i < n && !(content[i] === '*' && content[i + 1] === '/')) i += 1; i += 2; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { i = skipString(content, i, ch); continue; }

    // Callback markers: an arrow, or the 'function' keyword (word-bounded).
    if (ch === '=' && next === '>') { sawMarker = true; localParen = 0; i += 2; continue; }
    if (ch === 'f' && content.startsWith('function', i)
        && !isWordChar(content[i - 1]) && !isWordChar(content[i + 8])) {
      sawMarker = true; localParen = 0; i += 8; continue;
    }

    if (ch === '(') { callOpened = true; callDepth += 1; localParen += 1; i += 1; continue; }
    if (ch === ')') {
      if (callDepth > 0) callDepth -= 1;
      if (localParen > 0) localParen -= 1;
      i += 1;
      if (callOpened && callDepth === 0) return ''; // call closed, no body — bare ref / expr body
      continue;
    }
    if (ch === '{') {
      if (sawMarker && localParen === 0) { bodyOpen = i; break; }
      i = skipBraceBlock(content, i); // options object / destructured param — not the body
      continue;
    }
    if (ch === ';' && callDepth === 0) return ''; // statement ended before any body
    i += 1;
  }
  if (bodyOpen < 0) return '';

  // ── Phase 2: brace-match the body (strings + comments skipped throughout). ──
  let depth = 0;
  let j = bodyOpen;
  while (j < n) {
    const ch = content[j];
    const next = j + 1 < n ? content[j + 1] : '';
    if (ch === '/' && next === '/') { while (j < n && content[j] !== '\n') j += 1; continue; }
    if (ch === '/' && next === '*') { j += 2; while (j < n && !(content[j] === '*' && content[j + 1] === '/')) j += 1; j += 2; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { j = skipString(content, j, ch); continue; }
    if (ch === '{') { depth += 1; j += 1; continue; }
    if (ch === '}') { depth -= 1; j += 1; if (depth === 0) return content.slice(bodyOpen + 1, j - 1); continue; }
    j += 1;
  }
  return content.slice(bodyOpen + 1); // unterminated — best-effort partial
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
