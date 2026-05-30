// lib/conductor/five-whys-parser.js — pure parser for the 5-Whys session output
// (SPEC_V02J AC-2).
//
// SRP (universal.md §I.S): extract + validate the trailing JSON block that the
// 5-Whys session prompt asks `claude -p` to emit, and return a well-formed
// parsed object — ALWAYS. No I/O, no spawn, no env reads. Pure.
//
// SACRED INVARIANT (SPEC §5 risk #1, L-016): this function NEVER throws on bad
// input. Malformed / prose-only / empty output yields a fallback object with
// recommended_action:"escalate-to-user" and the parse error captured in
// evidence[]. A human always gets a safe, actionable result.

/**
 * The closed enum of recommended actions (SPEC AC-2). Order is informational.
 * @type {readonly string[]}
 */
export const RECOMMENDED_ACTIONS = Object.freeze([
  'continue-with-hint',
  'abandon-approach',
  'escalate-to-user',
  'task-actually-complete',
  'false-positive-stall',
]);

/** @param {string} a @returns {boolean} */
export function isRecommendedAction(a) {
  return typeof a === 'string' && RECOMMENDED_ACTIONS.includes(a);
}

/**
 * Build the sacred fallback object. recommended_action is always
 * escalate-to-user so a human reviews when the machine couldn't decide.
 *
 * @param {string} reason  human-readable parse-failure reason (goes in evidence)
 * @returns {{ root_cause: string, recommended_action: string, action_hint: string, confidence: number, evidence: string[] }}
 */
export function fallbackResult(reason) {
  return {
    root_cause: 'Could not determine a root cause from the 5-Whys session output.',
    recommended_action: 'escalate-to-user',
    action_hint:
      'The 5-Whys session did not return a parseable structured result. ' +
      'A human should review the session log and decide how to proceed.',
    confidence: 0,
    evidence: [String(reason || 'unknown parse failure')],
  };
}

/**
 * Extract the LAST ```json ... ``` fenced block, or — if none — the last
 * bare top-level {...} object in the text. Returns the raw JSON string or null.
 *
 * We take the LAST block so any example JSON shown earlier in the persona
 * narrative does not shadow the real trailing answer.
 *
 * @param {string} text
 * @returns {string|null}
 */
export function extractJsonBlock(text) {
  if (typeof text !== 'string' || text.length === 0) return null;

  // 1) Prefer fenced ```json blocks. Match all, take the last.
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  let lastFenced = null;
  let m;
  while ((m = fenceRe.exec(text)) !== null) {
    const body = m[1].trim();
    if (body.startsWith('{') && body.endsWith('}')) lastFenced = body;
  }
  if (lastFenced) return lastFenced;

  // 2) Fall back to the last balanced top-level {...} in the raw text.
  const last = lastBalancedObject(text);
  return last;
}

/**
 * Find the LAST top-level balanced {...} substring — i.e. the object whose
 * closing brace is the final unmatched '}' in the text. We anchor on the last
 * '}' and walk backwards counting braces (string-aware) to its matching '{'.
 * This yields the outermost trailing object (the real answer), not an inner
 * nested one. Brace-counting avoids greedy/lazy regex pitfalls.
 *
 * @param {string} text
 * @returns {string|null}
 */
function lastBalancedObject(text) {
  // Locate the final '}' that is not inside a string, scanning forward to
  // track string context correctly, recording the last top-of-text close.
  let depth = 0;
  let inStr = false;
  let escaped = false;
  let openStack = [];
  let bestStart = -1;
  let bestEnd = -1;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') {
      openStack.push(i);
      depth += 1;
    } else if (ch === '}') {
      if (depth > 0) {
        const start = openStack.pop();
        depth -= 1;
        if (depth === 0) {
          // A complete top-level object just closed; remember it (last wins).
          bestStart = start;
          bestEnd = i;
        }
      }
    }
  }
  if (bestStart >= 0 && bestEnd >= bestStart) return text.slice(bestStart, bestEnd + 1);
  return null;
}

/**
 * Validate a parsed candidate object against the 5-Whys schema and coerce it
 * into the canonical shape. Returns { ok, value, error }.
 *
 * Schema (SPEC AC-2):
 *   { root_cause: string,
 *     recommended_action: <one of RECOMMENDED_ACTIONS>,
 *     action_hint: string,
 *     confidence: number in [0,1],
 *     evidence: string[] }
 *
 * @param {unknown} obj
 * @returns {{ ok: boolean, value?: object, error?: string }}
 */
export function validateParsed(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, error: 'parsed value is not a JSON object' };
  }
  if (!isRecommendedAction(obj.recommended_action)) {
    return {
      ok: false,
      error:
        `recommended_action '${String(obj.recommended_action)}' is not one of ` +
        `${RECOMMENDED_ACTIONS.join('|')}`,
    };
  }
  const confidence = clampConfidence(obj.confidence);
  const value = {
    root_cause:
      typeof obj.root_cause === 'string' && obj.root_cause.trim().length > 0
        ? obj.root_cause.trim()
        : '(no root_cause provided)',
    recommended_action: obj.recommended_action,
    action_hint: typeof obj.action_hint === 'string' ? obj.action_hint.trim() : '',
    confidence,
    evidence: Array.isArray(obj.evidence)
      ? obj.evidence.filter((e) => typeof e === 'string')
      : [],
  };
  return { ok: true, value };
}

function clampConfidence(c) {
  const n = Number(c);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Top-level pure parse. Extracts the trailing JSON block, parses it, validates
 * it, and returns the canonical object — or the sacred escalate-to-user
 * fallback when ANY step fails.
 *
 * NEVER throws (L-016).
 *
 * @param {string} sessionOutput  raw stdout text from the 5-Whys claude -p run
 * @returns {{ parsed: object, parseOk: boolean }}
 */
export function parseFiveWhys(sessionOutput) {
  const block = extractJsonBlock(sessionOutput);
  if (!block) {
    return { parsed: fallbackResult('no JSON block found in session output'), parseOk: false };
  }
  let candidate;
  try {
    candidate = JSON.parse(block);
  } catch (err) {
    return { parsed: fallbackResult(`JSON.parse failed: ${err.message}`), parseOk: false };
  }
  const v = validateParsed(candidate);
  if (!v.ok) {
    return { parsed: fallbackResult(v.error), parseOk: false };
  }
  return { parsed: v.value, parseOk: true };
}
