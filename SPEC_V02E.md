# Make My Dreams — v0.2e Spec: Composer minimal (lessons auto-injection)

> Per scoping `MAKE_MY_DREAMS.md` §6.5 + §6.5b — the autolearning loop has been the recurring promise of MMD since v9. Today (post-v0.2.3) we have 13 lessons in `docs/lessons-learned.md` (L-001..L-013), each with `Keywords for matching`, each with a documented `Rule`. **None of them are auto-injected into auto-dev prompts.** I (Cowork, manual Documentalist) inject them by hand when I notice they're relevant. The composer is what makes injection automatic, deterministic, and observable. v0.2e ships the **minimal composer**: a pure function `composeLessons(promptText, lessonsFile) → { injectedLessons[], composedPrompt }` that (a) reads the lessons file, (b) extracts keyword sets per lesson, (c) matches them against the prompt text, (d) injects matched lessons' rules into the prompt as a `## Active lessons` section. Wired into `lib/invoke-autodev.js` (and the parallel `lib/skills/_common/invoke-claude.js` from v0.2.g if available) so that ALL claude -p invocations from MMD automatically benefit from past lessons — without any human in the loop. v0.2e is the slice that finally makes the **autolearning loop** real end-to-end: future failures produce new lessons → future runs auto-receive them → the system genuinely learns over time.

---

## 1. Goal of v0.2e

Deliver three coordinated changes that turn the lessons file from a doc into an active asset:

1. **Pure composer function** in `lib/composer/match.js`: given a prompt and the lessons file path, return matched lessons (by keyword overlap) + a composed prompt with `## Active lessons` section injected at the top.
2. **Wire into invocation paths**: `lib/invoke-autodev.js` (for `mmd <dream>` and `mmd --here`) and `lib/skills/_common/invoke-claude.js` (for `mmd ship/qa/cso/document-release` if v0.2.g landed) both call `composeLessons` before building the final prompt.
3. **Observability**: every `mmd` subprocess invocation that uses composer writes a `composer.json` audit trail next to its run log, recording: which lessons matched, on which keywords, score per match. Surfaces in the run log header. The `audit-pillars.sh` script gets a new column reporting "lessons-injected per commit" so we can measure adoption.

**Non-features** (kept deliberately minimal for the walking skeleton):
- No semantic matching (no embedding, no LLM-driven matching). Pure keyword-set overlap, deterministic, sub-100ms.
- No lesson scoring/ranking beyond match count. All matched lessons get injected (capped at top-N by match score, default N=5, configurable).
- No automatic counter increment on lessons' "To promote if N reuses" — that's a Documentalist Worker concern (v0.5b). The composer just emits the audit; the counter update is manual until v0.5b.
- No constitution module composition — composer is for lessons-learned ONLY in v0.2e. Composing constitution modules (Layer A/B/C/D dynamic loading) is v0.5b too.

**Why this version exists**: per scoping §6.5, "every failure encountered during MMD development must produce a deterministic test+fix AND a documented lesson here. Once a lesson reaches N=5 validated re-uses [...] it is promoted." The reuse counter only goes up if the lesson actually gets injected — which today requires me. v0.2e makes injection deterministic so the counter starts ticking truthfully.

**Mission validation**: after v0.2e, running `mmd --here "use git checkout to switch branches"` produces a prompt that includes L-003 (concurrent git ops) and L-008 (`git branch -d` warning) automatically, BEFORE claude -p sees the user's request. Verified by inspecting the run log's first 50 lines for the `## Active lessons` section.

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: `composeLessons` pure function

**Given** a prompt string and a path to a lessons-learned.md file
**When** `composeLessons(prompt, lessonsPath, { topN = 5 })` is called
**Then**:
- Parses the lessons file into structured entries: `{ id: "L-001", title, keywords: string[], rule: string, status: "active" | "milestone" | "promoted" }`. Skip `status: "promoted"` (already in constitution).
- For each lesson, computes a match score: count of distinct keywords from the lesson that appear (case-insensitive, word-boundary) in the prompt. Score 0 means no match.
- Returns `{ injectedLessons: <matched lessons sorted by score desc, capped at topN>, composedPrompt: <original prompt prefixed with ## Active lessons section if any matched> }`.
- Pure function (no I/O within the matching logic; the file read is done by the caller or by an injected dependency for testability).
- Throws if the file path doesn't exist (exit 4-equivalent in the calling code).

