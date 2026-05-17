# ADR-006: Dream-bench v0 — 5 dreams, sequential, deterministic report

**Date**: 2026-05-17
**Status**: Accepted
**Authors**: Sébastien (project owner), auto-dev (Standard engine, v0.2b slice)

## Context

[SPEC_V02B](../../SPEC_V02B.md) introduces `mmd bench`: the regression harness without which the reflexive bootstrap ([MAKE_MY_DREAMS.md §7](../../MAKE_MY_DREAMS.md)) is unsafe to enable in earnest. Per scoping [§8.3](../../MAKE_MY_DREAMS.md) — "Blocking for bootstrap §7: without dream-bench, no safe self-improvement." Until v0.2b, every `mmd <dream>` and `mmd --here <change>` run was judged by feel; with v0.2b, regressions become measurable.

The harness has many possible shapes. This ADR records the five design decisions that bound v0.2b.

## Decisions

### D-1: Five canonical dreams, not ten or twenty

v0 ships **exactly 5 dreams**: 3 kid (camera-overlay drawing app, drum-pads, story-dice) + 2 pro (CSV viewer, markdown live-preview). The corpus is tracked at [`bench/dreams/`](../../bench/dreams/).

Five is the minimum that surfaces meaningful regression diversity:
- Audience mix — kid-tier vs pro-tier dreams exercise different complexity ceilings.
- Capability mix — camera, audio, plain DOM, File API, side-by-side rendering.
- Failure-mode mix — each dream tests a different class of regression (gesture-gated permissions, Web Audio fallback, file picker, markdown rendering, Canvas).

Why not 10 or 20? **Runtime budget**. A real `mmd bench` runs each dream through the full auto-dev pipeline (Phase 1 → 4 + Reality Check). The current production engine takes roughly 20–60 minutes per dream depending on complexity. Five dreams × 40 minutes (mean) = ~3.5 hours per real bench — a defensible "weekly nightly" load. Doubling to 10 dreams pushes the harness into >7-hour territory, which empirically (cf [L-006](../lessons-learned.md)) is the boundary where `claude -p` zombie / orphan failure modes start dominating signal noise. v0.3+ may grow the corpus once the v0.9 worktree parallelism lands and shortens the wall clock.

The 5-dream set is also the size [MAKE_MY_DREAMS.md §9 v0.3](../../MAKE_MY_DREAMS.md) names verbatim: "5 reproducible dreams". v0.2b is the first delivery of that promise.

### D-2: Sequential, not parallel

v0.2b runs dreams **one at a time**. Parallelism is deferred to [v0.9 (git worktrees)](../../MAKE_MY_DREAMS.md).

Three reasons:
1. **Isolation guarantee** ([AC-3](../../SPEC_V02B.md)): the harness asserts each dream writes only inside its `bench/runs/<run-id>/<dream-id>/demo/<slug>/` tree. Sequential execution from the same cwd makes this trivially true; parallel execution requires per-dream worktrees, which is the whole v0.9 slice.
2. **Resource contention**: a Phase 3 implementation can saturate a single machine's CPU + RAM + (probably) network bandwidth to Anthropic. Running five in parallel is not faster, it is throttled — and noisy on the timing metric we care about.
3. **Failure attribution**: when a parallel run fails, attributing the failure to a specific dream vs a cross-dream interaction requires correlation logic the v0 harness doesn't need to invent. Sequential gives clean per-dream logs.

### D-3: No cost-in-dollars metric

The metric schema ([AC-4](../../SPEC_V02B.md)) records `duration_seconds`, `exit_code`, `commits_count`, `phase4_findings_count`, and `reality_check.{ran,passed,...}`. It does **NOT** record a token count or a dollar estimate.

Rationale:
- **Token count is the right proxy, but its source is the Anthropic billing API**, which is per-account and rate-limited. v0.2b would couple every bench run to a credentialed API call, which the harness explicitly cannot afford to depend on (`mmd bench --dry-run` MUST work without any Anthropic credentials per AC-1).
- **Duration is a defensible interim proxy**. Both kid-01 and pro-02 cost roughly $duration × $cost-per-second$. For regression detection ("v0.2c is 30% slower than v0.2a"), duration alone is sufficient.
- **Adding a `$cost` field that we can only fill in some of the time is worse than not having it**: consumers learn to ignore the field when it's `null`, then keep ignoring it when it's populated. Better to defer the column entirely until we can fill it always.

v0.2b+ will revisit when the Anthropic Files / Billing API is stable enough to call from a bench run.

