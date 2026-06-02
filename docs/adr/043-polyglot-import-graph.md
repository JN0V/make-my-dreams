# ADR-043 — Polyglot import graph: a per-language import-edge adapter registry (§VIII)

**Status**: accepted
**Date**: 2026-06-02
**Slice**: v0.8.1 (polyglot import graph — blast-radius + coherence-graph code edges)

## Context

v0.8.0 (ADR-042) made the **Test Curator** polyglot and added constitution **§VIII
(technology-agnostic analysis, NON-NEGOTIABLE)**. The same JavaScript-only correctness
failure still lived in MMD's **code-dependency analysis**:

- `computeBlastRadius` (`lib/sealed-tests/blast-radius.js` + `import-graph.js`, ADR-027)
  parsed **JS** `import`/`require`/`export … from`/dynamic-`import()` specifiers and
  resolved `./`/`../`/`+ext`/`/index` against the repo file set.
- The **coherence graph** (`lib/documentalist/coherence-graph.js`, the `--since`
  code↔code edges, ADR-037) is built on that import graph.

On a **Rust / Python / Go / C** repo the blast radius (which the **sealed-test gate**
consumes) and the coherence graph's code edges would be **wrong or empty — silently**.
That is the §VIII failure: an analysis hard-wired to one language, fabricating or
silently-emptying a measurement that doesn't apply (a §VI honesty violation too).

Unlike the Test Curator (whole-repo, manifest-detected stack, refuse-if-unsupported), an
import graph spans a **mixed** repo and is decided **per file** — a JS file has JS edges,
a Python file has Python edges, a Rust file (no adapter) has none. So the honesty rule
here is **per-file capability**, not whole-repo refusal.

## Decision

Make the import graph **adapter-based**, reusing the v0.8.0 pattern: a **language-neutral
core** (the reverse-closure graph math) + per-language **import-edge adapters**. The
existing JS logic becomes the **JS adapter** with **zero behavior change** (the sealed-gate
regression lock). A real **Python adapter** proves genericity.

### The import-edge adapter contract (`lib/code-graph/adapters/index.js`)

Each adapter is a plain object:

