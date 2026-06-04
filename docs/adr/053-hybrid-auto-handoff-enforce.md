# ADR-053 — Hybrid auto-handoff: incite, then enforce at a checkpoint

**Status**: accepted
**Date**: 2026-06-04
**Slice**: v0.14.b (the live-finding fix for Conductor step C — the cooperative-only stop of v0.13.0/ADR-051 does not work in practice)

## Context — the live finding

v0.13.0 (ADR-051) made auto-handoff **cooperative-only**: at the threshold MMD's
monitor writes the `.mmd/local/handoff-request` marker, and the auto-dev
orchestrator is asked, at each phase boundary, to read the marker and **exit
cleanly** so MMD can relaunch a fresh successor in resume mode.

The instruction is correct. **The LLM does not obey it.** A real Sonnet
`--auto-handoff` run (2026-06-04) wrote checkpoints per phase yet ran past **≥2
boundaries to ~120% context with 0 handoffs**. The structural root cause: a
`claude -p` agent has **no reliable self-terminate primitive** and, under "finish
the task" pressure, keeps going. The test suite was green because the fakes
*simulated* the cooperative exit — **green tests, broken reality**; only the live
run caught it (the trap L-004/§VI warns about).

So a gentle ask is necessary (it is the cleanest outcome when obeyed) but **not
sufficient** — MMD cannot *depend* on it.

## Decision — HYBRID (incite, then enforce)

Keep the cooperative incitation **and** add an MMD-side enforce backstop. Two
paths, both ending in a resuming successor:

1. **Incite (unchanged, Path A).** The monitor still writes the marker at the
   threshold; the heredoc still asks the orchestrator to stop cleanly at the next
   boundary. If the agent OBEYS → it exits cleanly (incomplete checkpoint +
   marker) → MMD relaunches resume (the v0.13.0 cooperative path). No force.
2. **Enforce (new, Path B).** If the agent IGNORES the incitation — it completes
   **another** phase (the checkpoint advances) while **over** the threshold and is
   **still alive** — MMD waits a short **grace** (`MMD_HANDOFF_GRACE_MS`, a last
   chance to exit on its own), then **terminates the orchestrator process group
   (SIGTERM → SIGKILL) AT that checkpoint** and relaunches resume.

### Why the enforce is safe (the "killing worries me" concern)

Termination happens **only at a phase checkpoint** — a phase just COMPLETED and
its per-AC commits (L-019) are already in git. So **no committed work is lost**;
only the un-checkpointed reasoning since the last boundary, which the fresh
successor re-derives. MMD terminates only the auto-dev orchestrator's process
group (auto-dev's `claude -p` spawns children — a bare-leader SIGTERM would orphan
them, so we kill the **group** via a detached spawn + `process.kill(-pid, …)`).
This is exactly the §4.2 design — *"any level can be killed and recreated from the
files"* — done at a safe point, as a backstop, **after asking nicely first**.

### The remaining LLM-dependent risk, named honestly (§VI)

The enforce (SIGTERM at a checkpoint) is deterministic + reliable. The **RESUME**
(a fresh agent reads the checkpoint + handoff notes and continues from the next
phase) is still LLM-dependent and **not yet proven live**. So **AC-5 (a live
forced-then-resumed run) is REQUIRED** — no green-by-fakes pass. A resume failure
is a reported wall and the slice is NOT done.

## Components (all ADDITIVE; a no-checkpoint / no-flag run is byte-for-byte today's)

- **`lib/conductor/handoff.js`** (pure, never throws) — `shouldForceHandoff({pct,
  threshold, lastCompletedPhase, phaseAtSpawn, handoffsSoFar, maxHandoffs})` →
  boolean, true iff `pct ≥ threshold` AND `lastCompletedPhase > phaseAtSpawn` (a
  NEW boundary since THIS successor launched — proof the agent reached a boundary
  and kept going, not the inherited checkpoint) AND `handoffsSoFar < maxHandoffs`.
  Any non-finite/garbage field → a safe `false` (never an enforced kill on junk).
  `parseHandoffGraceMs(raw, fallback=15000)` → a non-negative integer ms (0
  honored). `decideHandoff` (v0.13.a) still classifies the cooperative-exit case
  post-exit; `shouldForceHandoff` drives the enforce-while-alive case.
- **`lib/invoke-autodev.js`** — an opt-in **abort seam** on `invokeAutodev`: a
  caller `abortPredicate(ctx)` checked on each monitor tick. On the first fire it
  arms a `graceMs` window; if the child is still alive after the grace it
  terminates the **process group** (SIGTERM, escalating to SIGKILL) and resolves a
  distinct `{ aborted: 'handoff', code: null }`. A cooperative exit DURING the
  grace resolves normally (Path A, the caller's post-exit `decideHandoff` owns the
  marker). The seam is inert without a predicate — the spawn is **detached only
  when a predicate is supplied**, so the default build-MMD path is unchanged.
