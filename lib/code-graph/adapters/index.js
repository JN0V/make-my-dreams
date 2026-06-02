// lib/code-graph/adapters/index.js — the POLYGLOT import-edge adapter contract +
// registry (SPEC_V081 AC-1). This is the §VIII fix for MMD's code-dependency
// analysis: the import graph (blast-radius, ADR-027 + the coherence-graph code
// edges, ADR-037) must be a language-NEUTRAL core plus per-language adapters,
// NOT a JavaScript scanner that silently produces wrong/empty results on a
// Rust / Python / Go / C repo.
//
// SRP (universal.md §I.S): this module owns ONLY the contract and the registry —
// which adapter a given FILE selects, and how a file with NO adapter is named.
// The actual specifier parsing + resolution lives in each adapter
// (adapters/javascript.js, adapters/python.js …); the graph math (reverse
// closure) lives in the core (../sealed-tests/import-graph.js).
//
// Dependency direction (SPEC §3): **core ← adapters ← this index ← callers**.
// The core (import-graph.js reverse-closure math, coherence-graph.js) imports NO
// SPECIFIC adapter — it goes through THIS registry. This index imports the
// adapters; a caller (blast-radius.js, the document-review bin) imports this
// index. An adapter never imports the core.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE IMPORT-EDGE ADAPTER CONTRACT
// ─────────────────────────────────────────────────────────────────────────────
// Every adapter is a plain object implementing:
//
//   id            {string}  stable machine id, e.g. 'javascript', 'python'.
//   displayName   {string}  human stack name, e.g. 'JavaScript', 'Python'.
//   language      {string}  the language name reported for its files.
//
//   matches(filePath) → boolean
//       Does THIS FILE belong to my stack? Decided by extension/heuristic on the
//       PATH (a per-file decision — the import graph spans a mixed repo file by
//       file, unlike the Test Curator's repo-level manifest matching). PURE.
//
//   importEdges({ filePath, content, repoFiles }) → string[]
//       The repo-relative files THIS file imports, RESOLVED against `repoFiles`
//       (a Set or array of repo-relative paths). Unresolvable / external / stdlib
//       specifiers are DROPPED (they are not repo files). A file never imports
//       itself. NEVER throws — odd input → `[]` (an advisory graph that threw on
//       one odd file would hide the whole repo's reach; universal §VI).
//
// PER-FILE CAPABILITY HONESTY (the §VI / §VIII mechanism): a file whose language
// has NO adapter is NOT silently dropped as if it had no dependencies. It is
// classified **un-analyzed** with its detected language (`unanalyzedLanguageFor`),
// contributes NO edges, and the caller SAYS so ("code coupling for <stack> not
// available — no import adapter yet"). Emitting an empty edge set for a Rust file
// and passing the graph off as complete would be a fabricated measurement — the
// exact failure §VIII forbids.

import javascriptAdapter from './javascript.js';

// The registry: every IMPLEMENTED import-edge adapter, in a deterministic order
// (JS first — it is the dogfood stack and the AC-2 regression lock). Adding a
// language = adding one adapter file + one entry here; the core never changes
// (the whole point of §VIII). Frozen so the registry can't be mutated at runtime.
export const ADAPTERS = Object.freeze([javascriptAdapter]);

// Known CODE-language extensions that have NO adapter yet → reported as
// un-analyzed BY NAME (honest, §VI/§VIII) rather than silently ignored. This is
// deliberately SCOPED to source code: a repo's `.md` / `.json` / `.yml` / `.png`
// files are not code and never belong in the un-analyzed list (otherwise a
// JS-only repo's blast radius would be flooded with non-code "un-analyzed" noise
// and AC-3's empty-`unanalyzed` guarantee would break). A language gains an
// adapter ⇒ its extension simply stops appearing here. Extensions an adapter
// already claims (`.py` once the Python adapter ships) are NOT listed.
const UNANALYZED_CODE_LANGUAGES = Object.freeze({
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.rs': 'Rust',
  '.go': 'Go',
  '.c': 'C',
  '.h': 'C',
  '.cc': 'C++',
  '.cpp': 'C++',
  '.cxx': 'C++',
  '.hpp': 'C++',
  '.cs': 'C#',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.java': 'Java',
  '.swift': 'Swift',
  '.kt': 'Kotlin',
  '.kts': 'Kotlin',
  '.scala': 'Scala',
});

/**
 * The lowercased extension of a path (including the dot), or '' if none.
 * @param {string} filePath
 * @returns {string}
 */
export function extOf(filePath) {
  if (typeof filePath !== 'string') return '';
  const base = filePath.replace(/\\/g, '/').split('/').pop() || '';
  const i = base.lastIndexOf('.');
  return i <= 0 ? '' : base.slice(i).toLowerCase(); // <=0: no dot, or dotfile
}

/**
 * Resolve which adapter handles a FILE. Returns the first adapter whose
 * `matches(filePath)` is true, or `null` when none do. PURE — a function of the
 * path only. Never throws (a throwing adapter `matches` is skipped).
 *
 * @param {string} filePath repo-relative path
 * @returns {object|null} the matching adapter, or null
 */
export function adapterFor(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) return null;
  for (const a of ADAPTERS) {
    try {
      if (a && typeof a.matches === 'function' && a.matches(filePath)) return a;
    } catch {
      // a misbehaving adapter must never break dispatch — skip it (§VI).
    }
  }
  return null;
}

/**
 * If `filePath` is a recognized CODE file with no adapter, the human language
 * name to report it as un-analyzed; otherwise `null` (a file an adapter handles,
 * or a non-code file like `.md`/`.json`, is NOT un-analyzed). PURE.
 *
 * @param {string} filePath repo-relative path
 * @returns {string|null} e.g. 'Rust', or null
 */
export function unanalyzedLanguageFor(filePath) {
  if (adapterFor(filePath)) return null; // an adapter handles it — analyzed
  const ext = extOf(filePath);
  return UNANALYZED_CODE_LANGUAGES[ext] || null;
}

/**
 * Classify a file for the import graph: is it analyzed (has an adapter), and if
 * not, what language is it (un-analyzed) or is it simply not code? PURE, never
 * throws. The honest per-file capability record (§VIII).
 *
 * @param {string} filePath repo-relative path
 * @returns {{ filePath: string, ext: string, adapter: object|null,
 *             analyzed: boolean, language: string|null }}
 *   `analyzed:true` + the adapter for a supported file; `analyzed:false` +
 *   `language` for a recognized un-analyzed code file; `analyzed:false` +
 *   `language:null` for a non-code file (ignored by the graph).
 */
export function classifyFile(filePath) {
  const adapter = adapterFor(filePath);
  const ext = extOf(filePath);
  if (adapter) {
    return { filePath, ext, adapter, analyzed: true, language: adapter.language || adapter.displayName || null };
  }
  return { filePath, ext, adapter: null, analyzed: false, language: UNANALYZED_CODE_LANGUAGES[ext] || null };
}
