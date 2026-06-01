# Make My Dreams — v0.4.c Spec: import-graph blast radius (upgrade the grep stub)

> v0.4.a shipped `computeBlastRadius` as a deliberate **grep stub**: it matches filename *fragments* inside import/require lines, so it both over-counts (a filename merely mentioned in a comment or string) and under-counts (no transitive reach, no path resolution). v0.4.c replaces it with an **import-graph-accurate** analysis: parse the actual module **specifiers** (`import … from 'x'`, `import 'x'`, `export … from 'x'`, `require('x')`, dynamic `import('x')`), **resolve** each relative specifier to a concrete repo file (`./`, `../`, extension + `/index` resolution; bare/`node:`/npm specifiers ignored), build the import graph, and compute the **transitive reverse closure** — every file that imports a changed file directly OR through a chain. That is the true P-05 blast radius. **No external parser dependency** (acorn/babel): the repo is strict vanilla-stack (zero deps; hand-rolled YAML twice), so v0.4.c uses targeted specifier extraction + module resolution rather than a full AST — honestly named "import-graph accurate", not "full AST". The ADR documents exactly what that catches and the few exotic forms it does not (computed/runtime specifiers).

---

## 1. Goal of v0.4.c

Replace the fragment-grep stub with a resolved, transitive import graph:

```
changed = [lib/app.js]
  parse specifiers of every repo file  →  resolve to concrete files  →  import graph
  reverse-closure from `changed`        →  every file that (transitively) imports lib/app.js
  = the blast radius  (logged to status.json.blast_radius)
```

Deliverables:
1. **`lib/sealed-tests/import-graph.js`** (NEW, pure over injected fs):
   - `parseSpecifiers(text)` — extract module specifier strings from static `import`/`export … from`, side-effect `import 'x'`, `require('x')`, and dynamic `import('x')`. Best-effort line/segment parsing (no AST dep); ignores obvious non-imports.
   - `resolveSpecifier(fromFile, specifier, fileSet)` — resolve a RELATIVE specifier (`./`, `../`) against `fromFile`'s dir to a repo-relative path present in `fileSet`, trying the literal path, `+.js/.mjs/.cjs`, and `/index.{js,mjs,cjs}`. Returns the resolved repo-relative file or `null` for bare/`node:`/npm/unresolvable specifiers.
   - `buildImportGraph(files, readFile)` — `{ file: Set<resolvedImport> }` over all files; tolerant of unreadable files (skipped).
2. **`computeBlastRadius` upgraded** (`lib/sealed-tests/blast-radius.js`): build the graph, then return the **transitive reverse closure** of the changed set. Result shape `{ changed, importers, transitive }` where `importers` = DIRECT importers (one hop) and `transitive` = the full reverse closure (the blast radius); cycle-safe (visited set, no infinite loop); honest empty/unavailable → empty lists, never a crash. The orchestration logs `transitive` as the blast radius to `status.json.blast_radius`.
3. **Accuracy over the stub** — no false hit on a filename in a comment/string (only real resolved imports count); catches transitive importers the stub missed; resolves `./x` vs `../x` correctly (no basename collisions).

**Not in this slice** (documented limits, not bugs): a full AST parser / external dep; computed or runtime-built specifiers (`import(\`./\${name}.js\`)`); re-export aliasing through computed names; non-JS importers. These are stated in the ADR as the residual gap of the no-dep approach.

**Mission validation**: for a changed `lib/a.js` imported by `lib/b.js` which is imported by `lib/c.js`, `computeBlastRadius(['lib/a.js'])` returns `transitive = [lib/b.js, lib/c.js]` (both, via the chain) and `importers = [lib/b.js]` (direct only); a file that only mentions `"a.js"` in a comment is NOT included.

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: `parseSpecifiers` extracts real module specifiers
**Given** source text
**When** `parseSpecifiers(text)` runs
**Then**: it returns the specifier strings from `import x from 'spec'`, `import {…} from "spec"`, `import 'spec'`, `export … from 'spec'`, `require('spec')`, and dynamic `import('spec')` (single OR double quotes); a filename mentioned only in a comment or an unrelated string is NOT returned; it never throws on odd input (returns `[]`).
Tag: `@unit`.

### AC-2: `resolveSpecifier` resolves relative specifiers to concrete files
**Given** a `fromFile`, a specifier, and the set of repo files
**When** `resolveSpecifier` runs
**Then**: a relative specifier resolves against `fromFile`'s directory, trying the literal path, then `+.js/.mjs/.cjs`, then `/index.{js,mjs,cjs}`, returning the matching repo-relative file from the set; `./a` and `../a` resolve to DIFFERENT files (no basename collision — the stub's main inaccuracy); a bare specifier (`fs`, `lodash`), a `node:` specifier, or an unresolvable relative path returns `null`.
Tag: `@unit`.

### AC-3: `buildImportGraph` + transitive reverse closure (cycle-safe)
**Given** a set of files + a reader
**When** the graph is built and the reverse closure from a changed set is computed
**Then**: `buildImportGraph` maps each file to its resolved imports; the reverse closure returns every file that imports a changed file directly or through a chain (A←B←C all surface for a change to A); an import CYCLE does not cause an infinite loop (visited-set guard); unreadable files are skipped, never fatal.
Tag: `@unit`.

