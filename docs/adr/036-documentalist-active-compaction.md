# ADR-036 — The Documentalist ACTS: active compaction by archiving the SPEC sprawl (act on the safe thing first)

**Status**: accepted
**Date**: 2026-06-01
**Slice**: v0.7.c (`mmd document-compact` — archive root `SPEC_V*.md` into an archive folder)
**Extends**: [ADR-034](./034-documentalist-coherence-review.md) (v0.7.a roadmap-level detection), [ADR-035](./035-documentalist-conformance-drift.md) (v0.7.b per-claim drift)

## Context

The Documentalist has, so far, only **observed**: v0.7.a reconciled designed-vs-
built and flagged doc-health (length caps, **SPEC sprawl**); v0.7.b added per-
claim DRIFT detection (does a doc still tell the truth?). Its own dashboard names
the owner's #1 pain in plain numbers — **34 `SPEC_V*.md` files sprawled at the
repo root**, the single biggest "the docs are becoming incomprehensible" signal.

It is time for the Documentalist's **first action** (§6.4.3 *active compaction*).
But "act on the docs" is exactly where an automated agent is most dangerous: an
agent that rewrites prose can silently corrupt meaning, and the damage is hard to
review. So the question is not only *what* to compact but *what to compact FIRST*.

## Decision

**Act on the safe thing before the hard thing** — the action-side mirror of the
detect-first caution in v0.7.a/b.

The lowest-risk, highest-value compaction is **archiving the root SPEC files**:
mechanical, fully reversible (`git mv` preserves history), and it directly clears
the root sprawl the dashboard flags. The **higher-risk semantic compaction** —
sharding the over-cap docs (`MAKE_MY_DREAMS.md` at ~1.7k lines, etc.), which
needs judgment about section boundaries and cross-references — is **deferred** to
a later capability. The Documentalist earns trust on safe relocations before it
touches prose structure.

`mmd document-compact` (a pure planner `lib/documentalist/compact.js` +
the subcommand `bin/documentalist/document-compact.js`):

1. Gathers the root `SPEC_V*.md` files, `git mv`s each into an archive folder
   under `docs/` (history preserved), writes a newest-first INDEX there (filename
   + parsed version + title line), and rewrites references to the moved files
   (`SPEC_V0XX.md` → the archive-prefixed path) across tracked markdown.
2. `--dry-run` prints the plan and changes **nothing** (clean tree after).

### The safety contract (the heart of this slice)

- **Move-only + reference-path rewrite.** It `git mv`s files and prefixes an
  exact root SPEC filename token; it **NEVER** edits doc *content/prose*, never
  deletes, never summarizes or dedupes.
- **Idempotent.** No root SPECs → a clean no-op (exit 0). An already-prefixed
  reference is never double-prefixed (a negative-lookbehind exact-token rewrite),
  so re-running is always safe.
- **Reversible.** `git mv` keeps each file's history (`git log --follow` reaches
  the original); the whole change is a plain git rename + edits the operator can
  revert.
- **Honest, never half-applied.** A non-git repo (exit 5) or an untracked SPEC
  (exit 6) is reported **before** any mutation; a `git mv`/write failure stops and
  reports what moved. It does **not** auto-commit — the operator reviews + commits
  (commit-git §I).

### Drift-detector-as-validation (the v0.7.a/b synergy)

After the SPECs move, every doc that linked `SPEC_V0XX.md` would dangle — so the
reference rewrite is mandatory, and the **v0.7.b Drift detector is the proof it
was complete**: a post-compaction `mmd document-review` must show **no new
dangling SPEC references**. Detection guards the action. This is why detection was
built first and compaction second.

### New SPECs still land at root; a later run archives them

This does **not** change the SPEC-creation workflow: each slice keeps creating its
`SPEC_V*.md` at the repo root (where it is easy to find while in flight), and a
periodic `mmd document-compact` archives the shipped ones — the §6.4 periodic-
consolidation model. The planner's incremental support (already-archived SPECs are
not re-moved; the index stays complete) is exactly for this recurring use.

### Why the live 34-SPEC archival is the operator's POST-MERGE step

The auto-dev slice that builds this feature has its own in-flight `docs/specs/SPEC_V07C.md`
at the root. Running `mmd document-compact` *inside* the slice would move that
spec mid-build. So the slice validates the logic on **fixture git repos** in the
tests (dry-run no-op, real move+index+rewrite, idempotent re-run, integrity,
non-git/untracked failures); the real archival of MMD's own 34 SPECs is the
**operator's post-merge step** (AC-4), captured in HANDOVER.

## Consequences

- The owner's #1 doc pain (34 SPEC files at root) is resolved by one safe,
  reversible, idempotent command, validated by the Documentalist's own detector.
- The Documentalist now **detects** (v0.7.a), **guards truth** (v0.7.b), and
  **acts** (v0.7.c) — but only on the mechanical, reversible half.
- The harder semantic compaction (sharding the over-cap docs) is the trusted-next
  step once SPEC archival is proven; the coherence graph (derived doc↔code↔ADR
  traceability) follows.
- A small residual: the rewrite is an exact-filename token transform, so a
  reference that names a SPEC indirectly (a paraphrase, a glob) is not rewritten —
  acceptable, and the Drift detector would surface any genuine dangling link.
