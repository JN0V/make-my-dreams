# ADR-041 — The Test Curator's redundancy face (`mmd test-health`): find overlapping tests, detect-before-cut

**Status**: accepted
**Date**: 2026-06-02
**Slice**: v0.7.7 (Test Curator — redundancy detection)

## Context

v0.7.6 (ADR-040) gave the Test Curator its first face — **stratification health**:
which tests are untagged, whether the smoke subset is thin, which files are
oversized. That same ADR explicitly deferred **duplicate-test detection** as a
future candidate "once the deterministic dashboard is trusted." It is now trusted
(it ran clean on MMD and surfaced real debt), so this slice adds the second face.

AI-driven TDD does not only bloat the corpus with *untagged* tests; it grows
**near-duplicate** tests. The same module gets re-tested with slightly different
wording across slices; a copy-pasted test block survives with one literal changed;
two `it()` blocks assert almost the same thing. Over hundreds of slices nobody owns
the question **"are we over-testing the same surface?"** — `mmd qa` (per-change)
never sees it, because each test was fine *when it was the diff under review*. This
is the exact shape of debt the Test Curator was created to own.

## Decision

Add a **"Redundancy candidates"** section to `mmd test-health` / `docs/test-health.md`
that surfaces tests likely to overlap, under the Test Curator's existing contract.

### Method: clustering by target + structural similarity (NOT coverage)

Two complementary, **deterministic** signals computed from source text alone:

1. **Near-duplicate pairs** — structural similarity. Each test's *body* (the code
   between the callback's braces, captured by a brace-depth scan) is normalized
   (comments + whitespace stripped, tokenized), turned into k-gram **token
   shingles**, and pairs are scored by **Jaccard similarity**. Pairs at or above a
   threshold (`MMD_TEST_DUP_SIMILARITY`, default **0.9**) are flagged.
2. **Most-tested modules** — clustering. Test files are grouped by the `lib/`/`bin/`
   modules they import (their *targets*); the largest clusters are surfaced as
   **over-test candidates** (a module with many tests across many files is where
   redundancy, if any, is most likely).

**Why not coverage by default.** The intuitive definition of redundancy — "two
tests exercise the same lines" — needs an **instrumented test run**. That is slow,
non-deterministic, and it would break the Test Curator's pure / deterministic /
read-only contract (the whole reason it has no `claude` spawn). Structural
similarity is *exactly computable* from the source, deterministic, and fast. A
coverage-based mode stays a **deferred opt-in**, not the default.

### DETECT-BEFORE-CUT (the non-negotiable guard)

The section lists **candidates** and frames every one as "worth a glance." It
**NEVER** says "delete these," and the command **NEVER** edits or deletes a test.
A similar-looking pair may encode a genuinely distinct intent (a happy path vs an
error path that share scaffolding) — only a human can tell. This mirrors the
Documentalist's detect→earn-trust→act arc (v0.7.a–c): name the debt first; any
*cutting* is a separate, human-reviewed action. (Whether a future slice ever
auto-prunes is left open; if it does, it will be opt-in and reviewed, never the
default.)

### Bounded — within-file comparison (no quadratic blow-up)

Comparing every test against every other is O(N²) over ~1760 tests (~1.5M pairs).
`nearDuplicatePairs` compares **only tests within the same file**. Since same file
⇒ same target cluster, the "within the same target cluster" bound is automatically
satisfied by the tighter within-file bound. Per-file test counts are individually
bounded (the v0.7.6 oversized-file detector already flags the outliers), so the
total work is small. The cross-file "most-tested module" view comes from
`targetClusters` with **zero** pairwise comparison — it is a grouping, not a
similarity scan.

### Precision-first — no crying wolf

A redundancy section that flags hundreds of pairs is useless (the v0.7.b
discipline). Two guards keep it honest:
- **High default threshold (0.9)** — only near-identical bodies pair. On MMD's own
  corpus this yields **3** pairs, not a flood.
- **A token floor** — bodies below ~8 tokens are skipped, so two empty stub bodies
  are never flagged as "duplicates."

## Implementation

Mirrors the existing test-curator shape (pure judgment + pure render + thin I/O bin):

- `lib/test-curator/extract-bodies.js` (new, PURE) — `extractTestBody(content,
  fromIndex)` (deterministic brace-depth scan that skips strings + comments, robust
  to nested braces) and `extractFileTargets(content)` (sorted-unique `lib/`/`bin/`
  imports). Never throws.
- `lib/test-curator/scan.js` (extended) — attaches `body` + `targets` to each test
  entry and `targets` to each file metric. Additive; existing fields/counts and
  determinism unchanged.
- `lib/test-curator/redundancy.js` (new, PURE) — `nearDuplicatePairs(tests, {threshold})`
  and `targetClusters(tests)`. Deterministic, bounded, never throws.
- `lib/test-curator/report.js` + `bin/test-curator/test-health.js` (extended) —
  render the section + resolve `MMD_TEST_DUP_SIMILARITY` (graceful fallback). The
  bin stays **strictly read-only beyond `docs/test-health.md`** (asserted).

## Consequences

**Positive.**
- The corpus's redundancy posture is now visible and regenerable. On MMD: 3 real
  near-duplicate pairs (0.91–0.95) + the most-tested modules (`lib/invoke-autodev.js`
  204 tests / 33 files, then `argv-parser.js`, `server.js`).
- Still deterministic → CI-friendly, trustworthy, no LLM cost.
- Detect-before-cut keeps it safe: a false "duplicate" costs a glance, never a
  deleted test.

**Negative / limits (documented heuristic — honesty over tidiness, universal §VI).**
- **Structural, not semantic.** Two tests with identical structure but different
  intent can score high; two tests of the same thing written differently can score
  low. The threshold trades recall for precision (we chose precision).
- **Identifier-sensitive.** A pure variable-rename across an otherwise-identical
  test lowers similarity (tokens differ), so some true duplicates are missed. This
  is deliberate precision-first behavior, not a bug.
- **Within-file only.** A test duplicated across two *different* files is not paired
  (only clustered). Cross-file pairing would reintroduce the quadratic cost; the
  cluster view is the bounded substitute.
- **Import extraction is textual.** An `import … from '../../lib/x.js'` written
  inside a *fixture string* in a test file is counted as a target (same residual
  class as the v0.7.6 `test(`-inside-a-string note). Acceptable for an advisory
  heuristic; the report labels itself as such.

**Future (explicitly deferred, YAGNI).** Coverage-based redundancy (instrumented),
cross-file pairing within a cluster, identifier-normalized similarity, and any
*auto-pruning* are all candidates — each opt-in and human-reviewed if ever built.

## Alternatives considered

- **Coverage-based redundancy as the default.** Rejected: needs an instrumented
  run — slow, non-deterministic, breaks the read-only/pure contract. Deferred opt-in.
- **Global all-pairs comparison.** Rejected: O(N²) over ~1760 tests is ~1.5M
  comparisons. Within-file is bounded and catches the dominant case (copy-paste
  within a file).
- **Low threshold for high recall.** Rejected: it floods the report with weak
  pairs and trains the reader to ignore the section (crying wolf). Precision-first.
- **Auto-delete / auto-merge duplicates.** Rejected: detect-before-cut. A
  similar-looking test may document distinct intent; only a human decides.
