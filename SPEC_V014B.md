# Make My Dreams — v0.14.0 Spec (slice v0.14.b): forced-kill auto-handoff (the Conductor actually stops the orchestrator)

> *(Supersedes the cooperative-stop core of step C, v0.13.0. The transparent-flip SPEC_V014A is DEFERRED until this lands AND is proven live — you cannot make a broken handoff transparent.)*
>
> **The finding this fixes (live, 2026-06-04).** The cooperative auto-handoff (v0.13.0/ADR-051) relied on the auto-dev orchestrator, at each phase boundary, reading the `.mmd/local/handoff-request` marker and EXITING CLEANLY so MMD could relaunch a resume successor. The heredoc instruction is correct (right path, explicit "exit cleanly"), **but the LLM does not obey it**: a real Sonnet run wrote checkpoints per phase (good) yet ran past ≥2 boundaries without stopping — context hit ~120% of the window, **0 handoffs**. MMD's loop never triggered because it only acts after auto-dev EXITS at a boundary, and auto-dev never exited. Root cause: **relying on an LLM to self-terminate mid-workflow is unreliable.** (The unit/integration suite was green because the fakes SIMULATED the cooperative exit — green tests, broken reality; only the live run caught it. See `auto-handoff-cooperative-broken` memory + this is exactly why we proved before flipping to transparent.)
>
> **The fix: move the stop from the LLM to MMD (deterministic).** MMD (the parent process, which already runs the stream-json context monitor) watches BOTH the context % AND `.mmd/local/checkpoint.json`. When the context crosses the threshold AND a NEW phase checkpoint appears (`last_completed_phase` increased = a boundary was just reached and its work committed), MMD **forcibly terminates the auto-dev process** and relaunches a fresh successor in RESUME mode — bounded by `MMD_MAX_HANDOFFS`. The kill happens AT a checkpoint (a phase just finished + the per-AC commits are in), so **no committed work is lost** (only the un-checkpointed in-phase reasoning since the last boundary, which is acceptable — the successor re-derives it from the next phase).
>
> **What stays / what goes.** KEEP (all correct + reusable): the monitor, `decideHandoff` (incl. the v0.13.1 resumable-checkpoint gate), the checkpoint writer, the resume relaunch, the bounded loop, the `handoff` notify. REMOVE: the heredoc's "check the marker → EXIT CLEANLY at the boundary" instruction (it doesn't work) — the heredoc keeps ONLY the per-phase checkpoint write + the resume-aware init. The orchestrator no longer needs to know about handoffs at all; the Conductor decides and acts.
>
> **The remaining LLM-dependent risk, named honestly:** the forced KILL is deterministic and reliable. The RESUME (a fresh auto-dev reads the checkpoint + handoff notes and continues from the next phase) is still LLM-dependent and has NOT been proven live (B.1's resume never was either). So this slice's acceptance REQUIRES a live proof (AC-5): a forced run that actually kills at a boundary AND whose successor demonstrably resumes + completes. If the resume does not work live, that is a wall to report — not a green-by-fakes pass.

---

## 1. Goal of v0.14.b

```
MMD spawns auto-dev (monitored). During the run MMD watches context% + checkpoint.json:
   context ≥ threshold  AND  checkpoint.last_completed_phase increased (a new boundary, work committed)  AND  handoffs < MAX
      → MMD KILLS the auto-dev process (SIGTERM/SIGKILL), records a handoff, relaunches a fresh auto-dev in RESUME mode
   successor reads checkpoint + handoff/<N>.md, continues from phase N+1 (LLM-dependent — PROVEN live in AC-5)
   repeat until the run completes on its own (done) OR MMD_MAX_HANDOFFS → one final un-aborted run.

The orchestrator (heredoc) no longer does any marker-check / self-exit — it only writes a checkpoint per phase.
MMD_NO_AUTO_HANDOFF=1 / the default opt-in story is unchanged from v0.13 (still behind --auto-handoff for now; the
transparent flip SPEC_V014A is deferred until this is proven).
```

Deliverables:
1. **Abortable auto-dev spawn** (`lib/invoke-autodev.js`): `invokeAutodev` gains a cooperative-abort seam — a caller-supplied predicate (checked on each monitor tick) can request termination; on abort, invokeAutodev **kills the child process group** and resolves with a distinct result (e.g. `{ aborted: 'handoff', code: null }`) rather than a normal exit. Never leaks the child. Unit-testable with a fake that emits stream events + lets the predicate fire.
2. **Forced-stop decision** (`lib/conductor/handoff.js`, extend): a pure `shouldForceHandoff({ pct, threshold, lastCompletedPhase, phaseAtSpawn, handoffsSoFar, maxHandoffs })` → boolean — true iff `pct ≥ threshold` AND `lastCompletedPhase > phaseAtSpawn` (a NEW boundary since this successor started) AND `handoffsSoFar < maxHandoffs`. Pure, never throws. (Complements `decideHandoff`, which classifies the post-exit state; this drives the mid-run kill.)
3. **The Conductor drives the forced loop** (`bin/mmd.js` handoff loop): spawn monitored auto-dev with the abort predicate wired to `shouldForceHandoff` (reading the live monitor pct + polling `readCheckpoint`); on a handoff-abort → record it, fire the `handoff` notify, relaunch resume (reusing the v0.12.a resume relaunch), tracking `phaseAtSpawn` per successor; bounded by `MMD_MAX_HANDOFFS`, then a final un-aborted run. A normal exit → `decideHandoff` finish path (unchanged). The v0.13.1 no-false-handoff property holds (no new checkpoint ⇒ no kill).
4. **Heredoc simplified** (`install-mmd.sh`): REMOVE the cooperative "HANDOFF CHECK → exit cleanly" blocks at each boundary; KEEP the per-phase checkpoint write + the resume-aware init. The orchestrator is now handoff-agnostic. Materialization test asserts the checkpoint write remains and the self-exit instruction is gone.
5. **Docs + ADR + LIVE proof**: ADR-053 (cooperative→forced, why the LLM-self-stop failed live, the deterministic kill-at-checkpoint, no-committed-work-lost, the resume still LLM-dependent, transparent-flip deferred). README + CLAUDE.md, mechanical blocks, version → 0.14.0. **AC-5 (operator/live, REQUIRED):** a real forced `--auto-handoff` run kills at a boundary and the successor resumes + completes — captured honestly; a resume failure is a reported wall.

**Mission validation**: a monitored auto-dev run whose orchestrator crosses the threshold is FORCIBLY terminated by MMD at the next phase checkpoint (deterministic — not waiting on the LLM), and a fresh successor resumes from the checkpoint and continues, bounded by `MMD_MAX_HANDOFFS`; no committed work is lost; a run that never crosses the threshold (or reaches no new boundary) is never killed (no false handoff, v0.13.1 preserved); the resume is proven on a real run (AC-5).

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: abortable spawn (deterministic kill, no leak)
**Given** `invokeAutodev` with an abort predicate and a fake that emits several stream ticks
**When** the predicate returns true on a tick
**Then**: invokeAutodev terminates the child (process group), does not leave an orphan, and resolves with a distinct `aborted: 'handoff'` result (not a normal `code: 0`); when the predicate never fires, behavior is exactly as today (normal exit/await). 
Tag: `@unit`/`@integration` (predicate fires → child killed + aborted result; predicate never fires → unchanged).

### AC-2: pure forced-stop decision
**Given** `{ pct, threshold, lastCompletedPhase, phaseAtSpawn, handoffsSoFar, maxHandoffs }`
**When** `shouldForceHandoff(...)` runs
**Then**: true iff `pct ≥ threshold` AND `lastCompletedPhase > phaseAtSpawn` AND `handoffsSoFar < maxHandoffs`; false if under threshold, no new boundary since spawn, or at the cap; pure, never throws on odd/null input.
Tag: `@unit` (each gate; boundary/cap edges; null-safe).

### AC-3: the Conductor forced loop relaunches resume, bounded; no false handoff
**Given** a fake auto-dev that advances the checkpoint then keeps "running", under `--auto-handoff`
**When** the monitor pct crosses the threshold after a new checkpoint
**Then**: MMD kills the run, fires a `handoff` notify, relaunches resume (fresh `phaseAtSpawn`), repeats to `MMD_MAX_HANDOFFS`, then one final un-aborted run; a fake that crosses the threshold but advances NO checkpoint is NEVER killed (no false handoff — v0.13.1 preserved); a normal completion → finish + the alignment gate runs once.
Tag: `@integration` (forced kill → resume relaunch; cap → final; no-new-checkpoint → no kill).

### AC-4: heredoc drops the cooperative self-exit, keeps the checkpoint (materialized)
**Given** `install-mmd.sh` run on a temp target
**When** the materialized workflow is read
**Then**: it still instructs a per-phase checkpoint write + the resume-aware init, but contains NO "check the handoff-request marker → exit cleanly" self-stop instruction (the orchestrator is handoff-agnostic). 
Tag: `@integration` (checkpoint-write present; cooperative self-exit instruction absent).

### AC-5: live forced-handoff + resume proof (REQUIRED, operator/live)
**Given** MMD itself after this slice, a real `--here --auto-handoff` run with a forced low threshold on a capable model
**When** the orchestrator crosses the threshold after completing a phase
**Then**: MMD forcibly terminates it at the checkpoint AND a fresh successor demonstrably resumes from the next phase and the run completes — captured honestly (killed-at-phase-N, successor-resumed-from-N+1, completed). **If the resume does not work, it is reported as a wall and the slice is NOT declared done** (universal §VI; the 'always verify / untested = broken' rule — this AC is non-negotiable for this slice).
Tag: operator/live (no automated assertion — the explicit live proof the cooperative version lacked).

---

## 3. Out of scope (deferred)

- **Transparent flip (SPEC_V014A)** — deferred until THIS works + is proven live. Only then does default-on make sense.
- **Whether the orchestrator ever genuinely saturates on a real slice** — a real open question (it delegates phases to fresh sub-agents). Out of scope here, but if real runs never approach the threshold, a later slice may downscope auto-handoff. This slice makes the mechanism WORK; its necessity is a separate measurement.
- **Forced kill mid-phase (no checkpoint yet)** — we only kill AT a checkpoint (a completed boundary) so no committed work is lost. A run that fills before its first checkpoint is reported as a context-limited failure, not force-handed-off.
- **Parallel Conductor (D), Bundle C (E).**

---

## 4. Operational notes for the implementer

- The kill must target the child's PROCESS GROUP (the auto-dev claude -p may spawn its own children) and be clean (SIGTERM, escalate to SIGKILL after a short grace) — no orphans. Mirror the careful process handling already in the codebase.
- REUSE: the monitor (pct), `readCheckpoint`, the resume relaunch (v0.12.a), `decideHandoff`'s resumable gate (v0.13.1), the `handoff` notify. Do NOT re-implement them. This slice ADDS the abort seam + `shouldForceHandoff` + rewires the loop from "wait for cooperative exit" to "force-kill at a new boundary".
- `phaseAtSpawn` = `readCheckpoint().lastCompletedPhase` at each successor's launch (0 if none), so a successor only force-hands-off after IT completes a NEW phase — preventing an immediate re-kill loop on the inherited checkpoint.
- The heredoc edit only REMOVES the cooperative self-exit blocks; do not touch the checkpoint-write or resume-init (they're correct). Re-materialize awareness: the installed workflow needs `install-mmd.sh` to take effect (npm install -g does NOT re-materialize it).
- AC-5 is REQUIRED and live — do not mark the slice done on green fakes alone (that is exactly the trap that hid the cooperative bug).
- Commit incrementally per AC (L-019). Tests tagged per stratum.
