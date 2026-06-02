// lib/test-curator/adapters/python.js — the Python Test Curator adapter
// (SPEC_V080 AC-5). The PROOF of genericity: a real second-language adapter that
// makes `mmdream test-health` produce a genuine, honest report on a Python repo —
// demonstrating the core is language-neutral, not secretly JavaScript.
//
// ALL the Python assumptions live HERE, NOT in the core (§VIII):
//   - pytest functions (`def test_*`) + unittest methods (also `def test_*`)
//   - pytest markers (`@pytest.mark.<stratum>`) → stratum
//   - `import x` / `from x import …` module syntax → project-module targets
//   - the python test-file glob (`test_*.py`, `*_test.py`, files under tests/)
//
// Capability honesty (the §VI mechanism): the Python adapter declares
// supportsBodies=FALSE for v1 — indentation-based body extraction is a separate
// extractor (deferred, see ADR + SPEC §4). The core then marks near-duplicate
// (body-similarity) pairs as "not available for the Python adapter" rather than
// silently empty; stratification + clustering still work, so the report is real.
//
// PURE / never throws: discovery reads files via the INJECTED reader; junk in →
// empty-ish out. Target resolution emits repo-relative CANDIDATE paths
// (`pkg/mod.py` + `pkg/mod/__init__.py`); the bin's keepRealTargets(existsSync)
// keeps only the ones that resolve to a real file — so the adapter itself does NO
// filesystem probing for targets (stays unit-testable).

// A Python source file that is a TEST file by convention: `test_*.py`,
// `*_test.py`, or any `.py` living under a `tests/` or `test/` directory. This
// glob is a Python concern, so it lives in the adapter (mirrors the JS adapter's
// `*.test.js`). conftest.py is configuration, not a test file → excluded.
function isPyTestFile(relPath) {
  const p = String(relPath || '');
  if (!p.endsWith('.py')) return false;
  const base = p.split('/').pop();
  if (base === 'conftest.py') return false;
  if (/^test_.*\.py$/.test(base) || /.*_test\.py$/.test(base)) return true;
  return /(^|\/)(tests?)\//.test(p);
}

