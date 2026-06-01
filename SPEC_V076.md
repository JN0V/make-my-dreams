# Make My Dreams — v0.7.6 Spec: the Test Curator (`mmd test-health`)

> MMD already has three quality-adjacent roles, and they keep getting confused. `mmd qa` reviews **a single change** (per-diff correctness). The BMAD TEA (Murat) is **test architecture** (how to design a test plan / framework for a feature). The Documentalist (`mmd document-*`) keeps **docs** coherent over time. None of them answers a fourth, distinct question: *is the test **corpus** itself healthy as it grows?* — the test analog of the Documentalist, but for tests not docs.
>
> v0.7.6 adds the **Test Curator**: `mmd test-health`. It is **detect-and-report only** — strictly read-only, it NEVER modifies a test. It surfaces the corpus's stratification distribution (smoke/unit/integration/e2e), the tests that carry no stratification tag (a `testing.md` §V violation), a smoke-subset health line, and oversized test files that are split candidates. Honest advisory framing throughout — it is a clearly-labelled **heuristic**, not an authoritative audit. Deterministic over LLM (no claude spawn): the value is a trustworthy, regenerable dashboard.

---

## 1. Goal of v0.7.6

```
$ mmd test-health
  Test-health report written to docs/test-health.md
    Corpus: 1639 tests across 180 files (git-tracked, fixtures excluded).
    Stratification: 1333 unit · 430 integration · 5 smoke · 4 e2e · 5 untagged (heuristic).
    Smoke: 5 tests — looks THIN for a fast-feedback subset (advisory).
    Untagged: 5 tests violate testing.md §V stratification (listed in the report).
    Oversized: 2 files over the split thresholds (listed as split candidates).
    Read-only: nothing else in the repo was modified. Regenerate after material changes.
```

Deliverable: two pure modules + one thin subcommand + dispatch, mirroring the document-* family.

