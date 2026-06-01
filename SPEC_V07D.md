# Make My Dreams — v0.7.d Spec: the coherence graph — staleness-on-diff (`mmd document-review --since`)

> The Documentalist can detect roadmap gaps (v0.7.a), check per-claim drift (v0.7.b), and compact the sprawl (v0.7.c). v0.7.d adds the capability the owner asked for: a **coherence graph** coupling doc↔code↔ADR so that **changing one node flags the others as possibly stale** — "change one of the three (or n), know the other two need a look." The value is realized as a **staleness-on-diff check**: `mmd document-review --since <ref>` takes the slice's diff, walks the graph from the changed files, and reports the coupled neighbors to review.
>
> The golden rule (so it never rots): **derive the graph, never hand-maintain it.** MMD already produces ~80% of the edges for free — `computeBlastRadius` (ADR-027) gives code↔code (import closure), the v0.7.b `doc-refs` extractor gives doc→code, and `[[name]]`/`ADR-NNN`/markdown links give doc↔doc. v0.7.d composes those into one **file-level** bidirectional graph and walks it. **Advisory + ranked, never a hard gate** (strong edge = a direct import/reference/link; weaker = transitive) — a coupled-review *hint*, not a blocker that cries wolf. The optional n-ary *semantic* anchor (`@mmd:link <concept>`) and the Mermaid/.dot mind-map render are **deferred** (file-level + the diff check is ~80% of the value for ~20% of the cost).
>
> This is the structural answer to a pain v0.7.c just surfaced live: archiving the SPECs broke `documentalist-inventory.test.js` (it asserted root SPEC sprawl) — a coupled doc↔code↔test change a human had to catch *after* it broke. The coherence graph is exactly what would have flagged "you moved the SPECs; that test references the SPEC sprawl — review it" *before* the break.

---

## 1. Goal of v0.7.d

```
$ mmd document-review --since main
  ## Coupled changes (staleness — review the neighbors of what you changed)
  _Derived graph, advisory + ranked. Coupling ≠ certainty — review, don't obey._

  Changed in this diff (7 files):
  - lib/discover/classify.js
      → review (strong): test/unit/classify-brownfield.test.js   [imports]
      → review (strong): docs/adr/032-...md                       [doc→code ref]
      → review (weak):   docs/coherence-review.md                 [transitive]
  - lib/documentalist/inventory.js
      → review (strong): test/integration/documentalist-inventory.test.js [imports]
      → review (strong): docs/specs/SPEC_V07A.md                  [doc→code ref]

  3 changed files have no coupled neighbors (no edges) — likely self-contained.
```

Deliverables:
1. **Doc↔doc link extractor** (`lib/documentalist/doc-links.js`): a pure function pulling inter-doc edges from a doc's text — `[[name]]` wiki-links, `ADR-NNN` references (→ `docs/adr/NNN-*.md`), and relative markdown links to other tracked docs. Pure, never throws.
2. **Coherence graph builder** (`lib/documentalist/coherence-graph.js`): a pure `buildCoherenceGraph({ importEdges, docToCodeEdges, docLinkEdges })` → a **file-level, bidirectional** adjacency (each edge tagged with its `kind`: `import` / `doc-ref` / `doc-link`). Deterministic, never throws. Plus a pure `coupledNeighbors(graph, changedFiles)` → for each changed file, its neighbors **ranked by edge strength** (direct strong edge first; transitive/weak last), de-duplicated, excluding the changed files themselves.
3. **`mmd document-review --since <ref>`** (`bin/documentalist/document-review.js`): computes the changed files (`git diff --name-only <ref>`), builds the graph from the three derived edge sources (reusing `computeBlastRadius` for imports + the v0.7.b `doc-refs` extractor for doc→code + the new `doc-links` for doc↔doc), walks it, and prints a **"Coupled changes"** report to **stdout** — advisory, ranked, naming the edge kind. **Read-only** (writes nothing; `--since` is a query, it does NOT rewrite `docs/coherence-review.md`). Without `--since`, `mmd document-review` behaves **byte-for-byte as today** (the full dashboard).
4. **Live validation**: on a real diff (e.g. the v0.7.c commit that moved the SPECs + touched the inventory test), the check surfaces the coupled neighbors (the test ↔ the code ↔ the SPEC) that a human had to find manually. DoD-captured.