// A test declaration: a `def test_*(`. Whether it COUNTS depends on its scope
// (see scanOne): pytest collects a module-level `def test_*` and a `def test_*`
// METHOD of a `class Test*`, but NOT a `def test_*` nested inside another `def`
// (a helper closure) nor a method of a non-`Test*` class. We capture the leading
// indentation (group 1) for the scope check and the function name (group 2) as
// the human title. `async def` is allowed.
const DEF_RE = /^(\s*)(?:async\s+)?def\s+(test_\w*)\s*\(/;

// ANY `def`/`class` opener — used only to track lexical SCOPE so the `def test_*`
// collection rule above can tell a real test from a nested helper.
const ANY_DEF_RE = /^(\s*)(?:async\s+)?def\s+(\w+)/;
const CLASS_RE = /^(\s*)class\s+(\w+)/;

// pytest collects methods of classes named `Test*` (and not inheriting an
// __init__). We approximate with the name convention (the common case).
function isTestClassName(name) {
  return /^Test/.test(String(name || ''));
}

/** Leading-whitespace width of a line (tabs counted as one — good enough). */
function indentOf(s) {
  const m = /^[ \t]*/.exec(s);
  return m ? m[0].length : 0;
}

// A pytest marker decorator: `@pytest.mark.<name>` or `@mark.<name>`. We read
// `<name>` and map it to a stratum only when it is one of the four canonical
// strata; any other marker → no stratum (null), honestly (we don't invent one).
const MARKER_RE = /^\s*@(?:pytest\.)?mark\.(\w+)/;

// The four canonical strata the Test Curator tracks (same set as the JS adapter;
// the VALUES are shared vocabulary, the SYNTAX that yields them is per-adapter).
const STRATA = new Set(['smoke', 'unit', 'integration', 'e2e']);

// An import line: `import a.b.c` (optionally `as x`) or `from a.b import c`.
// Relative imports (`from . import x`, `from .pkg import y`) are handled by the
// leading-dot count. We only care about the dotted module path.
const IMPORT_RE = /^\s*import\s+([\w.]+)/;
const FROM_RE = /^\s*from\s+(\.*)([\w.]*)\s+import\s+/;

/**
 * Is this Python line a comment line (so a def/import on it is commented out)?
 * Conservative: only the obvious `#`-prefixed line.
 * @param {string} line
 * @returns {boolean}
 */
function isCommentLine(line) {
  return line.trimStart().startsWith('#');
}

/**
 * Turn a dotted Python module path into repo-relative CANDIDATE file paths. We
 * emit both `a/b/c.py` (a module) and `a/b/c/__init__.py` (a package); the bin's
 * real-file filter keeps whichever exists. A leading-dot relative import is
 * resolved against the importing file's directory. Returns [] for stdlib-looking
 * bare names with no project file (they simply won't resolve and get dropped).
 *
 * @param {string} dotted   e.g. 'app.models' or 'helpers'
 * @param {number} dots     count of leading dots (0 = absolute, 1 = current pkg, …)
 * @param {string} fromFile the importing test file's repo-relative path
 * @returns {string[]} candidate repo-relative paths
 */
function moduleCandidates(dotted, dots, fromFile) {
  const parts = String(dotted || '').split('.').filter(Boolean);
  let baseDir = '';
  if (dots > 0) {
    // Relative import: climb `dots - 1` directories up from the file's dir.
    const dir = String(fromFile || '').split('/').slice(0, -1);
    const up = dots - 1;
    baseDir = dir.slice(0, Math.max(0, dir.length - up)).join('/');
  }
  if (parts.length === 0) return [];
  const joined = [baseDir, ...parts].filter(Boolean).join('/');
  return [`${joined}.py`, `${joined}/__init__.py`];
}

/**
 * Extract the candidate project-module targets a Python test file imports.
 * Heuristic (KISS): every `import`/`from` specifier becomes candidate paths; the
 * bin keeps only those resolving to a real repo file, so stdlib/third-party
 * imports (no matching file) drop out naturally. PURE.
 *
 * @param {string} content
 * @param {string} relPath the file's repo-relative path (for relative imports)
 * @returns {string[]} sorted-unique candidate repo-relative paths
 */
function extractPyTargets(content, relPath) {
  if (typeof content !== 'string' || content.length === 0) return [];
  const set = new Set();
  for (const line of content.split('\n')) {
    if (isCommentLine(line)) continue;
    let m = IMPORT_RE.exec(line);
    if (m) {
      for (const c of moduleCandidates(m[1], 0, relPath)) set.add(c);
      continue;
    }
    m = FROM_RE.exec(line);
    if (m) {
      const dots = m[1] ? m[1].length : 0;
      for (const c of moduleCandidates(m[2], dots, relPath)) set.add(c);
    }
  }
  return [...set].sort();
}

/**
 * Scan one Python test file into its entries + metric. Tracks pytest markers
 * sitting on the decorator lines immediately above a `def test_*` so the def can
 * claim a stratum. PURE.
 *
 * @param {string} relPath
 * @param {string} content
 * @returns {{ tests: object[], metric: object }}
 */
function scanOne(relPath, content) {
  const lines = content.split('\n');
  const targets = extractPyTargets(content, relPath);
  const tests = [];
  // Pending stratum from a marker decorator seen since the last code line.
  let pendingStratum = null;
  // Lexical scope stack of enclosing class/def openers, innermost last
  // (each {indent, kind, name}). A `def test_*` is a real test ONLY when it is
  // module-level OR its IMMEDIATE enclosing scope is a `class Test*` — a def
  // nested in a def (a helper closure) or a method of a non-`Test*` class is not
  // collected by pytest, so we don't count it (F1 precision — SPEC AC-5).
  const scopes = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (isCommentLine(line)) continue;

    const mk = MARKER_RE.exec(line);
    if (mk) {
      const name = mk[1].toLowerCase();
      if (STRATA.has(name)) pendingStratum = name;
      continue; // a decorator line is not a def; keep the pending marker
    }

    const cm = CLASS_RE.exec(line);
    if (cm) {
      const indent = indentOf(line);
      while (scopes.length && scopes[scopes.length - 1].indent >= indent) scopes.pop();
      scopes.push({ indent, kind: 'class', name: cm[2] });
      pendingStratum = null; // a class line is not a test def
      continue;
    }

    const adm = ANY_DEF_RE.exec(line);
    if (adm) {
      const indent = indentOf(line);
      // Pop scopes we have exited (siblings / outer) before resolving the parent.
      while (scopes.length && scopes[scopes.length - 1].indent >= indent) scopes.pop();
      const parent = scopes.length ? scopes[scopes.length - 1] : null;

      const dm = DEF_RE.exec(line); // is it specifically a `def test_*`?
      const collectible = dm && (
        parent === null // module-level pytest function
        || (parent.kind === 'class' && isTestClassName(parent.name)) // Test* method
      );
      if (collectible) {
        tests.push({
          file: relPath,
          line: i + 1, // 1-based
          title: dm[2], // the function name, e.g. test_addition
          stratum: pendingStratum, // marker-derived, else null
          body: null, // supportsBodies=false for v1 (honest)
          targets,
        });
      }
      // Enter the def's own scope (so a nested def is seen as nested).
      scopes.push({ indent, kind: 'def', name: adm[2] });
      pendingStratum = null; // consumed (whether or not collected)
      continue;
    }

    // Any other non-blank, non-decorator line resets a dangling marker (a marker
    // not immediately followed by a def doesn't leak onto a later one).
    if (line.trim() !== '' && !line.trimStart().startsWith('@')) {
      pendingStratum = null;
    }
  }
  return {
    tests,
    metric: { path: relPath, lineCount: lines.length, testCount: tests.length, targets },
  };
}

