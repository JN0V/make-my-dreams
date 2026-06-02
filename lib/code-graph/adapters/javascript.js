// lib/code-graph/adapters/javascript.js — the JavaScript import-edge adapter
// (SPEC_V081 AC-2). This is the §VIII fix for MMD's code-dependency analysis:
// the import graph (blast-radius + the coherence-graph code edges) must be
// language-NEUTRAL in the core and per-language in the adapters, not a JS scanner
// pretending to be universal.
//
// THIS FILE OWNS ALL JAVASCRIPT SPECIFIER SYNTAX + RESOLUTION. It is the EXISTING
// logic from lib/sealed-tests/import-graph.js (the v0.4.c "import-graph accurate"
// blast radius, ADR-027) moved BEHIND the adapter contract with ZERO behavior
// change: `computeBlastRadius` on the MMD repo returns the identical reverse
// closure, and the sealed-test gate that consumes the blast radius is unaffected
// (the AC-2 regression lock). No JS token lives in the core any more.
//
// Honestly "import-graph accurate", NOT "AST-accurate": vanilla-stack, zero deps
// (universal §II KISS — the YAML-lite / hand-rolled-twice precedent), so we
// extract specifiers with targeted regexes and resolve by fileSet membership
// rather than pulling in acorn/babel. The residual gap (computed/runtime
// specifiers, re-export aliasing through computed names, non-JS importers) is
// documented in ADR-027 / ADR-043 — stated, not hidden (universal §VI).
//
// PURE / never throws (universal §I.S, §VI): no `node:fs` / `node:path` import —
// path resolution is hand-rolled POSIX so it is deterministic across platforms
// and the unit suite drives it with in-memory file sets.

// ── Specifier extraction ───────────────────────────────────────────────────

// Strip comments BEFORE matching so a commented-out import does not count. A
// regex stripper cannot do this correctly — a `/*` inside a line comment or a
// string (e.g. `// … lives in lib/*.`) fools the block-comment pattern into
// swallowing everything up to the next `*/`, eating real imports. So we run a
// single-pass char scanner with explicit code / line-comment / block-comment /
// string states. Newlines are preserved so two code lines are never merged into
// one (which could fabricate a cross-line `from 'x'` match).
//
// Residual limit (documented, ADR-027): a regex *literal* containing `//`
// (e.g. `/a\/\//`) is treated as a line comment — rare, line-local, never a
// whole-file swallow. JS module specifiers we care about are not in regexes.
function stripComments(text) {
  let out = '';
  let state = 'code'; // code | line | block | sq | dq | tpl
  const n = text.length;
  for (let i = 0; i < n; i += 1) {
    const c = text[i];
    const c2 = i + 1 < n ? text[i + 1] : '';
    switch (state) {
      case 'code':
        if (c === '/' && c2 === '/') { state = 'line'; i += 1; }
        else if (c === '/' && c2 === '*') { state = 'block'; i += 1; }
        else if (c === "'") { state = 'sq'; out += c; }
        else if (c === '"') { state = 'dq'; out += c; }
        else if (c === '`') { state = 'tpl'; out += c; }
        else out += c;
        break;
      case 'line':
        if (c === '\n') { state = 'code'; out += c; }
        break;
      case 'block':
        if (c === '*' && c2 === '/') { state = 'code'; i += 1; }
        else if (c === '\n') out += c; // preserve line count
        break;
      case 'sq':
      case 'dq':
      case 'tpl': {
        out += c;
        if (c === '\\' && i + 1 < n) { out += text[i + 1]; i += 1; break; } // escaped char
        const close = state === 'sq' ? "'" : state === 'dq' ? '"' : '`';
        if (c === close) state = 'code';
        break;
      }
      default:
        out += c;
    }
  }
  return out;
}

// The import forms, single OR double quotes. `from`-clause covers BOTH static
// `import … from 'x'` and `export … from 'x'`; the others are matched
// independently. Best-effort line/segment parsing — no AST.
const FROM_RE = /\bfrom\s*['"]([^'"\n]+)['"]/g; // import-from + export-from
const SIDE_EFFECT_RE = /\bimport\s+['"]([^'"\n]+)['"]/g; // import 'x'
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g; // import('x')
const REQUIRE_RE = /\brequire\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g; // require('x')

/**
 * Extract module specifier strings from JavaScript source text.
 *
 * Covers: static `import … from 'x'`, side-effect `import 'x'`, `export … from
 * 'x'`, `require('x')`, and dynamic `import('x')` (single OR double quotes). A
 * specifier mentioned only in a comment or an unrelated string is NOT returned
 * (comments are stripped first; only the four import-shaped patterns match).
 *
 * Never throws — odd / non-string input yields `[]` (universal §VI).
 *
 * @param {string} text source text
 * @returns {string[]} de-duped specifier strings, in first-seen order
 */
