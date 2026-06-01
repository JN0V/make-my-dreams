// lib/discover/constitution-suggest.js — deterministic, non-destructive
// governance-gap checklist for a project's constitution (SPEC_V06B AC-1).
//
// SRP (universal.md §I.S): owns ONLY the heuristic "which common governance
// themes does this constitution text mention?" decision. It is a PURE function
// over a string — no fs, no network, no clock — so it is exhaustively
// unit-testable and stable (same input → same output). The orchestrator
// (bin/discover.js) does the file read; the renderer (report.js) does the prose.
//
// Honesty (universal.md §VI): this is a KEYWORD HEURISTIC, never an authoritative
// audit. A theme is "present" iff its keyword regex matches the text; a theme
// can be mentioned in passing and still be flagged present, or phrased in a way
// the regex misses and be flagged absent. The renderer LABELS the output a
// heuristic so a reader never mistakes it for a verdict. "Elle reste": this
// module only READS the text and SUGGESTS — it never edits the constitution.
//
// KISS/YAGNI (universal.md §II): a small static table of themes, not an LLM and
// not a config file. An LLM-enriched mode (`discover --suggest-with-claude`) is
// a deferred future opt-in (SPEC_V06B §4), not built here.

/**
 * The governance themes MMD looks for, in a fixed order so the output is
 * deterministic. Each entry pairs a human-readable `label` (universal §VII —
 * plain language, no MMD-internal module paths) with a case-insensitive
 * `keywords` regex and a `suggestion` hint shown when the theme looks absent.
 *
 * Keyword choice is deliberately broad-but-conservative: common words a
 * governance document would use for the theme, so a genuinely-covered theme
 * matches, while the absence of all of them is a reasonable "gap" signal.
 *
 * @type {ReadonlyArray<{ label: string, keywords: RegExp, suggestion: string }>}
 */
const THEMES = Object.freeze([
  {
    label: 'Testing discipline',
    keywords: /\b(test|testing|tdd|red[\s-]*green|coverage|@smoke|@unit|@integration|@e2e|assertion)\b/i,
    suggestion: 'tag tests, drive a red→green pass on every failure, and state coverage expectations',
  },
  {
    label: 'Commit & branch workflow',
    keywords: /\b(commit|branch|push|pull request|\bpr\b|merge|conventional commit|git workflow)\b/i,
    suggestion: 'atomic commits, branch-first, push immediately, and a conventional-commit style',
  },
  {
    label: 'Security practices',
    keywords: /\b(security|secret|vulnerab|sanitiz|injection|least privilege|input validation|credential|auth)\b/i,
    suggestion: 'input validation, secrets handling, least privilege, and dependency hygiene',
  },
  {
    label: 'Error handling',
    keywords: /\b(error[\s-]*handling|exception|graceful|degrade|degradation|fail[\s-]*fast|fallback|throw)\b/i,
    suggestion: 'graceful degradation, explicit failure reporting, and a consistent error/exception strategy',
  },
  {
    label: 'Design principles',
    keywords: /\b(solid|kiss|dry|yagni|separation of concerns|single responsibility|coupling|cohesion)\b/i,
    suggestion: 'SOLID, KISS, DRY, and a clear separation of concerns',
  },
  {
    label: 'Documentation',
    keywords: /\b(document|documentation|readme|docstring|comment|\badr\b|changelog)\b/i,
    suggestion: 'docstrings/comments, an up-to-date README, and ADRs for significant decisions',
  },
  {
    label: 'AI-coding hygiene',
    keywords: /\b(ai|llm|agent|prompt|hallucinat|context (window|budget|rot)|sub-?agent)\b/i,
    suggestion: 'honest AI failure reporting, prompt hygiene, and context discipline for LLM-driven work',
  },
]);

/**
 * Classify a constitution's text into governance themes that look present vs
 * absent, by case-insensitive keyword heuristic.
 *
 * Contract (AC-1):
 *   - returns `{ present: string[], missing: Array<{ theme, suggestion }> }`.
 *     `present` holds the human-readable labels of themes whose keywords matched;
 *     `missing` holds `{ theme: label, suggestion }` for themes that did not.
 *   - PURE: no fs, no network, no clock. Stable: same input → same output.
 *   - Empty / whitespace-only / non-string input → degrades to "all missing"
 *     (every theme absent) rather than throwing (error-handling.md §III). This
 *     never crashes the discover pipeline on a partial/odd read.
 *
 * @param {string} constitutionText  the raw text of the project's constitution
 * @returns {{ present: string[], missing: Array<{ theme: string, suggestion: string }> }}
 */
export function suggestConstitutionImprovements(constitutionText) {
  const text = typeof constitutionText === 'string' ? constitutionText : '';

  const present = [];
  const missing = [];
  for (const { label, keywords, suggestion } of THEMES) {
    // A non-string degraded to '' matches nothing → every theme is "missing".
    if (text.length > 0 && keywords.test(text)) {
      present.push(label);
    } else {
      missing.push({ theme: label, suggestion });
    }
  }
  return { present, missing };
}

/**
 * The themes MMD checks, exported (labels only) so tests and callers can assert
 * on the closed set rather than hard-coding strings in many places.
 *
 * @type {readonly string[]}
 */
export const CHECKED_THEMES = Object.freeze(THEMES.map((t) => t.label));
