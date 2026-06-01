# ADR-038 — Cap the hub-SOURCE neighbor flood in the coherence-graph staleness report

**Status**: accepted
**Date**: 2026-06-01
**Slice**: v0.7.e (`mmd document-review --since <ref>` precision refinement)
**Extends**: [ADR-037](./037-coherence-graph-staleness.md) (v0.7.d coherence graph it refines)

## Context

v0.7.d shipped the coherence graph: `mmd document-review --since <ref>` walks a
file-level bidirectional graph derived from import closure + doc→code refs +
doc↔doc links, and reports the **coupled neighbors to review** for each file a
diff changed — advisory, ranked, read-only.

It already carried ONE precision lever against hub noise: **hub-TRANSIT
suppression.** A high-degree "hub" node — a doc like `CLAUDE.md` / `HANDOVER.md`
that references dozens of ADRs — is not used as a transit node when expanding
weak/transitive edges, so a change *near* a hub does not weak-flag the whole repo.

But a symmetric gap was left open. When the file a diff changed **is itself the
hub** (you edit `CLAUDE.md`), every one of its dozens of direct references is a
*direct* edge, so all of them are reported as `strong`. The "Coupled changes"
report floods with 40+ "review (strong)" lines. Per the v0.7.b discipline, a hint
that flags everything flags nothing — the flood is as useless as silence, and it
buries the genuinely-coupled neighbors of the *other* changed files.

## Decision

Add the symmetric counterpart: **hub-SOURCE cap.** When a changed file's direct
neighbor count exceeds the existing `HUB_DEGREE` threshold, it is a *hub source*:

1. **Cap to the top `HUB_DEGREE` direct neighbors**, taken AFTER the existing
   deterministic ranking (strong → kind precedence → path), so the kept slice is
   the highest-ranked one — not an arbitrary truncation.
2. **Record the dropped count** on the entry (`hubSuppressed`) and print an
   **honest note** in the report: `… +N more direct neighbors suppressed (hub
   source — …, reviewing all is noise, not a hint).` Never a silent truncation
   (universal §VI; the L-027 honesty discipline — surface the cap, don't hide it).
3. **Skip the transitive layer** for a hub source: weak edges layered on top of an
   already-capped flood are pure noise.

The cap lives in the **pure `coupledNeighbors`** (`lib/documentalist/
coherence-graph.js`), the same place hub-transit suppression already lives — it is
deterministic neighbor *selection*, so it is unit-testable and the renderer stays a
thin display. `HUB_DEGREE` (still `12`, one documented threshold) is now exported
so tests assert behavior at the boundary without hard-coding the number. The
`hubSuppressed` field is added **only when capping occurs**, so an ordinary entry
keeps its exact `{ file, neighbors }` shape (back-compat with every v0.7.d AC-2
assertion); a non-hub `--since` run is byte-for-byte v0.7.d's output.

## Honest limits (stated, not hidden — universal §VI)

- **One global threshold.** `HUB_DEGREE` is not tuned per edge-kind nor made
  configurable (YAGNI). A doc that legitimately couples to exactly 13 files loses
  its lowest-ranked neighbor to the cap; the honest note makes that visible, and
  the operator can still run blast-radius for the full set.
- **The cap is on the SOURCE's direct degree**, measured after excluding
  co-changed files — a file is never counted as its own neighbor, and a hub whose
  references were mostly co-changed in the same diff drops below the threshold and
  is reported in full.
- **It does not change which files are coupled**, only how many of a flood are
  *shown*; the suppressed neighbors are real couplings, just below the cut.

## Consequences

- Editing a hub doc now yields a tight, ranked, top-`HUB_DEGREE` list plus an
  explicit suppressed-count note, instead of a 40-line flood that buried the
  other changed files' hints.
- The graph now has symmetric hub handling: a hub couples to too much to be an
  actionable hint, whether it is *near* the change (transit suppression, v0.7.d)
  or *is* the change (source cap, v0.7.e). Both reuse the one `HUB_DEGREE` lever.

## Alternatives considered

- **Cap in the renderer only** — rejected: the selection of which neighbors to
  keep is deterministic logic that belongs in the pure walk (unit-testable);
  the renderer stays a thin display.
- **Drop the hub source's neighbors entirely** — rejected: it is genuinely
  coupled; showing the top-ranked few + an honest count is more useful than
  silence, and never hides the truncation.
- **Raise `HUB_DEGREE` instead of capping** — rejected: it only moves the flood
  threshold; the structural fix is to cap + disclose, not to widen the firehose.
- **Make the cap configurable** — rejected (YAGNI): one documented threshold,
  surfaced honestly, is enough; per-kind tuning is a later refinement if needed.