**Mission validation**: `mmd document-review --since <ref>` on a diff that changed `lib/discover/classify.js` reports its coupled neighbors — the test that imports it, the ADR that references it — ranked, advisory, on stdout, writing nothing; a self-contained change reports no neighbors; the plain `mmd document-review` is unchanged. The owner can now ask, before merging, "what else does this change touch?" and get a derived, honest answer.

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: doc↔doc link extractor (pure)
**Given** a doc's text
**When** `extractDocLinks(text, { docPath })` runs
**Then**: it returns the inter-doc edges it asserts — `[[name]]` wiki-links, `ADR-NNN` (→ `docs/adr/NNN-*.md`), and relative markdown links (`](../foo.md)`, `](docs/specs/SPEC_V06A.md)`) to other docs — each as a `{ to, kind: 'doc-link' }` (resolved to a repo-relative path where determinable). Pure, never throws; non-doc/odd input → empty. Conservative (don't invent edges for unresolvable targets — those are the v0.7.b drift detector's job, not the graph's).
Tag: `@unit` (wiki / ADR / md-link / unresolvable forms).

### AC-2: coherence graph builder + neighbor walk (pure, bidirectional, ranked)
**Given** the three edge sets (import / doc→code / doc↔doc)
**When** `buildCoherenceGraph(...)` then `coupledNeighbors(graph, changedFiles)` run
**Then**: the graph is a **file-level bidirectional** adjacency (an edge A→B is walkable A↔B; each edge keeps its `kind`); `coupledNeighbors` returns, per changed file, its neighbors **ranked** — direct strong edges (`import`, `doc-ref`, `doc-link`) before transitive/weak — de-duplicated, excluding the changed set. Pure, deterministic, never throws; empty graph / no changes → empty result; a changed file with no edges → reported as "no neighbors".
Tag: `@unit` (bidirectionality; ranking; transitive; isolated node; dedup).

### AC-3: `mmd document-review --since <ref>` — staleness report, read-only
**Given** `mmd document-review --since <ref>`
**When** it runs
**Then**: it computes changed files via `git diff --name-only <ref>` (injected/seam-testable), builds the graph from the three derived sources (`computeBlastRadius` imports + `doc-refs` doc→code + `doc-links` doc↔doc), walks it, and prints a **"Coupled changes"** report to stdout — per changed file, its ranked coupled neighbors with the edge kind, plainly framed as advisory ("coupling ≠ certainty"). It **writes nothing** (does NOT touch `docs/coherence-review.md`; assert the tree is unchanged after a `--since` run). A bad/unknown `<ref>` → honest non-zero error, not a crash. Without `--since`, output + the written dashboard are **byte-for-byte today's** (back-compat, asserted).
Tag: `@integration` (fixture repo + a known diff → expected neighbors; `--since` writes nothing; no-flag unchanged).

### AC-4: live validation on a real MMD diff — DoD gate
**Given** the MMD repo
**When** `mmd document-review --since <ref>` runs against a diff that touched a `lib/` file with known couplings (e.g. the v0.7.c change to `lib/documentalist/inventory.js` + the SPEC moves)
**Then**: the report surfaces the genuine coupled neighbors — the test that imports the changed module, the ADR/SPEC that references it — that a human otherwise finds only after something breaks (as happened in v0.7.c). The precision holds (no absurd neighbors); isolated changes report none. Captured in HANDOVER as proof the graph couples reality.
Tag: `@e2e`/`@integration` (real diff → real coupled neighbors).

### AC-5: docs + ADR
**Given** v0.7.d ships
**When** docs are read
**Then**: a new ADR documents the coherence graph — derive-never-maintain; the three free edge sources (reusing blast-radius + the v0.7.b extractor + the new doc-links); file-level granularity first (symbol/`@mmd:link`/mind-map deferred); advisory-ranked, never a hard gate; and that it would have caught the v0.7.c coupled-test break. `README.md` + `CLAUDE.md` document `mmd document-review --since`. `mmd document-readme --tests N` + `mmd handover --tests N` refresh the mechanical blocks (drift green).
Tag: `@unit` anchors (ADR/README markers).

---

## 3. Architecture (incremental)

```
lib/documentalist/doc-links.js        NEW — pure extractDocLinks(text,{docPath}) → doc↔doc edges ([[ ]] / ADR-NNN / md links)
lib/documentalist/coherence-graph.js  NEW — pure buildCoherenceGraph({importEdges, docToCodeEdges, docLinkEdges}) + coupledNeighbors(graph, changed)
bin/documentalist/document-review.js  MODIFY — add `--since <ref>`: git diff → build graph (reuse computeBlastRadius + doc-refs + doc-links) → walk → print "Coupled changes" to stdout (writes nothing). No-flag path unchanged.
lib/sealed-tests/import-graph.js      REUSE — computeBlastRadius supplies the code↔code import edges
lib/documentalist/doc-refs.js         REUSE — v0.7.b extractor supplies the doc→code edges
docs/adr/0NN-*.md                     NEW — coherence-graph ADR (derive-not-maintain; deferred symbol/anchor/mind-map)
README.md / CLAUDE.md / HANDOVER.md   MODIFY
package.json                          MODIFY — 0.7.3
```

### Files modified / added
```
make-my-dreams/
├── lib/documentalist/doc-links.js                       # NEW — pure doc↔doc edges
├── lib/documentalist/coherence-graph.js                  # NEW — pure graph + neighbor walk
├── bin/documentalist/document-review.js                  # modified — --since staleness mode (read-only)
├── test/unit/documentalist-doc-links.test.js              # NEW — AC-1
├── test/unit/documentalist-coherence-graph.test.js         # NEW — AC-2
├── test/integration/document-review-since.test.js           # NEW — AC-3/AC-4 (diff → neighbors; --since writes nothing; no-flag unchanged)
├── docs/adr/0NN-coherence-graph-staleness.md                # NEW
├── README.md / CLAUDE.md / HANDOVER.md                       # modified
└── package.json                                             # modified — 0.7.3
```

---

## 4. Out of scope for v0.7.d (→ later)
- ❌ **Symbol-level granularity** (function/export nodes) — file-level first; symbol resolution is a later refinement.
- ❌ **The `@mmd:link <concept>` semantic anchor** — the opt-in n-ary coupling for blocks with no derivable edge. Add on top of file-level later.
- ❌ **Mermaid/.dot mind-map render** — the visual map; deferred (the diff check is the actionable core). Comes after.
- ❌ **git co-change edges** (empirical "these files historically change together") — a weak-edge enrichment for later.
- ❌ **A hard pre-commit/CI gate** — v0.7.d is advisory only (a report). Gating is a separate, opt-in decision.
- ❌ **Auto-updating the coupled docs** — it flags neighbors to review; correcting them is human/`--with-claude` work (detect-before-correct).
- ❌ **Scale assumption**: a repo of a few hundred files — the import closure + doc scan is bounded; one diff at a time.

## 5. Implementation hints (for auto-dev)
1. Read this SPEC; `lib/sealed-tests/import-graph.js` (`computeBlastRadius` — the code↔code edges; it resolves module specifiers + reverse-closure); the v0.7.b `lib/documentalist/doc-refs.js` (doc→code edges — file-path refs); `bin/documentalist/document-review.js` (where `--since` slots in — keep the no-flag dashboard path untouched).
2. Keep `doc-links.js` + `coherence-graph.js` PURE (text/edges in, graph/neighbors out). The subcommand does git + fs.
3. Bidirectional: store each edge both ways (or symmetrize at walk time) so "doc references code" surfaces when EITHER endpoint changes. Rank: direct strong edge (`import`/`doc-ref`/`doc-link`) > transitive/weak. Keep ranking simple + documented.
4. `--since`: `git diff --name-only <ref>` (inject the runner for tests). Print the "Coupled changes" report to **stdout only** — `--since` is a query, it must NOT rewrite `docs/coherence-review.md` (assert clean tree after). Bad ref → honest non-zero.
5. The no-flag `mmd document-review` MUST stay byte-for-byte today's (assert it). `--since` is purely additive.
6. Advisory framing is mandatory (universal §VI): the report says coupling ≠ certainty, review don't obey. Precision-first (no absurd neighbors) — same discipline as v0.7.b.
7. Operational rules for the slice launch: `MMD_TIMEOUT_MS=0`, commit incrementally per AC, spec-frozen directive; do NOT cite a to-be-created `docs/adr/*.md` path literally (describe as "a new ADR in the ADR folder").
8. Constitution bindings: universal (§I SRP — two pure modules + a flag, §II KISS — file-level + derive-not-maintain, symbol/anchor/mind-map deferred, §VI honesty — advisory/ranked, precision-first, §VII readable coupled-changes report), ai-coding, commit-git, testing (tag every test; red-green; fixtures), error-handling (pure builders never throw; bad ref → honest error), documentation, brownfield.

## 6. Definition of done
1. All 5 ACs met (AC-4 is the live coupling gate).
2. Full suite passes (current 1626 + new tests).
3. `mmd document-review --since <ref>` prints a ranked, advisory "Coupled changes" report from the derived graph, writing nothing; the no-flag path is unchanged; a bad ref errors honestly.
4. On a real MMD diff, the report surfaces genuine coupled neighbors (the test↔code↔ADR/SPEC links) — the kind a human had to chase manually after the v0.7.c break.
5. README + CLAUDE.md + the new ADR in place; `mmd document-readme --tests N` (drift green) + `mmd handover --tests N` run.
6. Version bumped to `0.7.3`.
7. Slice merged (ff-only) + tag `v0.7.3`.
8. 32nd reflexive use of `mmd --here`. The Documentalist now sees **coupling**: change a node, learn which doc/code/ADR neighbors to review — derived from edges that already exist, advisory, never a gate. The mind-map render + semantic `@mmd:link` + symbol granularity are the trusted-next enrichments.

---

*Spec v0.7.d — the coherence graph: `mmd document-review --since <ref>` walks a file-level bidirectional graph (derived for free from import closure + doc→code refs + doc↔doc links) and reports the coupled neighbors of what a diff changed — advisory, ranked, read-only. Change one node, know which others to review. Mind-map render, semantic anchors, and symbol granularity are deferred.*
