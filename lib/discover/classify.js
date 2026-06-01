// lib/discover/classify.js — pure function mapping scan data to a discovery case.
//
// SRP (universal.md §I.S): owns ONLY the case-detection logic. No filesystem,
// no I/O — just a deterministic transform over the SCAN output. This lets
// classify() be unit-tested exhaustively without fixtures.
//
// Spec: SPEC_V02C §5 ("Case detection priority"), extended by SPEC_V06A AC-1:
//   1. `.mmd/shared/project-onboarder/last.md` exists AND contains `VALIDATED`
//      → 'already-onboarded'
//   2. Spec Kit OR BMAD detected → 'rich' (Spec Kit takes precedence if both)
//   3. `docs/stories/` with 10+ files → 'bmad-alone' (possible spec sprawl)
//   4. A recognized stack was scanned (a language/framework) but NO SDD
//      methodology → 'brownfield-app' (v0.6.a: a real Node/Python/Go/Rust app
//      MMD can onboard, NOT an empty repo)
//   5. Else → 'blank' (genuinely empty / unstructured — no manifest, no code)
//
// The five return values match the report's "Detected case" line. Spelling
// matters: tests assert on these exact strings.

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
  'brownfield-app',
  'blank',
]);

/**
 * Did the SCAN detect a recognized stack — a language or framework — in this
 * repo? This is the signal that separates a real (brownfield) app from a
 * genuinely empty/unstructured repo (v0.6.a AC-1).
 *
 * Per SPEC_V06A implementation hint #2: treat `frameworks.language` truthy OR
 * `languages` non-empty as "recognized stack". Defensive against the malformed
 * inputs classify() already tolerates — any odd shape simply reads as "no
 * stack" rather than throwing (error-handling.md §III graceful degradation).
 *
 * @param {object} scanData
 * @returns {boolean}
 */
function hasRecognizedStack(scanData) {
  const f = scanData.frameworks;
  if (f && typeof f === 'object' && f.language) return true;

  const langs = scanData.languages;
  // Legacy / alternate shape: a plain array of language names.
  if (Array.isArray(langs)) return langs.length > 0;
  // Scan shape (lib/discover/scan.js detectLanguages): { total, by_ext, top5 }.
  if (langs && typeof langs === 'object') {
    if (Array.isArray(langs.top5) && langs.top5.length > 0) return true;
    if (typeof langs.total === 'number' && langs.total > 0) return true;
  }
  return false;
}

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
 * @param {object}  [scanData.frameworks]      detected framework hints (scan.js)
 * @param {string|null} [scanData.frameworks.language]  primary language, if known
 * @param {object|string[]} [scanData.languages]  detected languages ({total,by_ext,top5} or legacy array)
 * @returns {'already-onboarded'|'rich'|'bmad-alone'|'brownfield-app'|'blank'}
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

  // Priority 4 (v0.6.a AC-1): a recognized stack but no SDD methodology is a
  // real brownfield app MMD can onboard — NOT a blank repo. This sits below
  // rich/bmad-alone (an SDD project is "richer" than a bare app) and above
  // blank (which is reserved for a genuinely empty/unstructured repo).
  if (hasRecognizedStack(scanData)) return 'brownfield-app';

  // Priority 5: genuinely empty / unstructured — no manifest, no code, no SDD.
  return 'blank';
}
