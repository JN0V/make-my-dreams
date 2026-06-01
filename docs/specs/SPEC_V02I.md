# Make My Dreams — v0.2.i Spec: Documentalist lite (counter incrementer + auto-promote)

> Per scoping §6.5/§6.5b — every lesson in `docs/lessons-learned.md` has a `**To promote if**: N reuses validated (counter: K)` line. The promotion mechanism is: once `K` reaches `N` (default 5), the Documentalist moves the lesson from the dynamic Layer F (`docs/lessons-learned.md`) to the appropriate constitution module (typically `ai-coding.md`, `commit-git.md`, `testing.md`, or `observability.md`). Today (post-v0.2.11) we have 18 lessons; the composer produces a `composer.json` per claude invocation listing the injected lesson IDs. **Counters are still incremented by hand** (I do it, and only when I notice — currently almost never). v0.2.i is the **lite Documentalist**: a deterministic `mmd document-lessons` subcommand that reads every `composer.json` under `.mmd/local/`, deduplicates by run_id, increments each matched lesson's counter, and auto-promotes any lesson reaching N=5 (moves it to the right constitution module + deletes from lessons-learned.md + writes a promotion ADR entry). Walking-skeleton: no LLM judgment, no semantic re-categorization, no cross-project aggregation. Pure file scan + counter math + targeted file moves.

---

## 1. Goal of v0.2.i

Deliver one new subcommand + the lib functions behind it:

1. **`mmd document-lessons [--dry-run] [--since <ts>]`** — scans `.mmd/local/**/composer.json`, aggregates matched lesson IDs (deduplicating by run_id to avoid double-counting if a composer.json is processed twice), increments each lesson's counter in `docs/lessons-learned.md`, and for each lesson that reaches `N` (per its own `**To promote if**: N`), auto-promotes it:
   - Determines the target constitution module from the lesson's `**To promote if**: …` line (if the line says `"promote to ai-coding.md"` use that; else default to `ai-coding.md`)
   - Appends the lesson's `Rule` + a header to the target module (no overwrite — append-only)
   - Removes the lesson from `docs/lessons-learned.md`
   - Records the promotion in `docs/adr/<NNN>-lesson-L-<XXX>-promoted.md` (small auto-generated ADR)
2. **`--dry-run`** prints what WOULD happen without modifying any file
3. **`--since <ts>`** processes only composer.json files newer than `<ts>` (ISO date). Default: all-time.

