# ADR-050 — The stateless, resumable auto-dev orchestrator (Conductor step B.1)

**Status**: accepted
**Date**: 2026-06-04
**Slice**: v0.12.a (§9.0 forward-plan **step B** — the pivot: make the orchestrator survivable; foundation for step C, auto-handoff@70%)

## Context

`/bmad-adv-auto-dev` is **MMD's own orchestrator skill** (materialized by the
`install-mmd.sh` heredoc into `_bmad/adv/workflows/auto-dev/workflow.md`), built
on top of BMAD. Its own text declares: *"YOUR ROLE: ORCHESTRATOR — you do NOT
execute the workflows yourself; you launch sub-agents via the Agent tool (fresh
context) for each phase."* So the §4.2 recursion is already realized — each of
the 4 phases runs in a fresh delegated sub-agent.

**The gap.** The orchestrator itself runs inside **one `claude -p` process with
no externalized phase checkpoint**. If that process dies — a crash, a Ctrl-C, a
reboot, or (the coming step C) a 70%-context handoff — the whole orchestration is
lost and **cannot be resumed**: a rerun restarts from Phase 1, re-doing the spec.
`slice.md` + the per-AC git commits are externalized, but auto-dev neither
**writes** "which phase is done" nor **reads** it to continue, and MMD's
`--resume` was a **stub** (it printed state and exited 3 — it continued no work).

This violates the §4.2 **stateless property** the architecture is supposed to
have: *"any level can be killed and recreated from the files."* It is also the
prerequisite for step C: auto-handoff at 70% context needs a resume mechanism to
hand the run to a fresh successor.

## Decision

Give the orchestrator the stateless property in three additive pieces. **A fresh
run with no checkpoint behaves byte-for-byte as before** — the checkpoint is
purely additive.

1. **Checkpoint primitives** (`lib/conductor/checkpoint.js`, injected-fs, never
   throws): `writeCheckpoint(dir, {lastCompletedPhase, specFrozen, specPath})`,
   `readCheckpoint(dir)` → the object or `null` (missing/malformed → null),
   `writeHandoffNote(dir, n, text)` → `handoff/<n>.md`, `isResumable(checkpoint,
   {totalPhases})` → `1 ≤ lastCompletedPhase < totalPhases`, and the pure
   `decideResume({checkpoint, totalPhases, processAlive, statusState})` →
   `relaunch | complete | none`. The files live under the existing gitignored,
   run-local `.mmd/local/` area (run **state**, not a committed deliverable). The
   **on-disk format is snake_case** (`last_completed_phase` …) — exactly what the
   auto-dev heredoc, an LLM, writes by hand — and `readCheckpoint` normalizes it
   to the camelCase JS API, so both producers round-trip identically.

2. **auto-dev checkpoints each phase transition** (the `install-mmd.sh` heredoc):
   after each of Phases 1-4 completes and before the next launches, the
   orchestrator writes a numbered `handoff/<N>.md` note (what the phase produced
   + what is next + key context) and overwrites `checkpoint.json`
   (`last_completed_phase`, `spec_frozen`, `spec_path`). The spec is marked
   frozen at/after Phase 2.

3. **auto-dev is resume-aware on init** (the heredoc): a new INITIALIZATION
   "Resume Check" reads the checkpoint; if it shows completed phases it
   **announces the resume**, recovers state from the `handoff/<N>.md` notes + the
   slice branch commits, and **starts at `last_completed_phase + 1`** — skipping
   completed phases and **never re-opening a frozen spec**. No checkpoint → the
   fresh-start path, unchanged.

4. **MMD CLI real resume** (`bin/mmd.js`): `mmdream --here --resume` (recovering
   the run from cwd's `status.json`, no dream arg needed) and the greenfield
   `<dream> --resume` detect an incomplete run (a resumable checkpoint AND the
   run is not done) and **relaunch a fresh auto-dev via the existing
   `invokeAutodev`** on the same slice/demo with a resume-aware prompt, so the
   orchestrator continues from the checkpoint. A complete run or no checkpoint →
   an honest message and **NO relaunch** (exit 0) — never a fabricated
   continuation. `MMD_TIMEOUT_MS=0` still applies to a resumed Standard run.

## The testability boundary (§VI)

auto-dev's behavior is a **prompt** in the heredoc — we cannot unit-test that the
LLM actually checkpoints at runtime. So the deterministic tests cover what *is*
testable: the checkpoint read/write/decide primitives (pure, never-throw,
boundary-checked), the CLI resume orchestration (with a fake auto-dev that the
relaunch invokes), and that `install-mmd.sh` **materializes** a workflow carrying
the per-phase checkpoint-write + the resume-aware init instructions (grep the
generated `workflow.md`). The end-to-end "auto-dev really resumes mid-pipeline"
is an explicit **operator/live validation** (AC-6), like the greenfield captures
— reported as a wall if it does not work, never papered over.

## Consequences

- **Survivability.** A killed run is now recoverable: `--resume` continues from
  the last completed phase instead of restarting and re-doing the spec. This is
  the long-asked "continue where it stopped".
- **Foundation for step C.** Auto-handoff@70% (the v0.5.b monitor already writes
  `READY_FOR_HANDOFF`) will *act* on the threshold by triggering exactly this
  resume against a fresh successor. This slice builds the mechanism C calls.
- **Honest no-fabrication.** `decideResume` has three closed outcomes; a complete
  run or a missing checkpoint is reported plainly, never relaunched into a
  pretend continuation (§VI).
- **Best-effort live-process detection.** There is no portable pid record of the
  detached `claude -p`, so the CLI does not claim to detect a live orchestrator;
  it relies on `status.json.state` (a manual `--resume` implies the prior process
  ended). `decideResume` keeps a `processAlive` branch for a future pid-file.
- **Run state, not deliverable.** The checkpoint + handoff notes are gitignored
  (`.mmd/local/`); auto-dev's per-AC commits never sweep them.

## Out of scope (deferred)

- **Step C — auto-handoff@70%** (this slice builds the resume it will call).
- **Sub-phase / mid-phase checkpointing** — granularity is the phase boundary
  (1-4); a mid-Phase-3 kill resumes at the start of Phase 3 (the per-AC commits
  already protect within-phase work). KISS.
- **Cross-machine / cross-repo resume** — the checkpoint is local to the run's
  `.mmd/`.
- **Parallel orchestrators (step D)** and **Bundle C observability (step E)**.

See docs/specs/SPEC_V012A.md for the full acceptance criteria.
