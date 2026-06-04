# Make My Dreams — v0.7.7 Spec: the Test Curator's REDUNDANCY face (`mmd test-health`)

> v0.7.6 gave the Test Curator (`mmd test-health`) its first face: **stratification health** — which tests are untagged, whether the smoke subset is thin, which files are oversized. This slice adds a second, complementary face: **redundancy detection** — *which tests likely overlap, so the corpus can be pruned.*
>
> AI-driven TDD doesn't just bloat the corpus with untagged tests; it grows **near-duplicate** tests — the same module re-tested with slightly different wording across slices, or two `it()` blocks that assert almost the same thing. Over hundreds of slices nobody owns the question "are we **over-testing** the same surface?". The redundancy face answers it.
>
> It stays true to the Test Curator's contract: **deterministic** (no `claude` spawn — structural similarity is exactly computable), **advisory**, and **DETECT-BEFORE-CUT** — it NEVER deletes a test. A similar-looking test may still document a distinct intent; the **human decides**. The method is **clustering by target + structural similarity** (token-shingle Jaccard over the test body), explicitly **NOT coverage** (a coverage mode stays a deferred opt-in — it needs an instrumented run, which would break the pure/deterministic/read-only contract).

---

## 1. Goal of v0.7.7

`mmd test-health` gains a **"Redundancy candidates"** section in `docs/test-health.md`:

```
## Redundancy candidates (advisory — DETECT-BEFORE-CUT, never auto-deleted)

Near-duplicate test pairs (structural similarity ≥ 0.90):
- test/unit/foo.test.js:42 ↔ test/unit/foo.test.js:55 — 0.94 similar
  ...

Most-tested modules (OVER-TEST candidates — a large cluster is worth a look):
| Target module | Tests | Files |
|---|---:|---:|
| lib/server.js | 71 | 9 |
  ...
```

Deliverable: one new pure module + one extended pure module + the scanner extension + the report wiring, mirroring the existing test-curator shape.

