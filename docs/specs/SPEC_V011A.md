# Make My Dreams — v0.11.0 Spec (slice v0.11.a): alignment gate on the normal path + iterate-on-gap

> *(Theme: the Conductor's first real CONTROL brick — "verify the ask, then correct." Task A of the orchestrator/conductor sequence A→B→C→D→E. Closes the sharpest gap from the état-des-lieux: a normal `/mmdream` run has ZERO automated alignment verification.)*
>
> **The gap (verified in code).** MMD already has a behavioral judge that grades an implementation against WHAT WAS ASKED — `lib/sealed-tests/judge.js` (`buildJudgePrompt`/`parseJudgeVerdict`/`judgeFallback`, pure) + `invokeJudge` (`bin/mmd.js`), with a defensive downgrade (an over-eager `OVERALL: MET` while a per-AC line is not-met is downgraded) and the sacred `uncertain` fallback (unparseable → never a fabricated `met`). **But it runs ONLY inside `runSealedPipeline`** (`if (sealed)`, the `--sealed` opt-in). On a normal `mmdream --here` the Reality Check is SKIPPED (`--here` mode — no PWA to open); on greenfield it is a shallow render check. So a normal `/mmdream` code change is **never checked for whether it fulfils the dream** — it relies entirely on the operator running `npm test` and reading the diff. The judge exists; it is just locked behind `--sealed`.
>
> **The fix (task A).** Wire the existing judge onto the **normal** path (`mmdream --here` non-sealed branch + greenfield), default-on, so every run grades the implementation against the dream/ACs **after** auto-dev completes and **before** the run is marked done — and when there is a gap, **iterate**: re-launch auto-dev once (bounded) with feedback naming the unmet ACs, then re-judge. A confirmed gap after the bounded iterations is reported **honestly** (exit 7, the slice is NOT marked done) — never a fabricated pass. This turns "MMD fires one call and watches" into "the Conductor verifies the ask and corrects."
>
> **Reuse, do not reinvent (the brick exists).** `buildJudgePrompt`/`parseJudgeVerdict`/`judgeFallback`/`invokeJudge` and the OVERALL-downgrade + sacred-fallback logic are reused as-is. The sealed path keeps its own judge (already runs); this slice adds the judge to the paths that have none. No second judge implementation.
>
> **Scope.** Task A only. The externalized `decisions.log`/`handoff/` Orchestrator loop (B), auto-handoff@70% (C), parallel Conductor + worktrees (D), and Bundle C observability (E) are the deferred follow-ups in the rewritten roadmap.

---

## 1. Goal of v0.11.a

```
mmdream --here "<dream>" (or greenfield)  →  auto-dev runs (unchanged spawn)  →  auto-dev completes
   →  ALIGNMENT GATE (default on; MMD_SKIP_ALIGN=1 opts out):
        judge grades the produced change against WHAT WAS ASKED (dream/ACs), evidence = the slice diff / produced files
          overall MET (every AC met)            → mark done (as today) + record status.json.judge
          any NOT-MET                           → ITERATE (bounded, MMD_ALIGN_MAX_ITERS default 1):
                                                     re-launch auto-dev with feedback naming the unmet ACs → re-judge
                                                       still a gap after the last iteration → EXIT 7 (behavioral-gap), NOT done, status.json.judge written
          uncertain / unparseable / gate-absent → HONEST report (the sacred fallback): do NOT iterate blindly, do NOT fabricate a pass;
                                                   record "alignment unverified — <why>", surface it; never silently "done"
```

Deliverables:
1. **Pure alignment-aggregation + feedback helper** (`lib/conductor/alignment-gate.js`): `aggregateAlignment(verdict)` → `{ aligned: boolean, gapAcs: [{ac, reason}] }` (aligned ⟺ `overall === 'met'`; `gapAcs` = the not-met ACs) and `buildGapFeedback({ gapAcs, dream })` → a prompt-fragment telling auto-dev which ACs the previous attempt missed and to address them (restating the goal — counters constraint decay, ai-coding §III). Pure, deterministic, never throws; an `uncertain`/empty verdict → `aligned:false` with no `gapAcs` (so the caller takes the honest-hold branch, not the iterate branch).
2. **Gate wired into the normal `--here` path** (`bin/mmd.js runHereMode`, the NON-sealed branch, after auto-dev completes, before `done`): builds an `artifactsSummary` from the slice diff (`git diff --name-only <base>..<slice>` + the dream as the ask), reuses `buildJudgePrompt`/`invokeJudge`/the OVERALL-downgrade, writes the verdict to `status.json.judge`. **Default-on**; `MMD_SKIP_ALIGN=1` opts out (mirrors `MMD_SKIP_GROUNDING`) → today's behavior exactly. **The auto-dev spawn itself is unchanged** (the gate is a post-completion step — the bootstrap/`--monitor` spawn stays byte-for-byte, pinned by a test).
3. **Gate wired into the greenfield path** (`bin/mmd.js` main greenfield completion, after `realityCheck`): same gate, evidence = the produced `demoDir` files. Default-on / `MMD_SKIP_ALIGN` opt-out. Sealed path is untouched (it already judges — no double-run).
4. **Bounded iterate-on-gap**: on a NOT-MET verdict, re-launch auto-dev (the injected `invokeAutodev` seam) with `buildGapFeedback` appended, up to `MMD_ALIGN_MAX_ITERS` (default **1**, integer ≥ 0, graceful fallback; 0 = gate-but-never-iterate), re-judging after each. A gap surviving the last iteration → **exit 7** (behavioral-gap, the existing meaning), status.json reflects the gap, the slice is **NOT** marked done. `uncertain`/unparseable/gate-absent → the **sacred fallback**: no blind iterate, an honest "alignment unverified" note, never a fabricated `met`.
5. **`/mmdream` template + docs**: the `/mmdream` playbook documents that the alignment gate runs by default on `--here`/greenfield (and how to opt out / cap iterations), and that monitoring should read `status.json.judge`; ADR-049 (the Conductor's verify-the-ask brick, reuse-not-reinvent, default-on with opt-out, bounded iterate, sacred fallback, the A→E sequence), README + CLAUDE.md, mechanical blocks refreshed, version bumped to 0.11.0.

**Mission validation**: a `mmdream --here` whose implementation misses an acceptance criterion gets a NOT-MET verdict → auto-dev re-attempts once with the unmet-AC feedback → either the gap closes (done, judge recorded) or the gap is reported honestly (exit 7, NOT done). An aligned implementation passes straight through (one judge call, done). A run with `MMD_SKIP_ALIGN=1` behaves exactly as today. A missing/!uncertain judge yields an honest "alignment unverified" note, never a fabricated pass. The auto-dev spawn is byte-for-byte unchanged (the gate is purely a post-step).

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: pure alignment-aggregation + gap-feedback helper
**Given** a parsed judge verdict `{overall, verdicts:[{ac,status,reason}]}`
**When** `aggregateAlignment(verdict)` / `buildGapFeedback({gapAcs,dream})` run
**Then**: `aligned` is true iff `overall === 'met'`; `gapAcs` lists exactly the `not-met` ACs (uncertain ACs are NOT gap-items — they take the honest-hold branch, not the iterate branch); an empty/odd/`uncertain` verdict → `{aligned:false, gapAcs:[]}`; `buildGapFeedback` restates the goal + names each unmet AC + its reason. Pure, deterministic, never throws.
Tag: `@unit` (all-met → aligned; one not-met → gap with that AC; uncertain → not-aligned, no gapAcs; empty → safe; feedback names the ACs).

### AC-2: gate on the normal `--here` path (default-on, opt-out, spawn unchanged)
**Given** a completed non-sealed `mmdream --here` run and a judge seam (fake in tests)
**When** the gate runs after auto-dev completes
**Then**: with the judge returning all-MET → the slice is marked done and `status.json.judge` is written; with `MMD_SKIP_ALIGN=1` → the gate does not run and behavior is byte-for-byte today's; the **auto-dev spawn args are unchanged** by this slice (pinned by a test); the sealed branch still runs its own judge (no double-judge).
Tag: `@unit` (spawn-args unchanged) + `@integration` (all-met → done + judge recorded; MMD_SKIP_ALIGN → no gate).

### AC-3: gate on the greenfield path
**Given** a completed greenfield build (evidence = produced `demoDir` files) and a judge seam
**When** the gate runs after `realityCheck`
**Then**: all-MET → done + `status.json.judge`; `MMD_SKIP_ALIGN=1` → today's behavior; sealed greenfield is untouched (already judges).
Tag: `@integration` (all-met → done + judge; opt-out path unchanged).

### AC-4: bounded iterate-on-gap + honest gap report (sacred fallback)
**Given** a judge returning NOT-MET for an AC, with `MMD_ALIGN_MAX_ITERS` set (default 1)
**When** the gate processes the gap
**Then**: auto-dev is re-launched (injected seam) with `buildGapFeedback` for up to `MMD_ALIGN_MAX_ITERS` attempts, re-judging after each; if a re-attempt closes the gap → done; if a gap remains after the last attempt → **exit 7**, `status.json.judge` records the gap, the slice is **NOT** marked done; `MMD_ALIGN_MAX_ITERS=0` → gate-but-never-iterate (gap → exit 7 immediately). An `uncertain`/unparseable/gate-absent verdict → **no iteration**, an honest "alignment unverified — <why>" note, the run is **not** silently marked done with a fabricated pass.
Tag: `@unit` (iters math; iters=0) + `@integration` (gap → re-launch with feedback → closes → done; gap persists → exit 7 not-done; uncertain → honest hold, no iterate).

### AC-5: `/mmdream` template + docs
**Given** the operator playbook and the docs
**When** updated
**Then**: `assets/claude-commands/mmdream.md` states the alignment gate runs by default on `--here`/greenfield, how to opt out (`MMD_SKIP_ALIGN=1`) / cap iterations (`MMD_ALIGN_MAX_ITERS`), and that monitoring reads `status.json.judge`; ADR-049 lands (verify-the-ask Conductor brick, reuse-not-reinvent, default-on/opt-out, bounded iterate, sacred fallback, A→E sequence); README + CLAUDE.md updated; mechanical blocks refreshed; version → 0.11.0.
Tag: `@unit`/`@integration` (template mentions the gate + opt-out; ADR-049 exists; version bumped).

---

## 3. Out of scope (deferred — the rest of the A→E sequence)

- **B — externalized `decisions.log`/`handoff/` + the Orchestrator delegation loop** (breaking the monolithic `/bmad-adv-auto-dev` call into MMD-orchestrated steps). The pivot that makes C+D possible. NOT this slice.
- **C — auto-handoff@70%** (the Conductor acting on the `READY_FOR_HANDOFF` marker the v0.5.b monitor already writes). Depends on B.
- **D — parallel Conductor + worktrees + safety hooks** (v0.9). Depends on B + the unblock-test worktree-safety fix.
- **E — Bundle C observability/HITL** (OpenTelemetry, per-action risk-scoring, worker `{result,confidence,alternatives}` schema). Layers independently.
- **Polymorphic Reality Check** (invoke `/qa`/`/design-review`/`/cso` by deliverable type) — the *deterministic/tool* alignment face; this slice is the *semantic/judge* face. Complementary, deferred.
- **Per-AC partial re-implementation** — the iterate re-launches the whole auto-dev with feedback, not a surgical per-AC fix. KISS; surgical iteration is a later refinement.

---

## 4. Operational notes for the implementer

- REUSE `lib/sealed-tests/judge.js` (`buildJudgePrompt`/`parseJudgeVerdict`/`judgeFallback`) and `invokeJudge` + the OVERALL-met-downgrade guard verbatim — do NOT write a second judge. `buildJudgePrompt` takes a `sealedDir`; on the normal path there are no sealed tests, so pass the evidence via `artifactsSummary` (the diff / produced files) and a null/absent sealed context — keep the prompt honest that the evidence is the diff, not a sealed suite.
- The gate is a **post-completion step** — it MUST NOT alter `buildAutodevArgs`/the spawn (the bootstrap + `--monitor` byte-for-byte contract). Pin the spawn args with a test (mirror the existing monitor-spawn regression lock).
- Default-on with `MMD_SKIP_ALIGN=1` opt-out (mirror `MMD_SKIP_GROUNDING`). `MMD_ALIGN_MAX_ITERS` integer ≥ 0, default 1, graceful fallback on junk (treat as default).
- Exit 7 is the EXISTING behavioral-gap code — reuse it, do not invent a new one. The slice must be **NOT marked done** on a surviving gap (universal §VI).
- Commit incrementally per AC (L-019). Tests tagged per stratum.