**Non-features** (deliberately deferred):
- LLM judgment on whether a lesson is "really" promotable (deterministic counter only).
- Semantic re-categorization (lesson decides its target module via its own `To promote if` line).
- Cross-project aggregation (only this repo's `.mmd/local/`).
- Automatic invocation from a cron / scheduled task (manual `mmd document-lessons` for now).
- Conflict resolution if a lesson is half-promoted then re-incremented (assume atomicity, document if it bites).
- Rolling back a promotion (the ADR records it; manual revert if needed).

**Why this exists**: the autolearning loop §6.5 has been operational since v0.2.7 in the "compose" direction (lessons → injected into prompts) but stuck in manual mode in the "promote" direction (counters → constitution). v0.2.i closes the second half. After v0.2.i, every `mmd document-lessons` run materially advances the system's promotion state without human-in-the-loop.

**Mission validation**: after v0.2.i, running `mmd document-lessons --dry-run` on the current repo state prints a list of lessons whose counters would be incremented + any that would be promoted. Re-running without `--dry-run` actually applies the changes. Running twice with no new composer.json files is idempotent (counters already at the right value).

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: `mmd document-lessons --help` + subcommand routing

**Given** MMD v0.2.i installed
**When** the user runs `mmd document-lessons --help`
**Then** the CLI prints usage including `--dry-run`, `--since <ts>`, the exit codes (0 ok / 2 user-argv error / 5 no composer.json found at all), and a note that the command modifies `docs/lessons-learned.md` + may create constitution / ADR files.

Tag: `@unit` for argv parsing + routing.

### AC-2: Pure aggregator `lib/documentalist/aggregate-injections.js`

**Given** a list of composer.json file paths
**When** `aggregateInjections(paths)` is called
**Then** it returns `{ totalRuns: number, byLesson: Map<string, { count: number, runIds: Set<string> }> }`. Deduplicates by `run_id` (composer.json includes the run_id from MMD_RUN_ID env). Skips malformed files (log warning, continue). Pure: no I/O within the aggregator (the caller reads the files and passes parsed JSON).

Tag: `@unit` with fixtures of varied composer.json shapes.

### AC-3: Pure counter mutator `lib/documentalist/mutate-counters.js`

**Given** a parsed lessons file (output of the v0.2.7 parser) + an aggregator output
**When** `mutateCounters(lessons, byLesson)` is called
**Then** it returns `{ updatedLessons, toPromote: Lesson[] }` where:
- `updatedLessons` reflects new `counter` values per matched lesson
- `toPromote` lists lessons whose new `counter` reaches their `promoteIfN` threshold
- Pure: no file writes (the caller serializes back to disk)

Tag: `@unit` exhaustive: counter starts at 0/3/4, increment by 0/1/many, threshold 3/5/10, missing `To promote if` line (skip), milestone-status lessons (skip — never promote).

### AC-4: Promotion executor `lib/documentalist/promote-lesson.js`

**Given** a Lesson object to promote + the repo root
**When** `promoteLesson(lesson, repoRoot, { dryRun })` is called
**Then**:
- Determines target module: parse `**To promote if**` line for `"promote to <module>.md"`, else default to `ai-coding.md`
- If `dryRun`: returns the plan (`{ action: 'promote', targetModule, lessonId, fromLine, toFile, adrPath }`) without touching files
- Else:
  - Appends the lesson's content (header + Rule paragraph) to `.specify/memory/constitution/<targetModule>.md` (last section, "Promoted from lessons-learned" subsection added if absent)
  - Removes the lesson block from `docs/lessons-learned.md` (lines from `## L-<id>` to the next `---` separator)
  - Creates `docs/adr/<NNN>-lesson-L-<XXX>-promoted.md` with date + rationale + the promoted content (NNN = max existing ADR number + 1)
  - Returns `{ action: 'promoted', ... }`

Tag: `@unit` for the file-mutation logic with fixtures. `@integration` end-to-end with a real lessons file + module.

### AC-5: `mmd document-lessons` end-to-end + ADR + README

**Given** v0.2.i installed + at least one composer.json file in `.mmd/local/`
**When** the user runs `mmd document-lessons` (or `--dry-run`)
**Then**:
- Scans `.mmd/local/**/composer.json`, dedups by run_id, prints summary: `Processed N runs, M unique injections across K lessons. {dry-run: would | will} increment N counters, {dry-run: would | will} promote P lessons.`
- If `--dry-run`: no file modifications, exit 0
- Else: applies all counter increments + promotions atomically (best-effort: if one promotion fails, continue with the rest, summarize at end)
- Exit codes: 0 ok / 2 user-argv error / 5 no composer.json found at all / 6 partial failure (some promotions errored; details on stderr)
- README has a `### Document lessons (mmd document-lessons)` subsection
- ADR-014 covers: why deterministic counter (no LLM judgment), why per-lesson `To promote if` line authority over module destination, the dedup-by-run_id rationale, the "skip milestone lessons" exception (L-010/L-011/L-013/L-014 are markers, not promotable), the future v0.5b full-Documentalist roadmap

Tag: `@integration` end-to-end with fixture composer.json files + a fixture lessons file.

---

## 3. Architecture (incremental)

```
mmd document-lessons [--dry-run] [--since <ts>]
   │
   ▼
[1] scan .mmd/local/**/composer.json
   │
   ▼
[2] parse each + aggregateInjections({ paths }) → { totalRuns, byLesson }
   │
   ▼
[3] parseLessons(lessonsPath) (reuse v0.2.7 parser)
   │
   ▼
[4] mutateCounters(lessons, byLesson) → { updatedLessons, toPromote }
   │
   ▼
[5] if dryRun: print summary + exit 0
   else:
     - serialize updatedLessons back to docs/lessons-learned.md
     - for each toPromote: promoteLesson(lesson, repoRoot)
     - print summary + exit
```

### Project structure (additions only)

```
make-my-dreams/
├── bin/
│   ├── mmd.js                              # modified — document-lessons subcommand dispatch
│   └── documentalist/
│       └── document-lessons.js             # NEW — thin coordinator
├── lib/
│   └── documentalist/
│       ├── aggregate-injections.js         # NEW — pure
│       ├── mutate-counters.js              # NEW — pure
│       ├── promote-lesson.js               # NEW — file mutator (dryRun-aware)
│       └── serialize-lessons.js            # NEW — pure inverse of parseLessons
├── test/
│   ├── unit/
│   │   ├── documentalist-aggregate.test.js          # NEW
│   │   ├── documentalist-mutate-counters.test.js    # NEW
│   │   ├── documentalist-promote-lesson.test.js     # NEW
│   │   └── documentalist-serialize.test.js          # NEW
│   └── integration/
│       └── document-lessons-e2e.test.js              # NEW
└── docs/adr/
    └── 014-documentalist-lite-counter-incrementer.md  # NEW
```

---

## 4. Out of scope for v0.2.i

- ❌ LLM judgment on promotability (deterministic counter only).
- ❌ Semantic re-categorization of lesson → module (use the `To promote if` line authority).
- ❌ Cross-project aggregation (only `.mmd/local/`).
- ❌ Auto-trigger on a cron / `mmd ship` hook (v0.2.i is manual invocation only).
- ❌ Promotion rollback subcommand.
- ❌ Per-promotion human confirmation prompt (auto-promote on N reached — fast lane).

---

## 5. Implementation hints (for auto-dev)

### Pre-implementation
1. Read SPEC_V02I.md (this file).
2. Read scoping §6.5 + §6.5b for the autolearning context.
3. Read `lib/composer/parse-lessons.js` (v0.2.7) and `lib/composer/match.js` to understand the lesson structure.
4. Read the composer.json format from any existing `.mmd/local/<*>-runs/*.composer.json`.

### Key risks
- **Serialization round-trip safety**: parsing a lesson file then serializing it back must be byte-identical when no mutations apply. Add a regression test that does parse→serialize on the current `docs/lessons-learned.md` and asserts unchanged.
- **Promotion atomicity**: lesson removal + module append + ADR creation = 3 file ops. Do them in a sequence with try/catch — if step 2 fails after step 1 succeeded, log and continue (best-effort), surface in the summary.
- **Dedup by run_id**: composer.json may not always have a unique run_id (older runs from before v0.2.7 may not). Use the file path as fallback dedup key.
- **Milestone lessons skip**: L-010 / L-011 / L-013 / L-014 have `**Status**: milestone` — never increment, never promote. Detect via the `Status` line.

### Apply L-001..L-018
All standard. Particularly:
- **L-016**: launch with `MMD_TIMEOUT_MS=0` + spec-frozen.
- **L-019 prevention** (from v0.2.k incident): commit incrementally per AC.
- **L-015** (now enforced by v0.2.h): the wrapper will block launch if a referenced file is missing — verify SPEC_V02I.md is on main before launch.

### Constitution module bindings
Active: universal, ai-coding, commit-git, testing, error-handling, documentation, observability.

---

## 6. Definition of done

v0.2.i is done when:

1. All 5 ACs met.
2. Full test suite passes (current 962 + new tests, expected ~990-1010).
3. `mmd document-lessons --dry-run` on the current repo state runs in <1s and prints a coherent summary.
4. README + ADR-014 in place.
5. Version bumped to `0.2.12`.
6. Slice merged + tag `v0.2.12` created.
7. 11th reflexive use of `mmd --here`. Composer should match L-018 (lessons composer) + L-009 (walking-skeleton scope) + scoping §6.5-related lessons.

---

*Spec v0.2.i — generated 2026-05-30 from scoping §6.5 + Sébastien's "continue MMD-on-MMD" pivot. After v0.2.i lands, the autolearning §6.5 loop is FULLY operational (compose AND promote), without human-in-the-loop except for the explicit `mmd document-lessons` invocation. The full Documentalist Worker (v0.5b) brings cron-like auto-trigger + LLM-augmented judgment, but the math + file moves are done.*