Tag: `@unit` exhaustive: empty prompt, no lessons file, lessons file with malformed entries, exact-match keywords, no-match keywords, partial-keyword (case sensitivity, word boundaries), topN truncation, ties broken deterministically (lower L-NNN first).

### AC-2: Lessons file parser

**Given** the actual `docs/lessons-learned.md` file (13 lessons)
**When** the parser runs
**Then**:
- Extracts exactly the active lessons (skipping L-010 which is `Status: milestone` per its frontmatter).
- For each lesson, extracts the `Keywords for matching:` list (comma- or pipe-separated).
- For each lesson, extracts the `Rule:` paragraph (between `**Rule**:` and the next `**` field).
- Parser tolerates the slight inconsistencies in the existing file (some lessons use `**Rule** (operative ...)`).
- Returns the structured list, version-stamped against the file's modification time for cache invalidation.

Tag: `@unit` against the live lessons file + 4 synthetic fixtures.

### AC-3: Composed prompt format

**Given** the composer matched 3 lessons (e.g., L-003, L-006, L-008)
**When** the prompt is composed
**Then** the output prompt has, prepended at the very top:

```markdown
## Active lessons (auto-injected by composer v0.2e)

The following lessons from docs/lessons-learned.md match keywords in this prompt. They are NOT optional — they encode validated rules from past failures. Apply each rule as you work.

### L-003 — Concurrent git operations on the same worktree conflict between auto-dev and human
**Rule**: while a long-running agent (auto-dev, gStack /qa, etc.) is active on branch X in a worktree, do NOT create or operate on other branches in that SAME worktree. (Two options: wait, or use `git worktree add ../<repo>-<sidetask>`.)

### L-006 — `claude -p` can stay in `S (sleeping)` state forever after finishing its work
**Rule**: BEFORE launching a new auto-dev (...) ALWAYS verify no previous one is still alive: `pgrep -af "claude -p"` ; if any survivor, SIGTERM then SIGKILL.

### L-008 — Never delete a branch when `git branch -d` warns "not yet merged to HEAD"
**Rule**: when `git branch -d <name>` warns "not yet merged to HEAD", STOP. Investigate divergence. Never chain `-d && push --delete` based on a warning.

---

<original prompt body follows here>
```

Format is deterministic. Same matched set → same prepended text byte-for-byte (modulo order, which is sort-by-score-then-by-id).

Tag: `@unit` with snapshot test against 3 known matched sets.

### AC-4: Wired into `lib/invoke-autodev.js`

**Given** `mmd <dream>` or `mmd --here <change>` is invoked
**When** `invokeAutodev` builds its prompt
**Then**:
- Before spawning `claude -p`, the prompt body is run through `composeLessons(promptBody, repoRoot + '/docs/lessons-learned.md')`.
- If `docs/lessons-learned.md` doesn't exist (e.g., on a brownfield target that hasn't run install-mmd.sh), composer is a no-op — no error, just original prompt preserved.
- If composer matches lessons, the composed prompt is what's passed to `claude -p`.
- A `composer.json` is written alongside the run log: `{ "composer_version": "v0.2e", "lessons_file_sha": "<file SHA at compose time>", "matched": [{ "id": "L-003", "score": 4, "keywords_hit": ["git checkout", "worktree", ...] }, ...], "injected_count": <N>, "elapsed_ms": <ms> }`.
- `MMD_COMPOSER_DISABLED=1` env var bypasses composition (escape hatch for debugging / fallback).

Tag: `@integration` with the live lessons file + a dream that mentions "git checkout" — expect L-003 matched.

### AC-5: Wired into `lib/skills/_common/invoke-claude.js` (if v0.2.g landed)

**Given** v0.2.g landed (`lib/skills/_common/invoke-claude.js` exists)
**When** `mmd ship`, `mmd qa`, etc. spawn claude
**Then**: same composer integration as AC-4 applies. The `_common` layer is the right hook point so all skill wrappers benefit uniformly.

If v0.2.g did NOT land (composer ships before Medium gStack), this AC reduces to: composer integrated only in `invoke-autodev.js`. Add a TODO comment in `_common/invoke-claude.js` (when it lands) to wire composer there.

Tag: `@integration` skipped if `lib/skills/_common/invoke-claude.js` is absent.

### AC-6: Observability — composer log + audit-pillars column

