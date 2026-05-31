// lib/dream-catcher/parse-reply.js — turn a raw BMAD reply into a usable scope.
//
// SRP (constitution §I.S): the single place that decides whether a headless
// `bmad-product-brief` reply is a usable scope or garbage. Pure — string in,
// plain object out, no I/O.
//
// For the v0.3.a-1 autonomous path the reply IS the scope (the brief prints a
// friendly markdown summary on stdout), so parsing is deliberately trivial.
// It is isolated in its own module for two reasons:
//   1. ai-coding.md §III — LLM output is untrusted; validate before you trust.
//      A failed/empty/truncated reply must be caught here, never fabricated
//      downstream (universal §VI honest fallback).
//   2. v0.3.a-2 will add the `{ question }` shape (guided multi-turn) without
//      touching any caller — they already branch on the returned shape.
//
// Return contract (exactly one shape):
//   { scope: string }            — a usable scope was found
//   { unparseable: true, reason } — nothing usable; caller must fall back

/** A reply shorter than this is treated as no-scope (defensive floor). */
const MIN_SCOPE_LEN = 12;

/**
 * Strip a single surrounding ```fence (with optional language tag) if the whole
 * reply is wrapped in one. Leaves inner fences untouched.
 */
function stripWrappingFence(text) {
  const fence = /^```[^\n]*\n([\s\S]*?)\n```$/;
  const m = text.match(fence);
  return m ? m[1].trim() : text;
}

/**
 * Parse a raw BMAD reply into a scope or an explicit unparseable verdict.
 *
 * @param {unknown} reply  raw stdout text from the headless `bmad-product-brief`
 * @returns {{scope: string} | {unparseable: true, reason: string}}
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
  if (text.length < MIN_SCOPE_LEN) {
    return { unparseable: true, reason: `reply too short to be a scope (${text.length} chars)` };
  }
  return { scope: text };
}
