# ADR-015: Promote L-002 into ai-coding.md

Date: 2026-05-30
Status: Accepted

## Context

Lesson L-002 — "`claude -p` does not flush stdout in real-time when redirected to a file" — reached its promotion threshold via the
deterministic counter mechanism shipped in v0.2.i (`mmd document-lessons`,
SPEC_V02I). Per scoping §6.5, once a lesson's validated-reuse counter reaches
its `**To promote if**: N` threshold it graduates from the dynamic Layer F
(`docs/lessons-learned.md`) into the relevant constitution module.

Trigger line: `**To promote if**: 5 reuses validated (counter: 1)`

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

### L-002 — `claude -p` does not flush stdout in real-time when redirected to a file

**Rule**: do NOT rely on `tail -f` of a `claude -p` stdout redirect to monitor an auto-dev run in progress. Instead, monitor via:
  1. `git log <slice-branch> --oneline` — auto-dev commits atomically as it completes logical steps
  2. `find <repo> -type f -mmin -N -not -path "*/.git/*"` — file modification activity
  3. `_bmad-output/implementation-artifacts/` for techspec + deferred-work files
  4. Process liveness: `pgrep -f "claude -p"` to confirm it's still running