**Given** any composer-augmented run completes
**When** the user inspects the run's log directory
**Then**:
- `<rundir>/composer.json` exists with the AC-4 schema.
- The first line of the actual `<rundir>/run.log` contains: `[composer] injected N lessons: L-001, L-003, ... (matched against <lessons_file_sha>)`. (Or `[composer] no lessons matched` / `[composer] disabled via MMD_COMPOSER_DISABLED`.)
- `scripts/audit-pillars.sh` gets a new flag `--with-composer` that reads composer.json files under `.mmd/local/<*>-runs/` and reports: `Composer: <N> runs auto-injected lessons (avg <M> per run, top lessons: L-XXX (k), L-YYY (j), ...)`. Without `--with-composer`, output is unchanged.

Tag: `@unit` for composer.json shape. `@integration` for end-to-end log header + audit-pillars column.

### AC-7: `mmd lessons` introspection subcommand

**Given** v0.2e installed
**When** the user runs `mmd lessons` (or `mmd lessons --help`)
**Then**:
- `mmd lessons` lists each active lesson with id + title + keyword count + (if composer.json files exist in `.mmd/local/`) the count of times this lesson was injected.
- `mmd lessons match "<some prompt or dream>"` shows which lessons would be injected for that input, with scores.
- `mmd lessons --show <id>` prints the full lesson (frontmatter + rule + keywords).
- `mmd lessons --help` documents the above.

This makes composition introspectable without `cat`-ing JSON files manually.

Tag: `@unit` for each subcommand + `@integration` for `mmd lessons match` against the live file.

### AC-8: Documentation + ADR

**Given** v0.2e ships
**When** the user reads `README.md` and `docs/adr/010-composer-minimal-keyword-overlap.md`
**Then**:
- README has `### Lessons & composer` subsection in `## Usage`, explaining: every dev command auto-receives matched lessons in its prompt, `mmd lessons` introspects, `MMD_COMPOSER_DISABLED=1` bypasses.
- ADR-010 covers: why keyword-overlap (deterministic, sub-100ms, no LLM cost, transparent — vs embedding/LLM matching), why no scoring sophistication in v0.2e (start simple, measure, evolve in v0.5b), why injection at the prompt TOP (claude is more likely to read top context first), why no automatic counter increment (Documentalist Worker concern v0.5b).
- `MAKE_MY_DREAMS.md` §6.5 + §6.5b paragraphs noting v0.2e delivered the walking-skeleton composer.

Tag: `@unit` for README anchor presence.

---

## 3. Architecture (incremental)

```
mmd <dream> / mmd --here / mmd ship / mmd qa / ...
   │
   ▼
[1] subcommand handler builds the prompt body
   │
   ▼
[2] composeLessons(promptBody, repoRoot + '/docs/lessons-learned.md')
       → returns { composedPrompt, matched: Lesson[] }
   │
   ▼
[3] write composer.json alongside run log
   │
   ▼
[4] spawn claude -p with composedPrompt (existing path)
```

### Project structure (additions only)

```
make-my-dreams/
├── bin/
│   ├── mmd.js                          # modified — 'lessons' subcommand dispatch
│   └── lessons.js                      # NEW — mmd lessons entry point
├── lib/
│   ├── composer/
│   │   ├── match.js                    # NEW — composeLessons pure function
│   │   ├── parse-lessons.js            # NEW — parser for docs/lessons-learned.md
│   │   └── format.js                   # NEW — composed prompt prefix builder
│   ├── invoke-autodev.js               # modified — calls composer before spawning
│   └── skills/_common/invoke-claude.js # modified IF v0.2.g landed — calls composer
├── scripts/
│   └── audit-pillars.sh                # modified — --with-composer flag
├── test/
│   ├── unit/
│   │   ├── composer-match.test.js              # NEW
│   │   ├── composer-parse-lessons.test.js      # NEW
│   │   ├── composer-format.test.js             # NEW
│   │   └── lessons-cmd.test.js                 # NEW
│   ├── integration/
│   │   ├── invoke-autodev-with-composer.test.js  # NEW
│   │   ├── lessons-cmd.test.js                   # NEW
│   │   └── audit-pillars-composer.test.js        # NEW
│   └── fixtures/
│       └── composer-lessons/
│           ├── minimal.md              # NEW — 3 toy lessons for unit tests
│           ├── malformed.md            # NEW — tolerated parse cases
│           └── empty.md                # NEW — edge case
└── docs/adr/
    └── 010-composer-minimal-keyword-overlap.md  # NEW
```

---

