# ADR-012: Composer categorization — context-aware lesson filtering

**Date**: 2026-05-30
**Status**: Accepted
**Authors**: Sébastien (project owner), auto-dev (Standard engine, v0.2.l slice)

## Context

The v0.2e composer ([ADR-010](./010-composer-minimal-keyword-overlap.md)) selects lessons to inject by keyword overlap, globally over the whole `docs/lessons-learned.md`, capped at the top-5 by score. With ~17 active lessons this works well. But keyword matching has no awareness of *what the current invocation is doing*: the keyword "git" already collides across L-003/L-008/L-017, and the only ceiling is `topN=5`. As the lessons count grows toward 50+, lexical-coincidence matches start crowding genuinely-relevant lessons out of the cap, and every prompt — `mmd qa`, `mmd --here`, `mmd unblock` — sees the same undifferentiated pool.

This is the exact problem the **constitution** hit at v1.3→v2.0, solved by modularizing into 13 modules + a per-context `constitution-bindings.yaml`. L-018 names the parallel: SPEC_V02E §4 deferred "semantic matching" and "scoring sophistication" (both genuinely big) but never said "categorization is also deferred" — a silent walking-skeleton-scope omission, the 5th echo of the L-009 pattern (after L-009 wrapper / L-012 gStack / L-015 Conductor / L-017 discover). v0.2.l closes it **predictively**, before the pain, on the constitution's proven model.

## Decision

### Mirror the constitution's per-context model

The composer adopts the same architecture the constitution adopted: light per-item categorization + a context-aware filter that runs **before** keyword matching. Concretely:

1. Each lesson gains two optional fields: `**Category**:` (a comma-list folksonomy, e.g. `git, subprocess-control, observability`) and `**Applies to**:` (a comma-list of subcommands like `mmd --here, mmd ship`, or `*` for universal).
2. `composeLessons(prompt, lessonsPath, { context })` where `context = { subcommand, phase?, engine? }`. The pipeline is now: parse → **filter by `Applies to`** → keyword match → topN cap → audit.
3. A lesson passes the filter when its `Applies to` includes the context's `subcommand` or `*`.

The filter runs first because it is the cheap, high-precision cut: it removes lessons that are *categorically* irrelevant to this invocation, leaving keyword matching to rank what remains. Result: `mmd lessons match "<prompt>" --context mmd-qa` returns a **strict subset** of the un-contextual match.

### Why annotation-on-lesson, not a separate bindings file

The constitution uses an external `constitution-bindings.yaml` because its modules are large files loaded wholesale; a binding table is the natural index. Lessons are small, single-fact entries that already live in one file with structured fields. Putting `Category`/`Applies to` **on the lesson** (one line each) keeps the classification next to the thing classified — lower friction to author, impossible to desync, and it reads naturally in `mmd lessons --show`. A separate `lessons-bindings.yaml` (mirroring the constitution) is captured in L-018 §5 as a **deferred** option: add it later only if per-lesson annotation proves too granular or too rigid (e.g. if the same `Applies to` list must be repeated across many lessons). Folksonomy first, formalization later.

### Why backward-compatible by default

Omitting `context` keeps the exact v0.2e behavior: full-file keyword matching, no filtering. This matters because (a) `mmd lessons match` without `--context` must keep working as the un-filtered baseline that proves the subset property, and (b) any legacy or future caller that doesn't yet pass a context is never penalized. The parser is equally tolerant: a lesson with no `Category`/`Applies to` defaults to `['uncategorized']` / `['*']`, so the pre-v0.2.l lessons file parses identically and a `*` default means "universal — never filtered out".

### The taxonomy and how to extend it

The category list is a **flat folksonomy** (no hierarchy in v0.2.l): `subprocess-control`, `observability`, `git`, `concurrency`, `testing`, `version-management`, `definition-of-done`, `design-vs-implementation`, `documentation`, `reflexive-bootstrap`, `milestone`, `pillar-audit`, `conductor`, `pre-conditions`, `prompt-engineering`, `discover`, `scanner`, `composer`, `scale`. New lessons add new categories freely — there is no closed enum to maintain. `Applies to` IS a closed-ish enum (the known subcommands + `*`): `mmd --here`, `mmd ship`, `mmd qa`, `mmd cso`, `mmd document-release`, `mmd unblock`, `mmd discover`, plus `*`. When a lesson genuinely applies broadly, **prefer listing subcommands explicitly over `*`** — it is more honest and lets future filtering stay precise (a lesson tagged `*` can never be filtered out, which is the right default only for truly universal lessons like the L-009/L-018 design-discipline ones).

Classification is a judgment call on each lesson's *content*, not a mechanical table lookup. The v0.2.l migration started from SPEC_V02L's proposed table but refined it where the wiring surfaced a miss: L-004 and L-016 (subprocess-control lessons about auto-dev stalling) were extended to include `mmd unblock`, because the 5-Whys/unblock session diagnoses exactly those stalls — and the v0.2.j integration test proving L-016 feeds a timeout-themed unblock session would otherwise have silently broken. A wrong classification is a future composer *miss*; getting it right is the whole point.

### Observability: the new composer.json metrics

The `composer.json` audit gains four additive fields: `context` (the arg, or `null`), `filtered_out_by_context` (N), `matched_by_keyword` (M, pre-topN), and `injected` (K, post-topN). The invariant `K ≤ M ≤ active − N` makes the filter's effect measurable post-hoc — a live `mmd qa` run with `filtered_out_by_context > 0` is the end-to-end proof the filter fires. These fields ARE the observability data the constitution's `observability.md` module asks for.

## Consequences

**Positive**: the composer is scale-resilient — adding lessons no longer dilutes any single invocation's relevant set. The L-009-pattern echo is structurally closed for the lessons-system axis (constitution already done; future scanners/parsers/registries inherit the META-rule "specs must enumerate scale assumptions in Out-of-scope"). The `--context` flag gives a direct introspection tool.

**Negative / deferred**: classification is manual until the v0.5b Documentalist can auto-classify new lessons. A mis-tagged `Applies to` silently drops a relevant match — mitigated by preferring explicit subcommand lists and by the `mmd lessons match --context` introspection. No category hierarchy and no per-category score weighting yet (flat folksonomy, keyword-overlap scoring unchanged) — both deferred per SPEC_V02L §4. The optional `lessons-bindings.yaml` remains a v0.2.l+ escape valve if annotation granularity becomes a problem.

## Related

- [ADR-010](./010-composer-minimal-keyword-overlap.md) — the v0.2e keyword-overlap composer this extends.
- [ADR-011](./011-five-whys-escalation.md) — `mmd unblock`, one of the contexts now passed to the composer.
- L-018 (predictive capture), L-009 (design-vs-implementation discipline), `constitution-bindings.yaml` (the proven per-context model).
- SPEC_V02L — the 7 ACs + DoD.
