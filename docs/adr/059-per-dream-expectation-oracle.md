# ADR-059 — Per-dream alignment oracle: fix the write-once-forever expectation leak

**Status**: accepted
**Date**: 2026-06-05
**Slice**: v0.20.a (stamp a dream-id into `expectation.md`; overwrite on a new dream, preserve on resume/same-dream)

## Context — a green alignment gate that verified nothing

v0.17.0 (ADR-056) froze the ORIGINAL ask at run start into
`.mmd/shared/expectation.md` and re-anchored MMD's v0.11 semantic judge to that
**immutable oracle** — so the build could no longer redefine its own success by
polishing `slice.md`/the spec mid-run (anti-drift; the goalposts cannot move).

The flaw: `writeExpectation` was **write-once-FOREVER** — if `expectation.md`
already existed, it no-op'd. But `.mmd/shared/` **persists across slices on a
repo**. So a genuinely NEW dream on a repo that already ran a prior slice found
the PRIOR slice's oracle, and the judge graded the NEW work against the OLD
dream's criteria — which "passed" because the prior slice was already merged into
this slice's base. **Zero real verification.**

This was found live during the v0.19.a merge (2026-06-05): the `mmdream document`
orchestrator slice came back `state=done` with the gate reporting "all ACs met"
— but the judge was grading the **v0.18.a** ACs, not the orchestrator's. Caught
only by a manual cross-check. The exact "always verify, including live" trap: a
green gate that verified the wrong thing.

Until fixed, no "done" on a repo that already ran a prior slice was trustworthy:
every slice was graded against whichever dream first wrote the oracle.

## Decision

Make the oracle **per-dream**, not write-once-forever, by stamping a
machine-readable **dream identity** into it and deciding three-way on run start.

1. **Stamp a dream-id** (`lib/conductor/expectation.js`):
   - `expectationDreamId(dream)` — pure: the first 16 hex chars of the sha256 of
     the **normalized** dream (trim + collapse whitespace). Never throws (odd/empty
     → the stable id of `""`, a real id, never null).
   - `buildExpectationContent` embeds a `<!-- dream-id: <16-hex> -->` comment line
     above the human-readable dream text (universal §VII — the stamp supplements,
     never replaces, the prose).
   - `readExpectationDreamId(content)` — pure: extract the stamp, `null` when
     absent/malformed (an old v0.17 oracle has no stamp → `null` → treated as a
     different dream, so a non-resume launch refreshes it).

2. **Three-way decision** (`decideExpectationWrite({existing, currentDreamId, isResume})`,
   PURE, never throws):

   | existing oracle | isResume | action |
   |---|---|---|
   | none (null/blank) | — | `write-fresh` |
   | same dream-id | — | `preserve` (re-run / same dream) |
   | different dream-id | `false` | `write-fresh` — **OVERWRITE (the fix)** |
   | different dream-id | `true` | `preserve` + `mismatch:true` (warn) |

   Any unexpected error degrades to the **safe conservative `preserve`** (the
   anti-drift default — when in doubt, do not move the goalposts).

3. **`writeExpectation`** takes a `readFileSync` reader seam + an `isResume`
   boolean: it reads the existing oracle's id and applies the decision. Never
   throws — read/parse/write errors degrade to a safe `{written:false, reason}`.
   **Backward compat:** a caller without the reader seam treats an existing file
   as an "unknown dream" → refresh on a non-resume launch, preserve on a resume.

4. **Wiring + honest logging** (`bin/mmd.js`): `runHereMode` and the greenfield
   path pass `isResume:false`; a new-dream overwrite logs "New dream — wrote a
   fresh alignment oracle (previous oracle was for a different dream)". `finishResume`
   passes `isResume:true` and, on a mismatch, logs an honest
   "⚠️ resume dream differs from the frozen oracle — keeping the original oracle"
   instead of silently grading the wrong dream.

## Why anti-drift still holds

The v0.17 guarantee survives **WITHIN a dream**: the SAME dream (re-run) OR a
resume **NEVER overwrites** the oracle. Only a genuinely DIFFERENT dream on a
**non-resume** launch refreshes it. The build still cannot redefine its own
success mid-run; this fix only stops the oracle leaking ACROSS dreams.

## The auto-handoff successor case

The v0.13/v0.14 auto-handoff successor is a **resume of the SAME dream** — it runs
the resume relaunch path, threaded as `isResume:true`, so it preserves the frozen
oracle naturally (same dream → `preserve` regardless; resume → never overwrites).

## Consequences

- A new dream on a repo that already ran a prior slice now grades against ITS OWN
  expectation — the v0.19 leak cannot recur.
- A resume / auto-handoff successor still preserves the frozen oracle (anti-drift).
- A mismatched resume warns honestly instead of silently grading the wrong dream.
- **Zero new dependency** — Node's built-in `crypto.createHash('sha256')` (the
  L-024 vanilla-stack bar).
- **No live AC required** — the bug is fully reproducible in pure write logic; the
  fix is locked by deterministic unit + integration regression tests.

## Out of scope (deferred)

- Re-verifying past "done" slices graded against a stale oracle (forward-only fix).
- Keying the oracle PATH per dream (`expectation-<id>.md`) — KISS: one path + a
  stamped id + overwrite-on-new keeps resume's fixed-path lookup simple.
