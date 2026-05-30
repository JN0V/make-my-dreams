// lib/documentalist/serialize-lessons.js — pure, byte-identity-preserving
// line-based reader/writer for docs/lessons-learned.md (SPEC_V02I AC-3 support
// + the AC-4 removal primitive + the serialization round-trip safety net).
//
// Why a dedicated module rather than the v0.2.7 parse-lessons.js: the composer
// parser (lib/composer/parse-lessons.js) is LOSSY — it returns
// { id, title, status, rule, keywords, category, appliesTo } and drops the
// `**To promote if**: N reuses validated (counter: K)` line, the Origin/Context
// prose, blank lines and separators. Reconstructing the file from that model
// could never be byte-identical. SPEC_V02I §5 "Serialization round-trip safety"
// REQUIRES that parse→serialize with no mutations is byte-identical. So this
// module never reconstructs from a model: it edits the ORIGINAL text in place,
// line by line, touching only the counter token of matched lessons and removing
// only the exact line range of promoted lessons. Everything else is preserved
// verbatim.
//
// Pure: no I/O. The caller (bin/documentalist/document-lessons.js) reads/writes.

const LESSON_HEADER_RE = /^## (L-\d+)\b/;
const COUNTER_RE = /\(counter:\s*(\d+)\s*\)/;
const SEPARATOR_RE = /^---\s*$/;

/**
 * Locate each lesson block's line range. A block starts at a `## L-NNN` header
 * line and runs until (exclusive) the next lesson header or end of file. Note
 * interstitial prose (e.g. the mid-file footer paragraph) is absorbed into the
 * PRECEDING block's range — harmless because (a) round-trip rejoins every line
 * verbatim and (b) removal targets the first `---` after the header, not the
 * whole range.
 *
 * @param {string[]} lines
 * @returns {Array<{ id: string, start: number, end: number }>} end exclusive
 */
function lessonRegions(lines) {
  const regions = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(LESSON_HEADER_RE);
    if (m) {
      if (regions.length > 0) regions[regions.length - 1].end = i;
      regions.push({ id: m[1], start: i, end: lines.length });
    }
  }
  return regions;
}

/**
 * Parse the v0.2.i-specific counter metadata the composer parser drops:
 * per active/milestone lesson, the promotion threshold (`N reuses`), the
 * current counter, the raw `**To promote if**` line + its index, and the
 * target constitution module inferred from that line.
 *
 * Returns a Map keyed by lesson id. Pure.
 *
 * @param {string} markdown
 * @returns {Map<string, {
 *   id: string,
 *   status: string|null,
 *   promoteIfN: number|null,
 *   counter: number|null,
 *   counterLineIdx: number|null,
 *   promoteLine: string|null,
 *   promoteLineIdx: number|null,
 *   targetModule: string,
 * }>}
 */
export function parseCounterMeta(markdown) {
  if (typeof markdown !== 'string') {
    throw new TypeError('parseCounterMeta: markdown must be a string');
  }
  const lines = markdown.split('\n');
  const regions = lessonRegions(lines);
  const meta = new Map();
  for (const region of regions) {
    let status = null;
    let promoteIfN = null;
    let counter = null;
    let counterLineIdx = null;
    let promoteLine = null;
    let promoteLineIdx = null;
    for (let i = region.start; i < region.end; i++) {
      const line = lines[i];
      const statusM = line.match(/^\*\*Status\*\*\s*:\s*(.+)$/i);
      if (statusM && status === null) {
        status = (statusM[1].trim().split(/\s+/)[0] || '').toLowerCase();
        continue;
      }
      if (/^\*\*To promote if\*\*/i.test(line) && promoteLine === null) {
        promoteLine = line;
        promoteLineIdx = i;
        const nM = line.match(/(\d+)\s+reuses/i);
        if (nM) promoteIfN = Number(nM[1]);
        const cM = line.match(COUNTER_RE);
        if (cM) {
          counter = Number(cM[1]);
          counterLineIdx = i;
        }
      }
    }
    meta.set(region.id, {
      id: region.id,
      status,
      promoteIfN,
      counter,
      counterLineIdx,
      promoteLine,
      promoteLineIdx,
      targetModule: resolveTargetModule(promoteLine),
    });
  }
  return meta;
}

/**
 * Infer the destination constitution module from a `**To promote if**` line.
 * Recognizes phrasings actually used in the file:
 *   "promote to ai-coding.md", "promotion into testing.md",
 *   "promote to commit-git.md", "... into documentation.md".
 * Defaults to ai-coding.md when no module is named (SPEC_V02I AC-4). Pure.
 *
 * @param {string|null} promoteLine
 * @returns {string} e.g. "testing.md" (never null)
 */
export function resolveTargetModule(promoteLine) {
  if (typeof promoteLine !== 'string' || promoteLine.length === 0) return 'ai-coding.md';
  const m = promoteLine.match(/promot\w*\s+(?:in)?to\s+([a-z0-9][a-z0-9-]*)\.md/i);
  return m ? `${m[1].toLowerCase()}.md` : 'ai-coding.md';
}

/**
 * Apply counter increments in place. `updates` maps lesson id → new counter
 * value. Only the `(counter: K)` token inside the matched lesson's
 * `**To promote if**` line is rewritten; every other byte is preserved.
 * Byte-identical to the input when `updates` is empty (round-trip safety).
 *
 * @param {string} markdown
 * @param {Map<string, number>|Record<string, number>} updates
 * @returns {string}
 */
export function serializeCounterUpdates(markdown, updates) {
  if (typeof markdown !== 'string') {
    throw new TypeError('serializeCounterUpdates: markdown must be a string');
  }
  const map = updates instanceof Map ? updates : new Map(Object.entries(updates || {}));
  if (map.size === 0) return markdown;
  const lines = markdown.split('\n');
  const meta = parseCounterMeta(markdown);
  for (const [id, newCounter] of map) {
    const m = meta.get(id);
    if (!m || m.counterLineIdx == null) continue;
    lines[m.counterLineIdx] = lines[m.counterLineIdx].replace(
      COUNTER_RE,
      `(counter: ${newCounter})`,
    );
  }
  return lines.join('\n');
}

/**
 * Remove a lesson block from the file: the lines from its `## L-<id>` header
 * through the FIRST `---` separator after it (inclusive), per SPEC_V02I AC-4.
 * No-op (returns the input unchanged) when the lesson is not found. Pure.
 *
 * @param {string} markdown
 * @param {string} id  e.g. "L-005"
 * @returns {string}
 */
export function removeLessonBlock(markdown, id) {
  if (typeof markdown !== 'string') {
    throw new TypeError('removeLessonBlock: markdown must be a string');
  }
  const lines = markdown.split('\n');
  const region = lessonRegions(lines).find((r) => r.id === id);
  if (!region) return markdown;
  let removeEnd = region.start; // inclusive
  for (let i = region.start + 1; i < region.end; i++) {
    if (SEPARATOR_RE.test(lines[i])) {
      removeEnd = i;
      break;
    }
    removeEnd = i; // no separator found → fall back to whole region
  }
  lines.splice(region.start, removeEnd - region.start + 1);
  return lines.join('\n');
}
