# ADR-032 — Transparent first-run setup for `mmd --here` + the `brownfield-app` discovery case

**Status**: Accepted
**Date**: 2026-06-01
**Deciders**: MMD core (self-dev, 27th reflexive `mmd --here`)
**Parent design**: [docs/specs/SPEC_V06A.md](../../SPEC_V06A.md) (FROZEN). First crossing of the "works on exactly one repo (itself)" wall — third-party readiness. The deeper "whose constitution governs the build" composer rework is the deferred v0.6.b.

## Context

MMD was proven on exactly one repo: itself. The moment someone runs it on *their* project, three things break the experience:

1. **`mmd discover` mislabels a real app as `blank`.** `classify` only knew the SDD methodologies (Spec Kit / BMAD / OpenSpec); it ignored the stack the SCAN had *already* detected. A `package.json` Node app, a `pyproject.toml` Python app, a `go.mod`/`Cargo.toml` project — all came back `blank`, as if empty.
2. **`mmd --here` launches inert on an unprepared repo.** `--here` needs MMD's constitution + the BMAD auto-dev workflow materialized in the target, but nothing checked. On a fresh third-party repo it would proceed into a setup that isn't there.
3. **The operational env-vars/flags are tribal knowledge.** `MMD_TIMEOUT_MS=0`, the "spec is frozen, go directly to implementation" dream directive, `--sealed`/`--monitor`/`MMD_NOTIFY_URL` — all undocumented at the point of use.

The gap (L-009 — design vs current code): the *design* (MAKE_MY_DREAMS.md §7, the reflexive bootstrap) always intended MMD to onboard *any* repo; the *current code* only ever ran on itself. v0.6.a closes the first-run half of that gap.

## Decision

Make MMD usable on another repo **without learning a new command**. No `mmd init`. The existing `mmd --here` detects, at first run, that the target lacks MMD's setup and **offers to run it** (one confirmation in a TTY; automatic + logged in `serve`/CI), then continues. A repo that already has a constitution keeps it untouched.

### 1. `classify` learns the stack — a new `brownfield-app` case

`DISCOVERY_CASES` gains `'brownfield-app'`, returned when the scan found a recognized stack (`frameworks.language` truthy OR `languages` non-empty) but **no** SDD methodology — distinct from `blank` (a genuinely empty/unstructured repo: no manifest, no code). Priority sits **below** `rich`/`bmad-alone` (an SDD project is richer than a bare app) and **above** `blank`. `already-onboarded` still wins; a missing/malformed `scanData` still degrades to `blank` without throwing. `mmd discover`'s "detected case" line + the written report surface the new label. The gate is unaffected (it keys on the report's VALIDATED status, not the case string).

### 2. A transparent first-run setup guard inside `mmd --here`

