// lib/autolearn/validated-reuse.js — the deterministic validated-reuse counter
// (SPEC_V090 AC-1). PURE: no fs, no spawn, never throws — so the unit suite can
// assert it exactly, like the v0.4.d judge parser and the 5-Whys parser.
//
// WHY this exists (ADR-010's wrong signal, now corrected): the composer
// increments a lesson's promotion counter on raw INJECTIONS — "the composer
// matching keywords is not the same as a validated re-use" (ADR-010 Q3). A
// lesson that merely appeared in prompts climbs toward promotion with no
// evidence it ever helped. v0.9.0 swaps that signal for a deterministic,
// reproducible proxy: a VALIDATED REUSE = a lesson injected into a run that
// completed successfully (`state === 'done'`), counted ONCE per run.
//
// This is a weak-but-honest proxy (a `done` run does not prove the lesson's rule
// was the reason it succeeded). The rigorous check happens later, at the
// promotion gate (lib/autolearn/promote-gate.js): the deterministic counter is
// cheap and always-on; the LLM gate is where the constitution actually changes.

/**
 * Count, per lesson, the number of DISTINCT runs in which the lesson was
 * injected AND the run reached `state === 'done'`.
 *
 * Rules (AC-1):
 *   - A `failed` / missing-state / in-progress run contributes 0.
 *   - Multiple injections of the same lesson within ONE run count once.
 *   - The same `runId` appearing in two records is deduplicated (counts once).
 *   - A record with no usable `runId` is skipped — without a stable run key the
 *     count would not be reproducible across re-runs nor idempotently creditable
 *     (AC-2). In MMD's pipeline every audit carries a `run_id`, so this only
 *     drops genuinely-unidentifiable records (honest, never a fabricated count).
 *
 * PURE; deterministic; NEVER throws; empty/odd input → empty Map.
 *
 * @param {Array<{ runId?: string, injectedLessonIds?: string[], state?: string }>} records
 * @returns {Map<string, { count: number, runIds: string[] }>}
 *   keyed by lesson id. `count` is THE per-lesson validated-reuse count;
 *   `runIds` (the distinct done-run ids, in first-seen order) supports the
 *   idempotent crediting in lib/documentalist/mutate-counters.js (AC-2).
 */
export function validatedReuses(records) {
  const out = new Map();
  if (!Array.isArray(records)) return out;

  for (const rec of records) {
    if (!rec || typeof rec !== 'object') continue;
    if (rec.state !== 'done') continue; // only a successful run is a validated reuse
    const runId = typeof rec.runId === 'string' && rec.runId !== '' ? rec.runId : null;
    if (!runId) continue; // no reproducible run key → cannot dedup/credit honestly
    const ids = Array.isArray(rec.injectedLessonIds) ? rec.injectedLessonIds : [];

    const seenThisRun = new Set(); // multiple injections within one run count once
    for (const id of ids) {
      if (typeof id !== 'string' || id === '') continue;
      if (seenThisRun.has(id)) continue;
      seenThisRun.add(id);

      let entry = out.get(id);
      if (!entry) {
        entry = { count: 0, runIds: [] };
        out.set(id, entry);
      }
      if (!entry.runIds.includes(runId)) {
        entry.runIds.push(runId);
        entry.count = entry.runIds.length;
      }
    }
  }

  return out;
}
