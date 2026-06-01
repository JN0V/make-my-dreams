// lib/test-curator/scan.js — the Test Curator's PURE scanner (SPEC_V076 AC-1).
//
// SRP (universal.md §I.S): given a list of `{path, content}` test-file pairs,
// extract per-test entries + per-file metrics. It makes NO decisions about what
// is "healthy" (that is report.js) and does NO I/O (the bin gathers the files).
// Pure, deterministic, never throws — junk in → empty-ish out, never a crash
// (ai-coding §I honesty: a scanner that throws on one odd file would hide the
// whole corpus's health).
//
// The stratification tag is read from the TEST TITLE STRING, per the project
// convention where a tag prefixes the title: `test('@unit …')` / `it('@smoke …')`.
// This is the same convention testing.md §V mandates and that the npm test:smoke
// script greps for (`--test-name-pattern=@smoke`). A title carrying none of the
// four strata is 'untagged' — a §V violation the report surfaces.

// The four stratification tags the Test Curator tracks. (`@slow`/`@mutation`
// exist in testing.md but are opt-in modifiers, not a primary stratum — a test
// is still smoke/unit/integration/e2e; we report only the four canonical strata
// + untagged. KISS: don't model what the report doesn't use.)
export const STRATA = Object.freeze(['smoke', 'unit', 'integration', 'e2e']);

// Match a `test(` or `it(` call followed by an opening quote (single, double, or
// backtick). The `(?<![.\w])` lookbehind requires `test`/`it` to start a fresh
// token: it rejects METHOD calls (`re.test('x')`, `obj.it('y')` — preceded by
// `.`) and longer identifiers (`subtest(`/`awaitit(` — preceded by a word char),
// the two common false positives a bare `\b` let through (Phase-4 F1). We capture
// the quote so we can read the title; global so multiple calls on one line count.
// Residual (documented heuristic, KISS): a `test('…')` written INSIDE a string
// literal would still be counted — fully stripping string contexts needs a real
// parser, out of scope for an advisory corpus scanner. Block-comment and `//`
// lines are skipped by isCommentLine below.
const TEST_CALL_RE = /(?<![.\w])(?:test|it)\s*\(\s*(['"`])/g;

// The stratification tag inside a title — first occurrence wins.
const TAG_RE = /@(smoke|unit|integration|e2e)\b/;

/**
 * Is this source line a comment line (so a `test(` on it is commented-out, not a
 * real call)? Conservative: only the obvious `//`-prefixed and ` * ` jsdoc-body
 * lines (precision-first — we'd rather count a weird real test than miss it, but
 * the common commented-out / doc cases are worth excluding).
 *
 * @param {string} line
 * @returns {boolean}
 */
function isCommentLine(line) {
  const t = line.trimStart();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

/**
 * Read the title literal starting at the opening-quote index. Best-effort: scan
 * to the matching unescaped quote on the SAME line; if it never closes (a
 * multiline / template-literal title), take the rest of the line. The tag we
 * care about prefixes the title, so a partial read still classifies correctly.
 *
 * @param {string} line  the source line
 * @param {number} quoteIdx index of the opening quote char
 * @returns {string} the title text (without the surrounding quotes)
 */
function readTitle(line, quoteIdx) {
  const quote = line[quoteIdx];
  let out = '';
  for (let i = quoteIdx + 1; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '\\') {
      // Keep the escaped char verbatim (don't terminate on an escaped quote).
      out += ch + (line[i + 1] || '');
      i += 1;
      continue;
    }
    if (ch === quote) return out;
    out += ch;
  }
  return out; // unterminated on this line — best-effort partial title
}

/**
 * Classify a title into one of the four strata, or 'untagged'.
 * @param {string} title
 * @returns {string}
 */
function tagOf(title) {
  const m = TAG_RE.exec(title);
  return m ? m[1] : 'untagged';
}

/**
 * Scan a single file's content into its test entries + metrics.
 * @param {string} filePath
 * @param {string} content
 * @returns {{ tests: object[], metric: { path: string, lineCount: number, testCount: number } }}
 */
function scanOne(filePath, content) {
  const lines = content.split('\n');
  const tests = [];
  for (let li = 0; li < lines.length; li += 1) {
    const line = lines[li];
    if (isCommentLine(line)) continue;
    TEST_CALL_RE.lastIndex = 0;
    let m;
    while ((m = TEST_CALL_RE.exec(line)) !== null) {
      // m.index points at `test`/`it`; the captured quote is at m.index + m[0].length - 1.
      const quoteIdx = m.index + m[0].length - 1;
      const title = readTitle(line, quoteIdx);
      tests.push({
        title,
        tag: tagOf(title),
        file: filePath,
        line: li + 1, // 1-based
      });
      // Avoid a zero-width infinite loop if a regex engine ever returns it.
      if (TEST_CALL_RE.lastIndex === m.index) TEST_CALL_RE.lastIndex += 1;
    }
  }
  return {
    tests,
    metric: { path: filePath, lineCount: lines.length, testCount: tests.length },
  };
}

/**
 * Scan a test corpus. PURE, deterministic, never throws.
 *
 * @param {Array<{ path: string, content: string }>} files
 * @returns {{
 *   tests: Array<{ title: string, tag: string, file: string, line: number }>,
 *   files: Array<{ path: string, lineCount: number, testCount: number }>,
 *   totals: { testCount: number, fileCount: number,
 *             byTag: { smoke: number, unit: number, integration: number, e2e: number, untagged: number } }
 * }}
 */
export function scanTestCorpus(files) {
  const tests = [];
  const fileMetrics = [];
  const byTag = { smoke: 0, unit: 0, integration: 0, e2e: 0, untagged: 0 };

  if (Array.isArray(files)) {
    for (const entry of files) {
      if (!entry || typeof entry !== 'object') continue; // skip null/strings/junk entries
      const filePath = String(entry.path == null ? '' : entry.path);
      const content = typeof entry.content === 'string' ? entry.content : null;
      if (content === null) {
        // A file we couldn't read content for: record a zero-metric file entry
        // (honest — it exists but contributed no tests), no tests.
        fileMetrics.push({ path: filePath, lineCount: 0, testCount: 0 });
        continue;
      }
      const { tests: fileTests, metric } = scanOne(filePath, content);
      for (const t of fileTests) {
        tests.push(t);
        byTag[t.tag] += 1;
      }
      fileMetrics.push(metric);
    }
  }

  return {
    tests,
    files: fileMetrics,
    totals: { testCount: tests.length, fileCount: fileMetrics.length, byTag },
  };
}
