# ADR-042 — The Test Curator goes POLYGLOT: a language-neutral core + per-technology adapters (§VIII)

**Status**: accepted
**Date**: 2026-06-02
**Slice**: v0.8.0 (Test Curator — polyglot adapter architecture)

## Context

The Test Curator (`mmd test-health`, v0.7.6–v0.7.8) was secretly **JavaScript-only**.
Its scanner hard-wired JS assumptions throughout the "generic" core:

- `test()` / `it()` call detection (the test grammar),
- the MMD `@smoke/@unit/@integration/@e2e` title-tag convention (the stratum source),
- `import` / `require` module syntax + `lib/`/`bin/` paths (the target extractor),
- brace-matched `{ … }` bodies (the redundancy similarity input),
- `*.test.js` file selection.

Run on a **Rust / Python / C / Go** repo, it would find ~nothing (no `test(` calls,
no `@`-tags) or — worse — **fabricate** numbers from whatever incidentally matched.
That is a direct violation of MMD's mission (work on **any** technology) and of the
newly-added **constitution §VIII (technology-agnostic analysis, NON-NEGOTIABLE)**,
which says: any capability that ANALYZES a target project MUST be technology-agnostic,
adapter-based, and must **detect-and-refuse** an unsupported stack rather than emit a
stack-mismatched measurement (a §VI honesty violation — fabricating a measurement that
doesn't apply).

This is the same L-009 / L-018 anti-pattern the project keeps fighting: **design scope
("works on any tech") leaking into an implementation that's only true for the dogfood
stack (MMD is JS).** The Test Curator was the first analysis tool to be confronted with
its own §VIII debt; this slice pays it down and sets the pattern for the others.

## Decision

Refactor the Test Curator into MMD's "**orchestrate, don't reimplement**" shape: a
**generic core** that knows nothing about any language, plus per-technology **adapters**
that discover tests in their ecosystem and normalize them into one shape the core
consumes. The existing JS logic becomes **one adapter**, not *the* tool. A real **Python
adapter** ships alongside it so genericity is **proven**, not promised.

### The adapter contract (`lib/test-curator/adapters/index.js`)

Every adapter is a plain object:

```
id            machine id ('javascript', 'python')
displayName   human stack name ('JavaScript/TypeScript', 'Python')
matches(signals) → boolean              // from manifest presence, PURE
discoverTests({ repoRoot, files, readFile }) → { entries, files }
  entries: { file, line, title, stratum|null, body|null, targets|null }
  files:   { path, lineCount, testCount, targets }   // per-file metrics
supportsBodies         capability flag — can it extract a body for similarity?
supportsStratification capability flag — does the stack have a stratum convention?
supportsCoverage       capability flag — can it produce coverage? (deferred for ALL)
```

A **registry** resolves adapters from a repo's signals:

- `resolveAdapters(signals)` → ALL implemented adapters whose `matches` is true (a
  polyglot repo → multiple), `[]` when none.
- `detectStackNames(signals)` → every detected stack by name **including unsupported
  ones** (Rust, Go) — so the refusal can name what it saw even with no adapter to ask.
- `supportedStackNames()` → the stacks that DO have an adapter (the "supported list").

Selection is **pure** (a function of the passed-in manifest signals); discovery takes an
**injected file reader**, so adapters are unit-testable without touching the filesystem.

### Dependency direction (the SRP boundary, DoD #4)

**core ← adapters ← index ← bin.** The core (`redundancy.js`, `report.js`) imports NO
adapter and contains NO language syntax. The adapters import the JS-internal scanners
(`scan.js`, `extract-bodies.js` are now JS-adapter-internal). The bin imports the
registry. An adapter never imports the core. This is what makes "add a stack = add one
file" true: the core never changes.

### The honest language gate (AC-4, the heart of the §VIII fix)

`bin/test-curator/test-health.js` detects the stack(s) from manifest presence, resolves
the matching adapter(s), runs each, and aggregates. When **no** adapter matches the
detected stack it **refuses honestly**: a clear message naming the detected stack + the
supported list, **exit 6, NO report written, NO fabricated numbers**. A mixed repo
analyzes the supported stacks and **names** the unsupported ones. This is precisely the
rule that would have stopped the JS-only bug: running the JS scanner over a Rust repo is
now impossible — the gate refuses first.

### Capability-flag honesty (the §VI mechanism)

Adapters differ in what they can extract. The Python adapter declares
`supportsBodies: false` for v1 (indentation-based body extraction is a separate, deferred
extractor). When an adapter lacks a capability, the core renders an **honest "not
available for the <stack> adapter" note** for that section — NEVER a silent empty that
reads as "clean" (a body-less stack must not render "✅ no near-duplicate pairs", which
would falsely imply it checked). Clustering + stratification still work for Python, so its
report is real and useful; only the body-similarity face is honestly marked unavailable.

### The Python adapter — proof of genericity (AC-5)

`lib/test-curator/adapters/python.js` discovers `def test_*` functions (pytest) and
`unittest` `class Test*` methods (also `def test_*`), derives a stratum from pytest
markers (`@pytest.mark.smoke` → `smoke`, else `null`), and extracts project-module
`targets` from `import`/`from` statements (resolving to repo-relative candidate paths the
bin's real-file filter keeps). A fixture Python repo yields a genuine, honest report —
demonstrating the core is language-neutral, not JS wearing a costume.

## Consequences

- **§VIII satisfied for the Test Curator.** It is technology-agnostic by design: proven
  on Python, honest (refuses) on the unsupported. The JS-only blindness is gone.
- **AC-2 regression lock held.** JS discovery is byte-identical (1774 tests, 187 files,
  same strata/bodies/targets/pairs/clusters on MMD itself); the only changes are the
  field rename `tag` → `stratum` (untagged → null) and the **genericized report prose**
  (the JS `test(`/`it(` mention was removed from the core per DoD #4, and the report now
  names the analyzed stack). This prose change is a deliberate, documented deviation from
  a *literal* byte-for-byte reading — required by DoD #4 itself ("the core contains NO
  language syntax") and by AC-4 ("the report names which stacks were analyzed"). The
  *substantive* content AC-2 enumerates (counts, stratification, untagged, redundancy
  pairs, clusters) is unchanged.
- **Coverage stays deferred — and will be polyglot.** All adapters declare
  `supportsCoverage: false`. Coverage was about to be built JS-specific (`node --test`);
  per §VIII it must instead run each adapter's **native** coverage tool (pytest +
  coverage.py, `cargo test` + llvm-cov, `go test -cover`, jest / `node --test`) and parse
  the standard formats (lcov / cobertura) in a shared parser. That is a follow-up now that
  the adapter model exists — NOT `node --test` baked into the core.
- **The same §VIII reckoning is queued for the other analysis tools.** blast-radius
  (ADR-027), the coherence graph (ADR-037), and doc→code refs (ADR-035) are ALSO
  JS-specific; each needs the same adapter treatment in its own slice. This ADR is the
  template.
- **Adding a stack is now cheap.** Rust/Go/C become a small new adapter file + one
  registry entry; until then they hit the honest refusal — never garbage.

### Documented heuristic residuals (honest, per §VI)

- The Python adapter's target resolution emits both `pkg/mod.py` and `pkg/mod/__init__.py`
  candidates and lets the real-file filter decide; a computed/`importlib` import is not
  resolved (same class of residual as the JS extractor's runtime-specifier gap, L-024).
- An `import` written inside a fixture string in a Python test file is counted as a target
  (same class as the v0.7.6 `test(`-in-a-string note); the real-file filter drops it
  unless a file by that name happens to exist.
- Python `supportsBodies: false` means no near-duplicate detection for Python in v1 — by
  design, honestly marked, an indentation-body extractor is a separate slice.
- Python `def test_*` collection follows pytest's scoping (module-level functions +
  `class Test*` methods); a `def test_*` nested in another `def`, or a method of a
  non-`Test*` class, is correctly NOT counted. The `Test*` test resolves by name
  convention (it does not check for an `__init__`, the one pytest-skip edge), and a
  bare `from . import sibling` (no dotted path) is not resolved to a target — both minor
  residuals consistent with the advisory, no-dep heuristic.
- Stack detection (`detectSignals`) probes manifests at the repo **root only** (SPEC §4
  scoped "a handful of stacks per repo"); a monorepo with manifests only in subdirectories
  detects no stack and hits the honest refusal rather than a fabricated report — honest,
  but a reach gap a future slice can close by also scanning the tracked-file list.
- The report's "untagged is a testing.md §V violation" framing is MMD's JavaScript
  convention; a stack whose stratification convention differs (Python's pytest markers)
  advertises a `stratumConventionLabel` and the report renders an honest stack-appropriate
  note instead of citing `@`-tags / §V for it (so the §VIII no-leak rule holds in the
  advice prose, not just the counting).

## Alternatives considered

- **Keep it JS-only, document the limit.** Rejected: §VIII is NON-NEGOTIABLE, and the
  user hit the bug on a real non-JS repo. A documented limit doesn't make the tool work.
- **One mega-scanner with `if (language === …)` branches.** Rejected: that is the
  language assumptions leaking into the core (§VIII forbids it) and an Open/Closed
  violation (every new stack edits the core). The adapter registry is open for extension,
  closed for modification.
- **A heavyweight per-language parser (tree-sitter et al.).** Rejected for v1 on the
  vanilla-stack / no-dep convention (L-024): a small, tested, hand-rolled line scanner is
  "robust enough" for an advisory corpus tool, and keeps the zero-dependency repo. The
  capability flags + documented residuals make the heuristic honest.