const pythonAdapter = {
  id: 'python',
  displayName: 'Python',

  // How tests are stratified in THIS stack (so the report gives stack-appropriate
  // advice instead of citing MMD's JS `@`-tag / testing.md §V convention — §VIII:
  // no language assumption leaks into the core's prose). null/absent for a stack
  // with no convention.
  stratumConventionLabel: 'a `@pytest.mark.<stratum>` marker (smoke/unit/integration/e2e)',

  // Capability flags (§VI honesty). Python v1 stratifies (pytest markers) and
  // clusters (import targets) but does NOT extract bodies yet (indentation bodies
  // are a separate, deferred extractor) → the core marks redundancy pairs
  // "not available for the Python adapter". Coverage is deferred for all stacks.
  supportsBodies: false,
  supportsStratification: true,
  supportsCoverage: false,

  /**
   * Does this repo use Python? Manifest presence: pyproject.toml / setup.py /
   * requirements.txt (AC-1). PURE.
   * @param {{ manifests?: string[] }} signals
   * @returns {boolean}
   */
  matches(signals) {
    const manifests = signals && Array.isArray(signals.manifests) ? signals.manifests : [];
    return ['pyproject.toml', 'setup.py', 'requirements.txt'].some((m) => manifests.includes(m));
  },

  /**
   * Discover the Python test corpus. Filters tracked files to python test files,
   * reads each via the injected reader, and scans for pytest/unittest tests.
   * NEVER throws.
   *
   * @param {{ repoRoot?: string, files?: string[], readFile?: (rel: string) => (string|null) }} args
   * @returns {{ entries: object[], files: object[] }}
   */
  discoverTests({ files, readFile } = {}) {
    const all = Array.isArray(files) ? files : [];
    const read = typeof readFile === 'function' ? readFile : () => null;

    const rels = all
      .map((f) => (typeof f === 'string' ? f : (f && f.path)))
      .filter((p) => typeof p === 'string' && isPyTestFile(p))
      .sort();

    const entries = [];
    const fileMetrics = [];
    for (const rel of rels) {
      let content = null;
      try {
        content = read(rel);
      } catch {
        content = null;
      }
      if (typeof content !== 'string') {
        fileMetrics.push({ path: rel, lineCount: 0, testCount: 0, targets: [] });
        continue;
      }
      const { tests, metric } = scanOne(rel, content);
      for (const t of tests) entries.push(t);
      fileMetrics.push(metric);
    }
    return { entries, files: fileMetrics };
  },
};

export default pythonAdapter;
