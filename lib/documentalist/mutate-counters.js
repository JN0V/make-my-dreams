// lib/documentalist/mutate-counters.js — pure counter mutator.
//
// SPEC_V090 AC-2 (the signal swap): a lesson's promotion counter rises by its
// VALIDATED REUSES not-yet-credited — NOT by raw injection count (ADR-010's
// wrong signal). A validated reuse is a distinct `done` run that injected the
// lesson (lib/autolearn/validated-reuse.js). Crediting is idempotent: a run
// already counted in a prior `document-lessons` run is passed in `creditedRuns`
// and excluded, so re-running never double-counts a run.
//
// Given the enriched lesson list (the v0.2.7 parser output merged with the
// counter metadata from serialize-lessons.js#parseCounterMeta), the per-lesson
// validated reuses, and the already-credited runs, compute the new counter per
// lesson and the set of lessons that reach their promotion threshold.
//
// Pure: no file writes. The caller serializes the result back to disk AND
// persists the newly-credited run ids (the idempotency record).
//
// Skip rules (carried from SPEC_V02I AC-3 + §5 "Milestone lessons skip"):
//   - status !== 'active'        → milestone/promoted/unknown never increment.
//   - counter or promoteIfN null → no parseable `**To promote if**` line; skip.
//   - no newly-credited reuses   → unchanged.

/**
 * @param {Array<{
 *   id: string, status: string,
 *   counter: number|null, promoteIfN: number|null,
 *   targetModule?: string, promoteLine?: string|null,
 *   title?: string, rule?: string,
 * }>} lessons
 * @param {Map<string, { count: number, runIds?: string[] }>|Record<string, { count: number, runIds?: string[] }>} validatedByLesson
 *   per-lesson validated reuses (validatedReuses output): `count` + the distinct
 *   `runIds`. `runIds` drives idempotent crediting; a value with no `runIds`
 *   credits nothing (its runs cannot be identified).
 * @param {{ creditedRuns?: Record<string, string[]>|Map<string, string[]> }} [opts]
 * @returns {{
 *   updatedLessons: object[],
 *   toPromote: object[],
 *   newlyCreditedRuns: Record<string, string[]>,
 * }}
 */
export function mutateCounters(lessons, validatedByLesson, opts = {}) {
  if (!Array.isArray(lessons)) {
    throw new TypeError('mutateCounters: lessons must be an array');
  }
  const getValidated = (id) =>
    validatedByLesson instanceof Map ? validatedByLesson.get(id) : validatedByLesson?.[id];

  const creditedRaw = opts.creditedRuns || {};
  const creditedFor = (id) => {
    const arr = creditedRaw instanceof Map ? creditedRaw.get(id) : creditedRaw[id];
    return new Set(Array.isArray(arr) ? arr : []);
  };

  const updatedLessons = [];
  const toPromote = [];
  const newlyCreditedRuns = {};

  for (const lesson of lessons) {
    const v = getValidated(lesson.id);
    const allRunIds = v && Array.isArray(v.runIds) ? v.runIds : [];
    const validatedReuseTotal = v ? (v.count ?? allRunIds.length) : 0;
    const alreadyCredited = creditedFor(lesson.id);
    const newRunIds = allRunIds.filter((r) => !alreadyCredited.has(r));
    const delta = newRunIds.length;

    // Not a promotable lesson (milestone/promoted/no `**To promote if**` line)
    // → carry through unchanged. We expose validatedReuseTotal regardless so the
    // CLI can surface it (AC-4).
    const promotable =
      lesson.status === 'active' && lesson.counter != null && lesson.promoteIfN != null;
    if (!promotable) {
      updatedLessons.push({ ...lesson, counterDelta: 0, validatedReuseTotal });
      continue;
    }

    const newCounter = lesson.counter + delta;
    const updated = {
      ...lesson,
      previousCounter: lesson.counter,
      counter: newCounter,
      counterDelta: delta,
      validatedReuseTotal,
    };
    updatedLessons.push(updated);
    if (delta > 0) newlyCreditedRuns[lesson.id] = newRunIds;
    // A lesson is a promotion CANDIDATE whenever its counter is at/above
    // threshold — whether it crossed this run (delta > 0) or was already there
    // and is being re-considered. This is what lets the operator workflow work:
    // a first `document-lessons` run with no gate HOLDS the lesson at threshold
    // (counter persisted); a later run WITH MMD_PROMOTE_GATE_CMD set re-gates and
    // promotes it — even though no NEW validated reuse arrived (delta = 0). The
    // gate decides each time; the counter only gates which lessons it sees.
    if (newCounter >= lesson.promoteIfN) toPromote.push(updated);
  }

  return { updatedLessons, toPromote, newlyCreditedRuns };
}
