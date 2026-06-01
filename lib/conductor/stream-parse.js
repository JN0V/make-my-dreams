// lib/conductor/stream-parse.js — pure parsing + context math for the v0.5.b
// live context monitor (SPEC_V05B AC-2).
//
// SRP (universal.md §I.S): this module owns ONLY the line→struct→numbers
// transforms. It has NO I/O (no node:fs, no spawn, no network) and never
// throws — a malformed or partial stream-json line returns null rather than
// crashing the monitor that consumes a live stream. The spawn, the tee
// re-render, and the status.json writes all live in invoke-autodev/bin.
//
// Why this exists: `claude -p --output-format stream-json --verbose` emits one
// JSON object per line:
//   - a `system`/init event carrying the model (e.g. "claude-opus-4-8[1m]" —
//     the [1m] suffix signals the 1M context window),
//   - `assistant` events whose `message.usage` reports the tokens the model just
//     processed (input + the two cache buckets),
//   - a final `result` event carrying a top-level `usage`.
// Summing input + cache_read + cache_creation gives the size of the prompt the
// orchestrator just sent — i.e. how full its context window is. Dividing by the
// window gives the live context %. See ADR-030 and L-027.
//
// NOTE (honesty, universal.md §VI): this is the ORCHESTRATOR's context, not the
// per-sub-agent context — the top-level stream only sees the macro auto-dev
// loop. An unknown model yields `estimated:true` + a default 200K window rather
// than a fabricated exact figure.

/** Models whose context window is the standard 200K. Matched by family prefix
 *  so a dated variant (e.g. "claude-haiku-4-5-20251001") is still "known". The
 *  `[1m]` suffix overrides this (handled first in contextWindowFor). */
const KNOWN_200K_RE = /^claude-(opus|sonnet|haiku)/i;

/** The 1M-window marker the CLI appends to a model id (e.g. "…-4-8[1m]"). */
const ONE_MILLION_RE = /\[1m\]/i;

const WINDOW_200K = 200_000;
const WINDOW_1M = 1_000_000;

/**
 * Parse a single stream-json line into a small, tolerant struct.
 *
 * Returns `null` for anything that is not a usable event: a non-string input, a
 * blank line, a partial/non-JSON line, JSON that is not an object, or an object
 * with no string `type`. NEVER throws — it is consumed inside a live stream's
 * data handler where a throw would abort the run.
 *
 * Extracted fields (all optional except `type`):
 *   - `type`  — the event type ("system" | "assistant" | "result" | …).
 *   - `model` — taken from the top-level `model` field, which only the `system`
 *               init event carries WITH the `[1m]` suffix. (The `assistant`
 *               event nests `message.model` WITHOUT the suffix, so we
 *               deliberately do NOT read it — the system event is the authority
 *               on the window. Spec AC-2: "model (from system)".)
 *   - `usage` — `message.usage` (assistant) or top-level `usage` (result).
 *   - `text`  — concatenated text parts of `message.content` (assistant), for
 *               the readable tee re-render.
 *
 * @param {string} line one line of stream-json output
 * @returns {{ type: string, model?: string, usage?: object, text?: string } | null}
 */
export function parseStreamEvent(line) {
  if (typeof line !== 'string') return null;
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;

  let obj;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    // Partial line (the stream was split mid-object) or plain text — not usable.
    return null;
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || typeof obj.type !== 'string') {
    return null;
  }

  const out = { type: obj.type };

  // model: only the system/init event carries the top-level `model` with the
  // [1m] suffix that determines the window.
  if (typeof obj.model === 'string' && obj.model.length > 0) {
    out.model = obj.model;
  }

  // usage: assistant nests it under `message`; result carries it top-level.
  const usage =
    obj.message && typeof obj.message === 'object' && obj.message.usage
      ? obj.message.usage
      : obj.usage;
  if (usage && typeof usage === 'object') {
    out.usage = usage;
  }

  // text: assistant message content is an array of parts; collect the text ones
  // for the human-readable tee (NOT the raw JSON).
  const content =
    obj.message && typeof obj.message === 'object' && Array.isArray(obj.message.content)
      ? obj.message.content
      : null;
  if (content) {
    const text = content
      .filter((p) => p && p.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text)
      .join('');
    if (text.length > 0) out.text = text;
  }

  return out;
}

/**
 * Resolve the context window for a model id.
 *
 * Returns `{ window, estimated }`:
 *   - a `[1m]` suffix       → { window: 1_000_000, estimated: false }
 *   - a known 200K model    → { window:   200_000, estimated: false }
 *   - unknown / empty model → { window:   200_000, estimated: true  }
 *
 * The object shape (rather than a bare number) is deliberate: it is the only
 * way to carry the honest `estimated` flag within the spec's 4-function API
 * without a fabricated exact figure for an unrecognized model (universal.md
 * §VI). Callers pass `.window` to contextPct. (SPEC_V05B AC-2 phrases this as
 * "= 1_000_000" / "200_000 + estimated:true" — i.e. the `window` value plus the
 * estimate signal.) See ADR-030.
 *
 * @param {string} [model]
 * @returns {{ window: number, estimated: boolean }}
 */
export function contextWindowFor(model) {
  if (typeof model !== 'string' || model.trim().length === 0) {
    return { window: WINDOW_200K, estimated: true };
  }
  if (ONE_MILLION_RE.test(model)) {
    return { window: WINDOW_1M, estimated: false };
  }
  if (KNOWN_200K_RE.test(model)) {
    return { window: WINDOW_200K, estimated: false };
  }
  return { window: WINDOW_200K, estimated: true };
}

/**
 * Sum the tokens that make up the context the model just processed:
 * `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`.
 *
 * `output_tokens` is intentionally EXCLUDED — it is what the model produced,
 * not what occupied its context window on the way in. Missing/non-numeric
 * fields count as 0 (tolerant — a partial usage object never throws).
 *
 * @param {object} [usage]
 * @returns {number}
 */
export function contextTokens(usage) {
  if (!usage || typeof usage !== 'object') return 0;
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return (
    num(usage.input_tokens) +
    num(usage.cache_read_input_tokens) +
    num(usage.cache_creation_input_tokens)
  );
}

/**
 * Compute `{ tokens, pct }` for a usage object against a window size.
 * `pct = tokens / window` (a 0..1 fraction; 0 when the window is non-positive,
 * never NaN/Infinity — tolerant by design).
 *
 * @param {object} usage
 * @param {number} window
 * @returns {{ tokens: number, pct: number }}
 */
export function contextPct(usage, window) {
  const tokens = contextTokens(usage);
  const w = typeof window === 'number' && window > 0 ? window : 0;
  const pct = w > 0 ? tokens / w : 0;
  return { tokens, pct };
}
