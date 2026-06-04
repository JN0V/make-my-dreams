# ADR-051 — Cooperative auto-handoff at 70% (Conductor step C)

**Status**: accepted
**Date**: 2026-06-04
**Slice**: v0.13.a (§9.0 forward-plan **step C** — the Conductor finally ACTS on the 70% signal it has been able to SEE since v0.5.b)

## Context

Two pieces existed but were never connected:

1. **The v0.5.b live context monitor** (`makeContextMonitor`, behind `--monitor`,
   ADR-030) spawns auto-dev as `stream-json`, tracks the orchestrator's context %,
   and at `MMD_HANDOFF_THRESHOLD` (default 0.70) writes a `ready_for_handoff`
   status field + fires a `context_70` notification — **but it does nothing**. It
   SEES the orchestrator filling up and only logs "Run continues (no auto-handoff
   yet)."
2. **The v0.12.a stateless, resumable orchestrator** (ADR-050) made auto-dev
   **checkpoint each phase** (`.mmd/local/checkpoint.json` + `handoff/<N>.md`) and
   gave MMD a **real `--resume`** that relaunches a fresh auto-dev continuing from
   the checkpoint. ADR-050 was explicitly built as "the foundation for step C".

The gap step C closes: when a long run's orchestrator context fills, nothing
acts — the run either limps on with a degraded macro-context or risks a hard
context wall. The `--resume` machinery to hand off to a fresh successor existed;
the 70% signal to trigger it existed; **nothing wired them together.**

## Decision

Wire the 70% signal to the resume mechanism as a **cooperative** handoff —
**`mmdream --here --auto-handoff "<dream>"`** (and the greenfield path):

- At 70%, MMD's monitor writes a small **handoff-request marker**
  (`.mmd/local/handoff-request`, gitignored run state) in addition to the existing
  `ready_for_handoff` field + `context_70` notify.
- The auto-dev orchestrator, at each phase boundary **right after** writing its
  B.1 checkpoint, **checks the marker**. If present, it **announces the handoff
  and exits cleanly without starting the next phase**, leaving an INCOMPLETE
  checkpoint. No marker → it continues as today.
- MMD's CLI sees the clean exit + incomplete checkpoint + the request marker and
  **relaunches a fresh successor in resume mode** (reusing v0.12.a's
  `invokeAutodev` + resume-aware prompt), which continues from `phase N + 1` with
  fresh low context. Repeat, bounded.

### Cooperative (C-graceful), not a forced kill

MMD does **not** kill auto-dev mid-phase — that would lose the in-phase reasoning.
The orchestrator stops only at a phase boundary it has already reached and
checkpointed, so the stop loses no work. The 0.70 threshold is conservative
precisely to leave headroom to finish the current phase before exiting. This is
the §4.2 "killed → recreated from files" property, but as a *clean cooperative
stop* rather than a kill.

### Opt-in by construction (the bootstrap contract)

Auto-handoff REQUIRES the monitor (only `stream-json` exposes the context usage),
so **`--auto-handoff` implies `--monitor`**. Without the flag, the default text
spawn — the path MMD uses to build **itself** — stays **byte-for-byte unchanged**
(pinned by a test). The handoff-request marker is written ONLY when
`--auto-handoff` provides the monitor's `requestHandoff` callback, so a
non-auto-handoff run (plain `--monitor` included) **never sees a marker** and the
orchestrator's phase flow is unchanged. C can never be default-on.

### Bounded + honest

Handoffs are capped by `MMD_MAX_HANDOFFS` (default 3) to prevent an infinite
handoff chain. At the cap, MMD launches **one final successor with handoff
DISABLED** (its monitor writes no marker → it runs to done or fails naturally) and
logs the cap honestly — progress is never infinitely deferred, nothing is silently
dropped (universal §VI). A `handoff` notification fires per handoff (reusing the
v0.5.a fan-out — a new signal, not a new transport).

### Reuse, don't reinvent

The slice writes **no second resume or spawn path**: it reuses v0.12.a's
`invokeAutodev` + `buildResumeFeedback` + `readCheckpoint`, and v0.5.a's notify
fan-out. The only new code is (1) a pure decision module and (2) the
marker/loop wiring.

