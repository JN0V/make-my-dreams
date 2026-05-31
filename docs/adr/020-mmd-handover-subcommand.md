# ADR-020 — `mmd handover` refreshes HANDOVER.md's mechanical State block (universal §VI/§VII)

**Status**: Accepted
**Date**: 2026-05-31
**Deciders**: MMD core (self-dev, 14th reflexive `mmd --here`, first with `--label`)

## Context

`HANDOVER.md` carries a session across context switches. Most of it is human
intent — roadmap, operational rules, the "why" — that no tool can derive. But
one block, "State at handover" (latest tag, branch, version, lesson/ADR counts,
recent commits), is purely mechanical, tedious to maintain by hand, and drifts
silently: at the start of this slice the live file claimed **17 active lessons**
while the authoritative parser (`parseLessons`) counted **13**. The State block
had been hand-edited three times across v0.2.14/v0.2.15 and was still wrong.

A wrong count in the one document everyone reads first at 2 a.m. is exactly the
kind of human-opacity universal §VII warns against, and a fabricated/stale number
is the dishonesty §VI forbids.

## Decision

Add `mmd handover [--tests N] [--dry-run]`, a subcommand that re-derives ONLY the
mechanical State block and rewrites it in place between two markers
(`<!-- mmd:handover:state:start -->` / `<!-- mmd:handover:state:end -->`),
preserving every byte outside the markers exactly.

Key design choices:

- **Mechanical vs intent split.** The tool derives only what is cheap and
  deterministic (git + repo files). It refuses to author any intent section —
  fabricating "what's next" would violate §VI. Intent stays human.
- **Count from the parser, not a regex or a human.** Active-lessons come from
  `parseLessons(...).filter(status==='active')` — the same source the composer
  trusts. A second tally is a second thing to drift.
- **`--tests N` over auto-running the suite.** Running `npm test` to get the count
  would violate SRP (a doc generator is not a test runner) and break determinism.
  The count comes from `--tests N` or an explicit `(run npm test to refresh)`
  placeholder — never invented, never copied-stale (§VI honesty).
- **Markers are the contract.** If either marker is absent the command does NOT
  guess an insertion point; it exits non-zero (exit 4) and prints the derived
  block for the human to place. This keeps the rewrite deterministic and safe.
- **Honest unavailability.** A failing git call renders `(unavailable: <reason>)`,
  never a crash and never a guess.
- **Purity + injection.** `lib/handover/build-state-block.js` and
  `lib/handover/rewrite-markers.js` are pure (git/fs/clock injected), mirroring
  `lib/conductor/stall-detector.js`, so the same inputs always yield identical
  output (idempotency) and the unit tests need no real git/fs.

## Consequences

- The State block is now machine-derived and self-correcting: running
  `mmd handover --tests <n>` fixes the stale 17→13 count and stays right.
- Idempotency (same repo state + same `--tests` ⇒ byte-identical file) is a tested
  invariant, so the command is safe to run in CI or a pre-commit hook later.
- The human still reviews + commits the refreshed file (commit-git §I gate — the
  command never auto-commits).
- Out of scope (deliberately deferred): templating intent sections, a
  `--run-tests` flag, scaffolding HANDOVER.md from nothing, and paginating full
  git history (the State block reads a small fixed `git log --oneline -N`).

This closes the L-020 candidate: session handover's mechanical block is now a
command, not a hand-curated section that drifts.
