// lib/dream-catcher/parse-reply.js — turn a raw BMAD reply into a usable scope.
//
// SRP (constitution §I.S): the single place that decides whether a headless
// `bmad-product-brief` reply is a usable scope or garbage. Pure — string in,
// plain object out, no I/O.
//
// For the v0.3.a-1 autonomous path the reply IS the scope (the brief prints a
// friendly markdown summary on stdout), so untagged parsing is trivial. v0.3.a-2
// adds the multi-turn modes: the ask_question / synthesize prompts tag their
// output with an explicit leading MARKER line so detection is DETERMINISTIC, not
// a fragile heuristic (L-021 spirit — MMD controls each turn's intent):
//   - a first meaningful line starting `QUESTION:` → a clarifying question;
//   - a first meaningful line starting `SCOPE:`    → a synthesized scope.
// An UNTAGGED reply keeps the a-1 behavior — the whole reply is treated as a
// scope — so the autonomous path and its existing tests are unchanged.
//
// It is isolated in its own module for two reasons:
//   1. ai-coding.md §III — LLM output is untrusted; validate before you trust.
//      A failed/empty/truncated reply must be caught here, never fabricated
//      downstream (universal §VI honest fallback).
//   2. callers branch on the returned shape, so adding the `{question}` shape
//      touches no caller's control flow.
//
// Return contract (exactly one shape):
//   { scope: string }            — a usable scope was found
//   { question: string }         — a single clarifying question was found
//   { unparseable: true, reason } — nothing usable; caller must fall back

/** A reply shorter than this is treated as no-scope (defensive floor). */
const MIN_SCOPE_LEN = 12;

/** Deterministic output markers the ask_question / synthesize prompts emit. */
export const QUESTION_MARKER = 'QUESTION:';
export const SCOPE_MARKER = 'SCOPE:';

/**
 * Strip a single surrounding ```fence (with optional language tag) if the whole
 * reply is wrapped in one. Leaves inner fences untouched.
 */
function stripWrappingFence(text) {
  const fence = /^```[^\n]*\n([\s\S]*?)\n```$/;
  const m = text.match(fence);
  return m ? m[1].trim() : text;
}

/** The first non-empty line of a (trimmed) multi-line text. */
function firstMeaningfulLine(text) {
  for (const line of text.split('\n')) {
    if (line.trim().length > 0) return line.trim();
  }
  return '';
}

/**
 * Parse a raw BMAD reply into a question, a scope, or an explicit unparseable
 * verdict. Tagged replies (QUESTION: / SCOPE:) are detected deterministically;
 * an untagged reply is treated as a scope (the a-1 autonomous contract).
 *
 * @param {unknown} reply  raw stdout text from the headless BMAD turn
 * @returns {{scope: string} | {question: string} | {unparseable: true, reason: string}}
 */
export function parseReply(reply) {
  if (typeof reply !== 'string') {
    return { unparseable: true, reason: 'reply was not a string' };
  }
  let text = reply.trim();
  if (text.length === 0) {
    return { unparseable: true, reason: 'reply was empty' };
  }
  text = stripWrappingFence(text);

  const head = firstMeaningfulLine(text);

  // Tagged QUESTION → a single clarifying question (a-2 guided modes).
  if (head.startsWith(QUESTION_MARKER)) {
    const question = head.slice(QUESTION_MARKER.length).trim();
    if (question.length === 0) {
      return { unparseable: true, reason: 'QUESTION marker with no question text' };
    }
    return { question };
  }

  // Tagged SCOPE → strip the marker, keep the rest, apply the scope floor.
  if (head.startsWith(SCOPE_MARKER)) {
    // Drop only the marker on the first meaningful line; preserve any following
    // lines so a multi-line scope survives.
    const idx = text.indexOf(SCOPE_MARKER);
    const stripped = (text.slice(0, idx) + text.slice(idx + SCOPE_MARKER.length)).trim();
    if (stripped.length < MIN_SCOPE_LEN) {
      return { unparseable: true, reason: `tagged scope too short (${stripped.length} chars)` };
    }
    return { scope: stripped };
  }

  // Untagged → treat the whole reply as a scope (a-1 autonomous path, unchanged).
  if (text.length < MIN_SCOPE_LEN) {
    return { unparseable: true, reason: `reply too short to be a scope (${text.length} chars)` };
  }
  return { scope: text };
}
