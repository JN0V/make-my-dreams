# ADR-019: Human-readable branch names for `mmd --here` (`--label` + boilerplate strip)

Date: 2026-05-31
Status: Accepted

## Context

Constitution v2.1.0 added universal.md §VII "Human-readable first": every
artifact a human may read — names, branches, commits, specs — must be
comprehensible to a human FIRST and AI-friendly second. A coded name with no
plain-language expansion is forbidden.

MMD's own tooling was the prime violator. `mmd --here "<dream>"` derived the
slice branch name by slugifying the WHOLE dream, and a real launch dream opens
with fixed scaffolding ("implement vX per SPEC_Y.md, spec is frozen, do not edit
it, skip party mode, go directly to implementation, deliver: …"). The slug
therefore captured the *preamble*, not the work, producing branches like:

```
slice/here-implement-v0-2-n-per-spec-v02n-md-spec-is-frozen-do-not-edit-it-1780216461
```

— humanly opaque, and the exact "rule lives only in prose, tooling ignores it"
trap that lesson L-019 warns against. A rule the system does not embody is weak.

## Decision

Two complementary changes, both in pure/CLI layers (no auto-dev involved):

1. **`--label <name>` flag** (top-level, value-bearing — the first such flag in
   `parseArgv`). The user supplies a short human phrase; it is slugified and used
   verbatim as the branch stem: `--label "wip-salvage stall signal"` →
   `slice/here-wip-salvage-stall-signal-<ts>`. This puts a human in direct
   control of the human-readable name.

2. **Boilerplate-stripped fallback** (`deriveBranchSlug`, `lib/parse-dream.js`).
   When no `--label` is given, a closed list of MMD launch-boilerplate phrases is
   removed from the dream before slugifying, so the subject survives:
   `slice/here-v0-2-n-stall-signal-wip-uncommitted-since-n-min-<ts>`. Stripping
   is applied ONLY to branch-name derivation, never to the general `slugify`
   (which feeds `slice_id` / state paths — wider blast radius). `slice_id` in
   status.json is intentionally left as the legacy slug; only the user-visible
   branch name changes.

`deriveBranchSlug` always returns a non-empty slug: a dream that is entirely
boilerplate falls back to slugifying the raw dream (legacy behavior).

## Consequences

- **Positive**: branches now read like the work; the §VII rule is embodied in
  code, not just written. `--label` is the deterministic gold path; the fallback
  is a safe default that needs no extra typing.
- **Negative / accepted**: the boilerplate list is a heuristic and will not catch
  every phrasing — it is best-effort, and `--label` is the reliable escape hatch.
  `--label` is consumed only in `--here` mode (a no-op elsewhere in v0.2.o).
- **Scope deliberately not taken**: `slice_id`, demo dir names, and existing
  history are unchanged; this ADR covers only the `--here` branch name.

## Alternatives considered

- **Smarter semantic extraction (LLM-derived label)**: rejected for v0.2.o —
  cost, non-determinism, and `--label` already gives the human full control.
- **Strip boilerplate inside the shared `slugify`**: rejected — `slugify` feeds
  `slice_id` and state paths; narrowing its output there has blast radius and
  would couple two concerns.
