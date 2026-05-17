# Make My Dreams — v0.2b Spec: `mmd bench` (dream-bench v0)

> Per scoping `MAKE_MY_DREAMS.md` §8.3 + §3.5 — dream-bench is the measurement harness that turns the reflexive bootstrap §7 from a process into a feedback loop. Without it, auto-dev runs are anecdotes; with it, they become data. v0.2b ships the smallest dream-bench that delivers signal: 5 canonical dreams, isolated runs, captured metrics, an aggregated report. Out of scope: cost-in-dollars estimation, cross-run comparisons (those land in v0.2b+ or v0.5b). v0.2b is the first slice developed via `mmd --here` (per L-010 rule) — this is the second test of the reflexive bootstrap §7 as the supported workflow.

---

## 1. Goal of v0.2b

Deliver a `mmd bench` subcommand that:

1. Reads a canonical set of **5 dreams** stored in `bench/dreams/*.md` (3 kid + 2 pro per scoping §8.3).
2. Runs each dream sequentially in an isolated `bench/runs/<run-id>/demo/<slug>/` directory, never polluting the user's working `demo/` dir.
3. Captures per-dream metrics (engine, duration, reality-check result, exit code, commits count, optional Phase 4 findings count) into `bench/runs/<run-id>/<slug>/status.json`.
4. Aggregates results into `bench/runs/<run-id>/report.md` (human) + `bench/runs/<run-id>/summary.json` (machine).
5. Returns exit code 0 if all dreams pass their reality check, non-zero otherwise — CI-friendly.
6. Supports `--dry-run` to validate the harness without invoking the real auto-dev (uses the fake-autodev fixture from v0.1/v0.2).

**Why this version exists**: per scoping §8.3 — "Blocking for bootstrap §7: without dream-bench, no safe self-improvement." Right now, every `mmd <dream>` or `mmd --here <change>` run is judged by feel; with v0.2b, regressions become measurable and the autolearning loop (v0.5b) gets a substrate to consume.

**Mission validation**: after v0.2b, `mmd bench --dry-run` exits 0 in under 30 s with a generated report; `mmd bench` (real, opt-in via `MMD_BENCH_REAL=1`) runs the 5 dreams sequentially over several hours and produces a report showing time-to-MVP and reality-check pass-rate per dream.

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: `mmd bench` subcommand recognized

**Given** MMD v0.2b installed
**When** the user runs `mmd bench`, `mmd bench --dry-run`, or `mmd bench --help`
**Then** the CLI:
- Routes to the bench handler (not the dream-creation path)
- `mmd bench --help` prints usage including: subcommand description, `--dry-run`, `--engine <fast|standard|deep>` (default `standard`), `--dreams <id1,id2,…>` (default all 5), `--out-dir <path>` (default `bench/runs/<run-id>/`)
- `mmd bench` without `MMD_BENCH_REAL=1` env var refuses with: `Real bench takes hours; run with MMD_BENCH_REAL=1 to confirm, or pass --dry-run.` Exit code 2.
- `mmd bench --dry-run` always runs (no env var needed)

Tag: `@unit` for subcommand routing + flag parsing, `@integration` for `--dry-run` end-to-end.

### AC-2: 5 canonical dreams live in `bench/dreams/`

**Given** the repo at v0.2b
**When** the user inspects `bench/dreams/`
**Then** the directory contains exactly 5 markdown files, one per canonical dream:

- `kid-01-drawing-camera-overlay.md` — the v0.1 fil-rouge dream ("a drawing app that overlays an image on the camera feed")
- `kid-02-drum-pads.md` — "a simple drum machine with 4 colored pads that play sounds"
- `kid-03-story-dice.md` — "an app that picks 3 random words from a list to start a story"
- `pro-01-csv-viewer.md` — "a CSV viewer that loads a local file and lets me sort columns"
- `pro-02-markdown-preview.md` — "a markdown editor with side-by-side live preview"

Each file follows a documented schema (front-matter `id`, `audience`, `complexity`, `dream`, `reality_check_min_assertions`) — see `bench/dreams/SCHEMA.md`.

