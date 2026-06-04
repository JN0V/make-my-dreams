# Make My Dreams — v0.12.0 Spec (slice v0.12.a): the stateless, resumable orchestrator (Conductor step B.1)

> *(Theme: §9.0 forward-plan **step B** — the pivot. Make the auto-dev orchestrator survivable: checkpoint its phase progress to externalized state + a REAL resume that continues from it. Foundation for step C, auto-handoff@70%.)*
>
> **The architecture (verified in code, corrected understanding).** `/bmad-adv-auto-dev` is **MMD's own skill** (defined in the `install-mmd.sh` heredoc that materializes `_bmad/adv/workflows/auto-dev/workflow.md`), built **on top of** BMAD — not BMAD itself. Its own text says: *"YOUR ROLE: ORCHESTRATOR — you do NOT execute the workflows yourself; you launch sub-agents via the Agent tool (fresh context) for each phase… track the spec file path across phases — it's the critical handoff artifact."* So the §4.2 recursion is **already realized**: MMD CLI → **auto-dev (the L2 Orchestrator, delegates each of its 4 phases to a fresh sub-agent Worker)** → BMAD phase skills.
>
> **The gap.** The orchestrator (auto-dev) runs inside **ONE `claude -p` process with no externalized phase checkpoint**. If that process dies — crash, kill, or (step C) a 70%-context handoff — the whole orchestration is lost and **cannot be resumed**: it restarts from Phase 1, re-doing the spec. `slice.md` + the per-AC git commits are externalized, but auto-dev neither **writes** "which phase is done" nor **reads** it to continue, and MMD's `--resume` is a **stub** (it prints state and exits 3 — it does not continue any work).
>
> **The fix (step B.1).** Give the orchestrator the §4.2 **stateless property** — "any level can be killed and recreated from the files." Three pieces: (1) auto-dev **checkpoints its phase progress** to externalized state at each phase transition (a machine-readable `checkpoint.json` + a human `handoff/<N>.md` note); (2) auto-dev is **resume-aware** on init — it reads the checkpoint and, if phases are already done, announces a resume and **skips the completed phases** instead of restarting; (3) MMD CLI gains a **real resume** that relaunches a fresh auto-dev to **continue** an incomplete run from the checkpoint. This directly delivers the long-asked "continue where it stopped" (#3) and is exactly what step C will trigger automatically at 70%.
>
> **What this is NOT.** Not a rewrite of auto-dev's phases (they already run as delegated sub-agents — there is nothing to "decompose"). Not a change to BMAD. Not auto-handoff itself (that is step C — this slice builds the resume mechanism C will call). A **fresh run with no checkpoint behaves byte-for-byte as today** (the checkpoint is additive).
>
> **Testability honesty (§VI).** auto-dev's behavior is a *prompt* in the `install-mmd.sh` heredoc — we cannot unit-test that the LLM actually checkpoints. What IS deterministically testable (and required here): the checkpoint read/write primitives (pure), the MMD-CLI resume orchestration (with a fake auto-dev that reads/writes the checkpoint), and that `install-mmd.sh` **materializes** a workflow carrying the checkpoint + resume instructions. The end-to-end "auto-dev really resumes mid-pipeline" is an explicit **operator/live validation** (AC-6), like the greenfield live captures.

---

## 1. Goal of v0.12.a

```
mmdream --here "<dream>"  →  auto-dev (orchestrator) runs:
    Phase 1 done → write handoff/1.md + checkpoint{last_completed_phase:1, spec_frozen:false}
    Phase 2 done → write handoff/2.md + checkpoint{last_completed_phase:2, spec_frozen:true, spec:.mmd/shared/slice.md}
    [process KILLED here — crash / Ctrl-C / (step C) 70% handoff]

mmdream --here --resume   →  MMD reads checkpoint: incomplete (2/4 done) + process not alive
                          →  relaunches a FRESH auto-dev with a resume-aware prompt
    auto-dev init reads checkpoint → "▶ Resuming from Phase 3 (Phases 1-2 already complete; spec frozen at slice.md)"
                                   → SKIPS Phases 1-2, continues Phase 3 → Phase 4 → done

mmdream --here --resume on a COMPLETE run  →  honest "nothing to resume — last run completed" (no relaunch)
mmdream --here --resume with NO checkpoint →  honest "no resumable run found" (no fabricated continuation)
```

Deliverables:
1. **Checkpoint primitives** (`lib/conductor/checkpoint.js`, injected-fs, never throws): `writeCheckpoint(dir, {lastCompletedPhase, specFrozen, specPath})`, `readCheckpoint(dir)` → the object or `null` (missing/malformed → null), `writeHandoffNote(dir, n, text)` → writes `handoff/<n>.md`, `isResumable(checkpoint, {totalPhases})` → boolean (a checkpoint with `lastCompletedPhase` ≥ 1 and < totalPhases). Placed under the existing run-local `.mmd/` layout (gitignored, ephemeral — it is run state, not a deliverable); follows `ensureLayout` conventions. Pure logic + thin fs, deterministic, NEVER throws.
2. **auto-dev checkpoints each phase transition** (`install-mmd.sh` auto-dev heredoc): after each phase completes, the orchestrator writes `handoff/<N>.md` (what the phase produced + what's next + key context for a successor) and updates `checkpoint.json` (`last_completed_phase`, `spec_frozen`, spec path). Additive — a normal run is unaffected beyond writing these files.
3. **auto-dev is resume-aware on init** (`install-mmd.sh` auto-dev heredoc): a new INITIALIZATION step reads the checkpoint; if it shows completed phases, the orchestrator **announces a resume**, reads the `handoff/<N>.md` notes + the slice branch's commits as the recovered state, and **starts at `last_completed_phase + 1`** — it does NOT re-run completed phases (notably it does NOT re-open a frozen spec). No checkpoint → today's fresh-start path, unchanged.
4. **MMD CLI real resume** (`bin/mmd.js`): `mmdream --here --resume` (and the greenfield `--resume`) detects an **incomplete** run — a checkpoint that `isResumable` AND no live auto-dev process (or `status.json.state !== 'done'`) — and **relaunches** a fresh auto-dev (via the existing `invokeAutodev`) on the same slice/demo with a resume-aware prompt, so the orchestrator continues from the checkpoint. A **complete** run or **no checkpoint** → an honest message and NO relaunch (never a fabricated continuation, universal §VI). The stub "print state + exit 3" is replaced by this real behavior; the greenfield session-control semantics (fresh/cancel) are preserved.
5. **Docs + the `/mmdream` resume note + live validation**: ADR-050 (the stateless/resumable orchestrator, the checkpoint/handoff contract, resume-as-foundation-for-C, the testability boundary), the `/mmdream` template documents `--resume` (continue an interrupted run), README + CLAUDE.md, mechanical blocks refreshed, version → 0.12.0. **AC-6 (operator/live):** on MMD itself, a real `--here` run interrupted after a phase and resumed via `mmdream --here --resume` continues without redoing the completed phases — captured honestly in the slice notes.

**Mission validation**: an interrupted `mmdream --here` leaves a checkpoint + `handoff/<N>.md`; `mmdream --here --resume` relaunches auto-dev, which announces the resume and continues from `last_completed_phase + 1` without re-doing the spec; a completed run reports "nothing to resume"; no checkpoint reports "no resumable run"; the checkpoint primitives never throw; a fresh run with no checkpoint is byte-for-byte today's behavior.

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: checkpoint primitives (never throw)
**Given** a `.mmd` run dir with/without a checkpoint (valid, malformed, missing)
**When** `writeCheckpoint` / `readCheckpoint` / `writeHandoffNote` / `isResumable` run
**Then**: a valid checkpoint round-trips; missing/malformed → `readCheckpoint` returns `null` (never throws); `writeHandoffNote(dir, n, text)` writes `handoff/<n>.md`; `isResumable` is true iff `1 ≤ lastCompletedPhase < totalPhases` (a 0/absent → false, a complete `=totalPhases` → false). Pure logic, deterministic, never throws on any input.
Tag: `@unit` (round-trip; malformed→null; isResumable boundaries; handoff note written).

### AC-2: auto-dev workflow checkpoints each phase (materialized)
**Given** `install-mmd.sh` run on a temp target
**When** the auto-dev workflow is materialized (`_bmad/adv/workflows/auto-dev/workflow.md`)
**Then**: the materialized workflow contains explicit instructions to write `handoff/<N>.md` + update the checkpoint after EACH phase transition (Phases 1-4), with the checkpoint path + fields named. (We validate the *instruction is materialized*, not the LLM's runtime behavior — testability boundary, §VI.)
Tag: `@integration` (materialize → grep the checkpoint-write instruction for each phase).

### AC-3: auto-dev workflow is resume-aware on init (materialized)
**Given** the materialized auto-dev workflow
**When** its INITIALIZATION section is read
**Then**: it contains an explicit resume step — read the checkpoint, and if it shows completed phases, announce a resume, recover state from `handoff/<N>.md` + the branch commits, and start at `last_completed_phase + 1` (skipping completed phases, never re-opening a frozen spec); no checkpoint → fresh start (today's path). 
Tag: `@integration` (materialize → grep the resume-aware init instruction).

### AC-4: MMD CLI real resume (continue, not just print) — honest
**Given** an existing run with a resumable checkpoint and no live process (fake auto-dev seam)
**When** `mmdream --here --resume` runs
**Then**: it relaunches auto-dev (the injected seam) on the same slice with a resume-aware prompt and the run continues; **and** on a COMPLETE run → an honest "nothing to resume — last run completed", NO relaunch; on NO checkpoint → an honest "no resumable run found", NO relaunch; never a fabricated continuation. The greenfield `fresh`/`cancel` session actions still behave as before.
Tag: `@unit` (resume-decision logic: resumable+dead→relaunch; complete→no; none→no) + `@integration` (`--here --resume` with a fake auto-dev: incomplete checkpoint → relaunch happens; complete → honest no-op).

### AC-5: docs + `/mmdream` resume note
**Given** the docs and operator playbook
**When** updated
**Then**: ADR-050 lands (stateless/resumable orchestrator, checkpoint+handoff contract, foundation-for-C, the testability boundary); `assets/claude-commands/mmdream.md` documents `mmdream --here --resume` (continue an interrupted run) in the monitoring/failure section; README + CLAUDE.md updated; mechanical blocks refreshed; version → 0.12.0.
Tag: `@unit`/`@integration` (ADR-050 exists; template mentions `--resume` continuation; version bumped).

### AC-6: operator/live resume validation (honest capture)
**Given** MMD itself after this slice
**When** the operator interrupts a real `mmdream --here` run after a completed phase and runs `mmdream --here --resume`
**Then**: auto-dev announces the resume and continues from `last_completed_phase + 1` WITHOUT redoing the completed phase(s); the outcome (resumed-from-phase-N, did-not-redo-spec) is captured honestly in the slice/HANDOVER notes. If live resume does not work as designed, that is reported as a wall (§VI), not papered over.
Tag: operator/live (no automated assertion — explicit live capture, like the greenfield AC-4 captures).

---

## 3. Out of scope (deferred)

- **Step C — auto-handoff@70%**: the v0.5.b monitor already writes `READY_FOR_HANDOFF`; step C makes the Conductor *act* on it by triggering THIS slice's resume against a fresh successor. Not this slice — this slice builds the resume mechanism C will call.
- **Sub-phase / mid-phase checkpointing**: checkpoint granularity is the **phase boundary** (1-4), not steps within a phase. A mid-Phase-3 kill resumes at the start of Phase 3 (the per-AC commits already protect the within-phase work). Finer granularity is a later refinement (KISS).
- **Parallel orchestrators (step D)** and **Bundle C observability (step E)** — later.
- **Cross-machine / cross-repo resume** — the checkpoint is local to the run's `.mmd/`; no remote state.

---

## 4. Operational notes for the implementer

- The checkpoint/handoff files are **run-local, ephemeral state** (gitignored) — place them under the existing gitignored `.mmd/` area per `ensureLayout` (NOT committed deliverables). Do not let auto-dev's per-AC commits sweep them (they are ignored).
- **Additive by construction**: a fresh run with no checkpoint MUST behave exactly as today. Pin the no-checkpoint path. The auto-dev heredoc edit must not change the default (no-resume) phase flow — it only ADDS the checkpoint-write at transitions + the resume-aware init branch.
- The `install-mmd.sh` heredoc is the source of truth for the auto-dev workflow; edit it there (the `.claude/`/`_bmad/` copies are regenerated). Mirror the existing materialization-test pattern (the `/mmdream` install test) for AC-2/AC-3.
- Reuse `invokeAutodev` for the resume relaunch — do NOT write a second spawn path. The resume prompt is a small wrapper: "this is a RESUME — read `.mmd/.../handoff/` + the checkpoint and continue from the last completed phase."
- Replace the `--resume` stub carefully: keep the greenfield `fresh`/`cancel` session-control behavior; only the `resume` action gains the real continuation. `MMD_TIMEOUT_MS=0` still applies to a resumed Standard run (L-016).
- Commit incrementally per AC (L-019). Tests tagged per stratum.
