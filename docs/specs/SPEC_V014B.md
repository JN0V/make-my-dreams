# Make My Dreams — v0.14.0 Spec (slice v0.14.b): hybrid auto-handoff (incite, then enforce at a checkpoint)

> *(Fixes the live finding that the cooperative-only stop of step C, v0.13.0, does not work. The transparent-flip SPEC_V014A stays DEFERRED until this lands AND is proven live.)*
>
> **The finding (live, 2026-06-04).** Cooperative auto-handoff (v0.13.0/ADR-051) asked the auto-dev orchestrator to read the `.mmd/local/handoff-request` marker at each phase boundary and EXIT CLEANLY. The instruction is correct, **but the LLM does not obey it**: a real Sonnet run wrote checkpoints per phase yet ran past ≥2 boundaries to ~120% context with **0 handoffs**. Structural root cause: a `claude -p` agent has **no reliable self-terminate primitive** and, under "finish the task" pressure, keeps going. (The suite was green because the fakes SIMULATED the exit — green tests, broken reality; only the live run caught it.)
>
> **The fix Sébastien chose — HYBRID (incite, then enforce):** do NOT abandon the gentle path, and do NOT depend on it.
> 1. **Incite (unchanged):** MMD's monitor still writes the `handoff-request` marker at the threshold, and the heredoc still asks the orchestrator to stop at the next boundary. If the agent obeys → it exits cleanly → MMD relaunches resume (the v0.13.0 cooperative path). No force, gentlest outcome.
> 2. **Enforce (new backstop):** if the agent IGNORES the incitation — it completes ANOTHER phase (the checkpoint advances) while over the threshold and is **still alive** (it did not exit) — MMD waits a short **grace** (a last chance to exit on its own), then **terminates the orchestrator process (SIGTERM, escalating to SIGKILL) AT that checkpoint** and relaunches resume.
>
> **Why the enforce is safe (addresses the "killing worries me" concern).** The termination happens ONLY at a phase checkpoint — a phase just COMPLETED and its per-AC commits (L-019) are already in git. So **no committed work is lost**; only the un-checkpointed reasoning since the last boundary, which the fresh successor re-derives. We terminate only the auto-dev orchestrator process, nothing else. This is exactly the §4.2 design — *"any level can be killed and recreated from the files"* — done at a safe point, as a backstop, after asking nicely first.
>
> **The remaining LLM-dependent risk, named honestly.** The enforce (SIGTERM at a checkpoint) is deterministic + reliable. The RESUME (a fresh agent reads the checkpoint + handoff notes and continues from the next phase) is still LLM-dependent and NOT yet proven live. So AC-5 (a live forced-then-resumed run) is **REQUIRED** — no green-by-fakes pass.

---

## 1. Goal of v0.14.b

```
MMD spawns auto-dev (monitored). MMD watches context% (monitor) + checkpoint.json. At the threshold it writes the marker (incite).
   Path A — agent OBEYS: exits cleanly at the boundary (incomplete checkpoint + marker) → MMD relaunches resume (v0.13.0 path).
   Path B — agent IGNORES: it advances the checkpoint (a NEW phase done) while over threshold AND is still alive →
            MMD waits a short grace for it to exit on its own; if still alive → SIGTERM (→SIGKILL) at that checkpoint,
            record a handoff, fire the `handoff` notify, relaunch resume.
   Repeat (each successor tracks phaseAtSpawn) until the run completes on its own OR MMD_MAX_HANDOFFS → one final un-enforced run.
   v0.13.1 preserved: no resumable checkpoint / no new boundary ⇒ no handoff (no false kill).
```

Deliverables:
1. **Abortable auto-dev spawn** (`lib/invoke-autodev.js`): `invokeAutodev` gains an abort seam — a caller predicate checked on each monitor tick; on fire it **terminates the child process GROUP** (SIGTERM, then SIGKILL after a short grace), never orphaning, and resolves with a distinct `{ aborted: 'handoff', code: null }`. When the predicate never fires (or the child exits first — the cooperative path), behavior is exactly as today.
2. **Pure enforce decision** (`lib/conductor/handoff.js`, extend): `shouldForceHandoff({ pct, threshold, lastCompletedPhase, phaseAtSpawn, handoffsSoFar, maxHandoffs })` → boolean — true iff `pct ≥ threshold` AND `lastCompletedPhase > phaseAtSpawn` (a NEW boundary since this successor started — i.e. the agent reached a boundary and kept going) AND `handoffsSoFar < maxHandoffs`. Pure, never throws. (`decideHandoff` still classifies the cooperative-exit case post-exit; this drives the enforce-while-alive case.)
3. **The Conductor hybrid loop** (`bin/mmd.js`): spawn monitored auto-dev with the abort predicate wired to `shouldForceHandoff` (live monitor `pct` + polled `readCheckpoint`, `phaseAtSpawn` captured at launch). A **grace** (e.g. `MMD_HANDOFF_GRACE_MS`, small default) lets the agent exit cooperatively first; only if it's still alive after the grace does the predicate fire → abort/terminate → relaunch resume. The cooperative exit (Path A) still works via the existing post-exit `decideHandoff` path. Bounded by `MMD_MAX_HANDOFFS`, then a final un-enforced run. The alignment gate (v0.11) runs once on true completion. v0.13.1 no-false-handoff preserved.
4. **Heredoc KEEPS the cooperative incitation** (`install-mmd.sh`): the per-phase checkpoint write + the "check the marker → please exit cleanly at the boundary" instruction + the resume-aware init all STAY (the incitation is harmless when obeyed and is Path A). No heredoc removal — the enforce is purely MMD-side. (Contrast the earlier forced-only draft, which wrongly proposed deleting the incitation.)
5. **Docs + ADR + LIVE proof**: ADR-053 (cooperative-only failed live → hybrid incite+enforce; the LLM has no self-terminate primitive; enforce is a graceful SIGTERM at a checkpoint = no committed work lost = §4.2; resume still LLM-dependent → AC-5 required; transparent flip deferred). README + CLAUDE.md, mechanical blocks, version → 0.14.0. **AC-5 (operator/live, REQUIRED):** a real run where the agent ignores the incitation, MMD enforces at a checkpoint, and the successor resumes + completes — captured honestly; a resume failure is a reported wall.

