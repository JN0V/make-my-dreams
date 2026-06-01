// lib/sealed-tests/judge.js — the LLM-as-judge behavioral oracle of the sealed
// pipeline (v0.4.d, SPEC_V04D). Both exports are PURE (no fs, no spawn) so the
// unit suite can assert their wording and parsing without a real claude
// (universal §I.S SRP, §II KISS) — exactly like tester-prompt.js.
//
// WHY a second oracle (PROBLEMS.md P-09): the sealed-test gate (v0.4.a–c) proves
// the code passes an INDEPENDENT test suite — but "tests prove the code does what
// it does, not what was ASKED". A suite can be adequate-but-incomplete: an AC no
// test covers slips through green. After the sealed tests re-run green, a JUDGE
// sub-agent reads WHAT WAS ASKED (the dream / slice.md ACs) + the produced
// implementation + the sealed tests, and grades each acceptance criterion
// met/not-met/uncertain with a reason. It runs ONLY behind the deterministic
// test gate — it never replaces the hard gate, it surfaces the behavioral gap
// the tests can't.
//
// HONEST like the 5-Whys (lib/conductor/five-whys-parser.js): an unparseable /
// empty / odd verdict falls back to `uncertain` — NEVER a fabricated `met`
// (universal §VI; the sacred fallback). parseJudgeVerdict NEVER throws.
//
// JUDGE_MARKER is a stable phrase the judge prompt (and only the judge prompt)
// carries, so the integration fake-claude can branch judge-vs-tester-vs-coder on
// it the way fake-claude-sealed.sh branches on SHARED_MARKER ('SEALED ORACLE').
// It MUST NOT contain 'SEALED ORACLE' or the fake would route it to the tester.

/**
 * A distinctive phrase that appears ONLY in the judge prompt. Chosen so it does
 * not contain the tester/coder marker ('SEALED ORACLE'); the test fake greps for
 * it to detect the judge call deterministically.
 * @type {string}
 */
export const JUDGE_MARKER = 'BEHAVIORAL JUDGE';

/** The closed verdict set (mirrors RECOMMENDED_ACTIONS in five-whys-parser.js). */
export const VERDICT_STATUSES = Object.freeze(['met', 'not-met', 'uncertain']);

/**
 * Build the JUDGE `claude -p` prompt.
 *
 * The judge grades the produced implementation against WHAT WAS ASKED — the dream
 * (and the slice spec / ACs when one was provided) — NOT merely "do the tests
 * pass". The sealed acceptance tests and the produced artifacts are EVIDENCE, not
 * the bar: a green suite that misses an AC is exactly the gap this oracle exists
 * to catch (P-09).
 *
 * MMD dictates the output format (L-021 spirit — MMD controls parsing, never the
 * model's free-form prose): one line per AC
 *   `AC <id>: MET|NOT-MET|UNCERTAIN — <reason>`
 * plus a final `OVERALL: MET|NOT-MET|UNCERTAIN — <reason>` line. parseJudgeVerdict
 * keys off those tags.
 *
 * @param {{ dream: string, slice?: string|null, sealedDir: string, artifactsSummary?: string|null }} args
 * @returns {string} the prompt body
 */
export function buildJudgePrompt({ dream, slice = null, sealedDir, artifactsSummary = null }) {
  if (typeof dream !== 'string' || dream.trim() === '') {
    throw new Error('buildJudgePrompt: a non-empty dream is required');
  }
  if (typeof sealedDir !== 'string' || sealedDir.trim() === '') {
    throw new Error('buildJudgePrompt: a sealedDir path is required');
  }

  const lines = [
    `You are the ${JUDGE_MARKER} of MMD's sealed pipeline — a behavioral oracle.`,
    '',
    'The implementation has ALREADY passed an independent, sealed acceptance-test',
    'suite (the deterministic gate). Your job is the OTHER question that suite',
    'cannot answer on its own: does the implementation actually do WHAT WAS ASKED?',
    'A test suite can be adequate-but-incomplete — an acceptance criterion no test',
    'covers can slip through green. You grade against the REQUEST, not the tests.',
    '',
    'Your ONE job: read WHAT WAS ASKED (the dream / acceptance criteria below),',
    'use the sealed acceptance tests + the produced artifacts as EVIDENCE, and grade',
    'each discernible acceptance criterion MET / NOT-MET / UNCERTAIN with a reason.',
    '',
    'Grading rules (NON-NEGOTIABLE):',
    '- Grade against WHAT WAS ASKED, not "do the tests pass". Passing tests are',
    '  evidence, never the bar — an AC the tests do not cover can still be NOT-MET.',
    '- MET only when the evidence clearly shows the criterion is satisfied.',
    '- NOT-MET when the evidence shows it is missing, wrong, or contradicted.',
    '- UNCERTAIN when the evidence is insufficient to decide — do NOT guess MET.',
    `- The sealed acceptance tests live in: ${sealedDir} (read them as evidence).`,
    '',
    'Output format (MMD parses these tags EXACTLY — emit nothing else of note):',
    '- One line per acceptance criterion, in this shape:',
    '    AC <id>: MET|NOT-MET|UNCERTAIN — <one-line reason>',
    '- Then a final summary line:',
    '    OVERALL: MET|NOT-MET|UNCERTAIN — <one-line reason>',
    '  OVERALL is MET only when EVERY acceptance criterion is MET; if any is',
    '  NOT-MET, OVERALL is NOT-MET; if any is UNCERTAIN (and none NOT-MET),',
    '  OVERALL is UNCERTAIN.',
    '',
    `What was asked (the dream, verbatim): ${dream}`,
  ];

  if (typeof slice === 'string' && slice.trim() !== '') {
    lines.push(
      '',
      'Acceptance criteria / slice spec (authoritative scope — grade against these',
      'where they are more specific than the dream):',
      '',
      slice.trim(),
    );
  }

  if (typeof artifactsSummary === 'string' && artifactsSummary.trim() !== '') {
    lines.push(
      '',
      'Produced artifacts (evidence of what the implementation actually delivered):',
      '',
      artifactsSummary.trim(),
    );
  }

  lines.push(
    '',
    'Grade now. Emit one `AC <id>: …` line per acceptance criterion and a final',
    '`OVERALL: …` line, and nothing that would obscure those tagged lines.',
  );

  return lines.join('\n');
}

