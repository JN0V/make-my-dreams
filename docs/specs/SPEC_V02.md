# Make My Dreams — v0.2 Spec: FAST engine (`mmd --fast`)

> Per scoping `MAKE_MY_DREAMS.md` v15+ §3.1 — FAST engine = **trimmed `auto-dev`** (1× Party Mode instead of 3×, Phase 2 adversarial spec review skipped if Phase 1 robust, 1-page upfront spec). Target: **under 10 minutes per slice** vs the 30-90 min of full auto-dev (Standard engine). This is the version that makes MMD iteration practical for small features — typically what Sébastien's daughter will use once she wants to tweak her drawing app ("add a red button", "make the brush thicker"). Per scoping v15 §3.1 v15 revision, this is NOT Ralph Loop — it's a trimmed auto-dev. Ralph Loop remains a deferred option for v0.6+. To be fed into Extend BMAD `auto-dev` (Standard engine itself, recursively — this v0.2 is the second test of the reflexive bootstrap §7 after v0.2.5).

---

## 1. Goal of v0.2

Deliver an `mmd --fast "<dream>"` invocation that:
1. Accepts the same `<dream>` natural-language argument as `mmd "<dream>"`.
2. Routes to a **quick auto-dev pipeline** with reduced ceremony: 1× Party Mode (not 3×), Phase 2 opportunistic (skip if Phase 1's spec passes a robustness check), Phase 3 Implementation, Phase 4 final adversarial review kept.
3. Produces the same kind of artifact as STANDARD (PWA under `demo/<slug>/`, vision/slice/status state files) — same shape, faster to produce.
4. Records its mode in `status.json` as `"engine": "fast"` so the Documentalist (v0.5b) can later compare time-to-MVP and quality metrics between FAST and STANDARD runs.
5. Is a CLI flag, not a separate command: `mmd --fast "<dream>"` (same surface as `mmd "<dream>"`, just with the flag prepended or appended).

**Why this version exists**: per scoping §3.1, FAST exists for "fast iteration on clear brownfield, small features, experimentation." A user (Sébastien or his daughter) who already has a PWA and wants to add one button should not wait 45 min. Target 5-10 min.

**Mission validation**: after v0.2, `mmd --fast "add a red color button to the drawing app"` on the v0.1 fil-rouge PWA produces a working modified PWA in under 10 min (typically 5-8), with the new button functional and the existing camera/upload/draw behavior preserved (regression-safe).

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: `--fast` flag is recognized

**Given** MMD v0.2 installed (`npm install -g .`)
**When** the user runs `mmd --fast "any dream"` or `mmd "any dream" --fast`
**Then** the CLI:
- Parses `--fast` correctly regardless of position (POSIX-style flag)
- Records `engine: "fast"` in `.mmd/shared/status.json` from the start
- Prints `Engine: FAST (trimmed auto-dev — target ≤10 min)` after parsing
- Proceeds with the trimmed pipeline (AC-3)

Without `--fast`, behavior is unchanged from v0.1 (STANDARD engine = full auto-dev). Tag: `@unit` for flag parsing, `@integration` for end-to-end.

### AC-2: `--fast` mutually exclusive with future `--deep` / `--standard`

**Given** v0.2 only defines `--fast` (future v0.2d will add `--standard` and `--deep`)
**When** the user passes `--fast` with any other future engine flag (`--standard`, `--deep`)
**Then** the CLI exits with code 2 and message: `Engine flags are mutually exclusive: pass at most one of --fast, --standard, --deep`. For v0.2 only `--fast` exists, so this check is forward-compatible scaffolding.

Tag: `@unit`.

### AC-3: Trimmed auto-dev invocation

**Given** the CLI has parsed `--fast` and initialized state files
**When** the CLI invokes auto-dev
**Then** the prompt passed to `auto-dev` instructs it to operate in **quick mode** with these explicit overrides:
- Phase 1 (Spec): **1× Party Mode** (not 3×). The prompt names the single round: `"Run one Party Mode session covering scope+investigation+spec generation in a single pass."`
- Phase 2 (Adversarial spec review): **OPPORTUNISTIC** — run only if Phase 1's spec output is `< 200 lines` AND contains `< 5 explicit "TODO" / "TBD" markers`. Else skip with a logged decision: `"Phase 2 skipped (robust spec heuristic passed)."`
- Phase 3 (Implementation): kept full (3-reviewer review). Skipping Phase 3 review would compromise correctness, which is non-negotiable per `testing.md` §III red-green rule.
- Phase 4 (Final adversarial code review): kept full. Cheaper to keep than to retroactively audit.

This is achieved by passing a `--quick-mode` flag (or equivalent env var) through to the underlying `bash + claude /bmad-adv-auto-dev` invocation, which the auto-dev workflow already accepts (or which v0.2 adds to `_bmad/adv/workflows/auto-dev/workflow.md` if it doesn't yet).

Tag: `@integration` with a fixture that asserts the quick-mode flag is passed through.

### AC-4: 1-page upfront spec (auto-derived from the dream)

**Given** the user passes a dream like `"add a red color button to the drawing app"`
**When** FAST mode runs
**Then** the CLI generates a **1-page minimal spec** (≤ 50 lines, ≤ 3000 chars) BEFORE invoking auto-dev. The spec is derived heuristically from:
- Dream slug + dream text → goal section
- Existing `vision.md` if any → constraints inherited
- Inferred acceptance criteria from the dream (1-3 ACs, generated by simple keyword heuristic, e.g. "button" → "the button is visible AND clickable AND triggers the intended behavior")

This minimal spec is written to `.mmd/shared/slice.md` BEFORE auto-dev runs, and is included in the prompt. Without it, FAST diverges (cf scoping §3.1: "without this upfront spec, Ralph diverges — that's what's observed in practice"; the same warning applies to trimmed auto-dev).

Tag: `@unit` for spec generation logic.

### AC-5: Time budget enforcement (soft)

**Given** the user expects FAST mode to take under 10 minutes
**When** the auto-dev subprocess exceeds 12 minutes (configurable via `MMD_FAST_MAX_MINUTES`, default 12)
**Then** the CLI:
- Does NOT kill the subprocess automatically (that would lose work)
- Logs a warning to stderr: `Warning: FAST mode is taking longer than expected (Xm Ys). This may indicate the dream is too complex for FAST; consider re-running with --standard.`
- Records the actual duration in `status.json.engine_metrics.duration_seconds` for the Documentalist (v0.5b) to learn from
- Continues to wait for the subprocess to finish normally

Tag: `@integration` with a fixture that simulates a slow subprocess.

### AC-6: status.json records engine + metrics

**Given** any FAST run completes (success or fail)
**When** the user inspects `.mmd/shared/status.json`
**Then** the file contains, in addition to the v0.1 fields:
- `"engine": "fast"`
- `"engine_metrics": { "duration_seconds": <N>, "party_mode_rounds": 1, "phase2_skipped": <true|false>, "phase2_skip_reason": "<text>" | null }`

This is the seed of the **tool-choice telemetry** (scoping §6.5b) and the **dream-bench** (v0.2b) — both consume this data later.

Tag: `@unit` for serialization + `@integration` for end-to-end shape.

### AC-7: Deferred items from v0.1 — CLI polish cluster

Per the v0.1 deferred backlog (scoping v17 §9 v0.2), the following items land in v0.2:

- **B2**: replace heuristic `claude` CLI detection (`cmd === 'claude' || /\/claude$/.test(cmd)`) with explicit `MMD_AUTODEV_MODE=cli|test` env var, so user wrappers like `claude-wrapper` are handled cleanly. Default = `cli`. Test wrappers set `MMD_AUTODEV_MODE=test` (and the existing `MMD_AUTODEV_CMD` env var stays in place).
- **B4**: add `MMD_QUIET=1` to suppress terminal stdout tee under `node --test` and CI; preserves the log-file tee.
- **B8**: consolidate the redundant `EACCES` short-circuit in `bin/mmd.js`'s top-level catch (cosmetic, but worth doing while v0.2 grows the CLI surface).
- **E7**: add a parallel `lstat` check on the `--resume` path so a symlinked `demo/<slug>` cannot social-engineer a misleading "state: done" message.
- **E13/E14**: stop silently dropping unknown `--foo` flags. Implement POSIX `--` end-of-flags separator AND error on unknown flags (unless they appear after `--`).

Tag: `@unit` for each individual fix where applicable, `@integration` for E13/E14 end-to-end behavior.

---

## 3. Architecture (incremental)

```
mmd [--fast] "<dream>"
   │
   ▼
[0] argv parser — recognizes --fast, --standard (forward-compat), --deep (forward-compat), --
   │
   ▼
[1] Parse dream → slug, vision.md, slice.md (+ minimal spec if --fast), status.json with engine=fast|standard
   │
   ▼
[2] Build auto-dev prompt:
       if engine == "fast":
         prepend the 1-page minimal spec
         pass --quick-mode flag (or env MMD_AUTODEV_QUICK=1)
       else:
         current v0.1 behavior
   │
   ▼
[3] Spawn auto-dev (same lib/invoke-autodev.js, with new env vars / flag passthrough)
   │   tee stdout/stderr (respect MMD_QUIET)
   │
   ▼
[4] Reality Check (unchanged)
   │
   ▼
[5] Update status.json.engine_metrics, exit
```

Total new components: a few utility files for spec-derivation + flag parsing. No new framework, no new runtime dependency (per `security.md` and SPEC_V025 precedent).

### Project structure (additions only)

```
make-my-dreams/
├── bin/mmd.js                   # modified — argv parser handles --fast, --standard, --deep, --
├── lib/
│   ├── argv-parser.js           # NEW — POSIX-style flag parser (handles --, mutual exclusion)
│   ├── engine.js                # NEW — engine selection + invocation prompt building
│   ├── spec-derive.js           # NEW — heuristic 1-page-spec generator for FAST mode
│   ├── invoke-autodev.js        # modified — accepts engine arg + passes --quick-mode flag
│   └── (other existing files unchanged)
├── _bmad/adv/workflows/auto-dev/workflow.md    # modified IF the existing workflow doesn't already understand --quick-mode (it may need a small amendment to recognize MMD_AUTODEV_QUICK=1 and adjust party mode rounds + phase 2)
└── test/
    ├── unit/
    │   ├── argv-parser.test.js  # NEW — POSIX flags, mutual exclusion, unknown flag rejection, --
    │   ├── engine-select.test.js # NEW — engine resolution from flags + env
    │   └── spec-derive.test.js  # NEW — heuristic spec generator on sample dreams
    └── integration/
        ├── fast-engine.test.js  # NEW — end-to-end FAST run with fake-autodev fixture that asserts the quick-mode flag was passed
        └── deferred-v01.test.js # NEW — tests for B2 (MMD_AUTODEV_MODE), B4 (MMD_QUIET), E7 (lstat on resume), E13/E14 (-- + unknown flag rejection)
```

---

## 4. Out of scope for v0.2

To stay focused:

- ❌ No `--standard` or `--deep` flag implementation (forward-compat scaffolding only — actual behavior is v0.2d).
- ❌ No Mode Router auto-detection (the user chooses FAST explicitly via `--fast`; auto-routing comes with v0.2d).
- ❌ No Ralph Loop (deferred to v0.6+ per scoping v15 §3.1).
- ❌ No Dream Catcher conversational (v0.3) — dream is still a CLI argument.
- ❌ No dream-bench v0 (v0.2b) — but `status.json.engine_metrics` is the seed.
- ❌ No Project Onboarder (v0.2c).
- ❌ No `.mmd/shared/` vs `.mmd/local/` split (v0.2c).
- ❌ No Documentalist event hooks (v0.5b).

---

## 5. Implementation hints (for auto-dev)

### Key risks to handle

- **Phase 2 opportunistic skip heuristic** may produce false positives (skips when it shouldn't) or false negatives (runs when it could skip). The heuristic in AC-3 (`< 200 lines AND < 5 TODO/TBD markers`) is conservative; tune based on the first 5-10 FAST runs.
- **Auto-dev's quick-mode flag pass-through**: the existing `_bmad/adv/workflows/auto-dev/workflow.md` may not yet understand `--quick-mode` or `MMD_AUTODEV_QUICK=1`. If so, amend it minimally to:
  - Reduce Phase 1 Party Mode to 1 round (instead of 3).
  - Add a Phase 2 skip condition based on the spec robustness heuristic.
  - Preserve Phase 3 and Phase 4 unchanged.
- **Backward compatibility with v0.1**: the default (no `--fast` flag) MUST behave exactly as v0.1.0. The 52 v0.1 integration tests + 4 smoke must still pass post-v0.2.
- **AI attribution in commits**: per `commit-git.md` §II, mention auto-dev in commit messages where it added value (the v0.2.5 precedent: `c34806a`, `34a4e5a`, etc.).

### Testing per `testing.md` §V stratification

- `@unit` for argv parser, engine selector, spec-derivation logic, status.json serialization — all under 100 ms each.
- `@integration` for the end-to-end FAST flow with a fake-autodev fixture (similar to v0.1's `test/fixtures/fake-autodev.sh`, but the fake asserts the quick-mode flag was passed).
- Full suite (v0.1 + v0.2.5 + v0.2 = ~200 tests) must pass cleanly. v0.2 brings probably ~20-30 new tests.

### Constitution module bindings (per `.specify/memory/constitution-bindings.yaml`)

Active during this work:
- `universal.md`, `ai-coding.md` (always)
- `commit-git.md` (touches git history)
- `testing.md` (writes tests, follows red-green for any failure)
- `security.md` (CLI surface, exit codes, env vars — Bundle A)
- `error-handling.md` (graceful degradation, friendly messages, exit codes per §II)
- `documentation.md` (README ## section + ADR-004 for the FAST engine)
- `observability.md` (engine_metrics for telemetry/autolearning)

### Apply the v0.2.5 lessons learned (`docs/lessons-learned.md`)

- **L-001**: this run will be launched via `setsid bash -c "claude -p ..." &` from the orchestration shell — NOT nohup.
- **L-002**: monitor progress via `git log slice/v0.2-fast-engine` + `find -mmin -N`, NOT via `tail -f /tmp/log`.
- **L-003**: while auto-dev runs on this slice, do not create other branches in this same worktree. Use `git worktree add ../make-my-dreams-side` for any urgent side work.
- **L-004**: at end of auto-dev, explicitly verify the Definition of Done (§6). If any item is missing, relaunch with a precise "RESUME" prompt or finish manually.
- **L-005**: NO hardcoded version strings in new tests. Read from `package.json` if needed.

---

## 6. Definition of done

v0.2 is done when:

1. All 7 acceptance criteria are met (AC-1 to AC-7).
2. The 5 deferred v0.1 items (B2, B4, B8, E7, E13/E14) are landed and tested.
3. New tests pass; full suite stays at 148+ passing.
4. `mmd --fast "add a red color button to the drawing app"` on the existing `demo/drawing-app-overlays-image-camera-feed/` produces a modified PWA in <10 min, with the existing functionality preserved (regression-safe per `brownfield.md` §III).
5. README updated with a `### FAST mode` subsection in `## Usage`.
6. ADR-004 written justifying: "FAST = trimmed auto-dev, NOT Ralph Loop, for v0.2." (Cross-reference scoping §3.1 v15 revision and ADR-003 precedent of pragmatic vanilla choices.)
7. Version bumped to 0.2.0 in `package.json` (`mmd --version` returns `0.2.0`; the test from v0.2.5 fix reads from package.json so it doesn't break).
8. Branch `slice/v0.2-fast-engine` merged to main via fast-forward, tag `v0.2.0` created.
9. A NEW lessons-learned entry added to `docs/lessons-learned.md` for any failure encountered during the FAST development itself (per `testing.md` §III red-green rule).

---

*Spec v0.2 — generated 2026-05-17 from MAKE_MY_DREAMS.md v19. To be fed to /bmad-adv-auto-dev on branch slice/v0.2-fast-engine. Second test of the reflexive bootstrap §7 after v0.2.5.*
