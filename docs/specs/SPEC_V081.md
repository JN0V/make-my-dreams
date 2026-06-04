# Make My Dreams — v0.8.1 Spec: polyglot import graph (§VIII debt — blast-radius + coherence-graph code edges)

> v0.8.0 made the **Test Curator** polyglot. The same JavaScript-only correctness failure (constitution **§VIII**) still lives in MMD's **code-dependency analysis**: `computeBlastRadius` (`lib/sealed-tests/import-graph.js`, ADR-027) parses JS `import`/`require` specifiers, and the **coherence graph** (`lib/documentalist/coherence-graph.js`, the `--since` code↔code edges) is built on it. On a **Rust / Python / Go / C** repo, the blast radius (used by the sealed-test gate) and the coherence graph's code edges would be **wrong or empty** — silently. This slice makes the import graph **adapter-based** per §VIII, reusing the exact pattern the Curator just proved.
>
> **The shape:** a per-language **import-edge extractor** registry (`lib/code-graph/adapters/`) — given a code file, return the repo files it imports. The existing JS logic becomes the **JS adapter** (zero behavior change — the sealed gate's blast radius on MMD stays byte-for-byte). A **Python adapter** proves genericity (`import x` / `from x import …` resolution). `computeBlastRadius`'s **reverse-closure math stays generic** (it operates on edges, not syntax). Unlike the Curator's whole-repo refuse, a graph spans a **mixed** repo, so the honesty rule is **per-file**: a JS file → JS edges, a Python file → Python edges, an **unsupported file (Rust/C/…) → NO edges, and the graph honestly declares it left those files un-analyzed** (capability honesty, §VI) — never a fabricated or silently-empty edge set passed off as complete.
>
> Scope is the import graph + its two consumers (blast-radius, coherence-graph code edges). The **doc→code ref extractor** (`doc-refs.js`, also JS-leaning) is a separate, lighter follow-up (it matches file-path tokens in prose, less language-bound). Coverage stays deferred (v0.8.0 §4).

---

## 1. Goal of v0.8.1

```
computeBlastRadius / coherence-graph code edges  →  per-file language adapter  →  generic graph

  a.js imports b.js      → JS adapter      → edge a.js → b.js   (unchanged; sealed-gate regression lock)
  m.py imports pkg/u.py  → Python adapter  → edge m.py → pkg/u.py
  main.rs (use foo)      → no adapter yet   → NO edge + recorded as "un-analyzed (Rust)" — NOT a fake/empty-as-complete
  mixed JS+Python repo   → both adapters    → edges for both, graph notes coverage
```

Deliverables:
1. **Import-edge adapter contract + registry** (`lib/code-graph/adapters/`): each adapter exposes `id`, `matches(filePath)` (by extension/heuristic), and `importEdges({ filePath, content, repoFiles })` → the repo-relative file paths this file imports (resolved; unresolvable/external → dropped). A registry picks a file's adapter; a file with no adapter is reported as **un-analyzed** (its language recorded), contributing no edges.
2. **JS adapter** (`lib/code-graph/adapters/javascript.js`): the EXISTING `import-graph.js` specifier-parse + resolution logic, moved behind the contract — **no behavior change**: `computeBlastRadius` on MMD returns the same reverse closure, and the **sealed-test gate is unaffected** (the regression lock). All JS specifier syntax/resolution lives HERE.
3. **Generic blast-radius core** (`lib/sealed-tests/import-graph.js` refactor): builds the forward edge set by dispatching each file to its adapter, then computes the **transitive reverse closure** generically (no syntax). Returns the closure **plus** an honest `unanalyzed` list (files whose language has no adapter) so callers know the graph's coverage. The sealed-gate caller keeps working (JS repo → identical result + empty `unanalyzed`).
4. **Coherence-graph code edges use it** (`lib/documentalist/coherence-graph.js` / the `--since` path): the code↔code edges come from the polyglot graph; the report honestly notes any un-analyzed languages ("code coupling for <stack> not available — no import adapter yet") instead of silently missing them.
5. **Python adapter** (`lib/code-graph/adapters/python.js`) — the proof: resolves `import a.b` and `from a.b import …` to repo files (package/dir/`__init__.py` heuristics), drops stdlib/external. A mixed JS+Python fixture yields edges for both; a Rust file is recorded un-analyzed, not faked.
6. **Docs + ADR**: the polyglot import-graph adapter architecture, §VIII compliance, the per-file capability-honesty model (un-analyzed list, never fake-complete), JS regression lock, doc-refs + coverage still owed.

**Mission validation**: `computeBlastRadius` on MMD (JS) → identical to today, sealed gate unaffected; on a fixture Python repo → real reverse closure from `import`/`from`; on a fixture mixed repo → both; on a fixture with a Rust file → that file in `unanalyzed`, no fabricated edges. `mmd document-review --since` on MMD → unchanged; the code-edge path is now polyglot-ready and honest about coverage.

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: import-edge adapter contract + registry
**Given** a repo's files
**When** the registry resolves a file's adapter
**Then**: a documented contract (`id`, `matches(filePath)`, `importEdges({filePath, content, repoFiles})` → repo-relative imported paths) exists; the registry returns the matching adapter or `null`; a file with no adapter is classified **un-analyzed** with its detected language/extension. Pure where practical (injected file set).
Tag: `@unit` (JS file → JS adapter, .py → Python, .rs → none/un-analyzed).

### AC-2: JS adapter — no behavior change (sealed-gate regression lock)
**Given** the MMD repo (JavaScript)
**When** `computeBlastRadius` runs through the JS adapter
**Then**: the reverse closure for any changed-file set is **identical** to v0.8.0 (assert on representative inputs), and the **sealed-test pipeline that consumes blast radius is unaffected** (its tests still pass). All JS specifier parsing + `./`/`../`/extension resolution lives in `adapters/javascript.js`, not the core.
Tag: `@unit` (closure parity on fixtures) + `@integration` (sealed-gate tests green).

### AC-3: generic blast-radius core + honest `unanalyzed`
**Given** files dispatched to adapters
**When** `computeBlastRadius` builds + closes the graph
**Then**: the forward edges come only from adapters (core has no language syntax); the transitive reverse closure is computed generically; the result includes an honest **`unanalyzed`** set (files whose language has no adapter). A JS-only repo → same closure as today + empty `unanalyzed` (back-compat for the existing caller). The core imports no adapter (core ← adapters).
Tag: `@unit` (generic closure on synthetic edges; un-analyzed files surfaced, not silently dropped-as-complete).

### AC-4: coherence-graph code edges are polyglot + honest
**Given** `mmd document-review --since <ref>`
**When** the code↔code edges are built
**Then**: they use the polyglot import graph; on MMD (JS) the output is unchanged; the report honestly notes any un-analyzed languages in the diff ("code coupling for <stack> not available — no import adapter yet") rather than silently omitting them. No behavior change for an all-JS diff (asserted).
Tag: `@integration` (MMD `--since` unchanged; a Python-file diff surfaces Python code edges; an un-analyzed file is noted).

### AC-5: Python adapter — genericity proven
**Given** a Python repo
**When** `computeBlastRadius` / the code-edge path runs
**Then**: the Python adapter resolves `import a.b` and `from a.b import x` to repo files (dir/package/`__init__.py` heuristics; stdlib/external dropped), yielding a real reverse closure; a mixed JS+Python fixture yields edges for both languages; a Rust/C file is recorded `unanalyzed`, never faked. Proves the graph core is language-neutral.
Tag: `@integration` (Python fixture → real closure) + `@unit` (Python import resolution).

### AC-6: docs + ADR
**Given** v0.8.1 ships
**When** docs are read
**Then**: a new ADR documents the polyglot import-graph adapter architecture (§VIII), the per-file capability-honesty (`unanalyzed`, never fake-complete), the JS regression lock + sealed-gate safety, and that doc→code refs + coverage are the remaining §VIII items. `README.md` + `CLAUDE.md` note the blast-radius/coherence-graph are now polyglot (ADR-027/037 cross-ref). `mmd document-readme --tests N` + `mmd handover --tests N` refresh.
Tag: `@unit` anchors.

---

## 3. Architecture (incremental)

```
lib/code-graph/adapters/
  index.js          NEW — contract + registry (adapterFor(filePath) → adapter|null)
  javascript.js     NEW — existing import-graph specifier parse + resolution, behind the contract (no behavior change)
  python.js         NEW — import/from resolution to repo files (proof)
lib/sealed-tests/import-graph.js   REFACTOR — computeBlastRadius dispatches per-file to adapters; generic reverse closure; returns { closure, unanalyzed }
lib/documentalist/coherence-graph.js  MODIFY — code↔code edges via the polyglot graph; honest un-analyzed note
docs/adr/0NN-*.md   NEW — polyglot import graph (§VIII)
README.md / CLAUDE.md / HANDOVER.md / package.json   MODIFY — 0.8.1
```

### Files modified / added
```
make-my-dreams/
├── lib/code-graph/adapters/{index,javascript,python}.js   # NEW — contract + registry + 2 adapters
├── lib/sealed-tests/import-graph.js                       # refactor — generic core + per-file dispatch + unanalyzed
├── lib/documentalist/coherence-graph.js                   # modified — polyglot code edges + honest note
├── test/unit/code-graph-adapters.test.js                   # NEW — AC-1/AC-2/AC-5 (registry + JS parity + Python)
├── test/integration/blast-radius-polyglot.test.js           # NEW — AC-3/AC-5 (Python closure, mixed, Rust un-analyzed)
├── docs/adr/0NN-polyglot-import-graph.md                    # NEW
├── README.md / CLAUDE.md / HANDOVER.md                      # modified
└── package.json                                            # modified — 0.8.1
```

---

## 4. Out of scope for v0.8.1 (→ follow-ups)
- ❌ **doc→code ref extractor polyglot** (`doc-refs.js`) — lighter (path-token matching in prose); next §VIII follow-up.
- ❌ **Coverage** — still deferred + must be polyglot when built (v0.8.0 §4).
- ❌ **More import adapters** (Rust `use`/`mod`, Go `import`, C `#include`) — each a new `adapters/<lang>.js`; ship JS + Python now; others land `unanalyzed` honestly until added.
- ❌ **Sealed-gate behavior change** — the blast radius MUST stay identical for JS (the gate is correctness-critical); this slice only changes HOW edges are produced, not the gate.
- ❌ **Scale assumption**: bounded per-file parse; same order as today's JS import graph.

## 5. Implementation hints (for auto-dev)
1. Read this SPEC + constitution **universal §VIII** + `lib/sealed-tests/import-graph.js` (the JS logic to move + the reverse-closure to keep generic) + `lib/documentalist/coherence-graph.js` (the code-edge consumer). The JS path is a **regression lock** — AC-2: identical blast radius + sealed-gate tests green.
2. Dependency direction: **core ← adapters** (import-graph core + coherence-graph never import a specific adapter; go through the registry). The reverse-closure algorithm is pure graph math — no language tokens.
3. Per-file honesty (§VI/§VIII): a file with no adapter goes into `unanalyzed` (with its language), contributes NO edges, and the result/report SAYS so. Never silently treat an incomplete graph as complete (that's the failure mode this whole §VIII line fixes).
4. The Python adapter is the proof — resolve `import a.b` / `from a.b import x` to repo files via dir/`__init__.py`/`.py` heuristics; drop stdlib/external (unresolvable under the repo). A fixture Python repo must yield a real reverse closure.
5. Keep `computeBlastRadius`'s existing public shape working for the sealed-gate caller (add `unanalyzed` additively; default-empty for JS).
6. Operational rules for the slice launch: `MMD_TIMEOUT_MS=0`, commit incrementally per AC, spec-frozen directive; do NOT cite a to-be-created `docs/adr/*.md` path literally.
7. Constitution bindings: universal (**§VIII headline**, §I SRP core/adapters, §VI honesty — `unanalyzed` never fake-complete, §VII readable notes), ai-coding, commit-git, testing (tag every test; red-green; JS regression lock + Python + mixed + Rust-unanalyzed fixtures; sealed-gate green), error-handling (unresolvable import → dropped, never throws), documentation, security (sealed-gate correctness preserved), brownfield.

## 6. Definition of done
1. All 6 ACs met (AC-2 JS-unchanged + sealed-gate green is the gate).
2. Full suite passes (current 1782 + new tests).
3. `computeBlastRadius` on MMD → identical reverse closure; sealed-test pipeline unaffected. A fixture Python repo → real closure; a mixed repo → both; a Rust file → `unanalyzed`, no fake edges. `mmd document-review --since` on MMD → unchanged; honest about un-analyzed languages.
4. The import-graph core + coherence-graph import NO adapter and contain NO language syntax; JS specifics live in `adapters/javascript.js`.
5. README + CLAUDE.md + the new ADR in place; `mmd document-readme --tests N` + `mmd handover --tests N` run.
6. Version bumped to `0.8.1`.
7. Slice merged (ff-only) + tag `v0.8.1`.
8. The import graph (blast-radius + coherence-graph code edges) is technology-agnostic per §VIII — proven on Python, honest on the unsupported, JS unchanged. Remaining §VIII debt: the doc→code ref extractor, then coverage (both queued in HANDOVER).

---

*Spec v0.8.1 — polyglot import graph: a per-language import-edge adapter registry (JS refactored in place with zero behavior change + sealed-gate regression lock; a real Python adapter proving genericity), `computeBlastRadius` made generic with an honest `unanalyzed` list (never a silently-incomplete graph passed as complete), and the coherence-graph code edges threaded through it. Closes the blast-radius / coherence-graph half of the §VIII debt; doc-refs + coverage remain.*
