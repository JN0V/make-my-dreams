# ADR-045: Close the autolearning loop — validated-reuse counter + LLM promotion gate

**Date**: 2026-06-02
**Status**: Accepted
**Authors**: Sébastien (project owner), auto-dev (Standard engine, v0.9.0 slice)

## Context

MMD's differentiator #2 ([MAKE_MY_DREAMS.md §6.5](../../MAKE_MY_DREAMS.md)) is the
**compounding autolearning loop**: every failure during MMD development produces a
deterministic test+fix AND a documented lesson in `docs/lessons-learned.md`; the
composer auto-injects a matched lesson's rule into future prompts (v0.2.e,
[ADR-010](./010-composer-minimal-keyword-overlap.md)); and once a lesson proves
itself through enough **validated re-uses**, it graduates into the constitution
(`mmd document-lessons`, v0.2.i, [ADR-014](./014-documentalist-lite-counter-incrementer.md)).

The loop had a hole at its heart. `mmd document-lessons` incremented each lesson's
`**To promote if**: N (counter: c)` line — and auto-promoted at threshold — **by the
raw injection count** (`mutateCounters: counter + injCount`). But ADR-010 itself
(Q3) had already named this the wrong signal:

> *"The composer matches keywords against a prompt; that's not the same as a
> **validated re-use**. A validated re-use means the rule was actually applied by
> the LLM downstream and the outcome was correct."*

So a lesson that merely **appeared** in prompts climbed toward promotion with no
evidence it ever helped — and promotion is heavy: it folds the rule into MMD's own
constitution and deletes the lesson from `lessons-learned.md` (hard to reverse).
ADR-010 deferred the fix to "the Documentalist Worker" — now built (v0.7.a–e). This
ADR closes the loop.

## Decision

Two changes, deterministic-where-cheap and LLM-where-it-matters.

### 1. The counter rises on a deterministic **validated-reuse** signal, not raw injections

A **validated reuse** of a lesson = it was **injected into a run that completed
successfully** (`status.json.state === 'done'`), counted **once per distinct run**.
This is a weak-but-honest proxy: a `done` run does not *prove* the lesson's rule was
the reason it succeeded, but it is cheap, always-on, reproducible, and strictly
better than "the keywords matched". A lesson injected only into **failed** runs gets
**no** increment.

- `lib/autolearn/validated-reuse.js` — pure `validatedReuses(records)` over per-run
  records `{ runId, injectedLessonIds, state }`: returns, per lesson, the count of
  distinct `done` runs that injected it (per-run deduped). Pure, never throws,
  empty→empty. A run with no usable `runId` is skipped (no reproducible key → no
  honest, idempotent credit).
- **The correlation crux** (the injection↔outcome join): the composer.json sidecar
  records *which* lessons were injected but not the run's final state, and
  `status.json` is overwritten every run. So every run now also writes a durable
  sibling `<runId>.outcome.json = { run_id, state, ts }` under `.mmd/local/runs/`
  (`lib/autolearn/run-outcome.js`, written at every completion path in `bin/mmd.js`
  — `--here`, sealed, greenfield, done and failed). The run log, composer.json, and
  outcome.json share one basename = the `runId` (also stamped into composer.json).
  `lib/composer/usage-stats.js#buildRunRecords` reads the audits and joins each to
  its outcome.
- **Idempotent crediting**: `lib/documentalist/mutate-counters.js` now increments each
  active lesson's counter by its validated reuses **not yet credited** — a run already
  counted in a prior `document-lessons` run is recorded in a durable
  `.mmd/local/credited-runs.json` and excluded, so re-running never double-counts a
  run. `--dry-run` prints the per-lesson deltas and writes nothing.

### 2. Promotion into the constitution is gated by an injected LLM validation (sacred fallback)

Because promotion changes MMD's own constitution, the deterministic counter only
decides *when to consider* a lesson; an **LLM gate** decides whether it actually
promotes.

- `lib/autolearn/promote-gate.js` — pure `parsePromoteGateVerdict(text)` →
  `validated | not-validated | uncertain` (+ the prompt builder). Mirrors the v0.4.d
  judge ([ADR-028](./028-llm-judge-behavioral-oracle.md)): MMD dictates the output
  format (`VERDICT: …`), the parser is pure and never throws, and an unparseable /
  empty / odd reply falls back to **`uncertain`** — NEVER a fabricated `validated`.
- `bin/documentalist/document-lessons.js` runs the gate (the `MMD_PROMOTE_GATE_CMD`
  `claude -p` seam) for each lesson that reached threshold, reviewing the rule + its
  reusing runs. **Only an explicit `validated` promotes** (append to the constitution
  module + remove from `lessons-learned.md` — the existing flow). `not-validated`,
  `uncertain`, an unparseable verdict, a spawn error/timeout, **or the gate being
  absent** all → **HOLD**: the lesson stays active, its counter is preserved, and an
  honest `held: gate <verdict>` note is logged. The gate runs strictly *behind* the
  deterministic counter, never instead of it.

### 3. Raw injections vs validated reuses are surfaced as distinct values (never conflated again)

`mmd lessons` gains a **VR** column next to **INJ** (`bin/lessons.js`), and
`mmd document-lessons` prints both totals on separate, labelled lines. INJ = raw
keyword-match injections (ADR-010's old signal); VR = validated reuses (the promotion
signal). The confusion that let the wrong signal drive promotion is now visible in the UI.

## Consequences

**Positive**

- A lesson climbs toward the constitution on **evidence it was used in successful
  work**, not mere mention. The irreversible-ish promotion is LLM-gated and
  conservative; an unproven or uncertain lesson is held, never promoted on a
  fabricated verdict (universal §VI, the sacred fallback).
- Reproducible + idempotent: the count is a pure function of durable on-disk records;
  re-running `document-lessons` never double-counts a run.
- The two signals can never be silently conflated again — they are distinct columns.

**Negative / honest limits**

- A `done`-run is a **weak** proxy (it does not prove causation). The LLM gate covers
  the rigor at the moment that matters (promotion); a richer per-run signal (e.g. "a
  Phase-4 finding in the lesson's category that the rule would have prevented") is a
  deferred refinement.
- The gate is a **single** non-deterministic LLM judge. As with the v0.4.d judge, the
  obvious softeners — a `--gate-advisory` warn-only mode, a multi-judge majority vote —
  are noted as deferred, not re-discovered.
- Validated reuse requires the run-outcome record; runs from before v0.9.0 (no
  outcome.json) read as missing-state and contribute 0 — honest, not retroactive.

## Out of scope (deferred)

- **Archival** — a lesson unused for M months → archived, no longer injected (the
  §6.5 tail). A focused follow-up.
- **Event-driven `document-lessons`** on every slice — stays a manual/operator step.

## References

- SPEC: [SPEC_V090.md](../../SPEC_V090.md)
- The wrong signal it corrects: [ADR-010 §Q3](./010-composer-minimal-keyword-overlap.md)
- The counter mechanism it rewires: [ADR-014](./014-documentalist-lite-counter-incrementer.md)
- The judge pattern it mirrors: [ADR-028](./028-llm-judge-behavioral-oracle.md)
- Scoping: [MAKE_MY_DREAMS.md §6.5](../../MAKE_MY_DREAMS.md)
