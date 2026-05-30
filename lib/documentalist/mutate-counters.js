// lib/documentalist/mutate-counters.js — pure counter mutator (SPEC_V02I AC-3).
//
// Given the enriched lesson list (the v0.2.7 parser output merged with the
// counter metadata from serialize-lessons.js#parseCounterMeta) and the
// aggregator output, compute the new counter per matched lesson and the set of
// lessons that reach their promotion threshold.
//
// Pure: no file writes. The caller serializes the result back to disk.
//
// Skip rules (SPEC_V02I AC-3 + §5 "Milestone lessons skip"):
//   - status !== 'active'        → milestone/promoted/unknown never increment.
//   - counter or promoteIfN null → no parseable `**To promote if**` line; skip.
//   - no injections this run     → unchanged.

/**
 * @param {Array<{
 *   id: string, status: string,
 *   counter: number|null, promoteIfN: number|null,
 *   targetModule?: string, promoteLine?: string|null,
 *   title?: string, rule?: string,
 * }>} lessons
 * @param {Map<string, { count: number, runIds?: Set<string> }>|Record<string, { count: number }>} byLesson
 * @returns {{ updatedLessons: object[], toPromote: object[] }}
 */
export function mutateCounters(lessons, byLesson) {
  if (!Array.isArray(lessons)) {
    throw new TypeError('mutateCounters: lessons must be an array');
  }
  const get = (id) => (byLesson instanceof Map ? byLesson.get(id) : byLesson?.[id]);

  const updatedLessons = [];
  const toPromote = [];

  for (const lesson of lessons) {
    const inj = get(lesson.id);
    const injCount = inj ? (inj.count ?? (inj.runIds ? inj.runIds.size : 0)) : 0;

    // Not promotable / not injected → carry through unchanged.
    if (
      lesson.status !== 'active' ||
      lesson.counter == null ||
      lesson.promoteIfN == null ||
      injCount <= 0
    ) {
      updatedLessons.push({ ...lesson, counterDelta: 0 });
      continue;
    }

    const newCounter = lesson.counter + injCount;
    const updated = {
      ...lesson,
      previousCounter: lesson.counter,
      counter: newCounter,
      counterDelta: injCount,
    };
    updatedLessons.push(updated);
    if (newCounter >= lesson.promoteIfN) toPromote.push(updated);
  }

  return { updatedLessons, toPromote };
}
