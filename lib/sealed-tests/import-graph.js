// lib/sealed-tests/import-graph.js — import-graph analysis (v0.4.c, SPEC_V04C;
// PROBLEMS.md P-05 "a change's true reach is invisible"). Upgrades the v0.4.a
// fragment-grep stub (blast-radius.js) to RESOLVED, TRANSITIVE accuracy:
//
//   parse the module specifiers of every file  →  resolve each relative
//   specifier to a concrete repo file  →  build the import graph  →  invert it
//   →  reverse-closure from the changed set = the true blast radius.
//
// Honestly named "import-graph accurate", NOT "AST-accurate": the repo is
// strict vanilla-stack (zero deps; hand-rolled YAML twice — universal §II KISS),
// so we extract specifiers with targeted regexes and resolve them by fileSet
// membership rather than pulling in acorn/babel. The residual gap (computed /
// runtime specifiers, re-export aliasing through computed names, non-JS
// importers) is documented in ADR-027 — stated, not hidden (universal §VI).
//
// PURE over injected reads (universal §I.S, §II): NO `node:fs` and NO `node:path`
// import — path resolution is hand-rolled POSIX so it is deterministic across
// platforms and the unit suite can drive it with in-memory file maps. Every
// public function tolerates junk input and never throws (universal §VI).
//
// Public API:
//   - parseSpecifiers(text) -> string[]            module specifier strings
//   - resolveSpecifier(fromFile, spec, fileSet) -> string | null   resolved repo file
//   - buildImportGraph(files, readFile) -> Map<file, Set<resolvedImport>>
//   - invertGraph(graph) -> Map<importee, Set<importer>>
//   - reverseClosure(graph, changed) -> Set<file>  transitive importers (excl. seeds)

// ── Specifier extraction ───────────────────────────────────────────────────

// Strip comments BEFORE matching so a commented-out import does not count
// (AC-1). A regex stripper cannot do this correctly — a `/*` inside a line
// comment or a string (e.g. `// … lives in lib/*.`) fools the block-comment
// pattern into swallowing everything up to the next `*/`, eating real imports.
// So we run a single-pass char scanner with explicit code / line-comment /
// block-comment / string states. Newlines are preserved so two code lines are
// never merged into one (which could fabricate a cross-line `from 'x'` match).
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

// The five import forms, single OR double quotes. `from`-clause covers BOTH
// static `import … from 'x'` and `export … from 'x'`; the others are matched
// independently. Best-effort line/segment parsing — no AST (SPEC §5.3).
const FROM_RE = /\bfrom\s*['"]([^'"\n]+)['"]/g; // import-from + export-from
const SIDE_EFFECT_RE = /\bimport\s+['"]([^'"\n]+)['"]/g; // import 'x'
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g; // import('x')
const REQUIRE_RE = /\brequire\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g; // require('x')

/**
 * Extract module specifier strings from source text.
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

// Resolve `.` and `..` segments of a relative POSIX-ish path. Leading `..`
// that escape the root are kept (an unresolvable escape just won't match the
// fileSet → null downstream).
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
 * `./a` and `../a` resolve to DIFFERENT files (the stub's main inaccuracy — no
 * basename collision). Never throws (universal §VI).
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

// ── Graph construction + reverse closure ───────────────────────────────────

/**
 * Build the import graph: each file → the set of repo files it imports
 * (resolved). Unreadable files are skipped (advisory tool, never fatal).
 *
 * @param {string[]} files repo-relative paths to scan
 * @param {(relPath: string) => string} readFile read one file's text
 * @returns {Map<string, Set<string>>} file → set of resolved imports
 */
export function buildImportGraph(files, readFile) {
  const graph = new Map();
  if (!Array.isArray(files) || typeof readFile !== 'function') return graph;

  const norm = (f) => f.replace(/\\/g, '/');
  const fileSet = new Set(
    files.filter((f) => typeof f === 'string' && f.length > 0).map(norm),
  );

  for (const file of fileSet) {
    let text;
    try {
      text = readFile(file);
    } catch {
      continue; // unreadable: skip, never fatal
    }
    if (typeof text !== 'string' || text.length === 0) {
      graph.set(file, new Set());
      continue;
    }
    const imports = new Set();
    for (const spec of parseSpecifiers(text)) {
      const resolved = resolveSpecifier(file, spec, fileSet);
      if (resolved && resolved !== file) imports.add(resolved); // a file never imports itself
    }
    graph.set(file, imports);
  }
  return graph;
}

/**
 * Invert an import graph: importee → the set of files that import it directly.
 *
 * @param {Map<string, Set<string>>} graph file → resolved imports
 * @returns {Map<string, Set<string>>} importee → direct importers
 */
export function invertGraph(graph) {
  const reverse = new Map();
  if (!(graph instanceof Map)) return reverse;
  for (const [file, imports] of graph) {
    if (!(imports instanceof Set)) continue;
    for (const imp of imports) {
      if (!reverse.has(imp)) reverse.set(imp, new Set());
      reverse.get(imp).add(file);
    }
  }
  return reverse;
}

/**
 * Transitive reverse closure: every file that imports a changed file directly
 * OR through a chain (A←B←C all surface for a change to A). The seeds (changed
 * files) themselves are excluded from the result.
 *
 * Cycle-safe: a visited set guards against an import cycle hanging the walk
 * (AC-3). Never throws (universal §VI).
 *
 * @param {Map<string, Set<string>>} graph file → resolved imports
 * @param {Iterable<string>} changed the changed (seed) files
 * @returns {Set<string>} all transitive importers, seeds excluded
 */
export function reverseClosure(graph, changed) {
  const reverse = invertGraph(graph);
  const seeds = new Set(
    [...(changed || [])]
      .filter((f) => typeof f === 'string' && f.length > 0)
      .map((f) => f.replace(/\\/g, '/')),
  );

  const visited = new Set(); // every node reached (incl. seeds) — the cycle guard
  const result = new Set(); // importers only (seeds excluded)
  const queue = [...seeds];
  for (const s of seeds) visited.add(s);

  while (queue.length > 0) {
    const node = queue.shift();
    const importers = reverse.get(node);
    if (!importers) continue;
    for (const importer of importers) {
      if (visited.has(importer)) continue; // cycle / already-seen guard
      visited.add(importer);
      if (!seeds.has(importer)) result.add(importer);
      queue.push(importer);
    }
  }
  return result;
}
