# Make My Dreams — v0.7.e Spec: cap hub-SOURCE neighbor floods in the coherence-graph staleness report

> v0.7.d shipped the coherence graph (`mmd document-review --since <ref>`): change a node, learn which doc/code/ADR neighbors to review — derived, advisory, ranked. It already has ONE hub precision lever: it does not **transit THROUGH** a high-degree hub node (a doc like `CLAUDE.md`/`HANDOVER.md` that cites dozens of ADRs) when expanding weak/transitive edges, so a change *near* a hub doesn't weak-flag the whole repo.
>
> But there is a symmetric gap v0.7.d left open: when the **changed file IS a hub** (you edit `CLAUDE.md` itself), *every one* of its dozens of direct references is reported as a `strong` neighbor. The "Coupled changes" report floods with 40+ "review (strong)" lines — which, per the v0.7.b discipline, is the same as flagging nothing. v0.7.e closes that gap: **cap the direct-neighbor flood from a hub source**, surfaced honestly (no silent truncation — universal §VI), and skip the (already-noisy) transitive layer for a hub source.

---

## 1. Goal of v0.7.e

```
$ mmd document-review --since main          # a diff that edited CLAUDE.md (a hub)
  ## Coupled changes (staleness — review the neighbors of what you changed)
  _Derived graph, advisory + ranked. Coupling ≠ certainty — review, don't obey._

  Changed in this diff (1 file), against `main`:
  - CLAUDE.md
      → review (strong): docs/adr/037-coherence-graph-staleness.md  [doc↔doc link]
      → review (strong): docs/adr/036-documentalist-active-compaction.md [doc↔doc link]
      … (top 12 shown)
      … +29 more direct neighbors suppressed (hub source — this file couples to
        much of the repo; reviewing all is noise, not a hint).
```

Deliverable: a precision refinement to the EXISTING pure walk + its renderer — no new module, no new subcommand.

1. **Hub-source cap in `coupledNeighbors`** (`lib/documentalist/coherence-graph.js`): when a changed file's direct-neighbor count exceeds the existing `HUB_DEGREE` threshold, it is a **hub source**. Report only the top `HUB_DEGREE` direct neighbors (by the existing deterministic ranking), record the number suppressed on the entry (`hubSuppressed`), and **skip transitive expansion** for that source (a hub source already floods — weak edges on top are pure noise). A non-hub source is **unchanged** (no `hubSuppressed` field; transitive layer intact). Pure, deterministic, never throws.
2. **Honest cap note in `renderCoupledChanges`** (`bin/documentalist/document-review.js`): when an entry carries `hubSuppressed > 0`, print a plain-language line naming the suppressed count and WHY (hub source) — never a silent truncation ("no silent caps", universal §VI / L-027 honesty discipline).

**Mission validation**: a `--since` diff that touches a hub doc reports at most `HUB_DEGREE` ranked direct neighbors plus an explicit "+N suppressed (hub source)" note, instead of flooding; a normal (non-hub) change is byte-for-byte unchanged from v0.7.d; the pure walk stays deterministic and never throws.

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: hub-source cap in the pure walk
**Given** a coherence graph in which a changed file has MORE than `HUB_DEGREE` direct neighbors
**When** `coupledNeighbors(graph, [hubFile])` runs
**Then**: the entry's `neighbors` is capped to the top `HUB_DEGREE` (by the existing strong-then-kind-then-path ranking — deterministic), the entry carries `hubSuppressed = (directNeighborCount − HUB_DEGREE)`, and NO transitive/weak neighbors are added for that source. A changed file with `≤ HUB_DEGREE` direct neighbors is UNCHANGED: no `hubSuppressed` field, transitive layer intact (back-compat with every existing AC-2 assertion).
Tag: `@unit` (hub at degree N>cap → capped + counted + no transitive; boundary at exactly `HUB_DEGREE` → not a hub; ranking of the kept top-N is deterministic).

