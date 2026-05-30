// lib/composer/filter-by-context.js — pure context filter for the composer.
//
// SPEC_V02L AC-2. Runs BEFORE keyword matching: given a parsed lessons set and
// a context `{ subcommand, phase?, engine? }`, keep only the lessons whose
// `appliesTo` list includes the context's `subcommand` OR the universal `'*'`.
//
// Mirrors the constitution's `constitution-bindings.yaml` per-context model:
// load only what applies to what we're doing right now. Backward-compatible —
// callers that pass no usable context get the full set back unchanged (the
// v0.2.7 behavior).
//
// Pure function — no I/O, no env reads.

/**
 * Filter lessons by an invocation context.
 *
 * A context is usable only when it carries a non-empty string `subcommand`
 * (e.g. 'mmd qa', 'mmd --here'). With no usable context the input is returned
 * unfiltered (a shallow copy) — this is the legacy/back-compat path.
 *
 * A lesson passes the filter when its `appliesTo` includes `'*'` (universal)
 * OR includes the exact `subcommand`. Lessons missing `appliesTo` are treated
 * as universal (`['*']`) for back-compat, matching the parser default.
 *
 * @param {Array<{ appliesTo?: string[] }>} lessons
 * @param {{ subcommand?: string, phase?: string, engine?: string } | null} [context]
 * @returns {Array} the kept subset (a new array; never mutates the input)
 */
export function filterLessonsByContext(lessons, context) {
  if (!Array.isArray(lessons)) {
    throw new TypeError('filterLessonsByContext: lessons must be an array');
  }
  const subcommand =
    context && typeof context.subcommand === 'string' ? context.subcommand.trim() : '';
  if (subcommand.length === 0) {
    // No usable context → no filtering (back-compat).
    return lessons.slice();
  }
  return lessons.filter((lesson) => {
    const appliesTo = Array.isArray(lesson.appliesTo) ? lesson.appliesTo : ['*'];
    return appliesTo.includes('*') || appliesTo.includes(subcommand);
  });
}