1. **`lib/test-curator/scan.js`** — a PURE scanner. Given `[{path, content}]` test-file pairs, extract per-test entries (`{title, tag, file, line}`) and per-file metrics (`{path, lineCount, testCount}`). The tag is read from the **test title string** per the project convention (a `test('@unit …')`/`it('@smoke …')` prefix), among `smoke|unit|integration|e2e`; a title carrying none → `untagged`. No I/O, never throws, deterministic.
2. **`lib/test-curator/report.js`** — a PURE markdown builder. Turns the scan into a test-health report: the tag stratification distribution (counts per tag), the UNTAGGED tests listed with file + line, a SMOKE-health line (count + thin/usable heuristic), and OVERSIZED files (over a lines OR test-count threshold) listed as split candidates. Honest advisory framing, clearly heuristic. Thresholds are injected (the bin reads + validates the env overrides).
3. **`bin/test-curator/test-health.js`** — the `mmd test-health` subcommand. Gather the git-tracked test files (excluding `test/fixtures/` — those are inputs to the discover tests, not MMD's own corpus), scan, build, write EXACTLY `docs/test-health.md` (regenerable, generated-by header, mirror of `docs/coherence-review.md`), print a summary. STRICTLY read-only beyond that one file (an integration test asserts no other tracked path changes). Wire dispatch in `bin/mmd.js` mirroring the document-* contract + a USAGE line + the `SUBCOMMANDS` list.
4. **Live validation**: `mmd test-health` on MMD surfaces the real corpus state (the tag distribution ~1639, the thin smoke subset, the untagged tests, the oversized files); captured in HANDOVER.
5. **ADR + docs**: a new ADR documents the Test Curator role and its boundaries (NOT `qa`, NOT the BMAD TEA, NOT the Documentalist — it owns test-corpus health), detect-before-act, deterministic-over-LLM. README + CLAUDE document `mmd test-health`. `mmd document-readme` + `mmd handover` refresh the mechanical blocks (drift report stays green).

**Mission validation**: running `mmd test-health` on MMD writes a truthful `docs/test-health.md` and changes no other tracked path; the pure scanner/report are deterministic and never throw on junk input; the smoke/untagged/oversized findings match a hand check; version is 0.7.6.

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: pure scanner
**Given** a list of `{path, content}` test-file pairs (some tests tagged `@smoke`/`@unit`/`@integration`/`@e2e` in their title, some untagged, multiline/odd titles, junk/empty input)
**When** `scanTestCorpus(files)` runs
**Then**: it returns `{ tests: [{title, tag, file, line}], files: [{path, lineCount, testCount}], totals }` where `tag` is the title's stratification tag (one of the four) or `'untagged'`; `line` is 1-based; `testCount` counts `test(`/`it(` calls; it is pure, deterministic, and NEVER throws (empty/`null`/malformed → empty result).
Tag: `@unit` (tag extraction from title prefix; untagged detection; line numbers; per-file metrics; `it(` and `test(`; multiline title best-effort; junk → no throw).

### AC-2: pure report builder
**Given** a scan result + thresholds `{maxLines, maxTests}`
**When** `buildTestHealthReport(scan, {maxLines, maxTests})` runs
**Then**: it returns markdown containing the tag distribution (count per tag incl. untagged), the untagged tests each with `file:line`, a smoke-health line (count + a thin-vs-usable heuristic, honestly labelled), and the oversized files (over `maxLines` OR `maxTests`) listed as split candidates — all framed as advisory heuristic. Pure, deterministic, never throws. Empty scan → an honest "no tests found" report, not a crash.
Tag: `@unit` (distribution table; untagged list with file+line; smoke thin/usable; oversized by lines and by test-count; empty scan).

### AC-3: the subcommand, read-only contract, dispatch
**Given** `mmd test-health` is run in the MMD repo
**When** it executes
**Then**: it gathers git-tracked test files (fixtures excluded), scans, builds, writes EXACTLY `docs/test-health.md` (with a generated-by header), prints a summary, and modifies NO other tracked path (asserted via `git status`); env overrides `MMD_TEST_FILE_MAX_LINES` / `MMD_TEST_FILE_MAX_TESTS` are honored with graceful fallback on junk values; `--dry-run` writes nothing; `--help` prints usage. Dispatch is wired in `bin/mmd.js` (before argv parsing, like the document-* family), with a USAGE line and a `SUBCOMMANDS` entry.
Tag: `@integration` (real run writes only the one file; `--dry-run` writes nothing; env override respected + junk falls back; `--help`).

### AC-4: live validation captured
**Given** the subcommand works
**When** it is run on MMD
**Then**: the real corpus state (tag distribution, thin smoke subset, untagged tests, oversized files) is captured in HANDOVER.
Tag: covered by AC-3 integration run + manual capture.

### AC-5: ADR + docs + version
**Given** v0.7.6 ships
**When** docs are read
**Then**: an ADR (number from the folder) records the Test Curator role + boundaries + detect-before-act + deterministic-over-LLM; README + CLAUDE document `mmd test-health`; `package.json` is `0.7.6`; `mmd document-readme` + `mmd handover` refresh the mechanical blocks; the drift report stays green.
Tag: `@unit` anchors (ADR/CLAUDE/README markers) + `@integration` (drift green).

---

## 3. Architecture (incremental, mirrors the document-* family)

```
lib/test-curator/scan.js              NEW — pure scanTestCorpus(files) → {tests, files, totals}
lib/test-curator/report.js            NEW — pure buildTestHealthReport(scan, {maxLines, maxTests}) → markdown
bin/test-curator/test-health.js       NEW — runTestHealth(rawArgs): gather git-tracked tests → scan → build → write docs/test-health.md
bin/mmd.js                            MODIFY — dispatch `test-health` + USAGE line
lib/argv-parser.js                    MODIFY — add 'test-health' to SUBCOMMANDS
docs/adr/040-test-curator-test-health.md  NEW
README.md, CLAUDE.md                  MODIFY — document mmd test-health
package.json                          MODIFY — 0.7.6
test/unit/test-curator-scan.test.js   NEW — @unit AC-1
test/unit/test-curator-report.test.js NEW — @unit AC-2
test/integration/test-health.test.js  NEW — @integration AC-3
```

### Boundaries (the role definition — the ADR's heart)
- **NOT `mmd qa`**: qa reviews a single change (per-diff correctness, fix-oriented). Test Curator looks at the whole corpus over time and never fixes.
- **NOT the BMAD TEA (Murat)**: TEA is test *architecture* — how to design a test plan/framework for a feature ahead of time. Test Curator is *posture of the existing corpus*.
- **NOT the Documentalist**: the Documentalist owns docs; the Test Curator owns the test corpus. Same shape (consolidate/coherence, detect-before-act, deterministic, regenerable dashboard) — different subject.

### Thresholds (env-overridable, validated, graceful fallback)
- `MMD_TEST_FILE_MAX_LINES` (default 500) — files longer are split candidates.
- `MMD_TEST_FILE_MAX_TESTS` (default 60) — files with more test calls are split candidates.
- A junk/empty/≤0 value falls back to the default (honest log line), never crashes.

### Read-only contract
`mmd test-health` writes EXACTLY `docs/test-health.md` and nothing else. It is the test analog of `mmd document-review`'s safety heart. No claude spawn (deterministic-over-LLM by design).

---

## 4. Definition of Done
- [ ] `lib/test-curator/scan.js` + `report.js` pure, deterministic, never throw; `@unit` tests with fixtures (red→green).
- [ ] `bin/test-curator/test-health.js` writes only `docs/test-health.md`; `@integration` test asserts the read-only contract, `--dry-run`, env override + fallback, `--help`.
- [ ] Dispatch + USAGE + `SUBCOMMANDS` wired.
- [ ] `docs/test-health.md` generated on MMD; corpus state captured in HANDOVER.
- [ ] ADR-040 + README + CLAUDE; version 0.7.6; `mmd document-readme` + `mmd handover` run; drift report green.
- [ ] Full `npm test` green; commits atomic per AC (L-019).