export function parseSpecifiers(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  try {
    const src = stripComments(text);
    const found = new Set();
    for (const re of [FROM_RE, SIDE_EFFECT_RE, DYNAMIC_IMPORT_RE, REQUIRE_RE]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src)) !== null) {
        if (m[1]) found.add(m[1]);
      }
    }
    return [...found];
  } catch {
    return [];
  }
}

// ── Path resolution (hand-rolled POSIX, no node:path) ──────────────────────

function dirOf(file) {
  const norm = file.replace(/\\/g, '/');
  const idx = norm.lastIndexOf('/');
  return idx === -1 ? '' : norm.slice(0, idx);
}

// Resolve `.` and `..` segments of a relative POSIX-ish path. Leading `..` that
// escape the root are kept (an unresolvable escape just won't match the fileSet
// → null downstream).
function normalizePath(p) {
  const out = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else out.push('..');
    } else {
      out.push(seg);
    }
  }
  return out.join('/');
}

const TRY_EXTS = ['', '.js', '.mjs', '.cjs'];
const INDEX_FILES = ['/index.js', '/index.mjs', '/index.cjs'];

/**
 * Resolve a RELATIVE module specifier to a concrete repo-relative file.
 *
 * Only specifiers starting with `.` (`./`, `../`) resolve; a bare specifier
 * (`fs`, `lodash`), a `node:` specifier, or an absolute path returns `null`.
 * The specifier is joined against `fromFile`'s directory and normalized, then
 * matched against `fileSet` membership trying: the literal path, `+.js/.mjs/.cjs`,
 * then `/index.{js,mjs,cjs}`. Returns the first match present in `fileSet`, or
 * `null` if nothing resolves.
 *
 * `./a` and `../a` resolve to DIFFERENT files (no basename collision). Never
 * throws (universal §VI).
 *
 * @param {string} fromFile the importing file (repo-relative)
 * @param {string} specifier the module specifier as written
 * @param {Set<string>|string[]} fileSet the repo's files (repo-relative)
 * @returns {string|null} the resolved repo-relative file, or null
 */
export function resolveSpecifier(fromFile, specifier, fileSet) {
  if (typeof fromFile !== 'string' || typeof specifier !== 'string') return null;
  // Only relative specifiers resolve; bare / node: / absolute → null.
  if (!specifier.startsWith('.')) return null;

  const set = fileSet instanceof Set ? fileSet : new Set(Array.isArray(fileSet) ? fileSet : []);
  const base = normalizePath(`${dirOf(fromFile)}/${specifier.replace(/\\/g, '/')}`);
  if (base === '') return null;

  for (const ext of TRY_EXTS) {
    const candidate = base + ext;
    if (set.has(candidate)) return candidate;
  }
  for (const idx of INDEX_FILES) {
    const candidate = base + idx;
    if (set.has(candidate)) return candidate;
  }
  return null;
}

// ── The adapter (the import-edge contract — see adapters/index.js) ──────────

const JS_EXTENSIONS = ['.js', '.mjs', '.cjs'];

const javascriptAdapter = {
  id: 'javascript',
  displayName: 'JavaScript',
  language: 'JavaScript',
  extensions: JS_EXTENSIONS,

  /**
   * Does this FILE belong to my stack? Decided by extension (a per-file decision,
   * NOT a repo-level manifest like the Test Curator's adapters — the import graph
   * spans a mixed repo file-by-file). PURE.
   * @param {string} filePath repo-relative path
   * @returns {boolean}
   */
  matches(filePath) {
    if (typeof filePath !== 'string') return false;
    return JS_EXTENSIONS.some((ext) => filePath.toLowerCase().endsWith(ext));
  },

  /**
   * The import edges of one JS file: the repo-relative files it imports,
   * resolved against `repoFiles`. Unresolvable / external / bare / node:
   * specifiers are dropped (they are not repo files). A file never imports
   * itself. NEVER throws (universal §VI) — odd input → `[]`.
   *
   * @param {{ filePath: string, content: string, repoFiles: Set<string>|string[] }} args
   * @returns {string[]} de-duped repo-relative imported file paths
   */
  importEdges({ filePath, content, repoFiles } = {}) {
    if (typeof content !== 'string' || content.length === 0) return [];
    const fileSet = repoFiles instanceof Set
      ? repoFiles
      : new Set(Array.isArray(repoFiles) ? repoFiles : []);
    const out = new Set();
    for (const spec of parseSpecifiers(content)) {
      const resolved = resolveSpecifier(filePath, spec, fileSet);
      if (resolved && resolved !== filePath) out.add(resolved);
    }
    return [...out];
  },
};

export default javascriptAdapter;