- **`bin/mmd.js`** — `makeForceHandoffPredicate` builds the per-spawn predicate
  (capturing `phaseAtSpawn = readCheckpoint().lastCompletedPhase` at launch, the
  live `pct` from the tick, a fresh-read checkpoint each call); `runHereMode` +
  the greenfield path wire it onto the first spawn and each successor.
  `runHandoffLoop` now treats an `{ aborted: 'handoff' }` result as a handoff
  trigger (NOT a failure) and routes it through the **same** `decideHandoff` path
  (the marker is present — the monitor wrote it; the checkpoint advanced — so the
  v0.13.1 gate passes), threading `handoffsSoFar` + `phaseAtSpawn` so the
  cap-final successor (handoffsSoFar == maxHandoffs) is **un-enforced for free**.
  Honest log wording distinguishes a clean stop (Path A) from an ENFORCED
  terminate (Path B).
- **`install-mmd.sh`** auto-dev heredoc — **UNCHANGED**: the per-phase checkpoint,
  the marker-check cooperative "exit cleanly" instruction, and the resume-aware
  init all STAY (the incitation is Path A; harmless when obeyed). The enforce is
  purely MMD-side — the heredoc never asks the orchestrator to self-terminate
  (contrast the earlier forced-only draft, which wrongly proposed deleting the
  incitation).

### Bounded + honest, v0.13.1 preserved

Enforced and cooperative handoffs share the one bounded loop: capped by
`MMD_MAX_HANDOFFS` (default 3), then **one final un-enforced successor** (runs to
done or fails naturally). The grace gives the agent the gentlest path first. A run
that crosses the threshold but reaches **no new boundary** is **never terminated**
(v0.13.1's no-false-kill gate, now also enforced on the abort side: `shouldForce-
Handoff` requires `lastCompletedPhase > phaseAtSpawn`).

## Testability honesty (§VI)

The enforce (SIGTERM at a checkpoint) is deterministic — fully tested. Deterministic
coverage: the pure `shouldForceHandoff` / `parseHandoffGraceMs` (every gate +
boundary + null-safety); the abort seam via a stay-alive stream-json fake
(fires→killed+aborted, never-fires→normal, child-exits-first→normal,
no-predicate→unchanged); the hybrid loop via an enforce fake that ignores the
incitation (Path B enforce-after-grace → resume → completion; enforce → cap →
final un-enforced run; cross-threshold-no-new-boundary → no kill; default
unchanged); and the heredoc materialization (incitation retained, no self-kill
instruction). The RESUME after a forced kill is LLM-dependent → **AC-5 is the
required operator/live proof** (a resume failure is a reported wall, never a
green-by-fakes done — the exact trap that hid the cooperative bug).

## Consequences

- **Positive**: auto-handoff now actually fires — a real orchestrator that ignores
  the gentle ask is reliably handed off at a safe checkpoint with no committed
  work lost. The gentlest path (cooperative) is still tried first. Zero new
  dependencies; the default (no-flag) path is provably untouched; everything
  reuses the v0.5.b monitor, v0.12.a resume, v0.13.a `decideHandoff`/gate + notify.
- **Negative / limits**: the RESUME remains LLM-dependent (AC-5 live proof
  required). We only terminate **at a checkpoint** — a run that fills before its
  first checkpoint is a context-limited failure, not force-handed-off (enforce
  mid-phase is deferred). Whether the orchestrator (which delegates phases to
  fresh sub-agents) genuinely saturates on a real slice is a separate measurement;
  if real runs never approach the threshold unforced, a later slice may downscope C
  (SPEC §3). The transparent flip (SPEC_V014A) stays deferred until this lands AND
  is proven live.

## Alternatives considered

- **Forced-only (delete the incitation)** — rejected: the cooperative stop is the
  gentlest outcome when obeyed and costs nothing to keep; deleting it throws away a
  free safe path. HYBRID keeps both.
- **Resolve the abort immediately after SIGTERM** (before the child is dead) —
  rejected: it risks orphaning the group or overlapping a relaunched successor with
  a dying one. We wait for the actual exit (with a SIGKILL escalation) so "no
  orphan" is real.
- **Enforce on a fixed timer instead of at a checkpoint** — rejected: terminating
  mid-phase loses in-phase reasoning AND may kill before any commit. The checkpoint
  is the safe boundary (§4.2).
- **Default-on** — rejected (L-027): the abort seam needs the `stream-json`
  monitor, which changes the spawn; the default text spawn is the reflexive
  bootstrap that builds MMD itself. Opt-in (`--auto-handoff` implies `--monitor`)
  is the safety contract.

See SPEC_V014B.md, ADR-051 (the cooperative path this hardens), ADR-050 (the
resume foundation), ADR-030 (the monitor), L-027 (opt-in spawn-changing
observability), L-004/L-019 (the green-by-fakes + lost-WIP traps this guards).
