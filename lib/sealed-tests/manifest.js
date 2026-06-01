// lib/sealed-tests/manifest.js — the SEAL of the sealed-test oracle (v0.4.a).
//
// A "seal" is a content hash manifest of the acceptance-test directory the
// tester sub-agent produced BEFORE the coder (auto-dev) ran. After the coder
// finishes, MMD re-hashes the same directory and compares: any file whose hash
// changed, or that disappeared, means the coder rewrote/deleted the oracle to
// make it pass — the classic AI failure (PROBLEMS.md P-04). That is a TAMPER
// and MMD refuses to mark the slice done (SPEC_V04A AC-2/AC-4).
//
// Design (universal §I.S, §II KISS): PURE over injected fs. The directory is
// addressed only through `readdirFn` (list the sealed dir's relative file
// paths) and `readFileFn` (read one file's bytes). No `node:fs` import here, so
// the unit suite exercises build / verify / tamper / removed / added with plain
// in-memory fakes and no temp dirs. The orchestrator in bin/mmd.js supplies the
// real fs-backed lister/reader.
//
// `node:crypto` IS imported directly: sha256 is a deterministic pure function
// of its input bytes, so it does not compromise testability the way real fs I/O
// would (the same input always yields the same digest).
//
// Constitution: universal §VI (honesty — never a silent "sealed OK": a missing
// dir returns an explicit empty manifest, callers treat empty-seal as an error),
// §I.S (this module only hashes + diffs; it never spawns, never reads real fs).
//
// Public API:
//   - buildManifest(dir, readdirFn, readFileFn)            -> { relPath: sha256 }
//   - verifyManifest(dir, manifest, readdirFn, readFileFn) -> { tampered, removed, added }

import { createHash } from 'node:crypto';

/**
 * sha256 hex digest of a file's bytes. Accepts a string or Buffer (Node's
 * createHash handles both); `undefined`/`null` content hashes the empty string
 * so a reader that returns nothing is still deterministic (never throws).
 *
 * @param {string|Buffer} content
 * @returns {string} 64-char lowercase hex digest
 */
export function sha256(content) {
  return createHash('sha256').update(content == null ? '' : content).digest('hex');
}

/**
 * Build a deterministic content manifest of the sealed directory.
 *
 * `readdirFn(dir)` MUST return an array of file paths RELATIVE to `dir`
 * (the orchestrator's real implementation walks the tree; the unit fakes
 * just return a fixed list). `readFileFn(dir, relPath)` returns that file's
 * bytes (string or Buffer).
 *
 * NEVER throws on a missing dir (SPEC_V04A AC-2): if `readdirFn` throws (e.g.
 * ENOENT) the manifest is empty `{}` — callers MUST treat an empty seal as an
 * explicit error (the tester wrote nothing), never a silent pass (universal §VI).
 * A single unreadable file is also tolerated (skipped) rather than aborting the
 * whole seal — the verify step will then surface it as `removed`.
 *
 * @param {string} dir absolute path to the sealed dir (passed through to the fns)
 * @param {(dir: string) => string[]} readdirFn
 * @param {(dir: string, relPath: string) => (string|Buffer)} readFileFn
 * @returns {Record<string, string>} { relPath: sha256 } — keys sorted for stable JSON
 */
export function buildManifest(dir, readdirFn, readFileFn) {
  let entries;
  try {
    entries = readdirFn(dir);
  } catch {
    // Missing / unreadable dir → empty seal (never throw — AC-2).
    return {};
  }
  if (!Array.isArray(entries)) return {};

  const manifest = {};
  // Sort so the manifest's key order is deterministic regardless of readdir order.
  for (const relPath of [...entries].sort()) {
    let content;
    try {
      content = readFileFn(dir, relPath);
    } catch {
      // One unreadable file: skip it. It is absent from the seal, so if it
      // reappears later verify reports it as `added` rather than crashing now.
      continue;
    }
    manifest[relPath] = sha256(content);
  }
  return manifest;
}

/**
 * Verify a previously-built manifest against the directory's CURRENT state.
 *
 * Returns three disjoint lists (each sorted, for stable reporting):
 *   - tampered: relPaths present in BOTH but whose content hash changed
 *   - removed:  relPaths in the original manifest but gone now
 *   - added:    relPaths present now but absent from the original manifest
 *
 * Identical state → all three empty. NEVER throws on a missing dir (AC-2): a
 * vanished sealed dir yields `removed` = every original key, `tampered`/`added`
 * empty — which the orchestrator surfaces loudly (the oracle was deleted).
 *
 * `manifest` is treated read-only. A null/undefined manifest is normalized to
 * `{}` (defensive: a caller that lost the seal sees every current file as
 * `added`, never a crash).
 *
 * @param {string} dir
 * @param {Record<string, string>} manifest the sealed { relPath: sha256 }
 * @param {(dir: string) => string[]} readdirFn
 * @param {(dir: string, relPath: string) => (string|Buffer)} readFileFn
 * @returns {{ tampered: string[], removed: string[], added: string[] }}
 */
export function verifyManifest(dir, manifest, readdirFn, readFileFn) {
  const sealed = manifest && typeof manifest === 'object' ? manifest : {};
  const current = buildManifest(dir, readdirFn, readFileFn);

  const tampered = [];
  const removed = [];
  const added = [];

  for (const relPath of Object.keys(sealed)) {
    if (!(relPath in current)) {
      removed.push(relPath);
    } else if (current[relPath] !== sealed[relPath]) {
      tampered.push(relPath);
    }
  }
  for (const relPath of Object.keys(current)) {
    if (!(relPath in sealed)) added.push(relPath);
  }

  return {
    tampered: tampered.sort(),
    removed: removed.sort(),
    added: added.sort(),
  };
}

/**
 * Convenience predicate: is the seal intact? A seal is broken when ANY file was
 * tampered or removed. `added` files alone do NOT break the seal — a coder
 * legitimately adds its own (non-sealed) test files; only weakening/deleting the
 * sealed oracle is the P-04 failure we forbid (SPEC_V04A AC-4).
 *
 * @param {{ tampered: string[], removed: string[], added: string[] }} verdict
 * @returns {boolean}
 */
export function sealIntact(verdict) {
  return (
    !!verdict &&
    Array.isArray(verdict.tampered) && verdict.tampered.length === 0 &&
    Array.isArray(verdict.removed) && verdict.removed.length === 0
  );
}