## Components

- **`lib/conductor/handoff.js`** (pure, never throws): `decideHandoff({checkpoint,
  handoffRequested, handoffsSoFar, maxHandoffs, totalPhases})` → `{action, reason}`
  where `action ∈ {finish, handoff, cap-final}` — `finish` when the checkpoint is
  complete OR no handoff was requested (the safe default that prevents loops);
  `handoff` when incomplete + requested + under cap; `cap-final` when incomplete +
  requested + cap reached. `parseMaxHandoffs(raw, fallback=3)` → integer ≥ 1
  (junk/zero/negative/float → fallback). The loop that spawns lives in `bin/mmd.js`;
  this module only DECIDES.
- **`lib/conductor/checkpoint.js`** (additive): the handoff-request marker
  primitives — `writeHandoffRequest` / `readHandoffRequest` / `handoffRequested` /
  `clearHandoffRequest` / `handoffRequestPath` (injected-fs, never throw,
  idempotent), beside the existing checkpoint primitives.
- **`bin/mmd.js`**: `makeContextMonitor` gains an optional `requestHandoff`
  callback (writes the marker at the threshold crossing under `--auto-handoff`);
  `runHandoffLoop` drives the bounded loop; `runHereMode` + the greenfield path
  call it after the first spawn; `--auto-handoff` resolves to `--monitor` and
  `MMD_MAX_HANDOFFS` resolves the cap.
- **`install-mmd.sh`** auto-dev heredoc: the **HANDOFF CHECK** instruction — at
  each phase boundary, after the checkpoint, check the marker and stop cleanly if
  present (additive; materialized-instruction tested, §VI testability boundary).
- **`lib/conductor/notify.js`**: a new `handoff` lifecycle event.
- **`lib/argv-parser.js`**: `HANDOFF_FLAGS = ['auto-handoff']`.

## Testability honesty (§VI)

auto-dev's boundary-stop behavior is a *prompt* in the heredoc — we test that the
INSTRUCTION is **materialized**, not the LLM's runtime obedience. Deterministically
tested: the pure handoff-decision logic (every branch + the cap boundary +
null-safety), the marker primitives, the MMD handoff loop (a deterministic fake
auto-dev simulating a cooperative stop → relaunch resume; the cap → final
un-handoffed run; completion → finish), the monitor writing the marker at 70%
end-to-end (the stream-json fake), and the default-spawn-unchanged pin. The true
"a real run crosses 70% and hands off mid-pipeline" is the explicit **operator/live
validation (AC-6)** — captured honestly in HANDOVER, reported as a wall if it does
not behave as designed (never papered over).

## Consequences

- **Positive**: a long MMD run no longer degrades or risks a context wall when the
  orchestrator fills — it hands off to a fresh successor and continues, bounded.
  The Conductor's "see → act" loop is closed. The 70% signal that has been visible
  since v0.5.b is finally actionable. Zero new dependencies; the default
  (no-flag) path is provably untouched.
- **Negative / limits**: the handoff is cooperative, so a phase that overruns the
  window **before** reaching a boundary is not handed off (a forced-kill fallback
  is deferred). Granularity is the phase boundary (1-4), inheriting B.1's
  granularity (sub-phase handoff deferred). Cross-machine handoff, adaptive
  thresholds, and parallel handoff (step D) are out of scope.

## Alternatives considered

- **Forced-kill handoff** (terminate auto-dev mid-phase at 70%) — rejected: loses
  the in-phase reasoning. A forced kill as a *fallback* when the orchestrator
  overruns the window before a boundary is a later refinement.
- **Make auto-handoff default-on** — rejected: it changes the spawn (stream-json),
  and the default text spawn is the reflexive-bootstrap path that builds MMD
  itself. Opt-in is the safety contract (L-027).
- **A second resume/spawn path tailored to handoff** — rejected (DRY, universal
  §III): the v0.12.a resume already does exactly "relaunch a fresh auto-dev
  continuing from the checkpoint." Handoff is just resume triggered by the marker.

See SPEC_V013A.md, ADR-030 (the monitor), ADR-050 (the resume foundation),
ADR-029 (the notify fan-out), L-027 (opt-in spawn-changing observability).