### AC-2: honest cap note in the report
**Given** a `--since` run whose changed set includes a hub source
**When** `renderCoupledChanges` renders it
**Then**: after the (capped) neighbor list for that file, the report prints a plain-language line stating how many direct neighbors were suppressed and that the cause is a hub source (not silent truncation). A run with no hub source produces byte-for-byte the v0.7.d output (no note).
Tag: `@unit`/`@integration` (renderer emits the note for a hub entry; absent for a normal entry).

### AC-3: docs + ADR
**Given** v0.7.e ships
**When** docs are read
**Then**: an ADR records the hub-source cap (the symmetric counterpart to v0.7.d's hub-transit suppression; both are the same precision lever — a hub couples to too much to be an actionable hint). `CLAUDE.md` notes the refinement under the v0.7.d entry. `mmd document-readme --tests N` + `mmd handover --tests N` refresh the mechanical blocks (drift green).
Tag: `@unit` anchors (ADR/CLAUDE markers).

---

## 3. Architecture (incremental)

```
lib/documentalist/coherence-graph.js   MODIFY — coupledNeighbors: detect hub source, cap top-HUB_DEGREE, record hubSuppressed, skip transitive for it. Export HUB_DEGREE (test robustness).
bin/documentalist/document-review.js   MODIFY — renderCoupledChanges: print the honest "+N suppressed (hub source)" note.
test/unit/documentalist-coherence-graph.test.js  MODIFY — AC-1 (+ back-compat)
test/integration/document-review-since.test.js   MODIFY — AC-2 (hub fixture → capped + note)
docs/adr/0NN-*.md                       NEW — hub-source-cap ADR
CLAUDE.md / README.md / HANDOVER.md     MODIFY
package.json                            MODIFY — 0.7.4
```

---

## 4. Out of scope (→ later / unchanged from v0.7.d)
- ❌ Tuning `HUB_DEGREE` per-kind or making it configurable (YAGNI — one threshold, documented).
- ❌ Symbol-level granularity, the `@mmd:link` semantic anchor, the Mermaid/.dot mind-map, git co-change edges — all still deferred per SPEC_V07D §4.
- ❌ A hard gate — still advisory only.

## 5. Implementation hints (for auto-dev)
1. The cap belongs in the PURE `coupledNeighbors` (it is deterministic neighbor-selection, the same place hub-transit suppression already lives), NOT only in the renderer — so it is unit-testable and the renderer stays a thin display.
2. Detect the hub source from the direct-neighbor count (excluding co-changed files), BEFORE expanding transitive edges, and short-circuit the transitive loop for it.
3. Add `hubSuppressed` to the entry ONLY when capping occurred — every existing AC-2 `deepEqual` asserts entries of exactly `{ file, neighbors }`, so an unconditional field would break back-compat.
4. Honest note in the renderer (universal §VI): name the suppressed count + the reason. No silent truncation.
5. Keep the no-hub path byte-for-byte v0.7.d's (assert an ordinary `--since` run is unchanged).

## 6. Definition of done
1. AC-1..AC-3 met.
2. Full suite passes (current 1651 + new tests), red-green per new test.
3. A hub-source `--since` diff caps to `HUB_DEGREE` ranked neighbors + an honest suppressed-count note; a normal diff is unchanged.
4. ADR + CLAUDE.md in place; `mmd document-readme --tests N` (drift green) + `mmd handover --tests N` run.
5. Version bumped to `0.7.4`.
6. 33rd reflexive use of `mmd --here`.

---

*Spec v0.7.e — cap the hub-SOURCE neighbor flood in `mmd document-review --since`: when the changed file itself is a hub, show the top `HUB_DEGREE` ranked direct neighbors + an honest "+N suppressed" note and skip its transitive layer. The symmetric counterpart to v0.7.d's hub-transit suppression. Precision-first; advisory; never a gate.*
