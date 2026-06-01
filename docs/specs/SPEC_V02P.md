# Make My Dreams — v0.2.p Spec: `mmd handover` — auto-refresh the State block (L-020 closure)

> HANDOVER.md transfers *intent* (what's next + why) across context switches. Most of it — roadmap, operational rules, the "why" — is human prose that NO tool can derive. But one block, "State at handover" (latest tag, branch, version, lesson/ADR counts, recent commits), is purely mechanical, error-prone to maintain by hand, and silently drifts: as of this slice the live HANDOVER.md claims "17 active lessons" while the authoritative parser (`parseLessons`) counts **13**. v0.2.p adds `mmd handover`, a subcommand that re-derives ONLY that mechanical block from git + repo files and rewrites it in place between two markers, leaving every human-authored section byte-for-byte untouched. It never fabricates intent (constitution universal §VI honesty) and never runs the test suite (SRP — a doc generator is not a test runner): the one non-cheap field, the test count, is supplied via `--tests N` or left as an explicit "stale, refresh me" marker. This closes the L-020 candidate: session handover formalized as a command, not a manually-curated wiki page.

---

## 1. Goal of v0.2.p

A new `mmd handover [--tests N] [--dry-run] [--help]` subcommand that:

1. **Derives the mechanical State block** from deterministic, cheap sources:
   - Latest tag — `git describe --tags --abbrev=0`
   - Current branch — `git branch --show-current`
   - `mmd` version — `package.json` `version`
   - Active-lessons count + ids — `parseLessons(docs/lessons-learned.md)` filtered to `status === 'active'` (authoritative; replaces hand-counting)
   - ADR count — number of `docs/adr/*.md`
   - Recent commits — `git log --oneline -N` (default N=5)
   - Test count — from `--tests N` if given; else an explicit placeholder (NEVER an invented or silently-stale number)
2. **Rewrites the block in place** between `<!-- mmd:handover:state:start -->` and `<!-- mmd:handover:state:end -->` markers in HANDOVER.md. Everything outside the markers is preserved exactly.
3. **Is idempotent**: running it twice with the same repo state + same `--tests` value produces an identical file.

Reuses the existing injectable git runner (`lib/skills/_common/git.js#runGit`) and lessons parser (`lib/composer/parse-lessons.js#parseLessons`) — no new git/parse plumbing.

**Non-features** (deliberately deferred):
- Generating or templating any INTENT section ("What just shipped", "Planned next", operational rules, special considerations). These are human prose; the tool refuses to fabricate them (§VI).
- Running `npm test` to obtain the count (`--run-tests` flag) — out of scope (SRP + determinism). The count comes from `--tests N` or a placeholder.
- Creating HANDOVER.md from nothing. The command refreshes an existing file's State block; a full scaffold generator is a separate concern.
- Auto-committing the refreshed file (the human reviews + commits — commit-git §I gate).

**Why this exists**: this very session hand-edited the State block three times (v0.2.14, v0.2.15) and still left the active-lessons count wrong (17 vs the real 13). Mechanical state should be machine-derived; only intent deserves human authorship. `mmd handover` draws that line in code.

**Mission validation**: after v0.2.p, `mmd handover --tests 1055 --dry-run` prints a HANDOVER.md whose State block shows tag `v0.2.16`, `13` active lessons, `20` ADRs — all auto-derived — with every intent section unchanged from the input.

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: `mmd handover` is registered, dispatched, and self-documents

**Given** the CLI
**When** `mmd handover --help` runs
**Then**:
- `'handover'` is a member of `SUBCOMMANDS` (`lib/argv-parser.js`)
- `bin/mmd.js` dispatches `handover` to a `bin/handover.js` entry point (mirrors the `unblock` / `document-lessons` dispatch pattern)
- `--help` prints usage (synopsis, the three flags, an example) and exits 0
- `parseHandoverArgs` recognizes `--tests <N>` (value), `--dry-run` (bool), `--help` (bool); rejects unknown flags with exit 2 and a hint; `--tests` with a non-integer or missing value → exit 2

Tag: `@unit` for `parseHandoverArgs`.

### AC-2: The State block is derived deterministically from cheap sources

**Given** injected git runner, file readers, and clock
**When** the pure State-block builder runs
**Then** it returns a markdown block containing, each on its own labeled line:
- Latest tag (from `git describe --tags --abbrev=0`)
- Branch (from `git branch --show-current`)
- `mmd` version (from `package.json`)
- Active-lessons count AND the id list (from `parseLessons`, `status==='active'` only) — proves it would render `13`, not `17`, for the current repo
- ADR count (count of `docs/adr/*.md`)
- Recent commits — `git log --oneline -N` (default 5), each line `<sha> <subject>`
- A `Generated: <date>` line from the INJECTED clock (deterministic in tests)
- Each git call goes through `runGit`; a failing git call yields a explicit `(unavailable: <reason>)` field value, never a crash and never a fabricated value

Tag: `@unit` (all I/O injected; no real git/fs).

### AC-3: Marker-based in-place rewrite preserves all human content

**Given** a HANDOVER.md containing the two markers
**When** `mmd handover` runs
**Then**:
- Only the text between `<!-- mmd:handover:state:start -->` and `<!-- mmd:handover:state:end -->` (inclusive of the boundary handling, exclusive of the marker lines themselves) is replaced
- Every byte outside the markers is preserved exactly (assert via a fixture diff: intent sections, headings, trailing prose all identical)
- **Idempotency**: running twice with identical repo state + identical `--tests` produces a byte-identical file
- **Missing markers**: if either marker is absent, the command does NOT guess where to write — it exits non-zero (proposed exit 4) with a message that prints the generated block and instructs the user to add the two marker lines where they want it

Tag: `@integration` (temp HANDOVER.md fixture).

### AC-4: Test count is honest — `--tests N` or an explicit placeholder

**Given** the test-count field
**When** the block is rendered
**Then**:
- With `--tests 1055`: the field reads `1055 passing` (or equivalent)
- Without `--tests`: the field reads an explicit placeholder such as `Tests: (run \`npm test\` to refresh)` — the command MUST NOT copy a stale number from the existing file nor invent one (§VI honesty)
- `--tests` accepts only a non-negative integer; anything else → exit 2

Tag: `@unit`.

### AC-5: `--dry-run` writes nothing

**Given** `mmd handover --dry-run`
**When** it runs against a HANDOVER.md with markers
**Then**:
- The fully-rewritten HANDOVER.md content is printed to stdout
- The file on disk is NOT modified (assert mtime / content unchanged)
- Exit 0

Tag: `@integration`.

### AC-6: Documentation + ADR + lesson + live markers

**Given** v0.2.p ships
**When** the docs are read
**Then**:
- An ADR numbered 020 (slug `mmd-handover-subcommand`) under the ADR folder documents: the mechanical-vs-intent split, why the tool refuses to author intent (§VI), why `--tests N` over auto-running the suite (SRP + determinism), and the marker-based contract
- `docs/lessons-learned.md` gains a formal **L-020** entry (status active, with `Category` / `Applies to` / `Keywords for matching`) describing the "mechanical state drifts when hand-maintained" pattern and the command that fixes it
- `README.md` mentions `mmd handover` in its subcommand list
- The live `HANDOVER.md` gets the two marker lines added around its existing "State at handover" block, so the command works on it immediately (and running the command corrects the stale `17 → 13` active-lessons count)

Tag: `@unit` for README/ADR/lesson/marker anchor presence.

---

## 3. Architecture (incremental)

```
New subcommand (mirrors unblock / document-release):
  bin/handover.js                    — NEW entry point: parse args, gather state, rewrite or --dry-run
  lib/handover/build-state-block.js  — NEW pure builder: (injected git/fs/clock) -> markdown block
  lib/handover/rewrite-markers.js    — NEW pure rewriter: (fileText, block) -> newText | {missingMarkers}
  lib/argv-parser.js                 — modified: add 'handover' to SUBCOMMANDS + parseHandoverArgs
  bin/mmd.js                         — modified: dispatch 'handover'

Reused (no change):
  lib/skills/_common/git.js#runGit          — all git calls
  lib/composer/parse-lessons.js#parseLessons — active-lessons count + ids
```

### Files modified / added

```
make-my-dreams/
├── bin/
│   ├── mmd.js                                  # modified — dispatch + USAGE line
│   └── handover.js                             # NEW — entry point
├── lib/
│   ├── argv-parser.js                          # modified — SUBCOMMANDS + parseHandoverArgs
│   └── handover/
│       ├── build-state-block.js                # NEW — pure state-block builder
│       └── rewrite-markers.js                  # NEW — pure marker rewriter
├── test/
│   ├── unit/
│   │   ├── handover-argv.test.js               # NEW — AC-1
│   │   ├── handover-build-state-block.test.js  # NEW — AC-2 + AC-4
│   │   └── handover-rewrite-markers.test.js     # NEW — AC-3 idempotency + missing-markers
│   └── integration/
│       └── handover-dry-run.test.js            # NEW — AC-5 + end-to-end rewrite
├── docs/
│   ├── lessons-learned.md                      # modified — L-020 entry
│   └── adr/020-mmd-handover-subcommand.md      # NEW
├── HANDOVER.md                                 # modified — add the two state markers
├── README.md                                   # modified — subcommand mention
└── package.json                                # modified — version 0.2.16
```

---

## 4. Out of scope for v0.2.p

- ❌ Generating any INTENT section (roadmap, operational rules, "why") — the tool refuses to fabricate (§VI).
- ❌ Auto-running `npm test` (`--run-tests`) — SRP + determinism; count comes from `--tests N` or a placeholder.
- ❌ Creating HANDOVER.md from scratch / full scaffold — refresh-in-place only.
- ❌ Auto-committing the refreshed file — the human reviews + commits (commit-git §I).
- ❌ **Scale assumption**: `git log --oneline -N` reads a small fixed N (default 5); this is fine for a single-repo handover and is not meant to paginate full history.

---

## 5. Implementation hints (for auto-dev)

### Pre-implementation
1. Read SPEC_V02P.md (this file).
2. Read `bin/conductor/unblock.js` + `bin/skills/document-release.js` for the entry-point pattern, and `lib/argv-parser.js#parseDocumentReleaseArgs` / `parseBranchedSkillArgs` for the arg-parser conventions.
3. Read `lib/skills/_common/git.js#runGit` (the injectable git runner — reuse it; do NOT reinvent) and `lib/composer/parse-lessons.js#parseLessons` (active-lessons source).
4. Keep `build-state-block.js` and `rewrite-markers.js` PURE (injected git/fs/clock), mirroring `lib/conductor/stall-detector.js`'s injection style — so tests need no real git/fs.

### Key risks
- **Never fabricate**: a missing tag, empty branch, or git failure renders an explicit `(unavailable: …)` value — not a guess, not a stale copy (§VI).
- **Markers are the contract**: if absent, do NOT guess insertion point — exit non-zero and print the block (AC-3). This keeps the rewrite deterministic and safe.
- **Idempotency**: the builder output for a fixed repo state + fixed `--tests` MUST be byte-stable. Inject the clock so `Generated:` does not break determinism in tests.
- **Preserve outside-marker bytes exactly**: do not normalize, re-wrap, or re-indent the rest of the file.
- **Active-lessons count comes from `parseLessons`**, not a regex — that is the whole point (the live file's hand-count is wrong: 17 vs 13).

### Apply L-001..L-020 (and the promoted L-002/L-016 in ai-coding.md)
- **L-016**: launch with `MMD_TIMEOUT_MS=0` + spec-frozen.
- **L-019**: commit incrementally per AC.
- **universal §VII** (NEW, this is the first slice to exercise `--label`): the slice branch is named via `mmd --here --label "mmd-handover-subcommand"`.

### Constitution module bindings
Active: universal (incl. §VII), ai-coding, commit-git, testing, error-handling, documentation.

---

## 6. Definition of done

v0.2.p is done when:

1. All 6 ACs met.
2. Full test suite passes (current 1055 + new tests, expected ~1075-1090).
3. `mmd handover --tests 1055 --dry-run` renders a State block with the correct auto-derived tag / `13` active lessons / `20` ADRs, every intent section unchanged.
4. Running `mmd handover --tests <n>` on the live HANDOVER.md corrects the stale active-lessons count (17 → 13) and leaves all prose untouched; re-running is idempotent.
5. README + ADR-020 + L-020 lesson entry + the two markers added to HANDOVER.md.
6. Version bumped to `0.2.16`.
7. Slice merged (ff-only) + tag `v0.2.16`.
8. 14th reflexive use of `mmd --here` — and the FIRST to use the new `--label` flag (validates v0.2.15 end-to-end: the branch is `slice/here-mmd-handover-subcommand-<ts>`, human-readable).

---

*Spec v0.2.p — drafted 2026-05-31. L-020 closed: session handover's mechanical State block is now a command (`mmd handover`), not a hand-curated section that drifts. Intent stays human (§VI); only the derivable is derived. 14th reflexive use of mmd --here, first with --label.*