A pure `detectMmdSetup(targetDir) → {ready, missing[]}` probe (fs reads only, never throws) checks the minimum `--here` needs: the constitution (`.specify/memory/constitution.md`) and the auto-dev workflow (the `_bmad` workflow file OR the `.claude/commands/bmad-adv-auto-dev.md` slash-command — either drives auto-dev). The guard (`runFirstRunSetup`) runs in `runHereMode` **right after the "Mode: --here" line and before the onboarding gate + git checks** (a repo with no setup can't pass them meaningfully):

- **TTY** → print what's missing, ask once (`Run setup now? [o/N]`). Yes → spawn `install-mmd.sh <target>`, print the cheat-sheet, proceed. No → abort with a pointer to `install-mmd.sh .`, **exit 8**.
- **Non-TTY** (`serve`/CI) → auto-run with an honest log line (no prompt). Runner non-zero/throws → report, **exit 8**.
- **`MMD_SKIP_SETUP=1`** → bypass with a warning (escape hatch, mirrors `MMD_SKIP_GROUNDING`).
- **Already ready** → no-op; the run proceeds exactly as before.

The two outside-world touches — asking the user and spawning the installer — are **injected** (DIP) into `runFirstRunSetup`, so the whole decision tree is unit/integration-tested without a TTY or a shell. `bin/mmd.js` supplies the real readline prompt + the real `spawnSync('bash', [install-mmd.sh, target])` (overridable by `MMD_SETUP_CMD`, a testing seam mirroring `MMD_AUTODEV_CMD`).

**The setup is committed before the clean-tree check.** `install-mmd.sh` *writes* the constitution + workflow + `.gitignore` edits but does not commit them; the very next `--here` step (`validateHereTarget`) requires a clean working tree and would otherwise abort with exit 4 — defeating the whole mission. So after a successful setup `runHereMode` runs `git add -A && git commit -m "chore: MMD first-run setup …"` on the **base branch** (the setup is repo infrastructure; the slice branch is then created from a base that already includes it; commit-git §III — a successful setup is a recoverable unit). A commit failure is reported honestly → exit 8 (never a dirty, half-set-up tree). The guard only fires on a not-ready (fresh, un-onboarded) repo, so the `add -A` captures the setup's output.

### 3. An onboarding cheat-sheet (pure builder)

`buildOnboardingCheatsheet() → string` lists the non-evident operational rules — `MMD_TIMEOUT_MS=0`, the spec-frozen dream directive, commit-incrementally-per-AC, and `--sealed`/`--monitor`/`MMD_NOTIFY_URL` — each code paired with a plain-language one-liner (universal §VII). Printed once after a successful setup, never on a ready repo.

## Rationale for the contested choices

- **Why no `mmd init`?** Minimize commands to learn. A separate init is one more thing the user must know to run before `--here` works; folding detection into `--here` means the *only* command stays `mmd --here`. The guard is transparent.
- **Why a confirm in TTY but auto in serve/CI?** A human at a terminal should consent before MMD writes a constitution + installs a workflow into their repo (security.md — don't mutate an untrusted path silently). But `serve`/CI has no human to ask; the alternative there is an inert launch, which is worse than auto-running with a logged line (universal §VI honesty — the log says exactly what happened).
- **Why exit 8 on decline rather than an inert launch?** An inert `--here` (proceeding without a constitution/workflow) is the dishonest-success failure mode the constitution forbids (P-04). Declining is a legitimate user choice; the honest response is to abort with a clear pointer, not to pretend the run can proceed. 8 is a new, distinct rung on the closed exit ladder (3 cwd, 4 git, 5 gate/branch, 6 grounding/state, 7 judge, 8 setup) so "setup missing and declined-or-failed" is distinguishable from every other failure.
- **"Elle reste" — never overwrite an existing constitution.** If the target already has `.specify/memory/constitution.md`, `detectMmdSetup` reports ready and the guard is a no-op — and even when setup *does* run, `install-mmd.sh` Phase 2 detects an existing constitution and leaves it. MMD never imposes its own rules over a project's own. (The non-destructive "suggest improvements" mode is deferred v0.6.b.)

## Consequences

**Positive**: MMD is now usable on a repo other than itself. `discover` names the stack it scanned; `--here` onboards a fresh repo in one confirmation; the operational tribal knowledge is surfaced at the moment it's needed. The guard's decision tree is fully tested without a shell/TTY (injected runner + prompt + detect). MMD's own `--here` runs are unaffected (it's already ready → no-op). No new dependency, no new command.

**Negative / limits (honest, universal §VI)**: because the guard runs *before* the onboarding/discovery gate (per the spec ordering), a fresh **brownfield** repo run without `--skip-onboarding` and without an approved `mmd discover` report will have its setup committed on the base branch and *then* be rejected by the gate (exit 5) — a committed side effect before the rejection. It is recoverable (a later `mmd discover --approve` + re-run finds the guard a no-op), but the setup commit is left behind; run `mmd discover --approve` first to avoid it. A dirty working tree is refused *before* setup writes anything (exit 4), so the setup commit can never sweep pre-existing uncommitted work. The guard only verifies the *presence* of the constitution + workflow, not their *content* or version — a stale or partial install reads as ready. The setup shells out to `install-mmd.sh` (and thence `npx bmad-method`), so the auto-run path in CI needs network + a working toolchain; a failure there is reported (exit 8) but not repaired. The build still composes MMD's *bundled* constitution modules, not the *project's* own (Layer-C, the real "whose constitution governs" fix — deferred v0.6.b). The cross-project green run (AC-6) is a documented manual/scripted e2e, not a CI-gated test (it needs a real `claude -p`).

**Deferred to v0.6.b**: the Layer-C composer reading the project's constitution instead of MMD's bundled modules; a non-destructive "suggest improvements" mode on an existing constitution; content/version-aware readiness.

## Alternatives considered

- **A new `mmd init` command** — rejected: one more command to learn; the guard is transparent inside `--here`.
- **Proceed inert when setup is missing** — rejected: dishonest success (P-04). Exit 8 with a pointer is the honest abort.
- **Auto-run setup even in a TTY (no confirm)** — rejected: writing a constitution + installing a workflow into a human's repo without consent (security.md). Confirm in TTY, auto only where there's no human to ask.
- **Treat any non-empty `languages` (incl. a docs-only repo) as `brownfield-app`** — kept simple per the spec's literal definition (`frameworks.language` OR `languages` non-empty); the genuinely-empty/stackless repo stays `blank`. Refining "stack vs docs-only" is not worth the complexity at this slice (KISS).

## References

- [docs/specs/SPEC_V06A.md](../../SPEC_V06A.md) — the frozen spec.
- [ADR-013](./013-prompt-grounding-check.md) — the `MMD_SKIP_GROUNDING` escape hatch this guard mirrors with `MMD_SKIP_SETUP`.
- [ADR-024](./024-constitution-composer-layer-c.md) — the Layer-C composer whose project-aware rework is the deferred v0.6.b.
- L-009 — design vs current-code scope discipline (the wall this slice crosses).
- L-023 — independent, tamper-evident verification (the injected-runner discipline echoes it: the guard's logic is testable without trusting the shell).