Tag: `@unit` for the schema parser, `@integration` for "loading all 5 dreams cleanly."

### AC-3: Each dream runs in isolation

**Given** the user runs `mmd bench --dry-run` (or the real one)
**When** the harness processes each dream
**Then**:
- Each dream gets its own directory `bench/runs/<run-id>/<dream-id>/demo/<slug>/`
- State files (`vision.md`, `slice.md`, `status.json`) are written inside that directory — no pollution of the user's top-level `demo/` or `.mmd/shared/`
- Each dream's auto-dev (or fake-autodev in dry-run) runs as a separate subprocess, with its own log file under `bench/runs/<run-id>/<dream-id>/run.log`
- Dreams run **sequentially**, not in parallel (parallelism deferred to v0.9 with git worktrees per scoping §4.3)

Tag: `@integration` with fake-autodev fixture verifying isolation.

### AC-4: Metrics captured per dream

**Given** a bench run has processed a dream (real or dry-run)
**When** the user inspects `bench/runs/<run-id>/<dream-id>/metrics.json`
**Then** the file contains:

```json
{
  "dream_id": "kid-01-drawing-camera-overlay",
  "engine": "standard",
  "started_at": "2026-05-17T16:00:00Z",
  "ended_at": "2026-05-17T16:42:18Z",
  "duration_seconds": 2538,
  "exit_code": 0,
  "reality_check": {
    "ran": true,
    "passed": true,
    "screenshot_path": "bench/runs/<run-id>/<dream-id>/screenshot.png",
    "console_errors_count": 0
  },
  "commits_count": 7,
  "phase4_findings_count": 3,
  "log_path": "bench/runs/<run-id>/<dream-id>/run.log"
}
```

`phase4_findings_count` is best-effort (parses the auto-dev log for `## Finding F\d+` pattern); `null` if unparseable. `commits_count` reads from `git log` in the isolated demo dir.

Tag: `@unit` for the metric serializer + log parser, `@integration` for full capture in dry-run.

### AC-5: Aggregated report

**Given** a bench run has completed (all dreams attempted, success or fail)
**When** the user inspects `bench/runs/<run-id>/report.md` and `summary.json`
**Then**:
- `summary.json` is a machine-readable aggregate: total duration, per-dream pass/fail, aggregate reality-check pass-rate, engine used, MMD version, git SHA of MMD at bench time.
- `report.md` is human-readable: a table of dream-id × engine × duration × pass/fail × notable findings, followed by a short summary paragraph (auto-generated, deterministic — no LLM call).
- `bench/runs/latest` is a symlink to `bench/runs/<run-id>/`

Tag: `@integration` for end-to-end aggregation in dry-run.

### AC-6: Exit code reflects overall pass/fail

**Given** the bench has run all 5 dreams
**When** the harness exits
**Then**:
- Exit code 0 if ALL dreams passed their reality check (or, in dry-run, all fake-autodev runs succeeded)
- Exit code 6 if any dream's reality check failed but no dream crashed
- Exit code 7 if any dream's auto-dev crashed (non-zero subprocess exit)
- Stderr lists the failing dream ids on non-zero exit

Tag: `@unit` for exit-code logic given a metrics array.

### AC-7: Documentation + ADR

**Given** v0.2b ships
**When** the user reads `README.md` and `docs/adr/006-dream-bench-v0-design.md`
**Then**:
- README has a `### Bench mode (mmd bench)` subsection in `## Usage`, explaining the 5 dreams, opt-in nature, expected duration, output location.
- ADR-006 covers: why 5 dreams (small enough to run, large enough to surface regressions), why sequential (parallelism is v0.9), why no cost-in-dollars (token count is sufficient proxy for v0.2b), what `--dry-run` is for (CI testing the harness itself), why the report is deterministic (no LLM call — reproducible).
- `MAKE_MY_DREAMS.md` §8.3 (dream-bench section) gets a paragraph noting v0.2b delivered the v0 harness with `<sha>` and `<date>`.

Tag: `@unit` for the README anchor presence test.

---

