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
 * v0.17.a (SPEC_V017A AC-4) — classify a Reality Check result (the DETERMINISTIC
 * face) into the gate's decision inputs. A FAIL is a deterministic gap (the change
 * does not actually WORK — tests red / won't run); a SKIPPED is an HONEST
 * non-signal (nothing runnable was detectable — never treated as a pass NOR a
 * fail); a PASS (or any non-FAIL) is satisfied. PURE; NEVER throws — an
 * odd/missing result is treated as a non-failing skip (the semantic face still
 * governs; we never fabricate a deterministic fail out of nothing).
 *
 * @param {{ status?: string, reason?: string } | null} rc  from realityCheck/hereRealityCheck
 * @returns {{ failed: boolean, skipped: boolean, reason: string }}
 */
export function evaluateDeterministicFace(rc) {
  const status = rc && typeof rc.status === 'string' ? rc.status.trim().toUpperCase() : null;
  const reason = rc && typeof rc.reason === 'string' ? rc.reason : '';
  if (status === 'FAIL') return { failed: true, skipped: false, reason };
  if (status === 'SKIPPED') return { failed: false, skipped: true, reason };
  // PASS / unknown / missing → not a failure (the semantic face governs).
  return { failed: false, skipped: false, reason };
}

/**
 * v0.17.a (SPEC_V017A AC-4) — build the iterate feedback for a DETERMINISTIC gap
 * (tests red / the build does not run). Restates the goal at both ends (constraint
 * decay, ai-coding §III) and names the failing check so the next attempt fixes the
 * actual breakage. PURE; NEVER throws.
 *
 * @param {{ reason: string, dream: string }} args
 * @returns {string}
 */
export function buildDeterministicFeedback({ reason, dream } = {}) {
  const dreamText = typeof dream === 'string' ? dream : '';
  const why = typeof reason === 'string' && reason.trim() !== '' ? reason.trim() : '(no detail given)';
  return [
    'DETERMINISTIC GAP — the previous attempt does NOT actually work.',
    'The project did not pass its deterministic checks (its tests are red, or the',
    'built thing does not run). This is a CORRECTION pass, not a new task.',
    '',
    `Restating the goal (the dream, verbatim): ${dreamText}`,
    '',
    `Failing check: ${why}`,
    '',
    'Make the change ACTUALLY WORK: fix the failing tests / make the build run.',
    'Commit incrementally. Restating the goal once more to keep it in focus:',
    dreamText,
  ].join('\n');
}

/**
 * v0.17.a (SPEC_V017A AC-4) — combine the two faces' feedback for the iterate
 * re-launch. When BOTH faces fail, the next attempt must fix both; this stitches
 * the deterministic fragment and the semantic gap fragment with a clear divider.
 * PURE; NEVER throws (a falsy fragment is dropped).
 *
 * @param {{ deterministic?: string|null, semantic?: string|null }} args
 * @returns {string}
 */
export function combineFaceFeedback({ deterministic = null, semantic = null } = {}) {
  const parts = [deterministic, semantic].filter((p) => typeof p === 'string' && p.trim() !== '');
  return parts.join('\n\n---\n\n');
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
