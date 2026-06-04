// lib/conductor/expectation.js — freeze the ORIGINAL expectation at run start as
// an immutable alignment oracle (v0.17.a, SPEC_V017A AC-1, ADR-056).
//
// WHY (the drift SPEC_V017A names): MMD's v0.11 semantic judge grades the
// implementation against "the dream / .mmd/shared/slice.md" — but slice.md is
// written by the build and the spec phase can POLISH it, so the build can quietly
// redefine its own success. The fix is to freeze what was ORIGINALLY asked at
// run start into `.mmd/shared/expectation.md` and grade BOTH faces against that
// frozen oracle. The build may rewrite slice.md/spec all it likes; expectation.md
// is never overwritten (anti-drift; the goalposts cannot move).
//
// Constitution: §II KISS (a pure builder + a thin write-once writer, injected fs —
// no clever abstraction), §VI honesty (never throws; a re-run/resume NEVER
// overwrites an existing oracle, so the original ask survives every retry).
//
// Public API:
//   - buildExpectationContent(dream, scope)   PURE, never throws → markdown string
//   - writeExpectation(sharedDir, dream, scope, { fs, existsSync })
//       write-once → { written: true } | { written: false, reason }

import path from 'node:path';

/**
 * Build the markdown body of `expectation.md` from the original dream and the
 * optional Dream-Catcher scope. PURE — no I/O, NEVER throws (odd/empty inputs
 * degrade to empty strings; the scope section is omitted when there is no scope).
 *
 * @param {string} dream   the ORIGINAL dream, verbatim
 * @param {string} [scope] the Dream-Catcher refined scope (greenfield), when present
 * @returns {string} the markdown content for expectation.md
 */
export function buildExpectationContent(dream, scope) {
  const dreamText = typeof dream === 'string' ? dream.trim() : '';
  const scopeText = typeof scope === 'string' ? scope.trim() : '';

  const lines = [
    '# Original expectation (frozen oracle — do NOT edit)',
    '> Written at run start. Immutable — this file is the alignment oracle.',
    '',
    '## Original dream',
    dreamText,
  ];

  if (scopeText !== '') {
    lines.push(
      '',
      '## Dream-Catcher scope (if present)',
      scopeText,
    );
  }

  // Trailing newline for a well-formed text file.
  return lines.join('\n') + '\n';
}

/**
 * Write `.mmd/shared/expectation.md` ONCE. If the file already exists (a re-run
 * or a resume), this is a NO-OP — the original expectation is immutable, so the
 * build can never move the goalposts (anti-drift). NEVER throws: any write error
 * degrades to `{ written: false, reason }` (the caller decides whether to warn).
 *
 * The fs/existsSync seams are injected so the unit suite can assert the
 * write-once invariant with a fake fs (no real disk), mirroring the rest of the
 * conductor's pure-core / injected-edge shape.
 *
 * @param {string} sharedDir  the run's `.mmd/shared/` directory
 * @param {string} dream      the ORIGINAL dream, verbatim
 * @param {string} [scope]    the Dream-Catcher scope, when present
 * @param {{ fs: { writeFileSync: Function }, existsSync: Function }} deps
 * @returns {{ written: boolean, reason?: string, path?: string }}
 */
export function writeExpectation(sharedDir, dream, scope, { fs, existsSync } = {}) {
  if (typeof sharedDir !== 'string' || sharedDir.length === 0) {
    return { written: false, reason: 'no sharedDir' };
  }
  if (!fs || typeof fs.writeFileSync !== 'function' || typeof existsSync !== 'function') {
    return { written: false, reason: 'no fs seam' };
  }
  const target = path.join(sharedDir, 'expectation.md');

  // Write-once: an existing oracle is NEVER overwritten (immutable; resume-safe).
  let alreadyThere = false;
  try {
    alreadyThere = existsSync(target);
  } catch {
    // An odd existsSync error → treat as "unknown"; fall through to the write
    // attempt, which is itself guarded. Honest, never throws.
    alreadyThere = false;
  }
  if (alreadyThere) {
    return { written: false, reason: 'already exists', path: target };
  }

  try {
    fs.writeFileSync(target, buildExpectationContent(dream, scope), 'utf8');
    return { written: true, path: target };
  } catch (err) {
    return { written: false, reason: `write failed: ${err && err.message ? err.message : err}`, path: target };
  }
}

/**
 * Resolve the semantic judge's anchor (v0.17.a, SPEC_V017A AC-2): the FROZEN
 * expectation oracle when present, else an HONEST fallback to the in-memory
 * dream. The build's mutable slice.md is NEVER the anchor — only expectation.md
 * (the original ask) or, when it is unavailable, the dream itself.
 *
 * `readExpectation` is injected so the unit suite asserts both branches without a
 * real disk. NEVER throws: a missing / unreadable / empty oracle → the dream.
 *
 * @param {string} expectationDir  the run's `.mmd/shared/` directory
 * @param {string} dream           the in-memory dream (fallback anchor)
 * @param {{ readExpectation: (target: string) => string }} deps  injected reader
 * @returns {string} the oracle text used as the judge's grading anchor
 */
export function resolveAlignmentAnchor(expectationDir, dream, deps) {
  const readExpectation = deps && typeof deps.readExpectation === 'function'
    ? deps.readExpectation
    : null;
  if (typeof expectationDir === 'string' && expectationDir.length > 0 && readExpectation) {
    let content = null;
    try {
      content = readExpectation(path.join(expectationDir, 'expectation.md'));
    } catch {
      content = null;
    }
    if (typeof content === 'string' && content.trim() !== '') return content;
  }
  return typeof dream === 'string' ? dream : '';
}