**Mission validation**: an orchestrator that obeys the incitation hands off cooperatively (Path A, no force); one that ignores it is enforced at a checkpoint after a grace (Path B) — deterministic, no committed work lost; both relaunch a resuming successor, bounded; a run that never crosses the threshold or reaches no new boundary is never terminated (v0.13.1); the resume is proven on a real run (AC-5).

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: abortable spawn (graceful terminate, no leak)
**Given** `invokeAutodev` with an abort predicate + a fake emitting several ticks
**When** the predicate fires
**Then**: the child process group is terminated (SIGTERM then SIGKILL after a grace), no orphan, resolves `{ aborted: 'handoff', code: null }`; predicate never fires OR child exits first → behavior exactly as today.
Tag: `@unit`/`@integration` (predicate fires → killed + aborted result; never fires → unchanged; child self-exit first → normal result).

### AC-2: pure enforce decision
**Given** `{ pct, threshold, lastCompletedPhase, phaseAtSpawn, handoffsSoFar, maxHandoffs }`
**When** `shouldForceHandoff(...)` runs
**Then**: true iff `pct ≥ threshold` AND `lastCompletedPhase > phaseAtSpawn` AND `handoffsSoFar < maxHandoffs`; false under threshold, no new boundary since spawn, or at the cap; pure, never throws on odd/null input.
Tag: `@unit` (each gate; boundary/cap edges; null-safe).

### AC-3: the hybrid loop — cooperative first, enforce as backstop, bounded, no false handoff
**Given** fakes for both paths under `--auto-handoff`
**When** (A) a fake that exits at the boundary with an incomplete checkpoint+marker, and (B) a fake that advances the checkpoint then KEEPS running over threshold
**Then**: (A) → relaunch resume via the existing cooperative-exit path (no force); (B) → after the grace, MMD terminates + relaunches resume; both bounded by `MMD_MAX_HANDOFFS` then a final un-enforced run; a fake that crosses threshold but advances NO checkpoint is NEVER terminated (v0.13.1); a normal completion → finish + alignment gate once.
Tag: `@integration` (Path A cooperative; Path B enforce-after-grace; cap → final; no-new-checkpoint → no kill).

### AC-4: heredoc keeps the incitation + checkpoint (materialized)
**Given** `install-mmd.sh` on a temp target
**When** the materialized workflow is read
**Then**: it STILL contains the per-phase checkpoint write, the marker-check + cooperative "exit cleanly" instruction, and the resume-aware init (the incitation is retained — Path A). 
Tag: `@integration` (checkpoint + cooperative-incitation + resume-init all present).

### AC-5: live hybrid-enforce + resume proof (REQUIRED, operator/live)
**Given** MMD itself after this slice, a real `--here --auto-handoff` run with a forced low threshold on a capable model
**When** the orchestrator crosses the threshold and (as observed) does NOT self-exit
**Then**: MMD enforces termination at a checkpoint AND a fresh successor demonstrably resumes from the next phase and the run completes — captured honestly (ignored-incitation, enforced-at-phase-N, resumed-from-N+1, completed). **If the resume does not work, it is reported as a wall and the slice is NOT done** (universal §VI; this AC is non-negotiable).
Tag: operator/live (no automated assertion).

---

## 3. Out of scope (deferred)

- **Transparent flip (SPEC_V014A)** — deferred until this works + is proven live.
- **Whether the orchestrator ever genuinely saturates on a real slice** — it delegates phases to fresh sub-agents, so it may stay light; if real runs never approach the threshold unforced, a later slice may downscope C. This slice makes the mechanism WORK; necessity is a separate measurement.
- **Enforce mid-phase (before any checkpoint)** — we only terminate AT a checkpoint (committed boundary). A run that fills before its first checkpoint is a context-limited failure, not force-handed-off.
- **Parallel Conductor (D), Bundle C (E).**

---

## 4. Operational notes for the implementer

- Kill the child PROCESS GROUP (auto-dev's `claude -p` spawns children) — SIGTERM, escalate to SIGKILL after a short grace; no orphans.
- The **grace** is the heart of "incite first": on detecting `shouldForceHandoff`, do NOT terminate immediately — give the agent a brief window to exit cooperatively (Path A); enforce only if still alive after it.
- `phaseAtSpawn` = `readCheckpoint().lastCompletedPhase` at each successor launch (0 if none) — a successor only enforces after IT completes a NEW phase, preventing an immediate re-kill on the inherited checkpoint.
- REUSE: monitor, `readCheckpoint`, resume relaunch (v0.12.a), `decideHandoff` + its v0.13.1 gate, the `handoff` notify. This slice ADDS the abort seam + `shouldForceHandoff` + the grace, and REWIRES the loop to "cooperative-exit OR enforce-after-grace". Do NOT re-implement them, do NOT remove the heredoc incitation.
- The installed workflow needs `install-mmd.sh` to re-materialize (npm install -g does NOT) — relevant for the AC-5 live run.
- AC-5 is REQUIRED + live — never mark done on green fakes alone (the trap that hid the cooperative bug).
- Commit incrementally per AC (L-019). Tests tagged per stratum.
