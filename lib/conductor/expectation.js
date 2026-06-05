// lib/conductor/expectation.js — freeze the ORIGINAL expectation at run start as
// an immutable alignment oracle (v0.17.a, SPEC_V017A AC-1, ADR-056), now PER-DREAM
// (v0.20.a, SPEC_V020A, ADR-059).
//
// WHY (the drift SPEC_V017A names): MMD's v0.11 semantic judge grades the
// implementation against "the dream / .mmd/shared/slice.md" — but slice.md is
// written by the build and the spec phase can POLISH it, so the build can quietly
// redefine its own success. The fix is to freeze what was ORIGINALLY asked at
// run start into `.mmd/shared/expectation.md` and grade BOTH faces against that
// frozen oracle. The build may rewrite slice.md/spec all it likes; expectation.md
// is never overwritten WITHIN a dream (anti-drift; the goalposts cannot move).
//
// WHY v0.20.a (the leak SPEC_V020A names): the original writer was write-ONCE
// FOREVER — if expectation.md existed, it no-op'd. But `.mmd/shared/` persists
// across slices on a repo, so a genuinely-NEW dream found the PRIOR slice's
// oracle and the judge graded the new work against the OLD dream's criteria (zero
// real verification). The fix stamps a machine-readable `dream-id` (sha256 of the
// normalized dream) into the oracle and decides three-way on run start: no oracle
// → write; same dream-id → preserve (re-run); different dream-id AND not a resume
// → OVERWRITE (a fresh oracle for the new dream); different dream-id on a RESUME →
// preserve but flag a mismatch so the caller warns. Anti-drift stays intact WITHIN
// a dream (same dream OR resume never overwrites); only a different dream on a
// non-resume launch refreshes the oracle.
//
// Constitution: §II KISS (a pure builder + a pure three-way decision + a thin
// writer over an injected fs — no clever abstraction), §VI honesty (never throws;
// any read/parse/write error degrades to the SAFE conservative PRESERVE with an
// honest reason, so the gate can never crash a run), zero new dependency (Node's
// built-in `crypto` for the stamp — the L-024 vanilla-stack bar).
//
// Public API:
//   - expectationDreamId(dream)               PURE, never throws → 16-hex id string
//   - readExpectationDreamId(content)          PURE, never throws → id string | null
//   - buildExpectationContent(dream, scope)    PURE, never throws → markdown string
//   - decideExpectationWrite({existing, currentDreamId, isResume})
//       PURE, never throws → { action: 'write-fresh' | 'preserve', mismatch? }
//   - writeExpectation(sharedDir, dream, scope, { fs, existsSync, readFileSync, isResume })
//       per-dream → { written: true|false, reason?, path?, mismatch? }

import path from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Compute a stable, machine-readable identity for a dream: the first 16 hex chars
 * of the sha256 of the normalized (trimmed + whitespace-collapsed) dream text.
 * PURE — no I/O, NEVER throws (odd/empty inputs → the stable id of the empty
 * string, which is a real id, not null/undefined).
 *
 * @param {string} dream the dream text
 * @returns {string} a 16-char lowercase hex id
 */
export function expectationDreamId(dream) {
  try {
    const normalized = (typeof dream === 'string' ? dream : '').trim().replace(/\s+/g, ' ');
    return createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 16);
  } catch {
    return createHash('sha256').update('', 'utf8').digest('hex').slice(0, 16);
  }
}

/**
 * Extract the stamped dream-id from an oracle's content. PURE — NEVER throws.
 * Returns null when the stamp is absent/malformed or the input is not a string
 * (e.g. an old v0.17 oracle written before the stamp existed → null → treated as
 * "different dream" by the decision, which on a non-resume launch refreshes it).
 *
 * @param {string} content the full oracle markdown
 * @returns {string|null} the 16-hex id, or null
 */
