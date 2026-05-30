// lib/composer/match.js — keyword-overlap matching + composer entry point.
//
// SPEC_V02E AC-1, AC-3, AC-4. Deterministic, sub-100ms, no LLM cost. The
// promise: every `mmd` subprocess invocation can call `composeLessons` to
// auto-prepend matched lessons to its prompt — closing scoping §6.5's
// autolearning loop end-to-end.
//
// Three exported functions:
//   - matchLessons(prompt, lessons[], opts)    pure, no I/O
//   - composeLessons(prompt, lessonsPath, opts)  reads the file, parses, matches, formats
//   - composeLessonsSync(prompt, lessonsPath, opts)  sync variant for callers that can't await
//
// MMD_COMPOSER_DISABLED=1 short-circuits both compose* functions — returns
// the original prompt unchanged. Escape hatch for debugging / fallback.

import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

import { parseLessons } from './parse-lessons.js';
import { filterLessonsByContext } from './filter-by-context.js';
import { formatComposedPrompt, COMPOSER_VERSION } from './format.js';

const DEFAULT_TOP_N = 5;

/**
 * Pure keyword-overlap matcher. Filters to active-status lessons, scores by
 * the count of distinct keywords present in the prompt (case-insensitive,
 * word-boundary), returns the top-N sorted by score desc + id asc (ties
 * broken deterministically).
 *
 * @param {string} prompt
 * @param {Array<{ id: string, title: string, status: string, rule: string, keywords: string[] }>} lessons
 * @param {{ topN?: number }} [opts]
 * @returns {Array<{ id: string, title: string, status: string, rule: string, keywords: string[], score: number, keywords_hit: string[] }>}
 */
export function matchLessons(prompt, lessons, opts = {}) {
  if (typeof prompt !== 'string') {
    throw new TypeError('matchLessons: prompt must be a string');
  }
  if (!Array.isArray(lessons)) {
    throw new TypeError('matchLessons: lessons must be an array');
  }
  const topN = Number.isFinite(opts.topN) && opts.topN > 0 ? Math.floor(opts.topN) : DEFAULT_TOP_N;

  const scored = [];
  for (const lesson of lessons) {
    if (lesson.status !== 'active') continue; // Skip milestone/promoted/unknown.
    if (!Array.isArray(lesson.keywords) || lesson.keywords.length === 0) continue;
    const hits = [];
    for (const kw of lesson.keywords) {
      if (matchesKeyword(prompt, kw)) hits.push(kw);
    }
    if (hits.length > 0) {
      scored.push({ ...lesson, score: hits.length, keywords_hit: hits });
    }
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.id.localeCompare(b.id, 'en');
  });
  return scored.slice(0, topN);
}

/**
 * Word-boundary, case-insensitive presence check. Multi-word keywords
 * (e.g. "git checkout") are matched as literal substring with non-alnum
 * boundaries on both sides — so "git" does NOT match "github".
 *
 * @param {string} prompt
 * @param {string} keyword
 * @returns {boolean}
 */
function matchesKeyword(prompt, keyword) {
  if (typeof keyword !== 'string' || keyword.length === 0) return false;
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Non-alnum boundaries (or string edges). Note: we don't use \b because
  // \b doesn't recognize the boundary between alnum and `-` / `/` (which
  // appear in our keywords like "claude -p", "mmd --here", "MMD_RUN_ID").
  const re = new RegExp(`(?:^|[^A-Za-z0-9_])${escaped}(?:$|[^A-Za-z0-9_])`, 'i');
  return re.test(prompt);
}

/**
 * Compute a short content hash of the lessons file (for the composer.json
 * audit trail and the run-log header). 12-char hex prefix of SHA-256 — used
 * for change detection across runs, NOT for security/identity. Birthday
 * collision space is small (~16M files); the comparison context is the
 * project's own append-only history, so collisions are not a concern.
 *
 * @param {string} markdown
 * @returns {string}
 */
export function lessonsFileSha(markdown) {
  return createHash('sha256').update(markdown, 'utf8').digest('hex').slice(0, 12);
}

/**
 * Async entry point: read the lessons file, parse, match, format.
 *
 * Returns a result object with:
 *   - composedPrompt: original prompt, optionally prefixed with `## Active lessons` section
 *   - injectedLessons: array of matched lesson objects (with score + keywords_hit)
 *   - lessonsFileSha: 12-char content hash, or null when file is missing/disabled
 *   - elapsedMs: total wall-clock for the compose operation
 *   - composerVersion: COMPOSER_VERSION constant
 *   - disabled?: true when MMD_COMPOSER_DISABLED=1
 *   - missing?: true when the lessons file doesn't exist (brownfield no-op per AC-4)
 *
 * MMD_COMPOSER_DISABLED=1 → no-op (returns the original prompt unchanged).
 * ENOENT on the lessons file → no-op (returns the original prompt unchanged).
 *
 * SPEC_V02L AC-2: pass `opts.context = { subcommand, phase?, engine? }` to
 * filter lessons by `Applies to` before keyword matching. Omit it for the
 * legacy full-file behavior. The result carries `context`,
 * `filteredOutByContext`, `matchedByKeyword`, and `injected` for the
 * composer.json audit trail (AC-7).
 *
 * @param {string} prompt
 * @param {string} lessonsPath
 * @param {{ topN?: number, env?: NodeJS.ProcessEnv, context?: { subcommand?: string, phase?: string, engine?: string } }} [opts]
 */
