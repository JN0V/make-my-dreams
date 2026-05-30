// lib/here-mode/extract-file-refs.js — pure file-reference extractor (SPEC_V02H AC-1).
//
// SRP (universal.md §I.S): one job — given the user dream/prompt text, return
// the list of repo-relative file paths it references, matching a CLOSED set of
// documented patterns. No I/O, no git, no process state — a deterministic
// string → string[] function.
//
// Why closed-pattern regex and not LLM/semantic extraction: deterministic,
// cost-free, sub-millisecond, and covers ~95% of real MMD dreams (which cite
// SPEC_*.md / docs/*.md / .specify/memory/*.md / a handful of root docs). The
// semantic path is deferred to v0.5+ (SPEC_V02H §1 non-features). See
// docs/adr/013-prompt-grounding-check.md for the rationale.
//
// Determinism (AC-1): the same input always yields the same output. Duplicates
// are collapsed to a single entry, and the result is ordered by first
// appearance in the dream text (stable, explainable to the user via the debug
// log the caller can emit).

// The closed pattern set. Order here does NOT affect the output order (that is
// driven by position in the dream); it only affects which regex first claims a
// given span — irrelevant since identical spans collapse on dedup.
//
// Note (DRY, universal.md §III): the general `docs/…\.md` pattern already
// subsumes `docs/adr/NNN-….md` (the adr path is a valid docs path), so we do
// NOT add a separate adr regex — that would be redundant. AC-1's adr example
// (`docs/adr/012-composer-categorization.md`) is matched by DOCS_MD below.
const SPEC_MD = /\bSPEC_[A-Z0-9_]+\.md\b/g;
const DOCS_MD = /\bdocs\/[a-z0-9/\-_]+\.md\b/g;
// `.specify/memory/…` begins with a dot, so a leading `\b` does NOT assert the
// intended boundary (a boundary needs a word char on one side; `.` is not one).
// We instead use a negative lookbehind: the match must not be glued to a
// preceding path/word char (so `foo/.specify/…` or `x.specify` are not split
// mid-token), which still allows the common cases (start, whitespace, backtick,
// quote, parenthesis).
const SPECIFY_MD = /(?<![\w./])\.specify\/memory\/[a-z0-9/\-_]+\.md\b/g;
// Whole-name root tokens. Each is word-boundary-anchored on both ends.
const ROOT_TOKENS = [
  /\bMAKE_MY_DREAMS\.md\b/g,
  /\bPROBLEMS\.md\b/g,
  /\bBOOTSTRAP\.md\b/g,
  /\bCLAUDE\.md\b/g,
  /\bREADME\.md\b/g,
  /\bpackage\.json\b/g,
];

const ALL_PATTERNS = [SPEC_MD, DOCS_MD, SPECIFY_MD, ...ROOT_TOKENS];

/**
 * Extract the repo-relative file paths referenced in a dream string.
 *
 * @param {string} dreamText the user-facing dream/prompt text (NOT the
 *   composer-augmented final prompt — see SPEC_V02H §5 L-016/L-018 note).
 * @returns {string[]} unique paths, ordered by first appearance. `[]` when the
 *   input is empty/non-string or contains no documented reference.
 */
export function extractFileRefs(dreamText) {
  if (typeof dreamText !== 'string' || dreamText.length === 0) return [];

  // Collect every match together with the index where it starts, so we can
  // order deterministically by first appearance and dedup stably.
  const hits = [];
  for (const pattern of ALL_PATTERNS) {
    // Each pattern carries the `g` flag; reset lastIndex defensively in case a
    // shared regex object retained state from a prior call.
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(dreamText)) !== null) {
      hits.push({ path: m[0], index: m.index });
      // Guard against zero-width matches looping forever (none of our patterns
      // are zero-width, but this keeps the loop provably terminating).
      if (m.index === pattern.lastIndex) pattern.lastIndex += 1;
    }
  }

  // Order by first-seen index; dedup keeping the earliest occurrence.
  hits.sort((a, b) => a.index - b.index);
  const seen = new Set();
  const out = [];
  for (const { path } of hits) {
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}
