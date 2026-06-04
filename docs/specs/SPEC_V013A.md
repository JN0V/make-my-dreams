# Make My Dreams — v0.13.0 Spec (slice v0.13.a): cooperative auto-handoff at 70% (Conductor step C)

> *(Theme: §9.0 forward-plan **step C**. Connect the v0.5.b context monitor — which already SEES 70% but does nothing — to the v0.12.a resume mechanism, so the Conductor hands off to a fresh successor when the orchestrator's context fills. The Conductor finally ACTS.)*
>
> **The pieces exist; C connects them.** (1) The v0.5.b monitor (`makeContextMonitor`, behind `--monitor`) spawns auto-dev as `stream-json`, tracks the orchestrator's context %, and at `MMD_HANDOFF_THRESHOLD` (default 0.70) writes a `ready_for_handoff` marker + fires a `context_70` notification — **but it does not act**. (2) The v0.12.a B.1 work made auto-dev **checkpoint each phase** (`checkpoint.json` + `handoff/<N>.md`) and gave MMD a **real resume** that relaunches a fresh auto-dev continuing from the checkpoint. **C wires them**: at 70%, the orchestrator finishes its current phase, checkpoints, and **stops cleanly at the phase boundary**; MMD detects the cooperative stop and **relaunches a fresh successor in resume mode**, bounded.
>
> **Cooperative (C-graceful), not a forced kill.** MMD does NOT kill auto-dev mid-phase (that loses the in-phase reasoning). Instead, auto-dev — at each phase boundary, where it already checkpoints (B.1) — checks whether a handoff was requested; if so it announces and **exits cleanly without starting the next phase**, leaving an incomplete checkpoint. MMD sees a clean exit + incomplete checkpoint + a handoff request → relaunches resume. The 70% threshold is conservative precisely to leave headroom to finish the current phase before exiting. This is the §4.2 "killed → recreated from files" property, but as a *clean cooperative stop* rather than a kill.
>
> **Opt-in by construction (the bootstrap contract).** Auto-handoff REQUIRES the monitor (only `stream-json` exposes the context usage). It is gated behind a new **`--auto-handoff`** flag that **implies `--monitor`**. Without it, the default text spawn — the path MMD uses to build itself — stays **byte-for-byte unchanged** (pinned by a test). C can never be default-on.
>
> **Bounded + honest.** Handoffs are capped by `MMD_MAX_HANDOFFS` (default 3) to prevent an infinite handoff chain; at the cap, MMD launches one **final** successor with handoff DISABLED (it runs to done or fails naturally) and logs the cap honestly — progress is never infinitely deferred, and nothing is silently dropped (universal §VI). A `handoff` notification event is fired per handoff (reusing the v0.5.a fan-out).
>
> **Testability honesty (§VI).** auto-dev's boundary-stop behavior is a *prompt* in the `install-mmd.sh` heredoc — we test that the instruction is **materialized**, not the LLM's runtime obedience. Deterministically tested: the pure handoff-decision logic, the MMD handoff loop (with a fake auto-dev simulating a cooperative stop), the handoff-request marker, and the default-spawn-unchanged pin. The true "a real run crosses 70% and hands off mid-pipeline" is an explicit **operator/live validation** (AC-6).

---

## 1. Goal of v0.13.a

```
mmdream --here --auto-handoff "<dream>"   (--auto-handoff implies --monitor)
   →  MMD spawns auto-dev (monitored, stream-json). Orchestrator context climbs as it accumulates phase results.
   →  context crosses 70% → monitor writes ready_for_handoff + a handoff-REQUEST marker MMD/auto-dev share.
   →  auto-dev finishes the current phase, writes its checkpoint (B.1), checks the request at the boundary:
        request present → "⏸ Handoff requested at phase N boundary — checkpointing and stopping cleanly for a fresh successor."
        → exits 0, leaving an INCOMPLETE checkpoint (last_completed_phase = N < total).
   →  MMD's handoff loop: exit + incomplete checkpoint + handoff requested + handoffs < MAX →
        log "↪ Handoff 1/3: relaunching a fresh successor (resume from phase N+1)", fire `handoff` notify,
        clear the request marker, relaunch a FRESH monitored auto-dev in RESUME mode (v0.12.a) → continue.
   →  successor runs phases N+1… (fresh low context). Repeat until the orchestrator completes the pipeline (done)
        OR MMD_MAX_HANDOFFS reached → one FINAL successor with handoff DISABLED (runs to done/fail) + honest cap log.
   →  on true completion: the v0.11 alignment gate runs once (unchanged).

mmdream --here "<dream>"   (NO --auto-handoff)  →  byte-for-byte today: one spawn, no handoff, default text spawn.
```

Deliverables:
1. **Pure handoff-decision logic** (`lib/conductor/handoff.js`, never throws): `decideHandoff({checkpoint, handoffRequested, handoffsSoFar, maxHandoffs, totalPhases})` → `{action: 'finish' | 'handoff' | 'cap-final', reason}` — `finish` when the checkpoint is complete (or no handoff requested); `handoff` when incomplete + requested + `handoffsSoFar < maxHandoffs`; `cap-final` when incomplete + requested + cap reached. `parseMaxHandoffs(raw, fallback=3)` (integer ≥ 1; junk → fallback; `0` clamps to a meaningful minimum or fallback — documented). Pure, deterministic, never throws.
2. **Monitor writes a handoff-REQUEST marker at threshold** (`makeContextMonitor` / `lib/conductor/checkpoint.js` or a sibling): when the threshold is first crossed, in addition to the existing `ready_for_handoff` status field + `context_70` notify, write a small file-system **request marker** the orchestrator can cheaply check at a phase boundary (a file in the gitignored `.mmd/` run-local area). Idempotent; cleared by MMD before each successor relaunch.
3. **auto-dev stops cleanly at a phase boundary on request** (`install-mmd.sh` auto-dev heredoc): at each phase boundary — right after writing the B.1 checkpoint — the orchestrator checks the handoff-request marker; if present, it ANNOUNCES the handoff and **exits cleanly without starting the next phase** (leaving the incomplete checkpoint). No request → continue as today. Additive; a non-`--auto-handoff` run never sees a request marker, so behavior is unchanged.
4. **MMD CLI handoff loop** (`bin/mmd.js`, behind `--auto-handoff` ⟹ `--monitor`): replace the single `invokeAutodev` await (in `runHereMode`, and greenfield) with a bounded loop driven by `decideHandoff` — spawn monitored auto-dev → on exit read the checkpoint + request marker → `finish` (proceed to alignment gate/done) | `handoff` (log + `handoff` notify + clear marker + **fresh** monitor + relaunch resume) | `cap-final` (honest cap log + one final resume with handoff disabled). `MMD_MAX_HANDOFFS` default 3. **Without `--auto-handoff` the path is byte-for-byte today's single spawn** (pinned). The alignment gate runs once on true completion.
5. **Docs + `/mmdream` note**: ADR-051 (cooperative auto-handoff, the 70%→boundary-stop→resume chain, opt-in/bootstrap contract, the cap, testability boundary, builds on B.1 + the v0.5.b monitor); `assets/claude-commands/mmdream.md` documents `--auto-handoff` (long runs that may fill context); README + CLAUDE.md; mechanical blocks; version → 0.13.0.
6. **Operator/live validation (honest capture, AC-6)**: on MMD itself, a real `--here --auto-handoff` run whose orchestrator crosses 70% stops at a phase boundary and a fresh successor resumes — captured honestly (handed-off-at-phase-N, successor-resumed, no-work-redone). If it does not behave as designed, reported as a wall (§VI), not papered over.

**Mission validation**: `mmdream --here --auto-handoff` whose orchestrator context crosses 70% finishes its current phase, checkpoints, stops cleanly, and MMD relaunches a fresh successor that resumes from the next phase — repeated up to `MMD_MAX_HANDOFFS`, then a final un-handoffed run; the decision logic never throws; **without** `--auto-handoff` the spawn + flow are byte-for-byte today's. The Conductor now ACTS on the 70% signal it has been able to SEE since v0.5.b.

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: pure handoff-decision logic (never throws)
**Given** `{checkpoint, handoffRequested, handoffsSoFar, maxHandoffs, totalPhases}`
**When** `decideHandoff(...)` runs
**Then**: `finish` when checkpoint complete (`lastCompletedPhase >= totalPhases`) OR `!handoffRequested`; `handoff` when incomplete + requested + `handoffsSoFar < maxHandoffs`; `cap-final` when incomplete + requested + `handoffsSoFar >= maxHandoffs`. `parseMaxHandoffs` returns an integer ≥ 1 (junk/empty/negative → fallback 3). Pure, deterministic, never throws on any (incl. null/odd) input.
Tag: `@unit` (each branch; cap boundary; parseMaxHandoffs; null-safe).

### AC-2: monitor writes a clearable handoff-request marker at threshold
**Given** a monitored run whose context crosses `MMD_HANDOFF_THRESHOLD`
**When** the threshold is first crossed
**Then**: in addition to the existing `ready_for_handoff` status field + `context_70` notify (unchanged), a request marker file is written in the gitignored `.mmd/` run-local area; it is idempotent (re-crossing does not duplicate) and MMD can clear it. Below threshold → no marker. 
Tag: `@unit`/`@integration` (marker written once at threshold; absent below; clearable).

### AC-3: auto-dev stops cleanly at a phase boundary on request (materialized)
**Given** `install-mmd.sh` run on a temp target
**When** the materialized auto-dev workflow is read
**Then**: it instructs the orchestrator, at each phase boundary AFTER writing the checkpoint, to check the handoff-request marker and — if present — announce the handoff and EXIT cleanly without starting the next phase (leaving the incomplete checkpoint); no marker → continue. (Instruction materialized — testability boundary, §VI.)
Tag: `@integration` (materialize → grep the boundary-stop-on-request instruction).

### AC-4: MMD handoff loop relaunches a bounded resume; default unchanged
**Given** `--auto-handoff` and a fake auto-dev that exits leaving an incomplete checkpoint + a handoff request
**When** the loop runs
**Then**: MMD relaunches a fresh monitored auto-dev in resume mode, clears the marker, fires a `handoff` notify, and repeats up to `MMD_MAX_HANDOFFS`; at the cap it runs one final successor with handoff disabled + logs the cap honestly; a complete checkpoint → `finish` (proceed to the alignment gate/done). **Without `--auto-handoff` the spawn args + single-spawn flow are byte-for-byte today's** (pinned by a `@unit` test). `--auto-handoff` implies `--monitor`.
Tag: `@unit` (spawn-args unchanged without the flag; --auto-handoff implies --monitor) + `@integration` (fake cooperative stop → relaunch resume; cap → final un-handoffed run; complete → finish).

### AC-5: docs + `/mmdream` note
**Then**: ADR-051 lands; `assets/claude-commands/mmdream.md` documents `--auto-handoff` (for long runs that may fill the orchestrator's context); README + CLAUDE.md updated; mechanical blocks refreshed; version → 0.13.0.
Tag: `@unit`/`@integration` (ADR-051 exists; template mentions `--auto-handoff`; version bumped).

### AC-6: operator/live auto-handoff validation (honest capture)
**Given** MMD itself after this slice
**When** a real `mmdream --here --auto-handoff` run's orchestrator crosses 70%
**Then**: it stops at the next phase boundary and a fresh successor resumes from the checkpoint without redoing completed phases — captured honestly in the slice/HANDOVER notes; a failure to behave as designed is reported as a wall, not papered over.
Tag: operator/live (no automated assertion — explicit live capture).

---

## 3. Out of scope (deferred)

- **Forced-kill handoff** (terminating auto-dev mid-phase) — rejected in favor of the cooperative boundary stop (no lost in-phase work). A forced kill as a *fallback* when the orchestrator overruns the window before reaching a boundary is a later refinement.
- **Sub-phase handoff granularity** — handoff happens at phase boundaries (1-4), inheriting B.1's granularity.
- **Parallel handoff / multiple orchestrators (step D)** and **Bundle C observability (step E)** — later.
- **Tuning the threshold adaptively** — `MMD_HANDOFF_THRESHOLD` stays a fixed conservative default (0.70), env-overridable as today.

---

## 4. Operational notes for the implementer

- `--auto-handoff` MUST imply `--monitor` (the context usage only exists in the stream-json spawn). WITHOUT the flag, the spawn + single-spawn flow stay byte-for-byte today's — pin it (mirror the v0.5.b/v0.11 spawn-pin tests). C can never be default-on.
- REUSE the v0.12.a resume relaunch (`invokeAutodev` + the resume-aware prompt) and the v0.12.a checkpoint reader — do NOT write a second resume or spawn path. REUSE the v0.5.a notify fan-out for the `handoff` event.
- Each successor gets a FRESH `makeContextMonitor` (its context accounting restarts low). Clear the handoff-request marker before each relaunch so the successor doesn't immediately re-stop.
- The handoff loop wraps BOTH `runHereMode` and greenfield; keep the alignment gate (v0.11) running ONCE on true completion, not per successor.
- `MMD_TIMEOUT_MS=0` applies to each successor (L-016). `MMD_MAX_HANDOFFS` integer ≥ 1, default 3, graceful fallback.
- The `install-mmd.sh` heredoc is the source of truth for the auto-dev workflow; mirror the v0.12.a materialization-test pattern for AC-3.
- Commit incrementally per AC (L-019). Tests tagged per stratum.