### AC-4: `computeBlastRadius` upgraded + integrated
**Given** changed files + injected `{ listFiles, readFile }`
**When** `computeBlastRadius` runs
**Then**: it returns `{ changed, importers, transitive }` — `importers` the direct one-hop importers, `transitive` the full reverse closure (blast radius); it uses RESOLVED imports (no fragment false-positives: a comment mentioning the filename is excluded; `./x` and `../x` not conflated); empty/unavailable input → empty lists (never throws — §VI); the sealed orchestration logs `transitive` to `status.json.blast_radius`. The v0.4.a blast-radius test is updated to the resolved semantics.
Tag: `@unit` + `@integration` (sealed run logs the upgraded blast radius).

### AC-5: Docs + ADR (+ lesson)
**Given** v0.4.c ships
**When** the docs are read
**Then**: an ADR numbered 027 documents the import-graph blast radius — why **import-graph resolution over a full-AST external dep** (vanilla-stack §II KISS, zero-deps convention, the YAML-lite precedent), the transitive-reverse-closure definition, and the **explicit residual gap** (computed/runtime specifiers, re-export aliasing, non-JS); `docs/lessons-learned.md` MAY gain an **L-024** entry ("resolved import-graph beats fragment-grep for impact; a full AST wasn't worth a dep"); `README.md`/`CLAUDE.md` note the upgrade.
Tag: `@unit` anchors.

---

## 3. Architecture (incremental)

```
lib/sealed-tests/import-graph.js   NEW — parseSpecifiers + resolveSpecifier + buildImportGraph + reverseClosure (pure)
lib/sealed-tests/blast-radius.js   MODIFY — computeBlastRadius uses the import graph; returns {changed, importers, transitive}
bin/mmd.js (sealed pipeline)       MODIFY (minimal) — log `transitive` as status.json.blast_radius
```

### Files modified / added
```
make-my-dreams/
├── lib/sealed-tests/import-graph.js                 # NEW
├── lib/sealed-tests/blast-radius.js                 # modified — resolved + transitive
├── test/unit/sealed-tests-import-graph.test.js      # NEW — AC-1/2/3
├── test/unit/sealed-tests-blast-radius.test.js      # modified — resolved semantics + transitive (AC-4)
├── test/integration/sealed-run.test.js              # modified if it asserts blast shape
├── docs/adr/027-import-graph-blast-radius.md         # NEW
├── docs/lessons-learned.md                          # modified (optional L-024)
├── README.md / CLAUDE.md                            # modified — note the upgrade
└── package.json                                      # modified — 0.4.2 (NO new dependency)
```

---

## 4. Out of scope for v0.4.c
- ❌ A full AST parser or ANY external dependency (vanilla-stack — `package.json` deps MUST stay empty).
- ❌ Computed/runtime specifiers, re-export aliasing through computed names, non-JS importers (documented residual gap, not bugs).
- ❌ Using the blast radius to GATE a run (it stays advisory, logged — same as v0.4.a).
- ❌ The other remaining v0.4.x candidates (Standard-default `--sealed`; LLM-as-judge oracle).
- ❌ **Scale assumption**: builds the graph over the repo/demo's JS files per run (hundreds, fine). A very large monorepo would warrant caching — not now.

## 5. Implementation hints (for auto-dev)
1. Read SPEC_V04C.md (this) and the current `lib/sealed-tests/blast-radius.js` stub it replaces (keep its honest-empty / never-throw contract + the injected `{ listFiles, readFile }` shape).
2. Keep everything PURE over injected fs (no `node:fs` in these modules) — unit tests use in-memory file maps, mirroring the existing sealed-tests unit style.
3. `parseSpecifiers`: targeted regexes for the five forms (static import, side-effect import, export-from, require, dynamic import), single+double quotes; do NOT attempt a full AST. Strip line comments before matching to avoid commented-out imports counting.
4. `resolveSpecifier`: only RELATIVE specifiers (start with `.`) resolve; everything else (bare, `node:`, absolute) → null. Try literal, `+ext`, `/index+ext`. Normalize `\\`→`/`. Resolution is against `fileSet` membership (no real fs).
5. Reverse closure: invert the graph (importee → importers), BFS/DFS from the changed set with a visited set (cycle-safe). `importers` = depth-1; `transitive` = all reached.
6. Honest (§VI): unresolvable/odd input never throws; the ADR states the residual gap plainly (don't oversell "AST-accurate" — it's "import-graph accurate").
7. Constitution bindings: universal (§VI, §VII), ai-coding, commit-git, testing, error-handling, documentation, architecture.

## 6. Definition of done
1. All 5 ACs met.
2. Full suite passes (current 1343 + new tests); `package.json` deps stay EMPTY (no parser added).
3. `computeBlastRadius` returns resolved direct + transitive importers; a comment-only mention is excluded; `./x` vs `../x` not conflated; a cycle does not hang; the sealed pipeline logs `transitive` to `status.json.blast_radius`.
4. README + CLAUDE.md + ADR-027 in place (residual gap documented).
5. Version bumped to `0.4.2`.
6. Slice merged (ff-only) + tag `v0.4.2`.
7. 22nd reflexive use of `mmd --here` (9th with `--label`). P-05 impact mapping is now resolved + transitive (no dep) — the blast-radius stub graduates to import-graph accurate.

---

*Spec v0.4.c — upgrade `computeBlastRadius` from a fragment-grep stub to import-graph accuracy: parse + resolve module specifiers, build the import graph, return the transitive reverse closure (the true P-05 blast radius). No external parser dependency (vanilla-stack); the residual gap (computed/runtime specifiers) is documented, not hidden.*
