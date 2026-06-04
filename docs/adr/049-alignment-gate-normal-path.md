# ADR-049 — Alignment gate on the normal run path + bounded iterate-on-gap

**Status**: accepted
**Date**: 2026-06-04
**Slice**: v0.11.a (the Conductor's first real CONTROL brick — "verify the ask, then correct"; task A of the A→E orchestrator sequence)

## Context

MMD's value proposition is that it does not just *fire* an AI build and walk away —
it *conducts* one. But until now the conducting stopped at observation. A normal
`mmdream --here` or greenfield run had **zero automated verification that the
implementation fulfils the dream**. The Reality Check is SKIPPED in `--here` mode
(no PWA to open) and is a shallow render check on greenfield. Correctness rested
entirely on the operator running `npm test` and reading the diff.

This is the sharpest gap from the état-des-lieux, and the galling part is that
**the verification machinery already exists**. `lib/sealed-tests/judge.js`
(`buildJudgePrompt`/`parseJudgeVerdict`/`judgeFallback`, pure) + `invokeJudge`
(`bin/mmd.js`) is a behavioral oracle that grades an implementation against WHAT
WAS ASKED (the dream/ACs), with a defensive OVERALL-met downgrade (an over-eager
`OVERALL: MET` while a per-AC line is not-met is distrusted) and the sacred
`uncertain` fallback (an unparseable reply never becomes a fabricated `met`). It
catches P-09 — "a passing test suite is not proof of asked-for behavior" (L-025).
**But it ran ONLY inside `runSealedPipeline`, behind the `--sealed` opt-in.** The
judge was built, validated, and then locked away from the path 99% of runs take.

## Decision

Wire the **existing** judge onto the **normal** path — `mmdream --here` (non-sealed)
and greenfield — **default-on**, as an **alignment gate** that runs after auto-dev
completes and BEFORE the run is marked done. On a gap, **iterate**: re-launch
auto-dev once (bounded) with feedback naming the unmet ACs, then re-judge. This is
the Conductor's first move from "watch" to "verify the ask and correct."

- **Reuse, do not reinvent.** `buildJudgePrompt`/`parseJudgeVerdict`/`judgeFallback`/
  `invokeJudge` and the OVERALL-met-downgrade + sacred-fallback logic are reused
  **verbatim**. No second judge. `buildJudgePrompt` requires a `sealedDir`; on the
  normal path there is no sealed suite, so the real evidence (the slice diff for
  `--here`, the produced files for greenfield) rides in `artifactsSummary`, led by
  an **honest** note that the evidence is the diff, not a sealed test suite
  (universal §VI). The summary is recomputed on each judge call so a
  post-iteration diff is graded fresh, never a stale one.

- **A pure decision module.** `lib/conductor/alignment-gate.js` (pure, never
  throws): `aggregateAlignment(verdict)` → `{ aligned, gapAcs }` (aligned ⟺
  `overall === 'met'`; `gapAcs` = the **not-met** ACs only — an `uncertain` AC is
  **not** a gap item, so the caller reads the three branches straight off
  `(aligned, gapAcs.length)`), `buildGapFeedback({ gapAcs, dream })` → a
  correction-pass prompt fragment that restates the goal at both ends (counters
  constraint decay, ai-coding §III) and names each unmet AC + reason, and
  `parseMaxIters(raw)` → the bounded iteration count. The iterate **loop** itself
  lives in `bin/mmd.js` (`runAlignmentGate`) where the spawn/judge seams are; the
  module only *decides*, it never *acts*.

- **Default-on with an exact opt-out.** `MMD_SKIP_ALIGN=1` skips the gate and
  restores pre-v0.11 behavior **exactly** (mirrors `MMD_SKIP_GROUNDING`). The
  gate is a **post-completion step** — it never touches `buildAutodevArgs` or the
  spawn (the bootstrap / `--monitor` byte-for-byte contract, pinned by a test).

- **Bounded iterate-on-gap.** On a NOT-MET verdict the gate re-launches auto-dev
  via the injected `invokeAutodev` seam with `buildGapFeedback` appended, up to
  `MMD_ALIGN_MAX_ITERS` attempts (integer ≥ 0, default **1**, graceful fallback on
  junk; `0` = gate-but-never-iterate), re-judging after each. A gap surviving the
  last attempt → **exit 7** (the EXISTING behavioral-gap code, reused — not a new
  one), `status.json.judge` records the gap, the slice is **NOT** marked done.

- **The sacred fallback, distinct from a gap.** An `uncertain` / unparseable /
  gate-absent verdict (`gapAcs` empty but not aligned) takes the honest-hold
  branch: **no** blind iterate, **no** fabricated pass — an honest "alignment
  unverified — <why>" note, the verdict (`overall: uncertain`) recorded. The
  change is on the branch (done), but its alignment is explicitly *unconfirmed*,
  never silently waved through as met. A confirmed gap (exit 7, not done) and an
  unverifiable verdict (done-with-caveat) are deliberately different signals.

- **Sealed paths untouched.** `--sealed` / sealed-greenfield already judge inside
  `runSealedPipeline`; the gate only runs on the non-sealed branches, so there is
  no double-judge.

## Consequences

A `mmdream --here` whose implementation misses an acceptance criterion now gets a
NOT-MET verdict → auto-dev re-attempts once with the unmet-AC feedback → either the
gap closes (done, judge recorded) or it is reported honestly (exit 7, not done).
An aligned implementation passes straight through (one judge call, done). A run
with `MMD_SKIP_ALIGN=1` behaves exactly as before. A missing/uncertain judge
yields an honest "alignment unverified" note, never a fabricated pass. The
auto-dev spawn is byte-for-byte unchanged.

**Softness named (L-025.5).** A single LLM judge is non-deterministic. The bounded
iterate is whole-pipeline, not a surgical per-AC fix. These are accepted for this
slice; the obvious softeners (advisory/warn-only mode, multi-judge majority vote,
per-AC partial re-implementation) are deferred, not forgotten.

**Scope = task A only.** The rest of the Conductor sequence is deferred: **B** —
externalized `decisions.log`/`handoff/` + the Orchestrator delegation loop (break
the monolithic `/bmad-adv-auto-dev` call into MMD-orchestrated steps); **C** —
auto-handoff@70% (act on the `READY_FOR_HANDOFF` marker the v0.5.b monitor already
writes); **D** — parallel Conductor + worktrees + safety hooks; **E** — Bundle C
observability/HITL. The **polymorphic Reality Check** (invoke `/qa`/`/cso` by
deliverable type) is the *deterministic/tool* alignment face complementing this
*semantic/judge* face — also deferred.

See docs/specs/SPEC_V011A.md, L-025 (P-09 judge), and ADR-028 (the original sealed-pipeline
judge this slice reuses).
