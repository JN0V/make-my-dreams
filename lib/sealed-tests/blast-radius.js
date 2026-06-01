// lib/sealed-tests/blast-radius.js — a grep-based blast-radius STUB (v0.4.a,
// SPEC_V04A AC-5; PROBLEMS.md P-05 "a change's true reach is invisible").
//
// Given the files a change touched, the blast radius is "what else might this
// break?". The honest, cheap first cut: the changed files PLUS their DIRECT
// importers — every other file that `import`s or `require`s a changed file.
// This is deliberately a STUB: it greps source text for references, so it can
// over- or under-count (a string that merely mentions a filename, a dynamic
// import path it cannot resolve). AST-accurate analysis is the documented v0.5
// upgrade (§4). We log it as advisory, never gate on it.
//
// PURE over injected fs (universal §I.S, §II KISS): the directory is reached
// only through `listFiles()` (all candidate files to scan) and `readFile(path)`
// (one file's text). No `node:fs` import — the unit suite uses in-memory fakes.
//
// Constitution: universal §VI (honest — an empty/unavailable input yields an
// explicit empty result, never a crash; the over/under-count limitation is
// stated, not hidden).
//
// Public API:
//   - computeBlastRadius(changedFiles, { listFiles, readFile }) -> { changed, importers }

import path from 'node:path';

/**
 * Candidate reference forms for a changed file, used to grep importers.
 *
 * For a changed file `lib/app.js` we look for any other file mentioning:
 *   - the full relative path:           'lib/app.js' / "lib/app.js"
 *   - the path without extension:       'lib/app'
 *   - the basename:                     'app.js'
 *   - the basename without extension:   'app'  (only when distinctive, len >= 3,
 *                                        to avoid matching e.g. every `js`)
 *
 * These are substrings searched inside `import …` / `require(…)` lines. Returned
 * lowercased-agnostic? No — JS module specifiers are case-sensitive, so we keep
 * case. Deduped.
 *
 * @param {string} changedFile a repo-relative path
 * @returns {string[]} distinctive reference fragments
 */
function referenceFragments(changedFile) {
  const norm = changedFile.replace(/\\/g, '/');
  const ext = path.extname(norm);
  const noExt = ext ? norm.slice(0, -ext.length) : norm;
  const base = norm.split('/').pop();
  const baseNoExt = ext ? base.slice(0, -ext.length) : base;

  const frags = new Set([norm, base]);
  if (noExt !== norm) frags.add(noExt);
  // Only add the bare basename-without-extension when it is distinctive enough
  // to not match noise (e.g. don't grep for "js" or "ui").
  if (baseNoExt && baseNoExt.length >= 3 && baseNoExt !== base) frags.add(baseNoExt);
  return [...frags];
}

// Match an import/require line that references one of the given fragments.
// We restrict to lines that look like a module reference so that a changed
// file merely *named in a comment* elsewhere does not count as an importer
// (reduces the stub's false-positive rate without an AST).
function lineReferences(line, fragments) {
  const isModuleLine = /\b(import|require|export)\b/.test(line) || /\bfrom\s+['"]/.test(line);
  if (!isModuleLine) return false;
  return fragments.some((frag) => line.includes(frag));
}

/**
 * Compute the (stub) blast radius of a set of changed files.
 *
 * @param {string[]} changedFiles repo-relative paths the change touched
 * @param {{
 *   listFiles: () => string[],                 all candidate files to scan (repo-relative)
 *   readFile: (relPath: string) => string,     read one candidate's text
 * }} io
 * @returns {{ changed: string[], importers: string[] }} both sorted + de-duped.
 *   `importers` excludes the changed files themselves. Empty/unavailable input
 *   → `{ changed: [], importers: [] }` (never throws — universal §VI).
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

  if (changed.length === 0 || typeof listFiles !== 'function' || typeof readFile !== 'function') {
    return { changed, importers: [] };
  }

  // Precompute the reference fragments for every changed file.
  const fragsByChanged = changed.map((c) => referenceFragments(c));

  let candidates;
  try {
    candidates = listFiles();
  } catch {
    // Unavailable lister → explicit empty importers, never a crash.
    return { changed, importers: [] };
  }
  if (!Array.isArray(candidates)) return { changed, importers: [] };

  const importers = new Set();
  for (const candidateRaw of candidates) {
    if (typeof candidateRaw !== 'string' || candidateRaw.length === 0) continue;
    const candidate = candidateRaw.replace(/\\/g, '/');
    if (changedSet.has(candidate)) continue; // a file is not its own importer

    let text;
    try {
      text = readFile(candidate);
    } catch {
      continue; // unreadable candidate: skip (advisory tool, never fatal)
    }
    if (typeof text !== 'string' || text.length === 0) continue;

    const lines = text.split('\n');
    const referencesAnyChanged = fragsByChanged.some((frags) =>
      lines.some((line) => lineReferences(line, frags)),
    );
    if (referencesAnyChanged) importers.add(candidate);
  }

  return { changed, importers: [...importers].sort() };
}