/**
 * Build the sacred fallback verdict. `overall` is ALWAYS `uncertain` so an
 * unreadable judge reply NEVER reads as a fabricated pass (universal §VI; mirrors
 * five-whys-parser.js#fallbackResult / escalate-to-user).
 *
 * @param {string} reason  human-readable parse-failure reason
 * @returns {{ overall: 'uncertain', verdicts: [], reason: string }}
 */
export function judgeFallback(reason) {
  return {
    overall: 'uncertain',
    verdicts: [],
    reason: String(reason || 'unparseable judge verdict'),
  };
}

/** Normalize a raw tag (MET | NOT-MET | UNCERTAIN, any case) → closed status. */
function normalizeStatus(raw) {
  const t = String(raw || '').trim().toUpperCase();
  if (t === 'MET') return 'met';
  if (t === 'NOT-MET') return 'not-met';
  if (t === 'UNCERTAIN') return 'uncertain';
  return null;
}

// One AC line: `AC <id>: <STATUS> — <reason>`. NOT-MET is listed before MET in
// the alternation so the hyphenated token wins; the separator may be an em/en
// dash or a hyphen (the prompt dictates ` — `, but we stay tolerant).
const AC_LINE_RE = /^\s*AC\s+(\S+?)\s*:\s*(NOT-MET|UNCERTAIN|MET)\b\s*(?:[—–-]+\s*)?(.*)$/i;
const OVERALL_LINE_RE = /^\s*OVERALL\s*:\s*(NOT-MET|UNCERTAIN|MET)\b\s*(?:[—–-]+\s*)?(.*)$/i;

/**
 * Parse a judge reply into `{ verdicts: [{ ac, status, reason }], overall }` with
 * status/overall ∈ {met,not-met,uncertain}. Any unparseable / empty / odd reply
 * (no recognizable OVERALL tag) → `{ overall:'uncertain', verdicts:[], reason }`
 * — NEVER `met` (the sacred fallback, universal §VI). PURE; NEVER throws.
 *
 * The OVERALL: line is authoritative for `overall` (the model is instructed to
 * make it consistent with the per-AC lines). The per-AC lines populate
 * `verdicts`. If there is no parseable OVERALL line, the whole reply is treated
 * as unparseable → uncertain (an oracle with no bottom line proves nothing).
 *
 * @param {string} text  raw stdout from the judge `claude -p` run
 * @returns {{ verdicts: Array<{ac:string,status:string,reason:string}>, overall:string, reason?: string }}
 */
export function parseJudgeVerdict(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return judgeFallback('empty judge reply');
  }

  const lines = text.split(/\r?\n/);
  const verdicts = [];
  let overall = null;

  for (const line of lines) {
    const ov = OVERALL_LINE_RE.exec(line);
    if (ov) {
      const status = normalizeStatus(ov[1]);
      // Last OVERALL wins (a persona narrative may show an example earlier).
      if (status) overall = { status, reason: (ov[2] || '').trim() };
      continue;
    }
    const m = AC_LINE_RE.exec(line);
    if (m) {
      const status = normalizeStatus(m[2]);
      if (status) {
        verdicts.push({ ac: m[1].trim(), status, reason: (m[3] || '').trim() });
      }
    }
  }

  if (!overall) {
    return judgeFallback('no parseable OVERALL: line in judge reply');
  }

  return { verdicts, overall: overall.status, reason: overall.reason };
}