1. **`lib/test-curator/extract-bodies.js`** (new, PURE) — `extractTestBody(content, fromIndex)` returns the code between a test callback's opening `{` and its matching `}` via a deterministic **brace-depth scan** that skips strings and comments (robust to nested braces "well enough for a heuristic"); `extractFileTargets(content)` returns the sorted-unique set of **project modules under `lib/` or `bin/`** the file imports (from `import`/`require` lines). Pure, never throws.
2. **`lib/test-curator/scan.js`** (extended) — each test entry gains a `body` (extracted via `extractTestBody`) and a `targets` array (its file's `lib/`/`bin/` imports); each file metric gains `targets`. Additive — existing fields unchanged. Still pure, deterministic, never throws.
3. **`lib/test-curator/redundancy.js`** (new, PURE) — `nearDuplicatePairs(tests, opts)`: normalize each body (strip comments + whitespace, tokenize), compute token **shingles**, return pairs whose **Jaccard similarity ≥ threshold** (env-overridable `MMD_TEST_DUP_SIMILARITY`, default `0.9`, validated with graceful fallback); **bounded** — only compares tests **within the same file** (the tightest scope, itself within one target cluster — no global quadratic blow-up). Each pair reports both `file:line` locations + the similarity. `targetClusters(tests)`: group test files by their imported `lib/`/`bin/` module(s); return `{module, fileCount, testCount}` sorted largest-first. Deterministic, never throws, bounded.
4. **`lib/test-curator/report.js`** (extended) + **`bin/test-curator/test-health.js`** (extended) — render the "Redundancy candidates" section (near-duplicate pairs + top target clusters as over-test candidates), framed as advisory / detect-before-cut. The subcommand resolves `MMD_TEST_DUP_SIMILARITY` and stays **STRICTLY read-only beyond `docs/test-health.md`**. Fast + bounded.
5. **Live validation**: `mmd test-health` on MMD surfaces real near-duplicate pairs + the most-tested modules without false-deleting anything; headline numbers captured in HANDOVER.
6. **ADR + docs**: a new ADR documents the redundancy face (method, why-not-coverage, detect-before-cut, the bounded within-file/within-cluster comparison); README + CLAUDE document the section; `mmd document-readme` + `mmd handover` refresh the mechanical blocks; version → `0.7.7`.

**Mission validation**: a known near-duplicate pair IS flagged; two genuinely-different tests are NOT; a large target cluster is surfaced; `mmd test-health` on MMD writes a truthful `docs/test-health.md` and changes no other tracked path; the pure functions are deterministic and never throw on junk; version is 0.7.7.

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: scanner captures test bodies + per-file targets
**Given** a `{path, content}` test file whose tests have bodies (with nested braces and braces inside strings/comments) and whose file imports modules under `lib/`/`bin/` via `import`/`require`
**When** the scan runs
**Then**: `extractTestBody(content, fromIndex)` returns exactly the code between the callback's opening `{` and its matching `}` (brace-depth scan that skips strings + comments; never throws; unterminated → best-effort partial); `extractFileTargets(content)` returns the sorted-unique `lib/`/`bin/` module paths (relative `../../lib/x.js` normalized to `lib/x.js`; node:/external ignored); and `scanTestCorpus` attaches `body` + `targets` to each test and `targets` to each file metric — additively, existing fields and counts unchanged.
Tag: `@unit` (body between matching braces; nested braces; brace inside a string/comment ignored; multiple imports; require + import forms; node/external excluded; junk → no throw).

### AC-2: pure redundancy functions
**Given** scanned tests carrying `body` + `targets`
**When** `nearDuplicatePairs(tests, {threshold})` and `targetClusters(tests)` run
**Then**: `nearDuplicatePairs` returns `[{a:{file,line,title}, b:{file,line,title}, similarity}]` for pairs **within the same file** whose normalized-token-shingle Jaccard ≥ threshold (default 0.9; a near-identical pair IS returned, two structurally-different bodies are NOT; trivially-tiny bodies below a token floor are skipped to avoid crying wolf); it is bounded (no cross-file comparison) and never throws on junk. `targetClusters` returns `[{module, fileCount, testCount}]` grouped by imported `lib/`/`bin/` module, sorted by `testCount` desc then `fileCount` desc then `module` asc; deterministic; never throws.
Tag: `@unit` (near-dup flagged; different tests not flagged; threshold override respected; tiny bodies skipped; clustering counts + sort order; junk → no throw; bounded — same input deterministic).

### AC-3: report section + subcommand wiring, read-only contract
**Given** `mmd test-health` runs in a git repo
**When** it executes
**Then**: `docs/test-health.md` gains a "Redundancy candidates" section listing near-duplicate pairs (`file:line ↔ file:line — similarity`) and the top target clusters (module, N tests across M files) as OVER-TEST candidates, framed advisory / detect-before-cut (never "delete these"); `MMD_TEST_DUP_SIMILARITY` is honored with graceful fallback on junk; the command modifies NO tracked path other than `docs/test-health.md` (asserted via `git status`); `--dry-run` writes nothing; long lists are capped with an honest "+N more" note (no silent truncation).
Tag: `@integration` (real run writes only the one file and the report contains the section; `--dry-run` clean tree; junk env falls back with a note; the section is present on MMD's own corpus).

### AC-4: live validation captured
**Given** the redundancy face works
**When** `mmd test-health` runs on MMD
**Then**: the real near-duplicate pairs + most-tested modules are surfaced without deleting anything, and the headline numbers are captured in HANDOVER.
Tag: covered by AC-3 integration run + manual capture.

### AC-5: ADR + docs + version
**Given** the feature is implemented
**When** the slice closes
**Then**: ADR-041 documents the redundancy face (method = clustering + structural similarity; why-not-coverage; detect-before-cut as the non-negotiable guard; the bounded within-file/within-cluster comparison); README + CLAUDE document the redundancy section; `mmd document-readme` + `mmd handover` refresh the mechanical blocks (drift stays green); `package.json` is `0.7.7`.
Tag: `@integration` where mechanical (ADR file exists; docs mention redundancy); manual for the prose.

---

## 3. Method & design notes

- **Clustering by target + structural similarity, NOT coverage.** Coverage-based redundancy ("two tests exercise the same lines") needs an instrumented test run — non-deterministic, slow, and it would break the pure/read-only contract. Structural similarity (token-shingle Jaccard over the body) is exactly computable from source text, deterministic, and fast. A coverage mode stays a **deferred opt-in**.
- **Bounded — within-file only.** Comparing every test against every other is O(N²) over ~1640 tests. We compare **only within the same file** (the tightest scope; same file ⇒ same target cluster, so the within-cluster bound is automatically satisfied). Per-file test counts are individually bounded (the oversized-file detector already flags the outliers). `targetClusters` gives the cross-file "most-tested module" view without any pairwise cross-file comparison.
- **Precision-first — no crying wolf.** Default threshold 0.9 (near-identical). Bodies below a small token floor are skipped (two empty stub bodies are not meaningful redundancy). Honest advisory framing; clearly a heuristic.
- **DETECT-BEFORE-CUT (non-negotiable).** The section lists candidates and frames them as "worth a look"; it NEVER says "delete these" and the command NEVER edits a test. A similar-looking pair may encode distinct intent — the human decides.

## 4. Read-only contract

`mmd test-health` writes EXACTLY `docs/test-health.md` and nothing else. An `@integration` test asserts `git status --porcelain` shows only that path after a run. `--dry-run` writes nothing.

## 5. Definition of Done

- `lib/test-curator/extract-bodies.js`, `lib/test-curator/redundancy.js` (new); `scan.js`, `report.js`, `bin/test-curator/test-health.js` extended.
- `@unit` tests for body extraction, similarity, clustering (near-dup flagged, different-not-flagged, large cluster surfaced); `@integration` tests for the report section + read-only contract.
- ADR-041; README + CLAUDE updated; `mmd document-readme` + `mmd handover` run; `package.json` 0.7.7.
- Full suite green; commit-per-AC.
