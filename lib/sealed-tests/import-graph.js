// lib/sealed-tests/import-graph.js — the GENERIC (language-neutral) import-graph
// core (v0.4.c origin SPEC_V04C / ADR-027; made POLYGLOT in v0.8.1, SPEC_V081 /
// ADR-043). PROBLEMS.md P-05 "a change's true reach is invisible".
//
//   dispatch each file to its language ADAPTER for its import edges  →  build the
//   import graph  →  invert it  →  reverse-closure from the changed set = the
//   true blast radius.
//
// §VIII (technology-agnostic analysis, NON-NEGOTIABLE): this core contains NO
// language syntax. It does not know what an `import` or a `require` looks like —
// it asks the registry (../code-graph/adapters) for each file's adapter and lets
// the adapter produce the edges. The reverse-closure math below is pure graph
// theory over already-resolved edges. JS specifier parsing lives in
// adapters/javascript.js; Python in adapters/python.js; a file whose language has
// NO adapter is reported in `unanalyzed` and contributes no edges — never a
// fabricated or silently-empty edge set passed off as complete (§VI honesty).
//
// Dependency direction (SPEC §3, DoD #4): the core imports the REGISTRY
// (adapters/index.js), never a SPECIFIC adapter. core ← adapters.
//
// PURE over injected reads (universal §I.S, §II): NO `node:fs` import — the unit
// suite drives it with in-memory file maps. Every public function tolerates junk
// input and never throws (universal §VI).
//
// Public API:
//   - buildImportGraph(files, readFile) -> Map<file, Set<resolvedImport>>
//       (back-compat: the resolved forward graph, JS+Python+… via adapters)
//   - buildForwardGraph(files, readFile) -> { graph, unanalyzed }
//       the graph PLUS the honest list of files whose language has no adapter
//   - invertGraph(graph) -> Map<importee, Set<importer>>
//   - reverseClosure(graph, changed) -> Set<file>  transitive importers (excl. seeds)

import { adapterFor, unanalyzedLanguageFor } from '../code-graph/adapters/index.js';

// ── Forward graph construction (per-file adapter dispatch) ──────────────────

/**
 * Build the forward import graph AND the honest un-analyzed list.
 *
 * Each file is dispatched to its language adapter (via the registry); the
 * adapter resolves the file's imports to concrete repo files. A file with NO
 * adapter contributes no edges and, if it is a recognized CODE file (Rust, Go,
 * C, …), is recorded in `unanalyzed` with its language — so a caller can SAY the
 * graph's coverage is partial rather than treat it as complete (§VIII / §VI).
 * Non-code files (`.md`, `.json`, …) are neither edged nor reported.
 *
 * Unreadable files are skipped (advisory tool, never fatal). NEVER throws.
 *
 * @param {string[]} files repo-relative paths to scan
 * @param {(relPath: string) => string} readFile read one file's text
 * @returns {{ graph: Map<string, Set<string>>,
 *             unanalyzed: Array<{ file: string, language: string }> }}
 */
export function buildForwardGraph(files, readFile) {
  const graph = new Map();
  const unanalyzed = [];
  if (!Array.isArray(files) || typeof readFile !== 'function') return { graph, unanalyzed };

  const norm = (f) => f.replace(/\\/g, '/');
  const fileSet = new Set(
    files.filter((f) => typeof f === 'string' && f.length > 0).map(norm),
  );

  for (const file of fileSet) {
    const adapter = adapterFor(file);
    if (!adapter) {
      // No adapter: contributes no edges. If it is recognized CODE of an
      // un-adapted language, record it honestly; otherwise (a doc/config file)
      // ignore it entirely. We do NOT add a graph node for non-code files (it
      // would never carry an edge anyway — back-compat for the closure).
      const language = unanalyzedLanguageFor(file);
      if (language) unanalyzed.push({ file, language });
      continue;
    }
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
    let edges;
    try {
      edges = adapter.importEdges({ filePath: file, content: text, repoFiles: fileSet });
    } catch {
      edges = []; // a misbehaving adapter must never break the graph (§VI)
    }
    const imports = new Set();
    for (const dep of Array.isArray(edges) ? edges : []) {
      if (typeof dep === 'string' && dep.length > 0 && dep !== file) imports.add(dep);
    }
    graph.set(file, imports);
  }
  return { graph, unanalyzed };
}

/**
 * Build the import graph: each file → the set of repo files it imports
 * (resolved). Back-compat wrapper over `buildForwardGraph` for callers that only
 * need the graph (the `unanalyzed` list is the additive v0.8.1 face).
 *
 * @param {string[]} files repo-relative paths to scan
 * @param {(relPath: string) => string} readFile read one file's text
 * @returns {Map<string, Set<string>>} file → set of resolved imports
 */
export function buildImportGraph(files, readFile) {
  return buildForwardGraph(files, readFile).graph;
}

// ── Graph inversion + reverse closure (pure graph math — NO language tokens) ─

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
 * Cycle-safe: a visited set guards against an import cycle hanging the walk.
 * Never throws (universal §VI).
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