- `id` / `displayName` / `language` — identity + human stack name.
- `matches(filePath) → boolean` — does this **file** belong to my stack? Decided by
  **extension** on the path (a per-file decision — the graph spans a mixed repo file by
  file — NOT a repo-level manifest like the Test Curator's adapters). PURE.
- `importEdges({ filePath, content, repoFiles }) → string[]` — the repo-relative files
  this file imports, **resolved** against `repoFiles`. Unresolvable / external / stdlib
  specifiers are **dropped** (not repo files). A file never imports itself. NEVER throws
  — odd input → `[]`.

The **registry** exposes `adapterFor(filePath)` (the matching adapter or `null`),
`unanalyzedLanguageFor(filePath)` (the language name for a recognized **code** file that
has no adapter, else `null`), and `classifyFile(filePath)`.

### Per-file capability honesty (the §VIII / §VI mechanism)

A file whose language has **no adapter** is **not** silently treated as having no
dependencies. It is classified **un-analyzed** with its detected language and contributes
**no edges**; the result carries an honest `unanalyzed: [{ file, language }]` list and the
caller **says so** ("code coupling for `<stack>` not available — no import adapter yet").
Emitting an empty edge set for a Rust file and passing the graph off as complete would be
the exact fabricated measurement §VIII forbids.

Crucially, `unanalyzedLanguageFor` is **scoped to recognized source-code extensions**
(`.rs`, `.go`, `.c`, `.ts`, …). A repo's `.md`/`.json`/`.yml` files are **not** code and
never enter the un-analyzed list — otherwise a JS-only repo's blast radius would be flooded
with non-code noise and the back-compat "empty `unanalyzed` for an all-JS repo" guarantee
would break.

### Generic core (`lib/sealed-tests/import-graph.js`)

The core now contains **no language syntax**. `buildForwardGraph(files, readFile)`
dispatches each file to its adapter (via the **registry** — the core imports **no specific
adapter**) for forward edges, and returns `{ graph, unanalyzed }`. `invertGraph` and
`reverseClosure` are unchanged pure graph math. `buildImportGraph` stays as a back-compat
wrapper returning just the graph. `computeBlastRadius` gains an **additive** `unanalyzed`
field; the existing caller (the sealed pipeline in `bin/mmd.js`) destructures
`changed`/`importers`/`transitive` and is unaffected.

**Dependency direction: core ← adapters ← registry ← callers.** All JS specifier syntax
lives in `adapters/javascript.js`; Python in `adapters/python.js`.

### The Python adapter (`lib/code-graph/adapters/python.js`) — the proof

Resolves `import a.b` and `from a.b import x` to repo files via dir / package /
`__init__.py` heuristics (relative leading-dot imports climb from the importer's dir; a
`from … import name` tries both the module and `name` as a submodule); stdlib / third-party
/ unresolvable specifiers drop as external. A fixture Python repo yields a real reverse
closure; a mixed JS+Python repo yields edges for both; a Rust file lands `unanalyzed`.

### Coherence-graph code edges (`document-review --since`)

`buildSinceCoupling` selects code files via the registry (JS + Python, …) instead of a
hard-wired `.js` glob, so the code↔code edges are polyglot. When the **diff** touches a
language with no adapter, the report appends an honest note. An all-JS diff (MMD itself) is
byte-for-byte unchanged. `coherence-graph.js` itself needed **no** structural change — it
already consumes resolved `{from,to}` edges and contains no syntax, which is the §VIII
property: the syntax lives in the adapters, never in the graph.

## The JS regression lock + sealed-gate safety

AC-2 is the gate. The JS adapter's `importEdges` is the **exact** old per-file parse +
resolve, so `computeBlastRadius` on MMD returns the **identical** reverse closure and the
sealed-test gate (which uses the blast radius advisorily) is unaffected. Pinned by:
closure-parity unit tests, the un-changed sealed-gate integration tests, and a JS-only
`unanalyzed: []` assertion.

## Consequences

- **The blast radius + coherence-graph code edges are now technology-agnostic** — proven on
  Python, honest on the unsupported (Rust/Go/C land `unanalyzed`, never faked), JS unchanged.
- **Zero new dependencies** (vanilla-stack, hand-rolled — the L-024 / YAML-lite bar): the
  Python adapter is targeted regexes + heuristic resolution, not a Python AST.
- **Adding a language = one adapter file + one registry entry**; the core never changes.

### Honest residual gaps (documented, not hidden — universal §VI; extends ADR-027)

- JS: computed/runtime specifiers, re-export aliasing through computed names (unchanged).
- Python: a `src/`-rooted package layout, namespace packages, and re-exports may not
  resolve (absolute imports resolve from the **repo root**); unresolved → dropped as
  external, never faked.
- Still **JS-specific and owed** under §VIII: the **doc→code ref extractor**
  (`lib/documentalist/doc-refs.js`, path-token matching in prose — a lighter follow-up) and
  **coverage** (deferred for all stacks; must be polyglot when built — each adapter driving
  its native tool to lcov/cobertura). Both are queued in HANDOVER.

## Alternatives considered

- **A full per-language AST/parser** (e.g. tree-sitter) — more accurate, but a heavyweight
  permanent dependency for an **advisory** graph that never gates a run. Rejected per L-024
  / universal §II (the hand-rolled-regex bar).
- **Leave it JS-only and document the limit** — rejected: §VIII makes a single-language
  analyzer a **correctness failure** when the mission is polyglot, not a documentable detail.
- **Whole-repo refuse (the Test Curator's model)** — wrong shape for a graph: a mixed repo
  must analyze the supported files and honestly flag the rest **per file**, not refuse the
  whole run.

See ADR-027 (import-graph blast radius), ADR-037 (coherence graph), ADR-042 (polyglot Test
Curator — the sibling §VIII fix), constitution **universal §VIII**.
