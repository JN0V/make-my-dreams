# ADR-025 — `mmd document-readme`: the handover pattern applied to the README (doc-sync, Documentalist-lite)

**Status**: Accepted
**Date**: 2026-06-01
**Deciders**: MMD core (self-dev, 19th reflexive `mmd --here`, 6th with `--label`)
**Parent design**: [docs/specs/SPEC_V03D.md](../../SPEC_V03D.md) (FROZEN). Reuses the machinery
introduced by [ADR-020](./020-mmd-handover-subcommand.md) (`mmd handover`) and is the
lite, pulled-forward first step of the full Documentalist long planned for v0.5b.

## Context

Every MMD slice grows the README's per-command docs (each spec's AC-6), but **nothing
maintained the README's mechanical META**. The result is documentary drift that compounds
every slice: on 2026-05-31, at v0.3.3, this file's Status still read "Pre-v0.1 / not yet a
usable CLI" and its History stopped at v0.2e. It had been hand-patched once (commit
`4c46318`), but a hand-patch rots again the next slice — exactly the failure mode `mmd
handover` was built to kill for `HANDOVER.md` (the live file once claimed "17 active
lessons" while the parser counted 13).

The full event-driven **Documentalist** (Diataxis coverage, ADR-drift detection, gStack
`/document-generate` / `/document-release` delegation, cron trigger + LLM judgment) is ~5
roadmap milestones away (v0.5b). Waiting for it means five more slices of compounding
README drift. The *mechanical* part of the problem, though, is identical to a problem we
already solved.

## Decision

Ship the **lite** doc-sync now: a `mmd document-readme [--tests N] [--dry-run] [--help]`
subcommand that applies the proven **`mmd handover` pattern** to `README.md`.

### 1. Reuse the handover machinery — do not duplicate (SPEC §3)

- The marker-bounded rewrite is the **same** `lib/handover/rewrite-markers.js`, now
  parameterized over the marker **pair** (it defaults to the HANDOVER markers, so every
  existing two-arg `mmd handover` call is byte-unchanged). `mmd document-readme` passes its
  own `mmd:readme:status:*` and `mmd:readme:changelog:*` markers.
- The git/version/count helpers (`gitField`, `unavailable`, `renderAdrCount`) are **exported**
  from `lib/handover/build-state-block.js` and reused by the README builders, rather than
  re-implemented (DRY §III; SPEC §3 "extract/share rather than duplicate").

### 2. Two marker-bounded mechanical blocks

- **Status** block — version (`package.json`), latest tag, ADR count, active-lesson count
  (the authoritative `parseLessons`, status `active`), reflexive-slice count (the number of
  release tags, the honest mechanical proxy), and the test count.
- **Changelog** block — one markdown line per git tag, **newest first**, from each tag's
  **annotation** (`git for-each-ref --sort=-version:refname --format
  '%(refname:short)%09%(objecttype)%09%(contents:subject)' refs/tags`). This adds a source
  the README never had: the annotated-tag messages each `mmd ship` already writes.

### 3. A separate, PURE drift detector — print, never edit

`lib/readme-sync/detect-drift.js` compares `bin/mmd.js`'s `SUBCOMMANDS` (plus the top-level
flags) to the README text and returns the ones not mentioned. The entry point **prints** the
report on stdout (informational, exit 0) and writes **nothing** to the README. Drift is
surfaced at the cheapest moment without ever touching the human narrative.

### 4. The mechanical / intent split (the whole point)

The Status + Changelog blocks are **mechanical** (git/files) → machine-owned and regenerated.
The README's prose **History** (the *story* of why each slice happened) and the intro /
per-command docs are **intent** → human-owned and **never** touched. We only ever rewrite
between the markers. This is the same §VI honesty + SRP boundary `mmd handover` proved.

### Why tag annotations as the changelog source

The annotated tags are an existing, authoritative, one-line-per-release record (`mmd ship`
writes them). Deriving the changelog from them means the release list cannot drift from the
tags — and needs no second hand-maintained file. A lightweight tag (no annotation object,
detected via `%(objecttype)` so we don't accidentally borrow the pointed commit's subject)
renders an explicit `(no annotation)` rather than a fabricated summary.

### Why honest on every missing source, never fabricated

Same contract as `mmd handover` (universal §VI): a failing git call → `(unavailable:
<reason>)`; the non-cheap test count comes from `--tests N` or an explicit `(run npm test to
refresh)` placeholder — the command never runs the suite, never invents a number, never
auto-commits. A missing marker pair → exit 4 with the derived block printed (refuse to guess
where to write). Running it twice with the same repo state + same `--tests` is byte-idempotent.

### Why lite now, full Documentalist deferred to v0.5b

The mechanical META is the part that drifts every slice and is cheaply derivable. The
*intent* parts (regenerating the prose History narrative, Diataxis coverage, ADR-drift
judgment) need LLM judgment and an event-driven Worker — that is the v0.5b Documentalist.
Pulling the mechanical slice forward closes the compounding root cause years early without
speculatively building the heavy machine (universal §II YAGNI; L-009 — the gap is named, not
hidden).

## Consequences

- **Positive**: the README's version / tag / ADR-lesson-release counts / changelog are now
  machine-maintained from a single command; `mmd document-readme --tests N` after each slice
  keeps them honest. The handover machinery is reused, not duplicated — one rewriter, one set
  of git/count helpers, serving both `HANDOVER.md` and `README.md`. The drift report makes a
  newly-shipped-but-undocumented subcommand visible immediately.
- **Negative / accepted**: only the *mechanical* blocks are synced — the prose History still
  needs a human (named, not hidden; the full Documentalist is v0.5b). The reflexive-slice
  count is a release-tag proxy, not a precise `--here` tally. `--strict` (drift fails CI) is a
  future flag.
- **Honesty (universal §VI)**: every missing source degrades to an explicit `(unavailable)` /
  placeholder; nothing is fabricated, the suite is never run, the file is never auto-committed.

## References

- [docs/specs/SPEC_V03D.md](../../SPEC_V03D.md) — the slice spec (FROZEN)
- [ADR-020](./020-mmd-handover-subcommand.md) — `mmd handover`, the pattern + machinery this reuses
- [L-020](../lessons-learned.md) — the marker-bounded mechanical/intent doc-refresh pattern, reused here
- [L-009](../lessons-learned.md) — communicate the design/implementation gap (the deferred full Documentalist)
- [`lib/readme-sync/`](../../lib/readme-sync/) — the three pure builders (status / changelog / drift)
- [`lib/handover/rewrite-markers.js`](../../lib/handover/rewrite-markers.js) — the now-parameterized rewriter