### D-4: `--dry-run` mode exists and is the default in CI

`mmd bench --dry-run` substitutes the fake-autodev fixture from `test/fixtures/fake-autodev.sh` for the real auto-dev pipeline. It exits 0 in under 30 seconds with a fully-populated `summary.json` + `report.md` + 5 `metrics.json` files.

This is the **harness-validates-itself** mode:
- **CI safety**: a real bench takes hours and burns credentials. CI runs the dry-run to assert the harness mechanics (loader, isolation, aggregator, exit codes) didn't break, without ever calling Anthropic.
- **Faster iteration**: a developer modifying `lib/bench/aggregate.js` re-runs the dry-run in 0.2 seconds and gets immediate feedback.
- **Mission validation** ([§1](../../SPEC_V02B.md)): "v0.2b is done when `mmd bench --dry-run` exits 0 in under 30 s with a generated report." This decision turns that goal into a hard, automatable invariant.

The fake-autodev fixture pre-dates this ADR ([v0.1 invoke-autodev integration tests](../../test/fixtures/fake-autodev.sh)). v0.2b reuses it rather than introducing a parallel "bench fake" — DRY ([universal.md §III](../../.specify/memory/constitution/universal.md)).

### D-5: Deterministic report (no LLM in the aggregator)

[`lib/bench/aggregate.js`](../../lib/bench/aggregate.js) builds `report.md` by string concatenation. Given the same `summary.json`, it emits byte-identical output ([@unit test](../../test/unit/bench-aggregate.test.js) asserts this).

Three reasons:
- **Reproducibility**: bench reports are diff-able. A v0.3 vs v0.2b comparison is a clean text diff, not an "LLM summarized this run differently today".
- **Cost**: a deterministic concat costs 0 tokens. An LLM-narrated report costs ~2k tokens per bench × 5 dreams × every run. For 0 added signal.
- **Trust**: [ai-coding.md §I](../../.specify/memory/constitution/ai-coding.md) forbids fabricated success reports. A deterministic aggregator literally cannot lie — it cannot omit a failure or soften a regression's phrasing.

If a future iteration wants a "narrate the report" feature, it MUST be a SEPARATE step that consumes `summary.json` — never substituted for the deterministic aggregator.

## Consequences

### Trade-offs accepted

- **Coverage gap**: 5 dreams is enough to surface gross regressions (engine doesn't start, reality-check broken, slugifier corrupted) but probably not subtle ones (a specific dream tier degraded by 10%). v0.3+ will add dreams as the autolearning loop §6.5 surfaces failure classes that the v0 corpus missed.
- **No real-bench in CI**: GitHub Actions cannot run a 3+ hour bench on every PR. The opt-in `MMD_BENCH_REAL=1` gate is what unblocks "ship MMD vN+1" — a manual or weekly cron triggers it.
- **Engine is global per run**: v0.2b's `--engine` flag applies to ALL 5 dreams. v0.3+ may let each dream declare its native engine in the front-matter, but for v0 we want comparability across engines, not per-dream tuning.

### Future revisitation

- When v0.9 worktree parallelism lands, expand the corpus to 10 dreams (the design size per [§8.3](../../MAKE_MY_DREAMS.md)).
- When the Anthropic Billing API is reachable from a non-interactive subprocess, add `cost_tokens` + `cost_usd` fields to the AC-4 schema.
- When the autolearning loop ([v0.5b](../../MAKE_MY_DREAMS.md)) consumes bench output, formalize the "what counts as a regression" thresholds in a follow-on ADR.

## References

- [SPEC_V02B.md](../../SPEC_V02B.md) — full v0.2b spec (7 ACs + 10 DoD items)
- [MAKE_MY_DREAMS.md §8.3](../../MAKE_MY_DREAMS.md) — dream-bench scoping
- [MAKE_MY_DREAMS.md §9 v0.3](../../MAKE_MY_DREAMS.md) — "5 reproducible dreams" roadmap entry
- [`bench/dreams/SCHEMA.md`](../../bench/dreams/SCHEMA.md) — front-matter schema
- [`docs/lessons-learned.md`](../lessons-learned.md) — L-004 (auto-dev DoD verification), L-006 (claude zombie failure mode), L-009 (design vs current implementation)
- [`lib/bench/aggregate.js`](../../lib/bench/aggregate.js) — deterministic report builder
- [ADR-004](./004-fast-engine-trimmed-not-ralph.md) — precedent on choosing measurable proxies over speculative full instrumentation
