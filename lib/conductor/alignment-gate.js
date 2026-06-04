// lib/conductor/alignment-gate.js — the PURE aggregation + feedback helpers for
// the v0.11.a alignment gate (SPEC_V011A AC-1). The Conductor's first real
// CONTROL brick: "verify the ask, then correct."
//
// WHY (the gap SPEC_V011A names): MMD already has a behavioral judge that grades
// an implementation against WHAT WAS ASKED — lib/sealed-tests/judge.js — but it
// runs ONLY behind `--sealed`. A normal `mmdream --here`/greenfield run has ZERO
// automated alignment verification. This slice wires that SAME judge onto the
// normal path; these two helpers are the pure decision logic between the judge's
// verdict and the gate's three branches:
//   - aligned (every AC met)        → mark done (as today) + record the verdict
//   - a NOT-MET AC (a gap)          → iterate: re-run auto-dev naming the unmet ACs
//   - uncertain / unparseable / gate-absent → the sacred fallback: honest
//                                     "alignment unverified" note, NEVER a fabricated pass
//
// PURE (no fs, no spawn, no env, no Date) and NEVER throws — exactly like
// judge.js's parse/build pieces and five-whys-parser.js — so the unit suite can
// assert the math + wording without a real claude (universal §I.S SRP, §II KISS).
// The iterate LOOP itself (which spawns auto-dev + re-judges) lives in bin/mmd.js
// where the seams are; this module only decides, it never acts.

/**
 * Aggregate a parsed judge verdict into the gate's decision inputs.
 *
 * `aligned` is true IFF the judge's OVERALL is `met` (SPEC AC-1: aligned ⟺
 * `overall === 'met'`). `gapAcs` lists EXACTLY the `not-met` acceptance criteria —
 * an `uncertain` AC is NOT a gap item (it takes the honest-hold branch, not the
 * iterate branch). So the caller reads the three branches off `(aligned,
 * gapAcs.length)`:
 *   - aligned                       → done
 *   - !aligned && gapAcs.length > 0 → iterate on the named gaps
 *   - !aligned && gapAcs.length === 0 → sacred fallback (uncertain/empty/odd)
 *
 * Defensive against any shape (the verdict comes from parseJudgeVerdict, which
 * itself never throws, but also from judgeFallback and possibly malformed
 * callers): a missing/odd `overall` → not aligned; a missing/odd `verdicts` → no
 * gaps. NEVER throws.
 *
 * @param {{ overall?: string, verdicts?: Array<{ac?: string, status?: string, reason?: string}> }} verdict
 * @returns {{ aligned: boolean, gapAcs: Array<{ac: string, reason: string}> }}
 */
export function aggregateAlignment(verdict) {
  const overall =
    verdict && typeof verdict.overall === 'string' ? verdict.overall.trim().toLowerCase() : null;
  const aligned = overall === 'met';

  // A `met` overall has no gaps by definition. Otherwise collect the not-met ACs
  // (uncertain ACs are deliberately excluded — they are not actionable gaps).
  const list = verdict && Array.isArray(verdict.verdicts) ? verdict.verdicts : [];
  const gapAcs = aligned
    ? []
    : list
        .filter((v) => v && typeof v.status === 'string' && v.status.trim().toLowerCase() === 'not-met')
        .map((v) => ({
          ac: String(v.ac == null ? '' : v.ac).trim(),
          reason: String(v.reason == null ? '' : v.reason).trim(),
        }));

  return { aligned, gapAcs };
}

/**
 * Build the prompt fragment appended to the auto-dev re-launch on a gap. It
 * restates the goal (the dream, verbatim) at the top AND bottom — countering
 * constraint decay (ai-coding §III: restate the goal at both ends) — and names
 * each unmet acceptance criterion + the judge's reason so the next attempt knows
 * exactly what to fix.
 *
 * PURE + NEVER throws: a non-string dream → `''`; a non-array / empty gapAcs → a
 * fragment with no per-AC bullets (the caller only ever passes a non-empty
 * gapAcs, but the helper degrades safely).
 *
 * @param {{ gapAcs: Array<{ac?: string, reason?: string}>, dream: string }} args
 * @returns {string} the prompt fragment
 */
export function buildGapFeedback({ gapAcs, dream } = {}) {
  const dreamText = typeof dream === 'string' ? dream : '';
  const list = Array.isArray(gapAcs) ? gapAcs : [];

  const lines = [
    'ALIGNMENT GAP — the previous attempt did NOT satisfy every acceptance criterion.',
    'An independent behavioral judge graded the implementation against WHAT WAS ASKED',
    'and found the criteria below unmet. This is a CORRECTION pass, not a new task.',
    '',
    `Restating the goal (the dream, verbatim): ${dreamText}`,
    '',
    'Acceptance criteria graded NOT-MET — address EACH one:',
  ];

  if (list.length === 0) {
    lines.push('- (no specific acceptance criteria were named)');
  } else {
    for (const g of list) {
      const ac = String(g && g.ac != null ? g.ac : '').trim();
      const reason = String(g && g.reason != null ? g.reason : '').trim();
      lines.push(`- AC ${ac || '(unnamed)'}: ${reason || '(no reason given)'}`);
    }
  }

  lines.push(
    '',
    'Re-implement so that EVERY acceptance criterion above is satisfied. Commit',
    'incrementally per criterion. Restating the goal once more to keep it in focus:',
    dreamText,
  );

  return lines.join('\n');
}

/**
 * Parse the MMD_ALIGN_MAX_ITERS env value into a bounded iteration count.
 * Integer ≥ 0; anything else (absent, empty, non-integer, negative, junk) →
 * `fallback` (default 1). `0` is a VALID value meaning "gate but never iterate"
 * (a surviving gap → exit 7 immediately). PURE + NEVER throws.
 *
 * @param {string|number|undefined|null} raw
 * @param {number} [fallback=1]
 * @returns {number} a non-negative integer
 */
export function parseMaxIters(raw, fallback = 1) {
  if (raw === undefined || raw === null) return fallback;
  const s = String(raw).trim();
  if (s === '') return fallback;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0) return fallback;
  return n;
}