## 4. Out of scope for v0.2e

- ❌ Semantic matching (embedding, LLM-driven). Future v0.5b+.
- ❌ Automatic counter increment on lesson reuse. Documentalist Worker concern (v0.5b).
- ❌ Composing constitution modules (dynamic Layer A/B/C/D loading per profile). v0.5b.
- ❌ Composer-driven prompt summarization or truncation (just prepending fixed-format sections).
- ❌ A web UI for managing lessons. CLI only.
- ❌ Cross-project lessons (global ~/.mmd/lessons-learned.md per scoping §6.5). v0.5b.
- ❌ Per-skill custom composer rules (every gStack skill could ideally have different injection rules — defer until we have data on what works).

---

## 5. Implementation hints (for auto-dev)

### Pre-implementation checks

1. Read SPEC_V02E.md (this file) fully.
2. Read `docs/lessons-learned.md` carefully — your parser must handle the EXACT format of the 13 existing lessons, including minor inconsistencies.
3. Read scoping §6.5 + §6.5b.

### Key risks to handle

- **Parser robustness**: the existing lessons file is hand-written and has minor format drift (some lessons have `**Status**: milestone` vs `active`, some have `**Rule**:` vs `**Rule** (operative ...)`). Parser must tolerate, not fail loud — log warnings for unparseable lessons but continue.
- **Keyword extraction**: lesson keywords are comma-separated in `Keywords for matching: foo, bar, baz` — but watch for keywords containing commas (escape with quotes? Just don't — keep it simple, use comma split, document the limitation).
- **Match precision**: case-insensitive word-boundary regex. Don't match "git" inside "github" — use `\b`. Multi-word keywords like "claude -p" need literal substring match (escape regex specials).
- **No regression**: existing `mmd <dream>` and `mmd --here` behavior unchanged when composer matches 0 lessons. The composed prompt MUST be byte-identical to the original in that case (no extra trailing newlines).
- **Performance**: < 100ms total for compose + write composer.json on the current 13-lesson file. Use simple loops, no fancy data structures.
- **MMD_COMPOSER_DISABLED**: simple env check at the top of composeLessons — if `process.env.MMD_COMPOSER_DISABLED === '1'`, return original prompt unchanged, write `{ disabled: true }` composer.json.

### Apply lessons L-001..L-013 (and any new ones from v0.2c/v0.2.g)

All standard. Particularly relevant for THIS slice:
- **L-005 + L-007**: don't hardcode lesson counts or specific lesson titles in tests — read them dynamically (the file evolves).
- **L-009 + L-012**: clearly distinguish v0.2e's minimal walking-skeleton from the full v0.5b autolearning system. Name the gap in docs.

### Constitution module bindings

Active: universal, ai-coding, commit-git, testing, security, error-handling, documentation, observability. Particularly observability — composer.json IS observability data.

---

## 6. Definition of done

v0.2e is done when:

1. All 8 ACs met.
2. Full test suite passes (current + composer additions, expected ~650-700 total).
3. `mmd lessons` lists 13+ active lessons (depending on how many v0.2c and v0.2.g added).
4. `mmd lessons match "git checkout to switch branches"` returns L-003 (and possibly L-008) in its match list.
5. Running `mmd --here "<trivial change involving git checkout>"` produces a `composer.json` showing L-003 injected.
6. README + ADR-010 in place.
7. `MAKE_MY_DREAMS.md` §6.5 paragraph noting v0.2e delivered the walking-skeleton composer.
8. Version bumped to `0.2.7` (or whatever's next after v0.2.g's tag).
9. Slice merged to main via `mmd ship`.
10. `scripts/audit-pillars.sh --with-composer main..HEAD` reports composer activity.
11. L-017 captured if any failure surfaces.
12. **Reflexive milestone**: this is the **sixth** use of `mmd --here` (after L-010/L-011/L-013/L-015/L-016). If clean, the pattern is solid — propose to elevate "mmd --here is the supported workflow" from rule-in-lessons to explicit statement in `commit-git.md` constitution module.

---

*Spec v0.2e — generated 2026-05-17 alongside v0.2c and v0.2.g specs. To be implemented LAST of the three because it benefits from v0.2.g's `_common/invoke-claude.js` extraction (one less wiring point). Sixth reflexive use of mmd --here. If v0.2e lands clean, the **autolearning loop §6.5 is operational** — failures begin to compound into lessons that compound into better future runs, without human-in-the-loop.*
