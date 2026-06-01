# ADR-037 — The coherence graph: change one node, know which neighbors to review (derive, never maintain)

**Status**: accepted
**Date**: 2026-06-01
**Slice**: v0.7.d (`mmd document-review --since <ref>` — staleness-on-diff)
**Extends**: [ADR-034](./034-documentalist-coherence-review.md) (v0.7.a roadmap-level detection), [ADR-035](./035-documentalist-conformance-drift.md) (v0.7.b per-claim drift), [ADR-027](./027-import-graph-blast-radius.md) (the resolved import graph it reuses)

## Context

The Documentalist can reconcile designed-vs-built (v0.7.a), check per-claim drift
(v0.7.b), and compact the SPEC sprawl (v0.7.c). The owner's standing ask, though,
is structural: **doc, code, and ADR drift apart silently** — you change one and
forget the other two need a look. v0.7.c surfaced this live: archiving the SPECs
broke `documentalist-inventory.test.js` (it asserted root SPEC sprawl), a coupled
doc↔code↔test change a human had to catch *after* it broke. The need is to learn,
*before* merging, "what else does this change touch?"

The tempting answer — a hand-maintained map of "these things relate" — rots the
day it's written. The insight: **MMD already produces ~80% of the edges for free.**
`computeBlastRadius` (ADR-027) resolves the code↔code import closure; the v0.7.b
`doc-refs` extractor pulls doc→code references; `[[wiki]]`/`ADR-NNN`/relative
markdown links give doc↔doc. They just had never been composed into one graph.

## Decision

Ship a **coherence graph** that is **derived, never maintained**, and realize it
as a **staleness-on-diff query**: `mmd document-review --since <ref>` takes the
diff, walks a file-level graph from the changed files, and reports the **coupled
neighbors to review** — advisory, ranked, read-only.

Two pure modules + a flag (universal §I SRP):

1. **`lib/documentalist/doc-links.js`** — `extractDocLinks(text, {docPath, resolveAdr})`
   pulls the doc↔doc edges a doc asserts: `[[wiki]]` links (→ sibling `.md`),
   `ADR-NNN` (→ the real ADR file via an injected resolver, else the number-keyed
   stem), and relative markdown `.md` links. Pure, never throws, conservative
   (external/absolute/anchor/code links yield no edge — a code link is doc-refs'
   job; an unresolvable target is the drift detector's job, not the graph's).
2. **`lib/documentalist/coherence-graph.js`** — `buildCoherenceGraph({importEdges,
   docToCodeEdges, docLinkEdges})` composes the three sources into ONE **file-level,
   bidirectional** adjacency (each edge keeps its `kind`: `import`/`doc-ref`/`doc-link`);
   `coupledNeighbors(graph, changedFiles)` walks it and returns, per changed file,
   its neighbors **ranked strong (direct) before weak (transitive)**, deduped,
   excluding the changed set. Pure, deterministic, never throws.
3. **`bin/documentalist/document-review.js --since <ref>`** — computes the changed
   files (`git diff --name-only`, injectable seam), builds the graph from the three
   derived sources (reusing `computeBlastRadius` for imports, `doc-refs` for
   doc→code, the new `doc-links` for doc↔doc — edges kept only to real tracked
   files), walks it, and prints the **"Coupled changes"** report to stdout.

### The contract (what makes it safe + useful)

- **Derive, never maintain.** Every edge comes from an existing source; nothing is
  hand-curated, so the graph cannot rot. New couplings appear for free as imports
  and references are written.
- **Advisory + ranked, never a hard gate.** The report says *coupling ≠ certainty —
  review, don't obey*. A strong edge is a direct import/reference/link; weak is a
  two-hop transitive neighbor. v0.7.d gates nothing (a pre-commit/CI gate is a
  separate, opt-in decision).
- **Read-only query.** `--since` returns before any roadmap read or report write —
  it does **not** rewrite `docs/coherence-review.md` (asserted: clean tree after).
  The no-flag dashboard path stays byte-for-byte unchanged.
- **Precision-first (the v0.7.b discipline).** Two levers keep the report from
  crying wolf: (a) edges are kept only to **real tracked files** (no phantom
  neighbors); (b) **hub suppression** — a high-degree node (a top-level doc like
  CLAUDE.md/HANDOVER.md that references dozens of ADRs) is reported as a direct
  neighbor but is **not** used as a transit node for weak edges, so a change near
  it does not weak-flag the whole repo. We also stop transitivity at **two hops**
  on purpose; the full transitive import closure remains the sealed-gate blast
  radius's job.

This is exactly what would have caught the v0.7.c break: a `--since` run on that
diff couples the moved SPECs and the touched `lib/` module to the test that
references them — *before* the test went red, not after.

## Honest limits (stated, not hidden — universal §VI; the L-024 discipline)

- **File-level, not symbol-level.** A node is a file; we do not resolve
  function/export-level coupling. Symbol granularity is a later refinement.
- **No semantic anchor.** The opt-in n-ary `@mmd:link <concept>` for blocks with
  no derivable edge is deferred — file-level + the diff check is ~80% of the value.
- **No mind-map render.** The Mermaid/.dot visual map is deferred; the actionable
  diff check is the core.
- **No git co-change edges.** Empirical "these files historically change together"
  is a weak-edge enrichment for later.
- **Inherits the import graph's gap.** Code↔code edges are only as accurate as
  `computeBlastRadius` (ADR-027): computed/runtime specifiers, re-export aliasing
  through computed names, and non-JS importers are not seen.

## Consequences

- The Documentalist now sees **coupling**: "change one node, learn which doc/code/
  ADR neighbors to review." The owner can ask, before merging, "what else does
  this touch?" and get a derived, honest, ranked answer.
- The graph is one composition step; the deferred enrichments (symbol granularity,
  `@mmd:link`, mind-map render, git co-change) layer on top of it without
  rebuilding it — they refine edges, not the walk.

## Alternatives considered

- **A hand-maintained coupling map** — rejected: it rots the day it's written
  (the whole reason for "derive, never maintain").
- **A hard pre-commit/CI gate** — rejected for v0.7.d: a graph that blocks on
  every coupling cries wolf; advisory first, opt-in gating later.
- **Full transitive closure for the weak layer** — rejected: on a real repo with
  hub docs it couples everything to everything; two-hop + hub suppression keeps it
  actionable (precision-first).
- **A heavyweight graph dependency** — rejected (vanilla-stack, L-024): the walk
  is a small hand-rolled BFS over a Map, no new dependency.
