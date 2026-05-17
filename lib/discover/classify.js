// lib/discover/classify.js — pure function mapping scan data to a discovery case.
//
// SRP (universal.md §I.S): owns ONLY the case-detection logic. No filesystem,
// no I/O — just a deterministic transform over the SCAN output. This lets
// classify() be unit-tested exhaustively without fixtures.
//
// Spec: SPEC_V02C §5 ("Case detection priority"):
//   1. `.mmd/shared/project-onboarder/last.md` exists AND contains `VALIDATED`
//      → 'already-onboarded'
//   2. Spec Kit OR BMAD detected → 'rich' (Spec Kit takes precedence if both)
//   3. `docs/stories/` with 10+ files → 'bmad-alone' (possible spec sprawl)
//   4. Else → 'blank'
//
// The four return values match SPEC_V02C AC-5 ("Detected case" line in the
// report). Spelling matters: tests assert on these exact strings.

/**
 * Frozen list of every possible classification — exported so tests and
 * callers can branch on a closed enum rather than open string magic.
 *
 * @type {readonly string[]}
 */
export const DISCOVERY_CASES = Object.freeze([
  'already-onboarded',
  'rich',
  'bmad-alone',
  'blank',
]);

/**
 * Pure case detector. Input is the structured output of `lib/discover/scan.js`
 * (a plain object — see scan.js for the shape). Output is one of
 * DISCOVERY_CASES.
 *
 * Defensive: a missing or malformed scanData object is treated as `blank` so
 * the caller never crashes on a degraded input. This honors error-handling.md
 * §III (graceful degradation) — classify is called late in the pipeline and
 * a hard throw here would lose all upstream work.
 *
 * @param {object} scanData                       SCAN output
 * @param {boolean} [scanData.already_onboarded]  has VALIDATED last.md
 * @param {object}  [scanData.methodologies]      detected SDD methodologies
 * @param {boolean} [scanData.methodologies.spec_kit]
 * @param {boolean} [scanData.methodologies.bmad]
 * @param {boolean} [scanData.methodologies.openspec]
 * @param {number}  [scanData.methodologies.stories_count]  # of files in docs/stories/
 * @returns {'already-onboarded'|'rich'|'bmad-alone'|'blank'}
 */
export function classify(scanData) {
  if (!scanData || typeof scanData !== 'object') return 'blank';

  // Priority 1: a previously VALIDATED report wins regardless of any other
  // signal. The user explicitly approved this onboarding — re-running discover
  // is a refresh, not a fresh discovery.
  if (scanData.already_onboarded === true) return 'already-onboarded';

  const m = scanData.methodologies || {};

  // Priority 2: Spec Kit OR BMAD presence → 'rich'. Spec Kit takes precedence
  // when both are present (per spec §5) — but the case label is the same;
  // precedence affects ingest order, not the classification string.
  if (m.spec_kit === true || m.bmad === true) return 'rich';

  // Priority 3: BMAD-style spec sprawl. The 10-file threshold matches AC-6
  // Case B ("BMAD-alone with spec sprawl"). 10 is the floor where review
  // becomes hard enough to need MMD's catch-up value.
  if (typeof m.stories_count === 'number' && m.stories_count >= 10) {
    return 'bmad-alone';
  }

  return 'blank';
}