## 3. Architecture (incremental)

```
mmd bench [--dry-run] [--engine <e>] [--dreams <ids>]
   │
   ▼
[0] argv parser — recognizes 'bench' as a subcommand (special-case BEFORE the dream-as-positional logic)
   │
   ▼
[1] Load bench/dreams/*.md, validate against SCHEMA.md, filter by --dreams if set
   │
   ▼
[2] Create bench/runs/<run-id>/ (run-id = ISO date + short random suffix)
   │
   ▼
[3] For each dream sequentially:
       create per-dream isolated dir
       invoke auto-dev (or fake-autodev in dry-run) with the dream + engine
       capture metrics
       run reality check (skipped in dry-run)
   │
   ▼
[4] Aggregate → bench/runs/<run-id>/summary.json + report.md
   │
   ▼
[5] Update bench/runs/latest symlink
   │
   ▼
[6] Exit with appropriate code (0 / 6 / 7)
```

### Project structure (additions only)

```
make-my-dreams/
├── bin/mmd.js                          # modified — 'bench' subcommand dispatch
├── lib/
│   ├── bench/
│   │   ├── load-dreams.js              # NEW — read + validate bench/dreams/*.md
│   │   ├── run-one.js                  # NEW — orchestrate single dream (sets up isolated dir, invokes auto-dev, captures metrics)
│   │   ├── metrics.js                  # NEW — serialize metrics.json + parse phase4_findings from log
│   │   ├── aggregate.js                # NEW — produce summary.json + report.md
│   │   └── exit-codes.js               # NEW — pure function metrics[] → exit code
│   └── argv-parser.js                  # modified — recognize 'bench' subcommand
├── bench/
│   ├── dreams/
│   │   ├── SCHEMA.md                   # NEW — front-matter schema for dream files
│   │   ├── kid-01-drawing-camera-overlay.md
│   │   ├── kid-02-drum-pads.md
│   │   ├── kid-03-story-dice.md
│   │   ├── pro-01-csv-viewer.md
│   │   └── pro-02-markdown-preview.md
│   ├── runs/                           # generated at run time, .gitignored except a README
│   │   └── README.md                   # NEW — explains the structure for users
│   └── .gitignore                      # NEW — ignore runs/* except README.md
├── test/
│   ├── unit/
│   │   ├── bench-load-dreams.test.js   # NEW — schema validation
│   │   ├── bench-metrics.test.js       # NEW — serializer + log parser
│   │   ├── bench-aggregate.test.js     # NEW — report.md + summary.json shape
│   │   └── bench-exit-codes.test.js    # NEW — exit code logic
│   └── integration/
│       └── bench-dry-run.test.js       # NEW — end-to-end dry-run with all 5 dreams
└── docs/adr/
    └── 006-dream-bench-v0-design.md    # NEW — ADR
```

---

## 4. Out of scope for v0.2b

To stay focused on shipping a working harness in one slice:

- ❌ No cost-in-dollars estimation. Token count via Anthropic billing API is v0.2b+.
- ❌ No cross-run comparison (`mmd bench --compare <run-id1> <run-id2>`). v0.2b+.
- ❌ No parallel execution. v0.9 (git worktrees).
- ❌ No CI integration (GitHub Actions workflow). v0.2b+ — but the exit code design makes it trivial to add.
- ❌ No "smart re-run" (only re-run failed dreams from a previous run). Just full or filtered set.
- ❌ No mutation testing or assertion strengthening on bench dreams. Their PWAs are validated only by reality-check + the dream's `reality_check_min_assertions` field.
- ❌ No autolearning consumption of bench data. v0.5b consumes; v0.2b just produces.
- ❌ No new engines, no new modes. Bench uses whatever engine is current.

---

## 5. Implementation hints (for auto-dev)

### Key risks to handle

