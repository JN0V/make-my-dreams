// lib/sealed-tests/blast-radius.js — import-graph-accurate blast radius
// (v0.4.c, SPEC_V04C; PROBLEMS.md P-05 "a change's true reach is invisible").
//
// Given the files a change touched, the blast radius is "what else might this
// break?". v0.4.a shipped a deliberate fragment-grep STUB: it matched filename
// substrings inside import/require lines, so it both over-counted (a filename
// merely mentioned in a comment or string) and under-counted (no transitive
// reach, no path resolution, ./x vs ../x conflated). v0.4.c replaces that with
// a RESOLVED, TRANSITIVE import graph (lib/sealed-tests/import-graph.js):
//
//   parse the module specifiers of every file  →  resolve each relative
//   specifier to a concrete repo file  →  build the import graph  →  reverse
//   closure from the changed set = the true blast radius.
//
//   importers  = DIRECT one-hop importers of the changed files.
//   transitive = the FULL reverse closure (every file that imports a changed
//                file directly OR through a chain) — the blast radius we log.
//
// It is "import-graph accurate", NOT "AST-accurate" (vanilla-stack, zero deps):
// the residual gap — computed/runtime specifiers, re-export aliasing through
// computed names, non-JS importers — is documented in ADR-027, not hidden.
//
// PURE over injected fs (universal §I.S, §II KISS): the directory is reached
// only through `listFiles()` (all candidate files) and `readFile(path)` (one
// file's text). No `node:fs` import — the unit suite uses in-memory fakes.
//
// Constitution: universal §VI (honest — empty/unavailable input yields explicit
// empty lists, never a crash; the residual gap is stated, not hidden).
//
// Public API:
//   computeBlastRadius(changedFiles, { listFiles, readFile })
//     -> { changed, importers, transitive }

import { buildImportGraph, invertGraph, reverseClosure } from './import-graph.js';

/**
 * Compute the import-graph blast radius of a set of changed files.
 *
 * @param {string[]} changedFiles repo-relative paths the change touched
 * @param {{
 *   listFiles: () => string[],                 all candidate files to scan (repo-relative)
 *   readFile: (relPath: string) => string,     read one candidate's text
 * }} io
 * @returns {{ changed: string[], importers: string[], transitive: string[] }}
 *   all sorted + de-duped, excluding the changed files themselves:
 *     - `importers`  = direct one-hop importers (resolved imports only — a
 *                      comment-only mention is excluded; ./x and ../x are not
 *                      conflated).
 *     - `transitive` = the full reverse closure (the blast radius), cycle-safe.
 *   Empty/unavailable input → `{ changed, importers: [], transitive: [] }`
 *   (never throws — universal §VI).
 */
export function computeBlastRadius(changedFiles, io = {}) {
  const { listFiles, readFile } = io;

  // Normalize + de-dupe the changed set; tolerate junk input.
  const changedSet = new Set(
    (Array.isArray(changedFiles) ? changedFiles : [])
      .filter((f) => typeof f === 'string' && f.length > 0)
      .map((f) => f.replace(/\\/g, '/')),
  );
  const changed = [...changedSet].sort();

  const empty = { changed, importers: [], transitive: [] };
  if (changed.length === 0 || typeof listFiles !== 'function' || typeof readFile !== 'function') {
    return empty;
  }

  let candidates;
  try {
    candidates = listFiles();
  } catch {
    // Unavailable lister → explicit empty, never a crash.
    return empty;
  }
  if (!Array.isArray(candidates)) return empty;

  // Build the resolved import graph, then walk it backwards from the changed set.
  const graph = buildImportGraph(candidates, readFile);

  // Direct (one-hop) importers: invert the graph and union the changed set's
  // direct importers, excluding the changed files themselves.
  const reverse = invertGraph(graph);
  const importers = new Set();
  for (const c of changedSet) {
    const direct = reverse.get(c);
    if (!direct) continue;
    for (const importer of direct) {
      if (!changedSet.has(importer)) importers.add(importer);
    }
  }

  // Transitive reverse closure: the full blast radius (cycle-safe, seeds excluded).
  const transitive = reverseClosure(graph, changedSet);

  return {
    changed,
    importers: [...importers].sort(),
    transitive: [...transitive].sort(),
  };
}