export async function composeLessons(prompt, lessonsPath, opts = {}) {
  if (typeof prompt !== 'string') {
    throw new TypeError('composeLessons: prompt must be a string');
  }
  if (typeof lessonsPath !== 'string' || lessonsPath.length === 0) {
    throw new TypeError('composeLessons: lessonsPath must be a non-empty string');
  }
  const env = opts.env || process.env;
  const start = Date.now();
  if (env.MMD_COMPOSER_DISABLED === '1') {
    return noopResult(prompt, { disabled: true, elapsedMs: Date.now() - start });
  }
  let markdown;
  try {
    markdown = await readFile(lessonsPath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return noopResult(prompt, { missing: true, elapsedMs: Date.now() - start });
    }
    throw err;
  }
  return composeFromMarkdown(prompt, markdown, opts, start);
}

/**
 * Sync variant — same contract as composeLessons but uses readFileSync.
 * Useful for callers that can't easily await (e.g. CLI subcommand entry).
 */
export function composeLessonsSync(prompt, lessonsPath, opts = {}) {
  if (typeof prompt !== 'string') {
    throw new TypeError('composeLessonsSync: prompt must be a string');
  }
  if (typeof lessonsPath !== 'string' || lessonsPath.length === 0) {
    throw new TypeError('composeLessonsSync: lessonsPath must be a non-empty string');
  }
  const env = opts.env || process.env;
  const start = Date.now();
  if (env.MMD_COMPOSER_DISABLED === '1') {
    return noopResult(prompt, { disabled: true, elapsedMs: Date.now() - start });
  }
  // F7 (Phase-4 review): drop the existsSync pre-check to avoid a TOCTOU
  // race against the readFileSync below. ENOENT is the only "file missing"
  // signal we honor; everything else bubbles up like the async variant.
  let markdown;
  try {
    markdown = readFileSync(lessonsPath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return noopResult(prompt, { missing: true, elapsedMs: Date.now() - start });
    }
    throw err;
  }
  return composeFromMarkdown(prompt, markdown, opts, start);
}

function composeFromMarkdown(prompt, markdown, opts, start) {
  const sha = lessonsFileSha(markdown);
  const lessons = parseLessons(markdown);
  const activeLessons = lessons.filter((l) => l.status === 'active');

  // SPEC_V02L AC-2: context-aware filtering runs BEFORE keyword matching.
  // No context → no filtering (back-compat, v0.2.7 behavior).
  const context = opts.context || null;
  const candidates = context ? filterLessonsByContext(activeLessons, context) : activeLessons;
  const filteredOutByContext = activeLessons.length - candidates.length;

  // Keyword match the surviving candidates. Run UNCAPPED first so we can
  // report `matched_by_keyword` (M) distinct from `injected` (K, post-topN).
  const allMatched = matchLessons(prompt, candidates, { topN: Number.MAX_SAFE_INTEGER });
  const matchedByKeyword = allMatched.length;
  const topN = Number.isFinite(opts.topN) && opts.topN > 0 ? Math.floor(opts.topN) : DEFAULT_TOP_N;
  const matched = allMatched.slice(0, topN);

  const composedPrompt = matched.length > 0 ? formatComposedPrompt(prompt, matched) : prompt;
  return {
    composedPrompt,
    injectedLessons: matched,
    lessonsFileSha: sha,
    elapsedMs: Date.now() - start,
    composerVersion: COMPOSER_VERSION,
    totalActiveLessons: activeLessons.length,
    // AC-2 / AC-7 metrics (K ≤ M ≤ active − N):
    context,
    filteredOutByContext,
    matchedByKeyword,
    injected: matched.length,
  };
}

function noopResult(prompt, extra = {}) {
  return {
    composedPrompt: prompt,
    injectedLessons: [],
    lessonsFileSha: null,
    elapsedMs: extra.elapsedMs ?? 0,
    composerVersion: COMPOSER_VERSION,
    totalActiveLessons: 0,
    // AC-7: keep the metrics shape stable even on the disabled/missing path.
    context: null,
    filteredOutByContext: 0,
    matchedByKeyword: 0,
    injected: 0,
    ...extra,
  };
}

export { COMPOSER_VERSION };
