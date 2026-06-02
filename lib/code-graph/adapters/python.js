// lib/code-graph/adapters/python.js — the Python import-edge adapter
// (SPEC_V081 AC-5). The PROOF of genericity: a real second-language adapter that
// makes `computeBlastRadius` / the coherence-graph code edges produce a genuine,
// honest reverse closure on a Python repo — demonstrating the import-graph core
// is language-neutral, not secretly JavaScript.
//
// ALL the Python import syntax + resolution heuristics live HERE, NOT in the core
// (§VIII). The core just asks for `importEdges` and walks the graph.
//
// Resolution (KISS, dir/package/`__init__.py` heuristics — universal §II):
//   - `import a.b.c`            → a/b/c.py  OR  a/b/c/__init__.py
//   - `import a.b as x`         → same (the alias is irrelevant to the edge)
//   - `import a, b`             → resolve each
//   - `from a.b import x, y`    → the module a.b  (a/b.py | a/b/__init__.py) AND,
//                                 for each name, the submodule a.b.x (a/b/x.py |
//                                 a/b/x/__init__.py) — a `from … import` may pull
//                                 a submodule OR a name; we keep whichever RESOLVES
//                                 to a real repo file (the rest drop as external).
//   - `from . import x`         → x in the importer's own package dir
//   - `from .pkg import y`      → pkg under the importer's dir (leading-dot climb)
//
// Absolute imports resolve from the REPO ROOT (the common src-at-root layout); a
// `src/`-rooted package or an installed third-party module simply won't match the
// repo file set and is DROPPED (external) — honest, not faked. The residual gap
// (src-layout roots, namespace packages, re-exports) is documented in ADR-043.
//
// PURE / never throws (universal §VI): junk input → `[]`.

const PY_EXTENSIONS = ['.py'];

// `import a.b.c` / `import a.b as x` / `import a, b.c` — capture the whole
// comma-list after `import` (we split + strip `as` ourselves).
const IMPORT_RE = /^\s*import\s+(.+)$/;
// `from <dots><module> import <names>` — dots for relative, module may be empty
// (a bare `from . import x`), names captured for submodule resolution.
const FROM_RE = /^\s*from\s+(\.*)([\w.]*)\s+import\s+(.+)$/;

/** Is this Python line a `#` comment (so a def/import on it is commented out)? */
function isCommentLine(line) {
  return line.trimStart().startsWith('#');
}

/**
 * Repo-relative CANDIDATE files for a dotted module path, resolved against the
 * importer's location for relative (leading-dot) imports. Emits both the module
 * file (`a/b.py`) and the package init (`a/b/__init__.py`); the caller keeps
 * whichever is a real repo file.
 *
 * @param {string} dotted   e.g. 'app.models' or '' (bare `from . import x`)
 * @param {number} dots     count of leading dots (0 = absolute from repo root)
 * @param {string} fromFile the importing file's repo-relative path
 * @returns {string[]} candidate repo-relative paths (may be empty)
 */
function moduleCandidates(dotted, dots, fromFile) {
  const parts = String(dotted || '').split('.').filter(Boolean);
  let baseDir = '';
  if (dots > 0) {
    // Relative import: the importer's directory, then climb `dots - 1` levels.
    const dir = String(fromFile || '').replace(/\\/g, '/').split('/').slice(0, -1);
    const up = dots - 1;
    baseDir = dir.slice(0, Math.max(0, dir.length - up)).join('/');
  }
  if (parts.length === 0 && dots === 0) return []; // nothing to resolve
  const joined = [baseDir, ...parts].filter(Boolean).join('/');
  if (!joined) return [];
  return [`${joined}.py`, `${joined}/__init__.py`];
}

/** First candidate present in the repo file set, or null. */
function firstReal(candidates, fileSet) {
  for (const c of candidates) {
    if (fileSet.has(c)) return c;
  }
  return null;
}

/**
 * The names in a `from … import (a, b as c, *)` clause, stripped of aliases and
 * parens/`*`. Used to try each name as a submodule. Best-effort, single-line
 * (parenthesized multi-line `from` lists resolve their module edge regardless).
 *
 * @param {string} clause the text after `import`
 * @returns {string[]} bare imported names
 */
function importedNames(clause) {
  return String(clause || '')
    .replace(/[()]/g, ' ')
    .split(',')
    .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
    .filter((s) => /^\w+$/.test(s) && s !== '*');
}

const pythonAdapter = {
  id: 'python',
  displayName: 'Python',
  language: 'Python',
  extensions: PY_EXTENSIONS,

  /**
   * Does this FILE belong to my stack? `.py` by extension. PURE.
   * @param {string} filePath repo-relative path
   * @returns {boolean}
   */
  matches(filePath) {
    if (typeof filePath !== 'string') return false;
    return filePath.toLowerCase().endsWith('.py');
  },

  /**
   * The import edges of one Python file: the repo-relative files it imports,
   * resolved against `repoFiles`. Stdlib / third-party / unresolvable specifiers
   * are DROPPED (no matching repo file). A file never imports itself. NEVER
   * throws (universal §VI) — odd input → `[]`.
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

    const add = (candidates) => {
      const real = firstReal(candidates, fileSet);
      if (real && real !== filePath) out.add(real);
    };

    for (const rawLine of content.split('\n')) {
      if (isCommentLine(rawLine)) continue;
      // Drop an inline `# comment` tail so it can't fool the name parser.
      const line = rawLine.split('#')[0];

      const fm = FROM_RE.exec(line);
      if (fm) {
        const dots = fm[1] ? fm[1].length : 0;
        const module = fm[2];
        // 1) the module itself (a/b.py | a/b/__init__.py).
        add(moduleCandidates(module, dots, filePath));
        // 2) each imported name as a possible SUBMODULE (a/b/x.py | …/__init__.py).
        for (const name of importedNames(fm[3])) {
          const sub = module ? `${module}.${name}` : name;
          add(moduleCandidates(sub, dots, filePath));
        }
        continue;
      }

      const im = IMPORT_RE.exec(line);
      if (im) {
        for (const part of im[1].split(',')) {
          const dotted = part.trim().split(/\s+as\s+/)[0].trim();
          if (/^[\w.]+$/.test(dotted)) add(moduleCandidates(dotted, 0, filePath));
        }
      }
    }
    return [...out];
  },
};

export default pythonAdapter;
