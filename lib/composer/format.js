// lib/composer/format.js — pure formatter for the composed-prompt prefix.
//
// SPEC_V02E AC-3: builds the deterministic `## Active lessons` section that
// the composer prepends to a prompt body when one or more lessons match.
// Format is byte-deterministic: same matched set → identical prefix.
//
// Pure function — no I/O, no env reads. Caller decides whether to prepend at
// all (empty matched array → returns the original prompt unchanged in
// match.js#composeLessons).

const COMPOSER_VERSION = 'v0.2e';

/**
 * Build the `## Active lessons (auto-injected by composer v0.2e)` section
 * and prepend it to the original prompt.
 *
 * Format (frozen by AC-3):
 *
 *   ## Active lessons (auto-injected by composer v0.2e)
 *
 *   The following lessons from docs/lessons-learned.md match keywords in
 *   this prompt. They are NOT optional — they encode validated rules from
 *   past failures. Apply each rule as you work.
 *
 *   ### L-NNN — <title>
 *   **Rule**: <rule body>
 *
 *   ### L-MMM — <title>
 *   **Rule**: <rule body>
 *
 *   ---
 *
 *   <original prompt>
 *
 * Caller MUST ensure `matched` is non-empty — if empty, do NOT call this
 * function (per AC-3 + AC-4 the byte-identity guarantee: zero matches means
 * the composed prompt is the original prompt verbatim, with NO trailing or
 * leading newlines added).
 *
 * @param {string} originalPrompt
 * @param {Array<{ id: string, title: string, rule: string }>} matched
 * @returns {string}
 */
export function formatComposedPrompt(originalPrompt, matched) {
  if (typeof originalPrompt !== 'string') {
    throw new TypeError('formatComposedPrompt: originalPrompt must be a string');
  }
  if (!Array.isArray(matched) || matched.length === 0) {
    throw new Error('formatComposedPrompt: matched must be a non-empty array (caller MUST short-circuit on empty)');
  }
  const header = `## Active lessons (auto-injected by composer ${COMPOSER_VERSION})\n\n` +
    'The following lessons from docs/lessons-learned.md match keywords in this prompt. ' +
    'They are NOT optional — they encode validated rules from past failures. ' +
    'Apply each rule as you work.\n\n';
  const lessonBlocks = matched
    .map((lesson) => {
      const rule = (lesson.rule || '').trim();
      return `### ${lesson.id} — ${lesson.title}\n**Rule**: ${rule || '(no rule recorded)'}\n`;
    })
    .join('\n');
  return `${header}${lessonBlocks}\n---\n\n${originalPrompt}`;
}

export { COMPOSER_VERSION };
