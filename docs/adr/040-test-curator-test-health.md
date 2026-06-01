# ADR-040 — The Test Curator (`mmd test-health`): test-corpus health, detect-and-report only

**Status**: accepted
**Date**: 2026-06-01
**Slice**: v0.7.6 (Test Curator — `mmd test-health`)

## Context

MMD already has three quality-adjacent roles, and they were starting to blur into
each other:

- **`mmd qa`** — reviews *a single change* (per-diff correctness, fix-oriented). It
  answers "is *this diff* sound?".
- **The BMAD TEA (Murat)** — *test architecture*: how to design a test plan / pick
  a framework / scaffold coverage for a feature, ahead of implementation. It
  answers "how *should* we test this feature?".
- **The Documentalist (`mmd document-*`)** — keeps the *docs* coherent over time
  (inventory, drift/conformance, coherence graph, active compaction). It answers
  "have the *docs* drifted from what MMD became?".

None of them answered a fourth, distinct question: **is the test _corpus itself_
healthy as it grows?** AI-driven TDD produces test corpora that explode in size
(testing.md §V is the whole reason stratification tags exist). Over hundreds of
slices, tags get forgotten, a smoke subset silently shrinks below its
fast-feedback value, and individual test files bloat past the point of being
navigable. Nobody owned that posture. `mmd test-health` ran on MMD itself and
immediately surfaced **73 untagged tests** (a §V violation accumulated in older
files) — debt no per-change review (`qa`) would ever catch, because each of those
tests was fine *when it was the diff under review*.

The Test Curator is the **test analog of the Documentalist**: same shape
(consolidate / coherence, detect-before-act, deterministic, a regenerable
dashboard), different subject — tests, not docs.

## Decision

Add `mmd test-health` as a **detect-and-report-only** subcommand that owns
test-corpus health, with these deliberate boundaries:

1. **It is NOT `mmd qa`.** `qa` is per-change and fix-oriented; the Test Curator
   looks at the whole corpus over time and **never fixes** anything.
2. **It is NOT the BMAD TEA.** The TEA designs test *architecture* for a feature
   ahead of time; the Test Curator reports the *posture of the existing corpus*.
3. **It is NOT the Documentalist.** The Documentalist owns docs; the Test Curator
   owns tests. They share a philosophy, not a subject.
4. **Read-only, one file.** It writes EXACTLY `docs/test-health.md` (the test
   analog of `docs/coherence-review.md`) and touches nothing else — it NEVER
   edits, moves, or deletes a test. An integration test asserts the contract.
5. **Deterministic over LLM.** No `claude` spawn. The value is a *trustworthy,
   regenerable* dashboard, not a fuzzy opinion — and the corpus signal (tag
   counts, untagged list, oversized files) is exactly computable, so an LLM would
   add cost and non-determinism for no gain. (Contrast `document-review
   --with-claude`, where the heuristic genuinely benefits from a semantic second
   opinion.)

### Shape

- `lib/test-curator/scan.js` — PURE `scanTestCorpus(files)`: read the
  stratification tag from each test *title* (`test('@unit …')` convention, the
  same one `npm test:smoke` greps), extract `{title, tag, file, line}` per test +
  `{path, lineCount, testCount}` per file. Never throws.
- `lib/test-curator/report.js` — PURE `buildTestHealthReport(scan, {maxLines,
  maxTests})`: distribution table, untagged list (with `file:line`), smoke-health
  line (vs the §V 5–10 band), oversized split candidates. Honest advisory framing.
- `bin/test-curator/test-health.js` — the thin coordinator: gather git-tracked
  test files (excluding `test/fixtures/` — those are inputs to the discover tests,
  not MMD's own corpus), scan, build, write the one report. Env-overridable
  thresholds (`MMD_TEST_FILE_MAX_LINES` / `MMD_TEST_FILE_MAX_TESTS`) with graceful,
  honest fallback.

This mirrors the document-* family exactly (pure judgment + pure render + thin I/O
bin), so the codebase stays consistent (brownfield.md §I).

## Consequences

**Positive.**
- The corpus now has an owner. Untagged drift, a thinning smoke subset, and
  oversized files are *visible* and *regenerable*, not folklore.
- Detect-before-act keeps the slice safe: surfacing 73 untagged tests does not
  risk a mass auto-retag that could mis-stratify (a `@unit` that's really
  `@integration` would corrupt the fast lane). Fixing them is a separate, future,
  human-reviewed action — the same discipline the Documentalist followed
  (detect in v0.7.a/b before acting in v0.7.c).
- Deterministic → CI-friendly and trustworthy.

**Negative / limits.**
- The scanner is a **heuristic**: it reads tags from title prefixes and counts
  `test(`/`it(` calls. A test built by an unusual helper, or a tag placed
  somewhere other than the title, may be mis-counted. The report says so.
- It reports debt it will not fix. The 73 untagged tests remain until a future
  slice (or a human) tags them — by design, but it is debt now named, not closed.

**Future (explicitly deferred, YAGNI).** Auto-retag suggestions, per-stratum
runtime budgets (a `@unit` that exceeds 100 ms should be re-tagged — testing.md
§V), duplicate-test detection, and an opt-in `--with-claude` semantic pass are all
candidates once the deterministic dashboard is trusted — the same earn-trust-then-
act arc the Documentalist took.

## Alternatives considered

- **Fold it into `mmd qa`.** Rejected: `qa` is per-change; corpus health is a
  different question on a different cadence (consolidation, not review). Conflating
  them is exactly the role-blur this ADR resolves.
- **Make it `--with-claude` from day one.** Rejected: the signal is exactly
  computable; an LLM adds cost + non-determinism for no gain (deterministic-over-
  LLM).
- **Auto-fix untagged tests in this slice.** Rejected: detect-before-act. A wrong
  stratum is worse than an absent one (it corrupts the fast lane); retagging needs
  human judgment. The Curator names the debt; it does not silently rewrite tests.
