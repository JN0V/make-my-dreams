// lib/autolearn/promote-gate.js — the LLM promotion-validation gate (SPEC_V090
// AC-3). Both exports are PURE (no fs, no spawn) so the unit suite can assert
// their wording and parsing without a real claude — exactly like the v0.4.d
// judge (lib/sealed-tests/judge.js) and the 5-Whys parser.
//
// WHY a gate (the autolearning loop's safety valve): the deterministic
// validated-reuse counter (lib/autolearn/validated-reuse.js) is a weak proxy —
// a `done` run does not PROVE the lesson's rule was the reason. Promotion folds
// the lesson into MMD's OWN constitution and deletes it from lessons-learned.md
// (irreversible-ish, rule-changing). So before promoting a lesson that reached
// its threshold, an injected judge reviews the rule + its reusing runs and
// confirms it was genuinely applicable + honored. Only an explicit `validated`
// promotes; everything else HOLDS the lesson.
//
// HONEST like the judge (universal §VI, the sacred fallback): an unparseable /
// empty / odd verdict → `uncertain` → HOLD, NEVER a fabricated `validated`.
// parsePromoteGateVerdict NEVER throws.
//
// PROMOTE_GATE_MARKER is a stable phrase the gate prompt carries so an
// integration fake-claude can branch on it deterministically. It deliberately
// differs from the sealed-pipeline markers ('SEALED ORACLE', 'BEHAVIORAL JUDGE').

/** A distinctive phrase that appears ONLY in the promotion-gate prompt. */
export const PROMOTE_GATE_MARKER = 'PROMOTION VALIDATION GATE';

/** The closed verdict set (mirrors VERDICT_STATUSES in judge.js). */
export const GATE_VERDICTS = Object.freeze(['validated', 'not-validated', 'uncertain']);

/**
 * Build the sacred-fallback verdict. The verdict is ALWAYS `uncertain` so an
 * unreadable gate reply NEVER reads as a fabricated promotion approval
 * (universal §VI; mirrors judgeFallback / escalate-to-user).
 *
 * @param {string} reason
 * @returns {{ verdict: 'uncertain', reason: string }}
 */
export function gateFallback(reason) {
  return { verdict: 'uncertain', reason: String(reason || 'unparseable gate verdict') };
}

/**
 * Build the promotion-gate `claude -p` prompt. The gate grades whether the
 * lesson's rule was GENUINELY applicable + honored across the runs that reused
 * it — not merely that those runs passed. MMD dictates the output format (the
 * model never controls parsing): a single
 *   `VERDICT: VALIDATED|NOT-VALIDATED|UNCERTAIN — <reason>`
 * line. parsePromoteGateVerdict keys off that tag.
 *
 * @param {{ lesson: { id: string, title?: string, rule?: string }, reusingRuns?: string[] }} args
 * @returns {string}
 */
export function buildPromoteGatePrompt({ lesson, reusingRuns = [] } = {}) {
  if (!lesson || typeof lesson !== 'object' || typeof lesson.id !== 'string' || lesson.id === '') {
    throw new Error('buildPromoteGatePrompt: a lesson with an id is required');
  }
  const runs = Array.isArray(reusingRuns) ? reusingRuns.filter((r) => typeof r === 'string') : [];
  const title = lesson.title || '(untitled)';
  const rule = (lesson.rule || '').trim() || '(no rule recorded)';

  const lines = [
    `You are the ${PROMOTE_GATE_MARKER} of MMD's autolearning loop.`,
    '',
    'A lesson in docs/lessons-learned.md has reached its promotion threshold on a',
    'DETERMINISTIC validated-reuse counter: it was injected into N runs that each',
    'completed successfully (state=done). That counter is a weak proxy — a passing',
    'run does NOT prove the lesson\'s rule was the reason it passed. Promotion would',
    "fold this rule into MMD's OWN constitution (a rule-changing, hard-to-reverse",
    'act), so your judgment is the safety gate.',
    '',
    'Your ONE job: decide whether this lesson\'s rule was GENUINELY applicable and',
    'honored across the reusing runs — enough to graduate into the constitution.',
    '',
    'Grading rules (NON-NEGOTIABLE):',
    '- VALIDATED only when the evidence clearly shows the rule was applicable AND',
    '  honored across the reusing runs — promotion is conservative.',
    '- NOT-VALIDATED when the evidence shows the rule did not apply or was not honored.',
    '- UNCERTAIN when the evidence is insufficient to decide — do NOT guess VALIDATED.',
    '',
    'Output format (MMD parses this tag EXACTLY — emit nothing else of note):',
    '    VERDICT: VALIDATED|NOT-VALIDATED|UNCERTAIN — <one-line reason>',
    '',
    `Lesson under review: ${lesson.id} — ${title}`,
    '',
    'Rule:',
    rule,
    '',
    `Reusing runs (${runs.length} distinct done-run(s) that injected this lesson):`,
    runs.length > 0 ? runs.join(', ') : '(none recorded)',
    '',
    'Grade now. Emit exactly one `VERDICT: …` line.',
  ];
  return lines.join('\n');
}

// NOT-VALIDATED is listed before VALIDATED in the alternation so the hyphenated
// token wins; the separator may be an em/en dash or hyphen (the prompt dictates
// ` — `, but we stay tolerant).
const VERDICT_LINE_RE = /^\s*VERDICT\s*:\s*(NOT-VALIDATED|VALIDATED|UNCERTAIN)\b\s*(?:[—–-]+\s*)?(.*)$/i;

/** Normalize a raw tag → closed verdict, or null if unrecognized. */
function normalizeVerdict(raw) {
  const t = String(raw || '').trim().toUpperCase();
  if (t === 'VALIDATED') return 'validated';
  if (t === 'NOT-VALIDATED') return 'not-validated';
  if (t === 'UNCERTAIN') return 'uncertain';
  return null;
}

/**
 * Parse a gate reply into `{ verdict, reason }` with verdict ∈ GATE_VERDICTS.
 * Any unparseable / empty / odd reply (no recognizable VERDICT tag) →
 * `{ verdict:'uncertain', reason }` — NEVER `validated` (the sacred fallback,
 * universal §VI). The LAST VERDICT line wins (a persona narrative may show an
 * example earlier). PURE; NEVER throws.
 *
 * @param {string} text raw stdout from the gate `claude -p` run
 * @returns {{ verdict: string, reason: string }}
 */
export function parsePromoteGateVerdict(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return gateFallback('empty gate reply');
  }
  let found = null;
  for (const line of text.split(/\r?\n/)) {
    const m = VERDICT_LINE_RE.exec(line);
    if (m) {
      const verdict = normalizeVerdict(m[1]);
      if (verdict) found = { verdict, reason: (m[2] || '').trim() };
    }
  }
  if (!found) return gateFallback('no parseable VERDICT: line in gate reply');
  return found;
}
