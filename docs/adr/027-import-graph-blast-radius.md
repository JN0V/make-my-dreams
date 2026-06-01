# ADR-027 — Import-graph blast radius: resolve + transitive, no AST dependency

**Status**: Accepted
**Date**: 2026-06-01
**Deciders**: MMD core (self-dev, 22nd reflexive `mmd --here`, 9th with `--label`)
**Parent design**: [docs/specs/SPEC_V04C.md](../../SPEC_V04C.md) (FROZEN). Maps to [PROBLEMS.md](../../PROBLEMS.md) P-05 ("a change's true reach is invisible"). Upgrades the v0.4.a stub introduced in [ADR-026](./026-sealed-test-oracle.md).

## Context

v0.4.a ([ADR-026](./026-sealed-test-oracle.md), §"blast-radius stub") shipped `computeBlastRadius` as a deliberate **fragment-grep stub**: for a changed file it searched other files' import/require lines for filename *substrings* (the full path, the path without extension, the basename). That was honest as a first cut but inaccurate in two directions:

- **Over-counts**: a filename mentioned only in a comment or a plain string counted as an importer; a basename collision (`./helper.js` vs `../helper.js`) conflated two distinct files.
- **Under-counts**: it had no path resolution (no `+.js`/`/index` awareness) and, critically, **no transitive reach** — it only saw direct, one-hop mentions, so the true reach of a change (everything that imports it *through a chain*) stayed invisible. That is exactly the P-05 gap the stub was meant to start closing.

The question for v0.4.c: how to get from "grep stub" to an accurate blast radius. The obvious tool is a real JavaScript parser (acorn / babel) walking the AST for every `ImportDeclaration` / `CallExpression`. But this repo is **strict vanilla-stack**: `package.json` dependencies are empty and have always been (we hand-rolled a YAML-lite parser *twice* — `parseBindings` in the constitution composer, and the status/manifest readers — rather than add `js-yaml`). Adding `acorn` for an *advisory* impact map would break that convention for a feature that never gates a run.

## Decision

Build an **import-graph-accurate** blast radius with **zero new dependencies**: targeted specifier extraction + hand-rolled module resolution + a transitive reverse closure. Honestly named "import-graph accurate", **not** "AST-accurate".

### 1. Parse module specifiers, don't build an AST (`lib/sealed-tests/import-graph.js`)

`parseSpecifiers(text)` extracts the quoted specifier from the five real import forms with targeted regexes — static `import … from 'x'`, side-effect `import 'x'`, `export … from 'x'`, `require('x')`, dynamic `import('x')` (single OR double quotes). Comments are **stripped first** (block then line), so a commented-out import never counts. This is the same engineering judgement as the YAML-lite precedent: a small, well-tested, hand-rolled parser for a constrained grammar beats a heavyweight dependency we'd carry forever. It is pure (no `node:fs`, no `node:path`) and never throws (universal §VI).

### 2. Resolve relative specifiers to concrete repo files

`resolveSpecifier(fromFile, specifier, fileSet)` resolves **only** relative specifiers (those starting with `.`) against `fromFile`'s directory, trying the literal path, then `+.js/.mjs/.cjs`, then `/index.{js,mjs,cjs}` — returning the first that is a member of the repo's `fileSet`. A bare specifier (`fs`, `lodash`), a `node:` specifier, or an absolute/unresolvable path returns `null`. Resolution is hand-rolled POSIX (`.`/`..` segment folding, `\\`→`/` normalization) so it is deterministic across platforms and drivable from in-memory file maps. This is what fixes the stub's basename collision: `./a` and `../a` resolve to **different** files.

### 3. Transitive reverse closure = the blast radius

`buildImportGraph(files, readFile)` maps each file to its set of resolved imports (unreadable files skipped, never fatal). `invertGraph` flips it to importee → importers, and `reverseClosure(graph, changed)` walks the inverted graph from the changed set with a **visited-set guard** so an import cycle cannot hang. `computeBlastRadius` returns `{ changed, importers, transitive }`:

- `importers` = the **direct** one-hop importers of the changed set.
- `transitive` = the **full reverse closure** — every file that imports a changed file directly OR through a chain. *This* is the true P-05 blast radius, and it is what the sealed pipeline logs to `status.json.blast_radius` (`transitive` plus the supporting `changed`/`importers`).

It stays **advisory** (logged, never gates a run — same posture as v0.4.a) and honest on empty/unavailable input (explicit empty lists, never a crash).

## Residual gap (stated, not hidden — universal §VI)

"Import-graph accurate" is a deliberately narrower claim than "AST-accurate". The no-dep approach does **not** catch:

- **Computed / runtime specifiers** — `` import(`./${name}.js`) `` or `require(variable)`: the specifier isn't a literal, so it cannot be resolved statically.
- **Re-export aliasing through computed names** — a module re-exported under a name built at runtime is invisible to specifier extraction.
- **Non-JS importers** — an `index.html` that pulls a file via `<script src>`, a bundler config, or a CSS `@import`: these are not JS module imports and are not in the graph (the v0.4.a unit test for the `<script src>` PWA case documents this explicitly).
- **Exotic syntax** the regexes don't model (e.g. specifiers split across template concatenation).
- **A regex *literal* containing `//`** (e.g. `/a\/\//`) is treated by the comment scanner as a line comment — rare, line-local (never a whole-file swallow), and JS module specifiers we resolve don't live inside regex literals. (Comments are stripped with a single-pass char scanner that tracks code/string/line-comment/block-comment state — a regex stripper was rejected after it mistook the `/*` inside a `// … lib/*.` line comment for a block-comment opener and ate every import up to the next `*/`.)

These are the **price of zero dependencies**, not bugs. A full AST + a bundler-grade resolver would catch some of them; for an advisory impact map on a hundreds-of-files repo, the trade isn't worth a permanent dependency. A very large monorepo would also warrant caching the graph between runs — out of scope here (SPEC §4).

## Consequences

- **Positive**: the blast radius is now resolved (no comment/string false hits, no basename collisions) and transitive (the real reach of a change). Zero new dependencies — the vanilla-stack convention holds. All logic is pure and unit-tested over in-memory file maps.
- **Negative**: the documented residual gap means a computed/runtime import can still hide a dependency; the map is best-effort, and we say so rather than overselling "AST-accurate".
- **Neutral**: still advisory — it informs, it does not gate. Promoting it to a gate is a separate, later decision.

## Alternatives considered

- **Add `acorn`/`babel` and walk the AST** — most accurate, but breaks the zero-dep vanilla-stack convention for an advisory feature, and pulls a parser (+ its updates, + its attack surface) into a project that has deliberately hand-rolled two parsers to avoid exactly this. Rejected.
- **Keep the fragment-grep stub** — cheap but wrong in both directions (over- and under-counts), and never transitive. The whole point of v0.4.c is to close that. Rejected.
- **A regex AST-lite that tries to model full ES module syntax** — more code, more corner cases, diminishing returns over targeted specifier extraction; still not a real parser. The honest middle ground is "extract specifiers + resolve + close", with the gap documented. Chosen.