export function readExpectationDreamId(content) {
  if (typeof content !== 'string') return null;
  const m = content.match(/<!--\s*dream-id:\s*([a-f0-9]{16})\s*-->/);
  return m ? m[1] : null;
}

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
  const id = expectationDreamId(dream);

  const lines = [
    '# Original expectation (frozen oracle — do NOT edit)',
    '> Written at run start. Immutable — this file is the alignment oracle.',
    '',
    // Machine-readable dream identity (v0.20.a): lets writeExpectation tell a NEW
    // dream from a re-run/resume of the SAME dream. Human-readable text follows
    // below (universal §VII — the stamp supplements, never replaces, the prose).
    `<!-- dream-id: ${id} -->`,
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
 * Decide three-way whether to (over)write the oracle. PURE — no I/O, NEVER throws.
 *
 *   - no existing oracle (null/undefined/blank)        → write-fresh
 *   - existing is non-string non-null (unknown oracle) → preserve (cannot read id)
 *   - existing oracle's dream-id === current dream-id   → preserve (re-run/same dream)
 *   - existing oracle's id !== current AND not a resume → write-fresh (NEW dream — the fix)
 *   - existing oracle's id !== current AND a resume     → preserve, mismatch:true (warn)
 *
 * Any unexpected error degrades to the SAFE conservative `preserve` (the anti-drift
 * default — when in doubt, do not move the goalposts).
 *
 * @param {{ existing: string|null|undefined, currentDreamId: string, isResume: boolean }} args
 * @returns {{ action: 'write-fresh' | 'preserve', mismatch?: boolean }}
 */
export function decideExpectationWrite({ existing, currentDreamId, isResume } = {}) {
  try {
    if (existing == null || (typeof existing === 'string' && existing.trim() === '')) {
      return { action: 'write-fresh' };
    }
    // Non-string truthy existing (e.g. 42, {}) → unknown oracle → safe preserve
    // (spec: unknown input → preserve; never overwrite when we can't read the id).
    if (typeof existing !== 'string') {
      return { action: 'preserve' };
    }
    const existingId = readExpectationDreamId(existing);
    if (existingId != null && existingId === currentDreamId) {
      return { action: 'preserve' };
    }
    // Different dream (or an unstamped old oracle → id null → different).
    if (!isResume) return { action: 'write-fresh' };
    // A resume never moves the goalposts, even on a mismatch — but flag it so the
    // caller can warn honestly instead of silently grading the wrong dream.
    return { action: 'preserve', mismatch: true };
  } catch {
    return { action: 'preserve' };
  }
}

/**
 * Write `.mmd/shared/expectation.md` PER DREAM (v0.20.a). A NEW dream on a
 * non-resume launch OVERWRITES a stale oracle; the SAME dream (re-run) or any
 * resume PRESERVES it (anti-drift — the build can never move the goalposts WITHIN
 * a dream). NEVER throws: any read/parse/write error degrades to a safe
 * `{ written: false, reason }` (the caller decides whether to warn).
 *
 * The fs/existsSync/readFileSync seams are injected so the unit suite can assert
 * the per-dream logic with a fake fs (no real disk), mirroring the rest of the
 * conductor's pure-core / injected-edge shape.
 *
 * Backward compat: a caller that does NOT pass `readFileSync` cannot read the
 * existing oracle's id, so an existing file is treated as "unknown dream" → it is
 * refreshed on a non-resume launch and preserved on a resume.
 *
 * @param {string} sharedDir  the run's `.mmd/shared/` directory
 * @param {string} dream      the ORIGINAL dream, verbatim
 * @param {string} [scope]    the Dream-Catcher scope, when present
 * @param {{ fs: { writeFileSync: Function }, existsSync: Function, readFileSync?: Function, isResume?: boolean }} deps
 * @returns {{ written: boolean, reason?: string, path?: string, mismatch?: boolean }}
 */
export function writeExpectation(sharedDir, dream, scope, { fs, existsSync, readFileSync: readFileSyncDep, isResume = false } = {}) {
  if (typeof sharedDir !== 'string' || sharedDir.length === 0) {
    return { written: false, reason: 'no sharedDir' };
  }
  if (!fs || typeof fs.writeFileSync !== 'function' || typeof existsSync !== 'function') {
    return { written: false, reason: 'no fs seam' };
  }
  const target = path.join(sharedDir, 'expectation.md');

  let alreadyThere = false;
  try {
    alreadyThere = existsSync(target);
  } catch {
    // An odd existsSync error → treat as "not there"; honest, never throws.
    alreadyThere = false;
  }

  // Read the existing oracle's content (to extract its dream-id). When we CANNOT
  // read it (read error, or no reader seam), we cannot tell whether the existing
  // oracle is for THIS dream — so we MUST NOT overwrite it. Per spec (SPEC_V020A
  // lines 33/59/91): a read/parse error degrades to a SAFE PRESERVE (the anti-drift
  // default — never move the goalposts when in doubt).
  let existingContent = null;
  if (alreadyThere) {
    if (typeof readFileSyncDep === 'function') {
      try {
        existingContent = readFileSyncDep(target, 'utf8');
      } catch {
        // Read failed (EACCES, EBUSY, race) — cannot determine the existing
        // oracle's id → safe preserve, never overwrite.
        return { written: false, reason: 'could not read existing oracle (preserved)', path: target };
      }
    } else {
      // No reader seam provided but a file exists — cannot determine the existing
      // oracle's id → safe preserve (anti-drift default; backward compat).
      return { written: false, reason: 'exists but no reader seam (preserved)', path: target };
    }
  }

  const currentDreamId = expectationDreamId(dream);
  const decision = decideExpectationWrite({ existing: existingContent, currentDreamId, isResume: !!isResume });

  if (decision.action === 'preserve') {
    return {
      written: false,
      reason: decision.mismatch ? 'resume-mismatch' : 'same dream',
      path: target,
      ...(decision.mismatch ? { mismatch: true } : {}),
    };
  }

  // write-fresh
  try {
    fs.writeFileSync(target, buildExpectationContent(dream, scope), 'utf8');
    return { written: true, path: target, ...(alreadyThere ? { reason: 'new dream' } : {}) };
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
