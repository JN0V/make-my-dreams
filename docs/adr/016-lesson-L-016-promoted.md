# ADR-016: Promote L-016 into ai-coding.md

Date: 2026-05-30
Status: Accepted

## Context

Lesson L-016 — "`MMD_TIMEOUT_MS=1800000` (30 min) default kills Standard auto-dev mid-pipeline + spec-polish trap" — reached its promotion threshold via the
deterministic counter mechanism shipped in v0.2.i (`mmd document-lessons`,
SPEC_V02I). Per scoping §6.5, once a lesson's validated-reuse counter reaches
its `**To promote if**: N` threshold it graduates from the dynamic Layer F
(`docs/lessons-learned.md`) into the relevant constitution module.

Trigger line: `**To promote if**: 3 reuses validated (counter: 1) — strong candidate to promote to `ai-coding.md` as "Standard engine pre-conditions: MMD_TIMEOUT_MS=0 + spec-frozen directive in prompt." A future v0.2.h (Conductor preconditions hardening, see L-015) should also bake in: (a) auto-set `MMD_TIMEOUT_MS=0` for the Standard engine path unless user overrides, (b) detect WIP in the working tree after subprocess exit and surface it rather than letting `here-mode` exit silently.`

## Decision

Appended the lesson's Rule to `.specify/memory/constitution/ai-coding.md`
(under a "Promoted from lessons-learned" section) and removed the lesson block
from `docs/lessons-learned.md`. The destination module is taken from the
lesson's own `**To promote if**` line (else defaults to `ai-coding.md`) — the
lesson, not the Documentalist, decides where it belongs.

This promotion was applied automatically (no LLM judgment, no human-in-the-loop
beyond the explicit `mmd document-lessons` invocation). The full Documentalist
Worker (v0.5b) will add cron-like triggering and semantic judgment.

## Consequences

- The rule is now load-bearing constitution, injected by binding rather than by
  the keyword composer.
- The lesson no longer appears in `mmd lessons` (it is no longer an
  auto-injection candidate).
- Rollback, if ever needed, is manual: revert this ADR's commit.

## Promoted content

### L-016 — `MMD_TIMEOUT_MS=1800000` (30 min) default kills Standard auto-dev mid-pipeline + spec-polish trap

**Rule**: 1. **Always** set `MMD_TIMEOUT_MS=0` when launching `mmd --here` for a real implementation slice (Standard engine). The 30-min default is only safe for trivial changes (AC-7 dogfood) or `--fast` engine slices.
  2. The prompt to auto-dev MUST explicitly forbid further spec editing when the spec is considered final: include the line `The spec at SPEC_V02X.md is AUTHORITATIVE and FROZEN. Do NOT modify SPEC_V02X.md. Go directly to implementation (Phase 3 / coding).` This is the explicit way to short-circuit the spec-polishing trap.
  3. Operational checklist before `mmd --here` for a real implementation:
     - `MMD_TIMEOUT_MS=0` exported
     - The spec file's path verified to exist on base (L-015 mitigation)
     - The dream prompt explicitly says "spec is frozen, implement"
     - The previous slice's WIP (if any) is salvaged or discarded explicitly
