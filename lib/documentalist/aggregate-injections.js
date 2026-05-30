// lib/documentalist/aggregate-injections.js — pure aggregator over composer
// audit trails (SPEC_V02I AC-2).
//
// Reads NOTHING from disk. The caller (bin/documentalist/document-lessons.js)
// reads every `.mmd/local/**/*.composer.json`, parses each, and passes the
// parsed objects here. We tally, per lesson id, how many DISTINCT runs injected
// it — deduplicating by run_id so re-processing the same run never double-counts
// (SPEC_V02I §1, §5).
//
// composer.json schema (frozen by SPEC_V02E AC-4, lib/composer/audit.js):
//   { composer_version, lessons_file_sha, matched: [{ id, score, ... }], ... }
// Note: composer.json does NOT carry a run_id today. Per SPEC_V02I §5
// ("Dedup by run_id: ... Use the file path as fallback dedup key") we key on
// json.run_id when present, else the source file path, else a positional key.

/**
 * @param {Array<{ path?: string, json: object|null } | object>} composers
 *   Each entry is either `{ path, json }` (json === null marks a malformed
 *   file the caller could not parse) or a bare parsed composer object.
 * @param {{ onWarn?: (msg: string) => void }} [opts]
 * @returns {{
 *   totalRuns: number,
 *   byLesson: Map<string, { count: number, runIds: Set<string> }>,
 * }}
 */
export function aggregateInjections(composers, { onWarn = () => {} } = {}) {
  if (!Array.isArray(composers)) {
    throw new TypeError('aggregateInjections: composers must be an array');
  }
  const byLesson = new Map();
  const runKeys = new Set();
  let positional = 0;

  for (const entry of composers) {
    const hasWrapper = entry && typeof entry === 'object' && 'json' in entry;
    const json = hasWrapper ? entry.json : entry;
    const srcPath = hasWrapper ? entry.path : undefined;
    positional += 1;

    if (!json || typeof json !== 'object' || !Array.isArray(json.matched)) {
      onWarn(
        `aggregate-injections: skipping malformed composer audit${srcPath ? ` at ${srcPath}` : ''}`,
      );
      continue;
    }

    const dedupKey =
      (typeof json.run_id === 'string' && json.run_id) ||
      (typeof json.runId === 'string' && json.runId) ||
      srcPath ||
      `__run_${positional}`;
    runKeys.add(dedupKey);

    const seenThisRun = new Set();
    for (const m of json.matched) {
      if (!m || typeof m.id !== 'string') continue;
      if (seenThisRun.has(m.id)) continue; // one run counts a lesson once
      seenThisRun.add(m.id);
      let rec = byLesson.get(m.id);
      if (!rec) {
        rec = { count: 0, runIds: new Set() };
        byLesson.set(m.id, rec);
      }
      if (!rec.runIds.has(dedupKey)) {
        rec.runIds.add(dedupKey);
        rec.count = rec.runIds.size;
      }
    }
  }

  return { totalRuns: runKeys.size, byLesson };
}