- **Subcommand routing**: `mmd bench` must be recognized BEFORE the "treat positional as dream" logic — otherwise the parser thinks `bench` is a dream. Add an early branch in `bin/mmd.js`.
- **Isolated demo dirs**: each dream's auto-dev must believe its working dir is `bench/runs/<run-id>/<dream-id>/`. This means invoking auto-dev with that path as cwd — modify `lib/invoke-autodev.js` to accept a `cwd` parameter (currently uses `process.cwd()`).
- **Phase 4 findings parser**: log format is auto-dev-specific (`## Finding F1 / F2 / …` headings). Best-effort regex; return `null` rather than failing the whole run if parse fails.
- **`bench/runs/` size**: each real run generates a PWA + screenshots + logs per dream. Could grow large. `.gitignore` everything under `bench/runs/` except `README.md`. Suggest in the README that users `bench/runs/` -manually periodically.
- **Reality check in dry-run**: never invoke the real Reality Check from `--dry-run` (no browser, no MCP call). The fake-autodev fixture should write a dummy screenshot file so the metric `reality_check.ran=true, passed=true` looks like a real shape.

### Testing per `testing.md` §V stratification

- `@unit` for: schema validation, metrics serializer, log parser, aggregate logic, exit-code function.
- `@integration` for: `mmd bench --dry-run` end-to-end (uses fake-autodev fixture, asserts file structure + exit code).
- NO `@e2e` test in v0.2b that runs the real bench — that's a manual / opt-in operation (`MMD_BENCH_REAL=1` gate is the user's explicit decision to spend hours).

### Constitution module bindings

Active during this work:
- `universal.md`, `ai-coding.md` (always)
- `commit-git.md` (slice branch workflow)
- `testing.md` (red-green for any failure; `@unit` first, then `@integration`)
- `security.md` (subprocess invocation, env vars, path validation)
- `error-handling.md` (exit codes 0/2/6/7 with clear messages)
- `observability.md` (this IS the observability slice — metrics shape is canonical)
- `documentation.md` (README + ADR + scoping update)

### Apply lessons learned (L-001..L-010)

- **L-001**: launch via `setsid bash -c "claude -p ..." &`, not nohup.
- **L-002**: monitor via `git log slice/v0.2b-dream-bench-v0 --oneline` + file mtimes, not log tail.
- **L-003**: while auto-dev runs, use `git worktree add ../mmd-side` for any side work.
- **L-004**: explicitly verify DoD after auto-dev exits. Relaunch with precise RESUME if anything missing.
- **L-005 + L-007**: NO hardcoded version strings or slug paths in tests — read from `package.json` / call slug function.
- **L-006**: before launching, `pgrep -af "claude -p"` to confirm no zombie.
- **L-008**: never `git branch -d` on warning; verify merge first.
- **L-009**: distinguish design from current implementation in any doc.
- **L-010**: this slice IS the second `mmd --here` use — record the result (duration, exit code) at the end as proof the supported workflow holds.

---

## 6. Definition of done

v0.2b is done when:

1. All 7 ACs met.
2. Full test suite passes (current 266 + new tests ~ 290-310 expected).
3. `mmd bench --dry-run` exits 0 in under 30 s on a clean checkout.
4. README updated: `### Bench mode (mmd bench)` subsection.
5. ADR-006 written.
6. `MAKE_MY_DREAMS.md` §8.3 paragraph noting v0.2b delivery.
7. Version bumped to `0.2.2` (`mmd --version` returns `0.2.2`).
8. Slice merged to main, tag `v0.2.2` created.
9. New lesson(s) captured in `docs/lessons-learned.md` if any failure encountered during development.
10. **Reflexive milestone**: this slice was developed via `mmd --here` (not raw `claude -p`). Capture the AC-7-equivalent metric in L-011: `mmd --here "implement v0.2b per SPEC_V02B.md"` worked end-to-end, with duration and exit code recorded.

---

*Spec v0.2b — generated 2026-05-17. To be implemented via `mmd --here` (NOT raw `claude -p`) on branch `slice/v0.2b-dream-bench-v0`. Second test of the reflexive bootstrap §7 as the SUPPORTED workflow (after AC-7 of v0.2a). If `mmd --here` produces this slice cleanly, L-010's symbolic gate strengthens from "validated on a trivial change" to "validated on a real feature."*
