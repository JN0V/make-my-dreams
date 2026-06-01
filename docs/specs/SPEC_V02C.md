# Make My Dreams — v0.2c Spec: Project Onboarder (`mmd discover`)

> Per scoping `MAKE_MY_DREAMS.md` §6.7 + §1400 roadmap entry — the Project Onboarder is the gate that turns "MMD works on any project" from claim to reality. Without it, `mmd --here` runs on a non-MMD repo with zero project-specific context: auto-dev gets the change request but no awareness of the stack, conventions, existing specs, or open work. v0.2c delivers the **walking-skeleton onboarder**: a `mmd discover [<path>]` subcommand that scans a target repo, ingests structured artifacts (Spec Kit / BMAD / OpenSpec), infers conventions from code, and produces a `mmd-discovery-report.md` for human validation. Non-intrusion is the constitutional invariant: the onboarder writes only in `.mmd/`, `docs/` (new files), and the root report — never modifies existing code or specs. v0.2c is the slice that **finally makes brownfield real**, validating the §1bis positioning ("MMD stands on the shoulders of existing frameworks rather than replacing them") in working code rather than design intent.

---

## 1. Goal of v0.2c

Deliver a `mmd discover [<path>]` subcommand that:

1. **SCAN** — inventories an existing target directory: methodologies present (`.specify/`, `_bmad/`, `openspec/`, `docs/stories/`, ADRs), code (language, framework hints, structure), git age + activity.
2. **INGEST** — structured import of detected artifacts: Spec Kit constitution → `.mmd/shared/constitution/imported.md`, BMAD stories → `.mmd/shared/status.json` consolidated, specs → `vision.md` candidate.
3. **INFER** — for what wasn't found: grep + file analysis (no vector RAG per P-13) to extract conventions (lint config, test runner, build tool, naming patterns). Optionally LLM-augmented via `--infer-with-claude` flag (default: deterministic only for v0.2c walking-skeleton).
4. **REPORT** — produces `mmd-discovery-report.md` at the root of the target: detected case (Rich / BMAD-alone / Blank / Already-onboarded), what was scanned, what was ingested, what was inferred, hypotheses to validate, contradictions detected.
5. **VALIDATION GATE** — until the user runs `mmd discover --approve` (or edits + re-runs), other `mmd` commands that would modify code in the target (`mmd --here`, `mmd <dream>` if there's an existing `package.json`) emit a blocking warning: `Brownfield project detected, no validated discovery report. Run \`mmd discover\` first, or pass --skip-onboarding to override (NOT RECOMMENDED).`

Non-intrusion (constitutional, NON-NEGOTIABLE): the onboarder **never** modifies existing code, never overwrites existing specs, never touches `.git/`. Writes only in:
- `.mmd/shared/` (team-shared per §6.8)
- `.mmd/local/` (gitignored)
- `docs/` (NEW files only, never overwriting)
- `mmd-discovery-report.md` at root (creates or updates with explicit confirmation)

**Why this version exists**: the user just asked "can I use MMD on other projects?" The honest answer today is "yes for `mmd ship`, partially for `mmd --here` after `install-mmd.sh`, but auto-dev runs blind." v0.2c is the slice that closes the blindness — auto-dev henceforth gets a project context summary in its prompt, drawn from the validated discovery report.

**Mission validation**: after v0.2c, the user can pick any of his existing projects (one rich-with-specs, one blank, one in spec-sprawl), run `mmd discover .` in it, and get a useful report he can validate in <5 min, then use `mmd --here "small change"` and observe that auto-dev's behavior reflects the project's actual stack/conventions.

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: `mmd discover` subcommand recognized

**Given** MMD v0.2c installed
**When** the user runs `mmd discover`, `mmd discover <path>`, `mmd discover --help`, `mmd discover --approve`, `mmd discover --refresh`
**Then** the CLI:
- Routes to the discover handler (early branch, like `bench` and `ship`)
- `mmd discover --help` prints usage including: `<path>` default cwd, `--approve` (mark existing report as validated), `--refresh` (re-run from scratch overwriting `.mmd/shared/project-onboarder/last.md`), `--infer-with-claude` (LLM augmentation, slower), `--no-report-update` (scan only, no `mmd-discovery-report.md` modification).
- `mmd discover .` (or no arg) defaults to cwd.
- Exit codes: 0 ok / 2 user-argv error / 3 target path doesn't exist or not a directory / 4 target is not a git repo (warning, not blocker — `mmd discover --force-non-git` to override).

Tag: `@unit` for subcommand routing + flag parsing, `@integration` for `--help`.

### AC-2: SCAN phase — passive inventory

**Given** the user runs `mmd discover <path>` on a target directory
**When** the SCAN phase runs
**Then** the onboarder detects (without modifying anything):
- **Methodologies** present: `.specify/` (Spec Kit), `_bmad/` (BMAD), `openspec/` (OpenSpec), `docs/stories/` (BMAD stories convention), `docs/adr/` (ADRs), `.mmd/` (already onboarded?), `CLAUDE.md`, `MAKE_MY_DREAMS.md`.
- **Code**: dominant language (file count by extension), framework hints (`package.json` → React/Vue/Next, `pyproject.toml` → Python, `Cargo.toml` → Rust, `go.mod` → Go, etc.), test runner (`jest.config.js`, `vitest.config.ts`, `pytest.ini`, etc.), build tool, lint config.
- **Git**: HEAD SHA, default branch (best-effort: `main` or `master` or first listed), age (first commit date), activity (commits in last 90 days).
- The scan writes its output as a JSON to `.mmd/shared/project-onboarder/scan.json` — schema versioned (`{ "scan_version": 1, ... }`).

Tag: `@unit` for each detector (language, framework, test runner) on synthetic fixture dirs. `@integration` for full scan on a fixture brownfield repo under `test/fixtures/discover-repos/`.

### AC-3: INGEST phase — structured import

**Given** SCAN detected methodologies present (Spec Kit, BMAD, OpenSpec)
**When** the INGEST phase runs
**Then** the onboarder:
- If Spec Kit detected: copies `.specify/memory/constitution.md` (or modular index) into `.mmd/shared/constitution/imported.md`, prefixing with a header noting `imported-from: spec-kit` + source SHA.
- If BMAD detected with `docs/stories/`: reads each story file, classifies into `done` / `in-progress` / `draft` based on conventional frontmatter or section names, writes consolidated `.mmd/shared/status.json` with a `stories` array (one entry per story with status + path + title).
- If OpenSpec detected: copies relevant openspec files into `.mmd/shared/openspec-imported/`.
- If specs / plans found (`docs/spec.md`, `SPEC*.md`, etc.) outside of these methodologies: lists them in `.mmd/shared/project-onboarder/specs-found.json` for the user to triage.
- All operations are READ-ONLY on the target's existing files. Writes ONLY in `.mmd/shared/`.

Tag: `@unit` for each importer with synthetic fixtures (`test/fixtures/discover-repos/{spec-kit-rich,bmad-with-stories,blank,already-onboarded}/`). `@integration` for the full INGEST orchestration.

### AC-4: INFER phase — deterministic conventions extraction

**Given** SCAN + INGEST have run
**When** the INFER phase runs (in `--infer-with-claude=false` default mode)
**Then** the onboarder writes `.mmd/shared/project-onboarder/inferred.md` containing:
- **Stack summary** (from SCAN data): "JavaScript project, Node 20+, Vitest test runner, ESLint+Prettier, no Tailwind detected"
- **Naming patterns** (grep-based): function/class naming conventions sampled from `src/` (or equivalent), top 5 file extensions, presence of TypeScript.
- **Test conventions**: detected runner + which dirs have tests (`test/`, `tests/`, `__tests__/`, `*.test.js` colocated).
- **Documentation conventions**: presence of `CONTRIBUTING.md`, `CHANGELOG.md`, `README.md` (with line count), `docs/` structure.
- **Commit conventions** (best-effort): scan last 30 commits, detect Conventional Commits prefix usage rate, detect AI-mention frequency.

The deterministic INFER is fast (<5 s on a normal repo). If the user passes `--infer-with-claude`, an LLM pass adds: code style notes, architectural patterns observed, potential improvements (advisory, never automatically actioned).

Tag: `@unit` for each inference function. `@integration` for INFER on each fixture repo case.

### AC-5: REPORT phase — `mmd-discovery-report.md` generation

**Given** SCAN + INGEST + INFER have completed
**When** the REPORT phase runs
**Then** the onboarder writes `mmd-discovery-report.md` at the target root containing:

```markdown
# MMD Discovery Report

> Generated by `mmd discover` at <ISO timestamp> on <target path>
> Status: PENDING VALIDATION — run `mmd discover --approve` after review
> MMD version: <semver>

## Detected case
<one of: Rich (Spec Kit + BMAD) / BMAD-alone (possible spec sprawl) / Blank (no SDD) / Already-onboarded (refresh)>

## Scanned
- Methodologies: <list>
- Languages: <primary> (+ <secondary>)
- Frameworks: <list>
- Test runner: <name>
- Git: <age>, <commits-last-90d> commits in 90 days, default branch <name>

## Ingested
- <bullet list of files copied into .mmd/shared/...>

## Inferred
- Stack: <summary>
- Conventions: <summary>
- Tests: <summary>
- Docs: <summary>
- Commits: <summary>

## Hypotheses to validate (please review)
1. <hypothesis>
2. <hypothesis>

## Contradictions / surprises
- <only if any>

## Suggested next step
<one of: "Run `mmd discover --approve` then `mmd --here \"<small change>\"` to test." / "Validate the imported Spec Kit constitution at .mmd/shared/constitution/imported.md before proceeding." / etc.>

---

*This report was generated automatically. Edit it freely to correct errors; re-run `mmd discover --refresh` to regenerate from scratch.*
```

Also writes `.mmd/shared/project-onboarder/last.md` = a snapshot of the same report (audit trail; the root file is what the user sees, this one is what MMD's other commands consume).

Tag: `@integration` for report shape + content on each fixture case.

### AC-6: 3 canonical cases handled with fixture-tested behavior

**Given** the v0.2c slice ships
**When** running `mmd discover` on each fixture
**Then**:

- **Case A — Rich (Spec Kit + BMAD)**: fixture `test/fixtures/discover-repos/rich/` (mini Spec Kit constitution + 3 BMAD stories + an ADR). Report says `Detected case: Rich`. Imports the Spec Kit constitution + consolidates the 3 stories into status.json. Hypotheses include "the imported constitution differs from MMD's default — review at .mmd/shared/constitution/imported.md".
- **Case B — BMAD-alone with spec sprawl**: fixture `test/fixtures/discover-repos/bmad-sprawl/` (15 stories: 5 done, 5 draft, 5 obsolete-looking). Report says `Detected case: BMAD-alone (possible spec sprawl)`. Lists stories with classification + flags the sprawl: "15 stories detected, 5 marked done — recommend cross-check vs code (deferred to v0.2c+)".
- **Case C — Blank**: fixture `test/fixtures/discover-repos/blank/` (just package.json + src/ + README). Report says `Detected case: Blank (no SDD methodology)`. Inferred section is the bulk of the report. Suggests: "Run `mmd discover --approve` then `mmd --here \"<change>\"` — auto-dev will use the inferred stack."

All 3 fixture cases pass an `@integration` test asserting expected report structure + key strings.

Tag: `@integration` (3 tests, one per case).

### AC-7: Validation gate — blocking warning on subsequent mmd commands

**Given** the target has a `mmd-discovery-report.md` that's PENDING VALIDATION (not yet `--approve`d)
**When** the user runs `mmd --here "<change>"` or `mmd "<dream>"` in that directory
**Then** the CLI:
- Detects the pending report (presence + the `Status: PENDING VALIDATION` line)
- Emits to stderr: `Brownfield project detected with a pending discovery report. Review mmd-discovery-report.md, then run \`mmd discover --approve\` to mark it validated. To bypass this gate (not recommended), pass --skip-onboarding.`
- Refuses to proceed unless `--skip-onboarding` flag is present (exit code 5)
- `mmd discover --approve` flips the report's `Status:` line to `VALIDATED at <timestamp>` and removes the gate for subsequent runs.

If NO `mmd-discovery-report.md` exists but the target looks like a brownfield project (any of the SCAN signals: existing `package.json`/`pyproject.toml`/etc. + git history > 1 commit), `mmd --here` and `mmd <dream>` emit: `Brownfield project detected and no discovery report. Run \`mmd discover\` first, or pass --skip-onboarding to bypass.`

The gate is NOT triggered if the target directory is empty / has only a fresh git init / is recognized as MMD itself (presence of `MAKE_MY_DREAMS.md` at root). The gate IS triggered for any other "looks-existing" target.

Tag: `@integration` end-to-end with fixture repos in each state.

### AC-8: Documentation + ADR

**Given** v0.2c ships
**When** the user reads `README.md` and `docs/adr/008-project-onboarder-walking-skeleton.md`
**Then**:
- README has `### Discover mode (mmd discover)` subsection in `## Usage`, explaining: when to run, what it produces, the validation gate, link to scoping §6.7 for the full design.
- README also gets a "Brownfield" subsection under `## Install` that walks the user through: `cd /your/project && bash ~/Documents/make-my-dreams/install-mmd.sh . && mmd discover . && <review> && mmd discover --approve`.
- ADR-008 covers: why the validation gate is blocking by default (per scoping §6.7 + Bundle A risk), why INFER is deterministic in v0.2c with optional LLM (cost + reproducibility for walking-skeleton), why we ship 3 fixture cases (Rich / BMAD-sprawl / Blank — the 3 explicit scoping cases), what's NOT in v0.2c (auto-trigger by Tech Architect, story-vs-code cross-check, vision.md synthesis — all deferred to v0.2c+).
- `MAKE_MY_DREAMS.md` §6.7 gets a paragraph noting v0.2c delivered the walking skeleton with `<sha>` and `<date>`.

Tag: `@unit` for README anchor presence.

---

## 3. Architecture (incremental)

```
mmd discover [<path>] [--approve|--refresh|--infer-with-claude|--no-report-update]
   │
   ▼
[0] argv parser — recognizes 'discover' as early-branch subcommand
   │
   ▼
[1] Validate path (exists, is directory; if not a git repo, warn but proceed unless blocked by AC-1)
   │
   ▼
[2] Phase SCAN → write .mmd/shared/project-onboarder/scan.json
   │
   ▼
[3] Phase INGEST → copy artifacts into .mmd/shared/
   │
   ▼
[4] Phase INFER → write .mmd/shared/project-onboarder/inferred.md
   │
   ▼
[5] Phase REPORT → assemble mmd-discovery-report.md + .mmd/shared/project-onboarder/last.md
   │
   ▼
[6] Print summary + exit 0
```

The validation gate (AC-7) is implemented separately in `bin/mmd.js` for the `--here` and dream paths — they consult a small `lib/discover/gate.js` helper.

### Project structure (additions only)

```
make-my-dreams/
├── bin/
│   ├── mmd.js              # modified — 'discover' subcommand dispatch + gate hook for --here/dream paths
│   └── discover.js         # NEW — mmd discover entry point (thin coordinator)
├── lib/
│   ├── discover/
│   │   ├── scan.js         # NEW — methodologies/code/git detection (pure functions where possible)
│   │   ├── ingest.js       # NEW — Spec Kit / BMAD / OpenSpec importers
│   │   ├── infer.js        # NEW — deterministic + optional LLM-augmented
│   │   ├── report.js       # NEW — markdown assembly
│   │   ├── gate.js         # NEW — checks for pending/missing discovery report
│   │   └── classify.js     # NEW — pure function: scan-data → case (Rich/BMAD-alone/Blank/Already-onboarded)
│   └── argv-parser.js      # modified — recognize 'discover' subcommand
├── test/
│   ├── unit/
│   │   ├── discover-scan.test.js          # NEW
│   │   ├── discover-ingest.test.js        # NEW
│   │   ├── discover-infer.test.js         # NEW
│   │   ├── discover-report.test.js        # NEW
│   │   ├── discover-gate.test.js          # NEW
│   │   ├── discover-classify.test.js      # NEW
│   │   └── argv-parser.test.js            # modified
│   ├── integration/
│   │   ├── discover-rich.test.js          # NEW — Case A
│   │   ├── discover-bmad-sprawl.test.js   # NEW — Case B
│   │   ├── discover-blank.test.js         # NEW — Case C
│   │   ├── discover-already.test.js       # NEW — refresh path
│   │   └── discover-gate-here.test.js     # NEW — AC-7 end-to-end with mmd --here
│   └── fixtures/discover-repos/
│       ├── rich/                          # Spec Kit + BMAD mini setup
│       ├── bmad-sprawl/                   # 15 stories assorted statuses
│       ├── blank/                         # just package.json + src/ + README
│       └── already-onboarded/             # has .mmd/ + VALIDATED report
└── docs/adr/
    └── 008-project-onboarder-walking-skeleton.md  # NEW
```

---

## 4. Out of scope for v0.2c

- ❌ Auto-trigger by Tech Architect (scoping §6.7 paragraph "Auto-trigger by the Tech Architect"). The Tech Architect Worker doesn't exist yet; deferred to v0.5+ when Workers are real.
- ❌ Story-vs-code cross-check (scoping §6.7 Case B "Cross-check stories ↔ real code"). v0.2c lists stories with their declared status; verification against actual code is v0.2c+.
- ❌ Implicit ADR extraction from commits (scoping Case B). v0.2c+.
- ❌ Synthesized `vision.md` from grouped delivered stories (scoping Case B). v0.2c+.
- ❌ Archival plan for dormant stories (scoping Case B). v0.2c+.
- ❌ Worker `explorer` per scoping §6.7 (the Worker construct itself doesn't exist). Inference is in-process functions in v0.2c, not a Worker invocation.
- ❌ Vector RAG (per P-13 — explicitly NOT building it ever).
- ❌ A new engine (FAST/STANDARD/DEEP). `mmd discover` is a meta-command, not a dev pipeline.

---

## 5. Implementation hints (for auto-dev)

### Pre-implementation checks

1. Read SPEC_V02C.md (this file) fully — it's authoritative.
2. Read scoping §6.7 (Brownfield onboarding) for the design rationale.
3. Read `.specify/memory/constitution/brownfield.md` — the constitutional rules that apply.
4. Read `docs/lessons-learned.md` (L-001..L-013) — apply them all.

### Key risks to handle

- **Non-intrusion is sacred**: every write path must be `.mmd/`, `docs/<new file>`, or `mmd-discovery-report.md`. NEVER touch existing user files. Add a defensive check in `lib/discover/*.js` that asserts `outputPath.startsWith(target + '/.mmd/') || outputPath === target + '/mmd-discovery-report.md' || /^docs\//.test(rel)`. Fail loud if violated.
- **Fixture-repo creation**: the 4 fixture dirs under `test/fixtures/discover-repos/` need realistic structure but NOT real `.git/` (use git init in the test setUp if needed, then tear down). Beware: creating fixture git repos can leak into the host repo if done carelessly — always use isolated tmp dirs in test setup.
- **Classify is pure**: `classify(scanData) → 'rich' | 'bmad-alone' | 'blank' | 'already-onboarded'` should be a pure function, fully unit-testable without filesystem.
- **REPORT is deterministic**: same input → same output (modulo timestamp). For tests, freeze the timestamp injection (mock `Date.now()` or accept a `clock` arg).
- **Gate is opt-out-only**: `--skip-onboarding` works, but the gate is on by default. Don't add a config file to disable it permanently in v0.2c — keep the friction visible.
- **Case detection priority**: if `.mmd/shared/project-onboarder/last.md` exists AND has `VALIDATED`, it's `already-onboarded`. Else if Spec Kit OR BMAD detected, it's `rich` (Spec Kit takes precedence if both). Else if `docs/stories/` with 10+ files, it's `bmad-sprawl`. Else `blank`.
- **Already-onboarded refresh**: `mmd discover --refresh` re-runs all phases; without `--refresh`, if `last.md` exists, the report only updates the timestamp + a "no changes detected" note (saves time on re-runs).

### Apply lessons L-001..L-013

- **L-001/L-002/L-006**: standard launch hygiene if auto-dev needs subprocess work.
- **L-003**: any side work during this slice goes through `git worktree add ../mmd-side`.
- **L-004**: verify DoD explicitly at end. Definition of Done is §6.
- **L-005 + L-007**: NO hardcoded version strings or slug paths in tests.
- **L-008**: never `git branch -d` on warning.
- **L-009 + L-012**: keep distinguishing design (scoping §6.7) from current implementation (this walking skeleton's reduced scope §4).
- **L-010 + L-011 + L-013**: this is the **fourth** reflexive use of `mmd --here`. Capture L-015 with the duration + commit SHA at the end of this slice if it works, regardless of new failures.

### Constitution module bindings

Active during this work:
- `universal.md`, `ai-coding.md` (always)
- `commit-git.md` (slice workflow)
- `testing.md` (red-green; @unit first, then @integration)
- `security.md` (non-intrusion guarantee — defensive checks on every write path)
- `error-handling.md` (exit codes 0/2/3/4/5)
- `documentation.md` (README + ADR-008 + scoping update)
- `observability.md` (scan.json schema, report.md format)
- `brownfield.md` (THIS spec embodies brownfield's V "Phase 0 discovery before any code" — make the rule operational)

---

## 6. Definition of done

v0.2c is done when:

1. All 8 ACs met.
2. Full test suite passes (current 430 + new tests, expected 480-520).
3. `mmd discover .` on the MMD repo itself recognizes it as `already-onboarded` (because `.mmd/shared/project-onboarder/last.md` will exist after this slice runs).
4. Each of the 3 canonical cases (Rich / BMAD-sprawl / Blank) passes its `@integration` test with the expected report structure.
5. README updated: `### Discover mode (mmd discover)` subsection + `Brownfield` subsection under `## Install`.
6. ADR-008 written.
7. `MAKE_MY_DREAMS.md` §6.7 paragraph noting v0.2c delivered the walking skeleton.
8. Version bumped to `0.2.4` (`mmd --version` returns `0.2.4`).
9. Slice merged to main via `mmd ship` (acid test of v0.2.3 — ship using the ship from the previous slice) — or fall back to manual + capture a lesson if ship fails.
10. Tag `v0.2.4` created.
11. `scripts/audit-pillars.sh main..HEAD` still reports BMAD + gStack INVOKED ≥ 1 each (regression check on L-012's closure).
12. L-015 captured with the duration of THIS auto-dev run, since it's the 4th reflexive use after L-010/L-011/L-013 — pattern is now strong enough to justify promotion candidate review.

---

*Spec v0.2c — generated 2026-05-17 from scoping §6.7 + the user's brownfield question. To be implemented via `mmd --here` on the auto-generated slice branch. Fourth reflexive use of the supported workflow. After this lands, the answer to "can I use MMD on other projects?" becomes "yes, run `install-mmd.sh` + `mmd discover` + `--approve`, then you're in business."*
