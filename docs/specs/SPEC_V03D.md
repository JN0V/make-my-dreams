# Make My Dreams — v0.3.d Spec: `mmd document-readme` — doc-sync (Documentalist-lite)

> The recurring documentary-drift fix, pulled forward. Each slice's `AC-6` grows the README's per-command docs but nothing maintains the NARRATIVE meta — so on 2026-05-31, at v0.3.3, the README still said "Pre-v0.1 / not yet a usable CLI" and its History stopped at v0.2e (it was hand-patched once in commit `4c46318`, but that rots again next slice). The full Documentalist is ~5 roadmap milestones away (v0.5b). v0.3.d ships the LITE version: a `mmd document-readme` subcommand that applies the proven **`mmd handover` pattern** to the README — regenerate the MECHANICAL meta blocks between markers, preserve all human prose outside them, and never fabricate. It reuses the exact handover machinery (`lib/handover/rewrite-markers.js` for the marker-bounded rewrite, and the same git/version/count builders) and adds an authoritative source the README never had: **`git tag -n` annotations as the changelog**. Two managed blocks — a **Status** block (version + tag + ADR/lesson/reflexive-slice counts) and a **Changelog** block (one line per tag from its annotation) — plus a **drift report** on stdout that flags any `bin/mmd.js` subcommand the README doesn't mention. After v0.3.d, `mmd document-readme --tests N` after each slice keeps the README's mechanical meta honest; the human History/intro prose stays human.

---

## 1. Goal of v0.3.d

A new `mmd document-readme [--tests N] [--dry-run] [--help]` that:

1. **Regenerates two marker-bounded mechanical blocks in `README.md`**, leaving everything outside the markers byte-for-byte unchanged (the §VI honesty + mechanical/intent split that `mmd handover` proved):
   - **Status block** `<!-- mmd:readme:status:start --> … <!-- mmd:readme:status:end -->`: current version (`package.json`), latest tag, ADR count (`docs/adr/*.md`), active-lesson count (`parseLessons`), reflexive-slice count (count of `v0.*` tags or `--here` slices), and the test count (from `--tests N`, else an honest placeholder — never a fabricated or stale number).
   - **Changelog block** `<!-- mmd:readme:changelog:start --> … <!-- mmd:readme:changelog:end -->`: one line per git tag, newest first, rendered from each tag's annotation message (`git tag -n`/`for-each-ref`) — e.g. `- **v0.3.3** — Layer C: profile→constitution-module composer …`.
2. **Reports doc drift on stdout** (does NOT edit prose): compares `bin/mmd.js`'s `SUBCOMMANDS` (and the top-level flags) to what the README mentions, and prints a warning for any subcommand/flag absent from the README. Informational (exit 0); a `--strict` future flag could make it fail CI.
3. **Reuses the handover machinery** — `lib/handover/rewrite-markers.js` (generic marker rewrite, incl. the missing-marker behavior) and the version/tag/count helpers from `lib/handover/build-state-block.js` (extract/share rather than duplicate).

**Mechanical vs intent** (the whole point): the Status + Changelog blocks are mechanical (git/files) → machine-owned. The README's prose History (the *story/rationale*) and the intro/command docs are intent → human-owned, never touched.

**Non-features** (deferred): editing/regenerating the prose History narrative or the command docs; the full event-driven Documentalist (v0.5b — Diataxis coverage, ADR drift, gStack `/document-generate`); auto-running `npm test` (the count comes from `--tests N`, same SRP rule as `mmd handover`); auto-committing the result.

**Mission validation**: `mmd document-readme --tests 1268 --dry-run` prints a README whose Status block shows `v0.3.3 / 24 ADRs / 16 lessons / 1268 tests` and whose Changelog block lists every tag from its annotation, with the intro, command docs, and prose History identical to the input; the drift report lists any undocumented subcommand (expected: none today).

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: `document-readme` registered, dispatched, self-documenting
**Given** the CLI
**When** `mmd document-readme --help` runs
**Then**: `'document-readme'` is in `SUBCOMMANDS` (`lib/argv-parser.js`); `bin/mmd.js` dispatches it to a `bin/documentalist/document-readme.js` entry point (mirroring `document-lessons`); `--help` prints usage (the 3 flags + an example) and exits 0; `parseDocumentReadmeArgs` recognizes `--tests <N>` (value), `--dry-run`, `--help`, rejects unknowns (exit 2), and rejects a non-integer `--tests`.
Tag: `@unit`.

### AC-2: Status block built deterministically from cheap sources
**Given** injected git runner, file readers, and the `--tests` value
**When** the Status-block builder runs
**Then** it returns markdown with: version (`package.json`), latest tag (`git describe --tags --abbrev=0`), ADR count, active-lesson count (`parseLessons`, status active), reflexive-slice count (number of release tags), and the test count (`--tests N` → `N passing`; absent → an explicit `(run \`npm test\` to refresh)` placeholder). Each missing/failed source yields an explicit `(unavailable)` value — never a crash, never a fabricated number. Reuses the `lib/handover/build-state-block.js` helpers.
Tag: `@unit` (all I/O injected).

### AC-3: Changelog block from tag annotations
**Given** an injected git runner returning tags + annotation subjects
**When** the Changelog-block builder runs
**Then** it returns one markdown line per tag, **newest-first**, each `- **<tag>** — <annotation subject>`; lightweight (non-annotated) tags render with a `(no annotation)` note rather than crashing; tags sort by semver-ish order deterministically; an empty tag list yields an explicit "no tags yet" line.
Tag: `@unit`.

### AC-4: Marker-bounded in-place rewrite preserves all prose (reuses handover)
**Given** a README containing the two marker pairs
**When** `mmd document-readme` runs
**Then**: only the text between each `<!-- mmd:readme:status:* -->` / `<!-- mmd:readme:changelog:* -->` pair is replaced (via the SAME `lib/handover/rewrite-markers.js` used by `mmd handover`); every byte outside the markers — intro, command docs, prose History — is preserved exactly (fixture diff); running twice with identical repo state + identical `--tests` is byte-idempotent; a missing marker pair → exit non-zero with the generated block printed + instructions (handover's contract).
Tag: `@integration` (temp README fixture).

### AC-5: Drift report on stdout
**Given** `bin/mmd.js`'s `SUBCOMMANDS` and the README text
**When** `mmd document-readme` runs
**Then**: it prints a "doc drift" report listing any subcommand in `SUBCOMMANDS` not mentioned in the README (and, best-effort, top-level flags like `--here`/`--catch`/`--label` absent from the README); the report is informational (exit 0); it writes NOTHING to the README. With the current repo, the report is empty (all subcommands documented).
Tag: `@unit` (pure compare) + `@integration` (real README + SUBCOMMANDS).

### AC-6: `--dry-run` + docs + live markers
**Given** v0.3.d
**When** the docs are read / `--dry-run` is used
**Then**: `--dry-run` prints the rewritten README to stdout and writes nothing (mtime unchanged); the two marker pairs are added to the live `README.md` (around a Status block and a new Changelog block) so the command works on it immediately; an ADR numbered 025 documents the doc-sync (the `mmd handover` pattern applied to the README, tag-annotations as the changelog source, the mechanical/intent split, deferral of the full Documentalist to v0.5b); `README.md`/`CLAUDE.md` mention `mmd document-readme`. (No new lesson required — this is L-020's pattern reused.)
Tag: `@integration` (dry-run) + `@unit` (anchors).

---

## 3. Architecture (incremental)

```
bin/documentalist/document-readme.js   NEW — entry point (parse args, gather, rewrite or --dry-run, drift report)
lib/readme-sync/build-status-block.js  NEW — version/tag/ADR/lesson/slice/test → markdown (reuses handover helpers)
lib/readme-sync/build-changelog.js     NEW — git tag -n annotations → markdown changelog
lib/readme-sync/detect-drift.js        NEW — pure: SUBCOMMANDS + flags vs README text → missing[]
lib/argv-parser.js                     MODIFY — add 'document-readme' + parseDocumentReadmeArgs
bin/mmd.js                             MODIFY — dispatch + USAGE line

Reused (no/min change):
  lib/handover/rewrite-markers.js          — the marker-bounded rewriter (generic; reuse as-is)
  lib/handover/build-state-block.js        — version/tag/ADR/lesson/git helpers (extract shared bits if needed)
  lib/composer/parse-lessons.js            — active-lesson count
  lib/skills/_common/git.js                — runGit
```

### Files modified / added
```
make-my-dreams/
├── bin/documentalist/document-readme.js              # NEW
├── lib/readme-sync/{build-status-block,build-changelog,detect-drift}.js  # NEW
├── lib/argv-parser.js                                # modified
├── bin/mmd.js                                        # modified — dispatch + USAGE
├── test/unit/readme-sync-{status,changelog,drift}.test.js  # NEW
├── test/unit/document-readme-argv.test.js            # NEW
├── test/integration/document-readme.test.js          # NEW — rewrite + dry-run + drift
├── README.md                                         # modified — add the two marker pairs + mention
├── CLAUDE.md                                          # modified — mention
├── docs/adr/025-document-readme-doc-sync.md          # NEW
└── package.json                                       # modified — 0.3.4
```

---

## 4. Out of scope for v0.3.d
- ❌ Regenerating the prose History narrative or the command docs (intent — human-owned).
- ❌ The full event-driven Documentalist (v0.5b): Diataxis coverage, ADR-drift detection, gStack `/document-generate`/`/document-release` delegation.
- ❌ Auto-running `npm test` (count via `--tests N`, same SRP rule as `mmd handover`).
- ❌ Auto-committing the refreshed README, or a `--strict` CI-failing drift mode (future).
- ❌ Reconciling `MAKE_MY_DREAMS.md`'s roadmap labels (separate doc pass).
- ❌ **Scale assumption**: reads `git tag` (tens of tags) + a handful of files per run; fine.

## 5. Implementation hints (for auto-dev)
1. Read SPEC_V03D.md (this) and the `mmd handover` implementation it mirrors: `bin/handover.js`, `lib/handover/rewrite-markers.js`, `lib/handover/build-state-block.js`. REUSE `rewrite-markers.js` directly; extract/share the git/version/count helpers rather than duplicating.
2. Changelog source = tag annotations: `git for-each-ref --sort=-version:refname --format='%(refname:short)%09%(contents:subject)' refs/tags` (or `git tag -n1`) via `runGit`; render newest-first. A lightweight tag → `(no annotation)`.
3. Keep `build-status-block`, `build-changelog`, `detect-drift` PURE with injected reads; honest on every missing source (universal §VI) — `(unavailable)`/placeholder, never fabricate, never crash.
4. Drift = read `SUBCOMMANDS` from `lib/argv-parser.js` and substring-check the README; informational only.
5. Markers contract is handover's: missing markers → exit non-zero + print the block. Add the live markers in this slice so it self-applies.
6. Constitution bindings: universal (§VI, §VII), ai-coding, commit-git, testing, error-handling, documentation.

## 6. Definition of done
1. All 6 ACs met.
2. Full suite passes (current 1268 + new tests).
3. `mmd document-readme --tests 1268 --dry-run` renders a correct Status block (v0.3.4 / ADR + lesson counts / 1268) and a Changelog block from tag annotations, prose untouched; the drift report is empty for the current repo.
4. Running it for real on `README.md` is idempotent and corrects the mechanical blocks; re-running after the next slice keeps Status/Changelog honest.
5. README + CLAUDE.md mention `mmd document-readme`; ADR-025 in place.
6. Version bumped to `0.3.4`.
7. Slice merged (ff-only) + tag `v0.3.4`.
8. 19th reflexive use of `mmd --here` (6th with `--label`). The README's mechanical meta is now machine-maintained — the doc-drift root cause (narrative rots while the command list grows) is closed by the same `mmd handover` pattern, years before the full v0.5b Documentalist.

---

*Spec v0.3.d — `mmd document-readme`: the `mmd handover` pattern applied to the README. Two marker-bounded mechanical blocks (Status from version/counts, Changelog from tag annotations) + a stdout drift report; human prose preserved. Pulled forward from v0.5b because doc drift compounds every slice.*
