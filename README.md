# Make My Dreams (MMD)

> An accessibility and orchestration layer for AI-driven development. From a 13-year-old kid to a 30-year veteran — same tool, adapted experience.

## What this is

Make My Dreams (MMD) lets any human describe an application need in natural language and see a working MVP delivered quickly, then enriched iteratively.

MMD is built **on the shoulders of** existing frameworks rather than replacing them:

- **[Spec Kit](https://github.com/github/spec-kit)** — versioned constitution + spec-driven workflow
- **[OpenSpec](https://github.com/Fission-AI/OpenSpec)** — lightweight spec-first alternative
- **[BMAD](https://github.com/bmad-code-org/BMAD-METHOD)** — agent personas (Mary, Winston, Amelia…) and structured workflows
- **[gStack](https://github.com/garrytan/gstack)** — 41 mature skills covering the full sprint cycle
- **[Ralph Loop](https://ghuntley.com/loop/)** — minimalist bounded loop pattern

What MMD adds: multi-audience accessibility (Kid → Pro), reflexive bootstrap (MMD improves MMD), stateless hierarchical orchestration, brownfield Project Onboarder, local parallelization via git worktrees.

**MMD's success is the success of the projects it stands on.**

## Install

One-liner:

```bash
curl -fsSL https://raw.githubusercontent.com/JN0V/make-my-dreams/main/install.sh | bash
```

This clones MMD into `~/Documents/make-my-dreams/` (override with `MMD_HOME=/path`), installs Phase A (BMAD + adv module + auto-dev workflow + project constitution), and offers to install gStack as the next step. Prerequisites: `git`, `node` (v20+), `npx`, `claude` (Claude Code CLI). `bun` is required only for gStack and can be installed later.

Manual install (if you prefer to read the script first or operate offline):

```bash
git clone https://github.com/JN0V/make-my-dreams.git
cd make-my-dreams
bash install-mmd.sh .
```

> **v0.2.f install hardening** (2026-05-17): `install-mmd.sh` now installs `bun` + `gStack` *functionally* (verifies they respond, not just present), and writes `bin/mmd` — a shell shim that prepends `~/.bun/bin` to `PATH` before delegating to `node bin/mmd.js`. This closes the L-012 gap (`docs/lessons-learned.md`) where gStack-dependent subprocesses could not find `bun` in non-interactive `PATH`. Toggles: `MMD_AUTO_INSTALL_BUN=1` (skip the y/N prompt), `MMD_AUTO_INSTALL_GSTACK=1` (same for gStack), `MMD_REQUIRE_GSTACK=1` (make bun + gStack mandatory: declining or broken exits non-zero). See [`install-mmd.sh`](./install-mmd.sh) for the full phase layout.

> **v0.2.m all-five-pillars install** (2026-05-30): `install-mmd.sh` now detects, offers to install, and functionally verifies **all five** "stands on the shoulders of" pillars — not just bun + gStack. Three new phases follow the v0.2.f detect→offer→verify shape: **Phase 5 — Spec Kit** (`specify --version`, installed via `uv tool install specify-cli`), **Phase 6 — OpenSpec** (`openspec --version`, via `npm install -g openspec`), **Phase 7 — Ralph Loop** (Claude Code plugin `ralph-loop`, via `claude plugin install`; pre-check skips cleanly on pre-2.1 Claude Code). Each honors `MMD_AUTO_INSTALL_<PILLAR>=1` and `MMD_REQUIRE_<PILLAR>=1`. The run ends with an **`═══ Install summary ═══`** banner showing each pillar's status at a glance. This is the install-side closure of L-012 (every claimed pillar is now installable + verifiable on a fresh machine). See [ADR-017](./docs/adr/017-three-pillars-install-hardening.md) for the design rationale.

## Usage

### CLI mode (terminal)

```bash
cd ~/Documents/make-my-dreams
mmd "a drawing app that overlays an image on the camera feed"
# → creates ./demo/drawing-app-overlays-image-camera-feed/ with a working PWA
```

**Interactive Dream Catcher dialogue (`mmd "<dream>"` on a TTY) — *new in v0.3.b*.** When you run `mmd "<dream>"` in a terminal, MMD now refines your dream **before** launching — the same dialogue the web mode runs, driven over the *same* surface-agnostic core ([`lib/dream-catcher/`](./lib/dream-catcher/)), just in the terminal:

```
mmd "une appli pour dessiner"        (on a TTY)
  → C'est pour qui ?  [enfant / curieux / pro]
  → Niveau ?          [auto / équilibré / guidé]
  → (guidé) Q1 → réponse → Q2 → réponse …
  → ✨ Scope  → [R]ecommencer / [M]odifier / [Entrée]=C'est parti
  → existing auto-dev launch with the refined scope
```

- **TTY-gated by default**: `shouldCatch = --catch || (stdin.isTTY && !--no-catch)`, and **never under `--here`**. So a terminal user gets the dialogue automatically, while `mmd "…" | cat` (no TTY) and CI launch the **verbatim dream** directly, unchanged.
- **`--catch` / `--no-catch`** (mutually exclusive): `--catch` forces the dialogue (exit 2 on a non-TTY — it needs a terminal); `--no-catch` skips it even on a TTY.
- **`[M]odifier`** edits the scope in place — opens `$EDITOR` on it if set, else a single-line replacement prompt. **`[R]ecommencer`** restarts from the profile step. An aborted dialogue (Ctrl-D / EOF) does **not** launch.
- The refined scope replaces the dream fed to auto-dev, and the chosen **profile** is persisted to `status.json` **and threaded into the build** via `MMD_PROFILE` (see below).
- If BMAD fails or returns nothing usable, the Dream Catcher is honest (universal §VI): it launches your **verbatim dream** with a visible note rather than fabricate a scope.

See [ADR-023](./docs/adr/023-dream-catcher-cli-and-profile.md) and [L-022](./docs/lessons-learned.md).

**`MMD_PROFILE` — the profile reaches the build — *new in v0.3.b, composer added in v0.3.c*.** The audience profile chosen in the dialogue (`Kid` / `Curious` / `Pro`, default `Curious`) is exported as `MMD_PROFILE` into the auto-dev subprocess on **both** surfaces (CLI greenfield and the web `/api/catch/confirm`). The auto-dev prompt then **states the profile** and injects the **constitution modules bound to it** via the **Layer C composer** (`lib/constitution-compose.js`): `MMD_PROFILE` resolves through `.specify/memory/constitution-bindings.yaml` to `defaults.always ∪ profiles[profile]`, and each `.specify/memory/constitution/<name>.md` is read and concatenated into the prompt under per-module headers. So a **`Kid`** build now carries the full `safe-by-default.md` + `kid.md` text (no network, no third-party services, hardware permission on gesture only, no commerce/social, accessibility, age-appropriate), a **`Curious`** build carries `safe-by-default.md`, and a **`Pro`** build carries `pro.md`. If the bindings file or a module is unreadable the composer returns `null` and `buildPrompt` falls back to v0.3.b's minimal Kid line — graceful, never a crash (universal §VI). An unset `MMD_PROFILE` leaves the prompt unchanged (back-compat). The composer uses a hand-rolled YAML-lite parser (no `yaml` dependency, vanilla stack); it composes by **profile** only for now (engine/context/skill dimensions are a future slice — the resolver is built to extend). The profile is no longer a dead `status.json` field — see [ADR-024](./docs/adr/024-constitution-composer-layer-c.md) and [L-022](./docs/lessons-learned.md).

Env vars: `MMD_AUTODEV_CMD` (override subprocess for testing), `MMD_AUTODEV_MODE` (`cli` | `test` — explicit, replaces the v0.1 path heuristic), `MMD_QUIET=1` (suppress subprocess output on the terminal; log file preserved), `MMD_TIMEOUT_MS` (default 1800000), `MMD_REALITY_CHECK_BACKEND` (`mcp` | `playwright` | `skip`), `MMD_DREAM_MAX_LEN` (default 500), `MMD_PROFILE` (`Kid` | `Curious` | `Pro` — audience profile threaded into the build; usually set by the dialogue, `Kid` → safe-by-default prompt).

### FAST mode — *new in v0.2*

For small features or quick iterations on brownfield projects, prefix the dream with `--fast`:

```bash
mmd --fast "add a red color button to the drawing app"
```

FAST runs a **trimmed auto-dev pipeline** with reduced ceremony — 1× Party Mode (instead of 3×), Phase 2 adversarial spec review skipped opportunistically (when the upfront spec passes a robustness heuristic), Phases 3 + 4 kept full because correctness is non-negotiable. Target wall-clock: **under 10 minutes per slice**, versus 30–90 min for the default `mmd <dream>` (STANDARD engine).

Before invoking auto-dev, FAST writes a deterministic 1-page minimal spec to `.mmd/shared/slice.md` (≤ 50 lines, ≤ 3000 chars, generated heuristically from the dream + any existing `vision.md`). Without this grounding the trimmed pipeline diverges; with it, the LLM stays on track. See [ADR-004](./docs/adr/004-fast-engine-trimmed-not-ralph.md) for why FAST is a trimmed auto-dev rather than a Ralph Loop.

After the run, `.mmd/shared/status.json` records the engine and a few metrics that seed the future `dream-bench` (v0.2b):

```json
{
  "engine": "fast",
  "engine_metrics": {
    "duration_seconds": 412.3,
    "party_mode_rounds": 1,
    "phase2_skipped": null,
    "phase2_skip_reason": null
  }
}
```

FAST-specific env vars:
- `MMD_FAST_MAX_MINUTES` — soft budget (default 12). If the run exceeds it, stderr emits a warning suggesting `--standard`; the subprocess is NEVER killed (would lose work).

Engine flags (`--fast`, `--standard`, `--deep`) are mutually exclusive. `--standard` and `--deep` parse cleanly in v0.2 but resolve to the default STANDARD engine — their distinct semantics land in v0.2d. POSIX `--` is supported: anything after `--` is treated as positional dream text, so a dream like `--literally-my-dream` can be passed as `mmd -- --literally-my-dream`.

### Self-modification mode (`--here`) — *new in v0.2a*

For small in-place changes to **an existing git repo** — including MMD itself — pass `--here`:

```bash
cd ~/Documents/make-my-dreams
mmd --here "add a banner at the top of README.md that links to BOOTSTRAP.md"
```

`--here` skips `demo/<slug>/` and works **on the current repo**:

1. Validates that cwd is a clean git repo (exits 3 if not a repo, exits 4 if the working tree is dirty).
2. Creates a slice branch `slice/here-<dream-slug>-<unix-timestamp>` from HEAD (exits 5 if `git checkout -b` fails).
3. Invokes auto-dev with an in-place prompt — explicitly told NOT to scaffold a new PWA.
4. Writes `.mmd/shared/{vision,slice,status.json,decisions.log}` under the target repo with `mode: "here"`, `target_dir`, `slice_branch`, `base_branch`, `base_sha`.
5. **Never auto-merges** — the human reviews the slice branch and merges (or discards) it.

After the run, MMD prints the slice branch name and the three follow-up commands:

```
[OK] Changes applied on slice/here-add-a-banner-1779537600. Review with: git diff <base_sha>..HEAD
     Merge with:  git checkout main && git merge --ff-only slice/here-add-a-banner-1779537600
     Discard with: git checkout main && git branch -D slice/here-add-a-banner-1779537600
```

Engine flags compose with `--here` (`mmd --here --fast "<change>"` is valid). Reality Check is short-circuited in `--here` mode — there is no PWA to open. If the target repo has a `package.json` with a `test` script, MMD suggests `npm test` (suggestion only, never auto-runs).

**Why explicit and not auto-detected?** See [ADR-005](./docs/adr/005-here-mode-explicit-flag-not-auto-detect.md). Short version: silent in-place mutation is destructive-by-default — a footgun for any user running mmd from inside a personal git repo. `--here` requires a named opt-in.

**Operate on any project (`--here`).** This is the implementation step that fulfills the reflexive bootstrap [MAKE_MY_DREAMS.md §7](./MAKE_MY_DREAMS.md): from v0.2a onward, the same CLI works on greenfield (`demo/<slug>/`) and on any existing repo (in-place). Self-development of MMD now flows through the supported path rather than bypassing it (cf [`docs/lessons-learned.md`](./docs/lessons-learned.md) L-009).

**Prompt-grounding check — *new in v0.2.h*.** Before creating the slice branch, `--here` parses your dream for documented file references (`SPEC_*.md`, `docs/*.md`, `.specify/memory/*.md`, and root files like `MAKE_MY_DREAMS.md`, `README.md`, `package.json`) and verifies each one exists on the slice's base via `git cat-file -e`. If any cited file is missing, `mmd` exits with **code 6** and lists the missing paths plus how to fix it (commit the files to the base first, or remove the references from the dream) — instead of spending 30+ minutes of auto-dev on a prompt that references a file that isn't there (the failure captured in [`docs/lessons-learned.md`](./docs/lessons-learned.md) L-015). The check is deterministic, closed-pattern (no LLM), and runs in well under 100 ms. To bypass it — e.g. when a path lives somewhere the patterns don't recognize — set `MMD_SKIP_GROUNDING=1`; the slice then proceeds with a warning, at your own risk. See [ADR-013](./docs/adr/013-prompt-grounding-check.md).

`--here`-specific env vars:
- `MMD_HERE_PROTECTED_BRANCHES` — comma-separated list (default `main,master`). `--here` from a protected branch is NOT an error — the slice branch is still created from HEAD. This env var documents the protected names for future Conductor enforcement.
- `MMD_SKIP_GROUNDING` — set to `1` to bypass the prompt-grounding check (above). Not recommended; emits a warning and proceeds.

### Sealed-test oracle (`mmd --sealed`) — *new in v0.4.a; `--here` in v0.4.b; import-graph blast radius in v0.4.c*

The classic AI-coding failure is **making a test pass by rewriting the test, not the code** (PROBLEMS.md P-04 — ~a quarter of "verified" SWE-bench-Pro patches are actually wrong). `mmd --sealed "<dream>"` is an opt-in guard against it: an **independent oracle** that the implementing agent cannot quietly weaken.

```bash
mmd --sealed "a counter app with + and − buttons"   # greenfield
mmd --here --sealed "add a dark-mode toggle"          # in-place, incl. MMD itself (v0.4.b)
```

It runs a **two-phase, MMD-orchestrated** flow:

1. **TESTER** — a `claude -p` sub-agent derives acceptance tests from your dream (and `slice.md`, if present) into a sealed directory (`<target>/.mmd/shared/sealed-tests/` — `demo/<slug>/` on greenfield, the repo root on `--here`). It is told, emphatically, **not to implement the app** — the oracle must be blind to the implementation.
2. **SEAL** — MMD records a sha256 manifest of every sealed test file.
3. **CODER** — the existing auto-dev runs as usual, with a prompt stating the sealed directory is a **read-only oracle**: read the tests to learn the target behaviour, but never edit, weaken, rename, or delete them. (Greenfield runs the coder on `demo/<slug>/`; `--here` runs it on the slice branch.)
4. **VERIFY** — MMD re-hashes the sealed directory. Any **tampered** or **removed** file is a seal break: `mmd` exits **non-zero naming the file(s)** and the slice is **not** marked done and **not** merged (anti-P-04). Files the coder *adds* (its own helper tests) are allowed.
5. **RE-RUN + BLAST** — on an intact seal, MMD re-runs the sealed tests as an independent oracle (a failure flags the slice), then writes the **blast radius** to `status.json.blast_radius`. As of v0.4.c this is **import-graph accurate** (not the old grep stub): MMD parses every file's module specifiers, resolves each relative one to a concrete file (`./` vs `../` not conflated; comment-only mentions excluded), builds the import graph, and records the **transitive reverse closure** (`transitive`) — every file that imports a changed file directly or through a chain — alongside the direct `importers`.

The TESTER → SEAL → VERIFY → re-run → BLAST steps are **surface-agnostic** (`runSealedPipeline`, with the coder injected as a callback); only the coder differs between greenfield and `--here`. The **reflexive payoff** of v0.4.b: the same anti-P-04 oracle that guards a generated app now guards **MMD modifying itself** — a self-dev slice can be launched with `mmd --here --sealed` so an independent sealed oracle verifies its own correctness.

Honesty is non-negotiable (constitution §VI): a tester that fails or writes nothing, an empty seal, a coder error, a tamper, or a failing sealed test each surface **explicitly** — never a silent "sealed OK". `--sealed` composes with the engine flags and `--here` (`mmd --here --sealed --fast "<change>"`). The **default path (no `--sealed`) is byte-for-byte unchanged** on both surfaces.

Deferred to a follow-up (see [ADR-026](./docs/adr/026-sealed-test-oracle.md)): `--sealed` as a Standard-engine default. The blast radius graduated from grep stub to import-graph accurate in v0.4.c ([ADR-027](./docs/adr/027-import-graph-blast-radius.md)) with **zero new dependencies** (vanilla-stack); its documented residual gap is computed/runtime specifiers, re-export aliasing, and non-JS importers. Enforcement lives entirely at the **MMD layer** because the BMAD auto-dev workflow is gitignored — see the ADRs for why.

### Bench mode (`mmd bench`) — *new in v0.2b*

`mmd bench` runs a fixed corpus of 5 canonical dreams (3 kid + 2 pro, see [`bench/dreams/`](./bench/dreams/) and the [schema reference](./bench/dreams/SCHEMA.md)) end-to-end, captures per-dream metrics, and aggregates a deterministic report. It is the regression harness for the reflexive bootstrap: any future MMD version is only promotable if its `mmd bench` output beats the previous version's.

**v0.2b scope (design vs current implementation — per [L-009](./docs/lessons-learned.md))**:
- **Design** (per [MAKE_MY_DREAMS.md §8.3](./MAKE_MY_DREAMS.md)): a hands-off CI-runnable harness that gates every MMD release with measurable signals (time-to-MVP, reality-check pass rate, cost). v0.5b will additionally feed bench output into the autolearning loop.
- **Current implementation** (v0.2b): the loader, runner, metrics serializer, aggregator, and CLI dispatch all ship. The reality-check integration in real runs is deferred to a follow-up slice — for now `mmd bench` in real mode marks `reality_check.ran=false` while the user runs the reality check manually after the bench. `--dry-run` writes a stub screenshot so the metric shape is faithful to the design.

```bash
# Validate the harness itself (no auto-dev invoked, no env var needed):
mmd bench --dry-run

# Run for real (takes hours — opt-in gate):
MMD_BENCH_REAL=1 mmd bench

# Filter to one or two dreams:
mmd bench --dry-run --dreams kid-01-drawing-camera-overlay,pro-01-csv-viewer

# Override output dir:
mmd bench --dry-run --out-dir /tmp/my-bench-run

mmd bench --help
```

**Opt-in gate.** A real `mmd bench` runs the auto-dev pipeline 5× sequentially, which typically takes several hours. The harness refuses to start without `MMD_BENCH_REAL=1` (exit 2) unless `--dry-run` is also passed. This is a constitution `security.md` §A04 (insecure-design) safeguard: the more expensive default must require an explicit acknowledgement.

**Output layout** (under `bench/runs/<run-id>/`, gitignored except the README):
- `summary.json` — machine-readable aggregate (totals, pass rate, MMD version + git SHA).
- `report.md` — human-readable aggregate (deterministic — no LLM call).
- `<dream-id>/metrics.json` — per-dream AC-4 fields.
- `<dream-id>/run.log` — subprocess capture.
- `<dream-id>/screenshot.png` — reality-check screenshot (stub PNG in `--dry-run`).
- `<dream-id>/demo/<slug>/` — isolated working dir that auto-dev modified.
- `bench/runs/latest/` — symlink to the freshest run.

**Exit codes**: `0` all green, `2` user/gate error, `6` reality-check failed (no crash), `7` auto-dev crashed.

**Why these 5 dreams, why sequential, why no $-cost metric?** See [ADR-006](./docs/adr/006-dream-bench-v0-design.md).

### Discover mode (`mmd discover`) — *new in v0.2c*

`mmd discover [<path>]` is the Project Onboarder: it scans an existing target repo, ingests Spec Kit / BMAD / OpenSpec artifacts into `.mmd/shared/`, infers conventions deterministically, and writes `mmd-discovery-report.md` at the target root for human validation. Until the report is approved, `mmd --here` and `mmd <dream>` refuse to run on the same target (exit 5) — the **v0.2c validation gate** that catches "auto-dev hallucinates a stack" failures at the cheapest possible moment.

```bash
cd /your/project
mmd discover .                # SCAN → INGEST → INFER → REPORT (exit 0)
# review mmd-discovery-report.md
mmd discover --approve .      # flip Status: → VALIDATED
mmd --here "small change"     # now allowed
```

Flags: `--approve` (mark VALIDATED), `--refresh` (re-run from scratch), `--infer-with-claude` (LLM augmentation — stub in v0.2c), `--no-report-update` (scan only), `--force-non-git`, `--skip-onboarding` (top-level bypass — not recommended). Exit codes: `0` ok / `2` user error / `3` path missing / `4` not a git repo / `5` gate fired.

Non-intrusion guarantee: writes ONLY in `<target>/.mmd/`, `<target>/docs/` (NEW files), and `<target>/mmd-discovery-report.md`. Every write goes through `assertSafeWritePath` (path-traversal + symlink defenses). See [SPEC_V02C.md](./SPEC_V02C.md) for the 8 ACs and [ADR-008](./docs/adr/008-project-onboarder-walking-skeleton.md) for the design rationale.

### Brownfield install + onboarding

```bash
cd /your/project
bash ~/Documents/make-my-dreams/install-mmd.sh .
mmd discover .
# review mmd-discovery-report.md
mmd discover --approve .
mmd --here "your first small change"
```

### Ship mode (`mmd ship`) — *new in v0.2.f*

`mmd ship` invokes the gStack [`ship`](https://github.com/garrytan/gstack) skill on the current slice branch via `claude -p`. It replaces the manual `git merge --ff-only && git tag && git push --tags && git push --tags` chain that has been used for v0.1.0 → v0.2.2 releases with a richer workflow: merge-base verify, semver bump from diff, CHANGELOG update, squash WIP commits, push, PR creation, analytics persist.

**Prerequisites** (installed by `install-mmd.sh` as of v0.2.f — functional verification, not file presence):
- `bun` on `PATH` or at `~/.bun/bin/bun`
- gStack ship skill at `~/.claude/skills/gstack/ship/SKILL.md`
- `claude` (Claude Code CLI) on `PATH`

**Usage:**

```bash
# On a slice/* or feat/* branch:
mmd ship                       # ship the current branch
mmd ship slice/feat-foo        # ship a specific branch
mmd ship --dry-run             # build prompt + env, print plan, do NOT spawn claude
mmd ship --help                # full usage
```

**What the ship skill does** (5-line summary):
1. Reads the slice branch + base + tip SHA from the MMD-supplied prompt.
2. Runs the 20-step gStack ship workflow: merge-base verify, semver bump, CHANGELOG, squash WIP, tag, push, PR.
3. Tees stdout/stderr to `.mmd/local/ship-runs/<timestamp>.log`.
4. After exit, MMD runs [`scripts/audit-pillars.sh main..<branch>`](./scripts/audit-pillars.sh) and includes the pillar-invocation table in the summary (advisory — never gates the ship).
5. Returns the subprocess exit code as the `mmd ship` exit code.

**Exit codes** (per `error-handling.md` §II):
- `0` success
- `2` environment / dependency missing (claude, bun, gStack)
- `3` cwd is not a git repo
- `4` protected branch (main/master) or invalid branch prefix
- `<code>` subprocess passthrough on a real ship run

**Env vars:**
- `MMD_SHIP_TIMEOUT_MS` — subprocess timeout in ms (default 1800000, 30 min)
- `MMD_SHIP_CMD` — override the `claude` executable (testing only)
- `MMD_QUIET=1` — suppress terminal tee of subprocess output (log file preserved)

See [ADR-007](./docs/adr/007-gstack-effective-via-ship-subcommand.md) for the design rationale (why a wrapper rather than direct claude invocation, why install functional rather than file-presence, why `audit-pillars.sh` is advisory not gating).

### Other gStack skill wrappers — *new in v0.2.g*

Three more gStack-skill wrappers, all modelled on `mmd ship`. Same architecture (thin CLI coordinator → `claude -p` with `PATH=$HOME/.bun/bin:$PATH` forced → tees to `.mmd/local/<skill>-runs/<ts>.log`). All three are **read-only / advisory** — they never commit, never push, never create tags. They bypass the v0.2c Project Onboarder validation gate so a fresh brownfield can run `mmd cso` to learn about itself.

#### QA mode (`mmd qa`)

`mmd qa [<branch>] [--dry-run]` invokes the gStack [`qa`](https://github.com/garrytan/gstack) skill on the current (or named) branch: test stratification `@smoke`/`@unit`/`@integration`/`@e2e`, adversarial test pass, failure classification T1..T4 (in-branch new / pre-existing flake / infra / obsolete-deleted-spec). Output is tee'd to `.mmd/local/qa-runs/<timestamp>.log`. Expected wall-clock: 5-20 minutes.

```bash
mmd qa                       # qa the current branch
mmd qa slice/feat-foo        # qa a specific branch
mmd qa --dry-run             # build prompt + env, print plan
mmd qa --help                # full usage
```

Unlike `mmd ship`, `mmd qa` does NOT enforce the slice/feat/fix/... branch-prefix list — qa is advisory and may run on `main` too.

Env vars: `MMD_QA_TIMEOUT_MS` · `MMD_QA_CMD` · `MMD_GSTACK_SKILLS_DIR` · `MMD_QUIET=1`.

#### CSO mode (`mmd cso`)

`mmd cso [<branch>] [--dry-run]` invokes the gStack [`cso`](https://github.com/garrytan/gstack) (Chief Security Officer) skill on the current (or named) branch: secret scanning, dependency audit (incl. slopsquatting risk), lethal-trifecta check, sandbox / `settings.json` configuration validation — the Bundle A security audit per `.specify/memory/constitution/security.md`.

```bash
mmd cso                      # security review of the current branch
mmd cso slice/feat-foo       # security review of a specific branch
mmd cso --dry-run            # build prompt + env, print plan
mmd cso --help               # full usage
```

Env vars: `MMD_CSO_TIMEOUT_MS` · `MMD_CSO_CMD` · `MMD_GSTACK_SKILLS_DIR` · `MMD_QUIET=1`.

#### Release notes (`mmd document-release`)

`mmd document-release [<from>] [<to>] [--dry-run]` invokes the gStack [`document-release`](https://github.com/garrytan/gstack) skill to auto-generate a release-notes draft from a commit range. Defaults: `<from> = git describe --tags --abbrev=0` (last tag), `<to> = HEAD`. The draft is written to `.mmd/local/document-release-runs/<timestamp>.md` — a markdown file the user reviews and edits before publishing. Inputs the skill consults: `git log`, ADRs in `docs/adr/`, and the diff of `docs/lessons-learned.md`.

```bash
mmd document-release                       # range = last-tag..HEAD
mmd document-release v0.2.4 v0.2.6         # explicit refs
mmd document-release --dry-run             # build prompt + env, print plan
mmd document-release --help                # full usage
```

Exit codes for all three: same shape as `mmd ship` — `0` ok / `2` user/argv error / `3` not a git repo / `4` spawn failure or (for `document-release`) invalid refs / `<code>` subprocess passthrough.

> **`MMD_GSTACK_SKILLS_DIR` is a test-only knob.** Leave it unset in production — the default `~/.claude/skills/gstack` is correct. The variable's value flows into the LLM prompt and into a filesystem `existsSync` check, so it must never be pointed at an untrusted directory. See [ADR-009](./docs/adr/009-medium-gstack-integration-pattern.md) and `lib/skills/_common/skill-path.js` for the security rationale.

**Why these subcommands rather than folding the skills inside `auto-dev`?** Standalone CLI subcommands teach the user where each skill lives, can be composed with shell `&&`, and stay independently auditable in `audit-pillars.sh`. Folding inside `auto-dev` is the "Heavy option" from L-012 — deferred to v0.5+ once the Conductor design is mature. See [ADR-009](./docs/adr/009-medium-gstack-integration-pattern.md) for the full rationale.

### Lessons & composer — *new in v0.2e*

Every `mmd` subprocess invocation (autodev, ship, qa, cso, document-release) now passes its prompt through the **composer** before spawning `claude -p`. The composer reads `docs/lessons-learned.md`, finds the lessons whose keywords appear in the prompt (case-insensitive, word-boundary), and prepends a deterministic `## Active lessons (auto-injected by composer v0.2e)` section to the prompt. The autolearning loop from [MAKE_MY_DREAMS.md §6.5](./MAKE_MY_DREAMS.md) is now operational end-to-end: failures captured as new lessons reach every future prompt automatically.

```bash
mmd lessons                        # list every active lesson + injection count
mmd lessons match "git checkout"   # preview which lessons would inject for an input
mmd lessons match "git checkout" --context mmd-qa   # same, pre-filtered by context (v0.2.l)
mmd lessons --show L-008           # print one lesson's title + status + rule
mmd lessons --help
```

**Category + Applies to + context filtering** (*new in v0.2.l*). Each lesson now carries two optional annotations — `**Category**:` (a comma-list folksonomy, e.g. `git, subprocess-control`) and `**Applies to**:` (a comma-list of subcommands like `mmd --here, mmd ship`, or `*` for universal). Before keyword matching, the composer **filters by context**: a `mmd qa` invocation only considers lessons whose `Applies to` includes `mmd qa` or `*`, so a brownfield-only lesson never pollutes a qa prompt and vice-versa. Each spawn site passes its own context (`mmd --here`, `mmd <skill>`, `mmd unblock`); legacy callers that pass no context get the pre-v0.2.l full-file behavior unchanged. The fields are parser-tolerant (absent → `uncategorized` / `*`). Use `mmd lessons match "<prompt>" --context <subcommand>` to introspect the filtered result — it prints `Filtered N of M (context: …)` and returns a strict subset of the un-contextual match. This mirrors the constitution's per-context `constitution-bindings.yaml` model and keeps the composer scale-resilient as the lessons count grows — see [ADR-012](./docs/adr/012-composer-categorization.md).

Each composed run drops two sidecar files next to its `.mmd/local/<*>-runs/<ts>.log`:
- `<ts>.composer.json` — audit trail: which lessons matched, which keywords hit, file SHA, elapsed_ms, plus the v0.2.l context metrics (`context`, `filtered_out_by_context`, `matched_by_keyword`, `injected`)
- `[composer] injected …` line at the top of the run log itself

To roll up adoption across a slice: `scripts/audit-pillars.sh --with-composer main..HEAD` reports total runs, auto-injected runs, average lessons per run, and the top-5 lessons by injection count.

Knobs:
- `MMD_COMPOSER_DISABLED=1` — bypass composition (escape hatch — composer.json still written with `disabled: true`)
- `MMD_LESSONS_FILE` — point `mmd lessons` at a non-default file (testing)
- A missing `docs/lessons-learned.md` is a no-op (brownfield targets without `install-mmd.sh` are not penalized)

Matching is deterministic, sub-100ms on the live `docs/lessons-learned.md` regardless of size, capped at 5 injections per prompt by score with ties broken by id ascending. No LLM call, no embedding model — see [ADR-010](./docs/adr/010-composer-minimal-keyword-overlap.md) for why keyword-overlap over semantic matching.

### Document lessons (`mmd document-lessons`) — *new in v0.2.i*

The composer (above) injects lessons; `mmd document-lessons` closes the *other*
half of the autolearning loop — **promotion**. It is the "Documentalist lite": a
deterministic, no-LLM subcommand that scans every `.mmd/local/**/*.composer.json`
audit, deduplicates by run, increments each matched lesson's reuse counter in
`docs/lessons-learned.md`, and **auto-promotes** any lesson that reaches its own
`**To promote if**: N` threshold — appending its Rule to the right constitution
module, removing it from `docs/lessons-learned.md`, and writing a promotion ADR.

```bash
mmd document-lessons --dry-run            # preview: counters + promotions, no writes
mmd document-lessons                      # apply increments + promotions
mmd document-lessons --since 2026-05-01   # only audits newer than <ts>
mmd document-lessons --help
```

The destination module is taken from the lesson's own `**To promote if**` line
(e.g. "promote to testing.md"), defaulting to `ai-coding.md`. Milestone lessons
(`Status: milestone` — L-010/011/013/014) are never touched. Promotion is
best-effort across its three file ops; a partial failure exits `6` and reports
on stderr rather than pretending success. Exit codes: `0` ok / `2` user-argv
error / `5` no composer.json found at all / `6` partial failure. Pure-function
library (`lib/documentalist/{aggregate-injections,mutate-counters,promote-lesson,serialize-lessons}.js`),
with a byte-identity round-trip guarantee on `docs/lessons-learned.md`. See
[ADR-014](./docs/adr/014-documentalist-lite-counter-incrementer.md); the full
Documentalist Worker (cron trigger + LLM judgment) lands in v0.5b.

### Unblock mode (`mmd unblock`) — *new in v0.2.j*

When a slice looks stuck — no commit for a while, the same operation retried over and over, a recurring error in the logs, or a `claude -p` run killed by a timeout — do **not** retry blindly. Run a structured **5-Whys** stuck-recovery session instead:

```bash
mmd unblock                      # detector + 5-Whys on the current slice/* branch
mmd unblock slice/foo            # diagnose a named slice branch
mmd unblock --dry-run            # detector only: print signals + evidence, never call claude
mmd unblock --force              # skip the detector, run the session unconditionally
mmd unblock --help
```

`mmd unblock` first runs a deterministic, sub-100ms **stall detector** over `.mmd/shared/status.json`, the slice's last-commit age, and recent run-log error patterns. It emits signals from a closed enum (`no-commit-since-N-min`, `retry-count-exceeded`, `error-pattern-matched`, `duration-exceeded-budget`, `state-failed-explicit`, `heartbeat-stale`, `wip-uncommitted-since-N-min`). The last of these (*new in v0.2.n*) fires when the slice worktree is dirty (`git status --porcelain` non-empty) **and** the last commit is older than `MMD_STALL_WIP_UNCOMMITTED_MIN` (default 15 min) — the WIP-loss-on-kill risk (L-019): an auto-dev run killed mid-flight that left uncommitted work. When it fires, the 5-Whys prompt recommends `escalate-to-user` with the non-destructive salvage step `git stash push -u`. A clean stale branch or a fresh never-committed branch never fires it. If stalled (or `--force`), it spawns a **BMAD Party Mode** session: Mary (analyst) leads the 5-why chain while Winston (architect), Quinn (QA), Amelia (PO), and Christie (CSO) add their lens at each "why". Past lessons are auto-injected via the composer, so each session is smarter than the last.

The session writes `.mmd/shared/5-whys/<ts>.md` (full why-chain + evidence + parsed result) and prints one of five recommended actions:

| action | exit | what to do |
| --- | --- | --- |
| `continue-with-hint` | 8 | apply the hint, resume the slice |
| `abandon-approach` | 7 | pivot to a different approach |
| `escalate-to-user` | 6 | a human decision is needed (also the safe fallback on unparseable output) |
| `task-actually-complete` | 8 | the work is done — verify DoD and ship |
| `false-positive-stall` | 8 | no real stall — keep running |

`mmd unblock` does **not** auto-execute the action — you read the summary and act. Auto-trigger and auto-execution are a Conductor concern (see [MAKE_MY_DREAMS.md §4](./MAKE_MY_DREAMS.md)). Knobs: `MMD_STALL_MIN_NOCOMMIT` (default 10 min), `MMD_STALL_MAX_RETRIES` (3), `MMD_STALL_DURATION_BUDGET_FACTOR` (2.0), `MMD_STALL_ERROR_PATTERN_REGEX`, `MMD_STALL_WIP_UNCOMMITTED_MIN` (default 15 min), `MMD_FIVEWHYS_TIMEOUT_MS` (default 30 min). See [ADR-011](./docs/adr/011-five-whys-escalation.md) and [ADR-018](./docs/adr/018-wip-uncommitted-stall-signal.md) for the design rationale.

### Handover mode (`mmd handover`) — *new in v0.2.p*

`HANDOVER.md` carries a session across context switches. Most of it is human **intent** (what's next + why) that no tool can derive — but one block, "State at handover" (latest tag, branch, version, lesson/ADR counts, recent commits), is purely mechanical and drifts when hand-maintained (the live file once claimed "17 active lessons" while the parser counted 13). `mmd handover` re-derives ONLY that block and rewrites it in place between two markers, leaving every human-authored section byte-for-byte untouched.

```bash
mmd handover --tests 1055            # refresh the State block; record 1055 passing tests
mmd handover --tests 1055 --dry-run  # print the rewritten file to stdout, write nothing
mmd handover --help
```

The active-lessons count comes from the authoritative `parseLessons` (not a hand-tally), the tag/branch/commits from `git`, and the version from `package.json`. The one non-cheap field — the passing-test count — is supplied via `--tests N` or left as an explicit `(run npm test to refresh)` placeholder; the command **never** invents a number, runs the suite, or fabricates intent (constitution universal §VI). A failing git call renders `(unavailable: <reason>)`. If the markers (`<!-- mmd:handover:state:start -->` / `<!-- mmd:handover:state:end -->`) are absent, it refuses to guess where to write and exits 4 with the derived block printed. Running it twice with the same repo state + same `--tests` produces a byte-identical file (idempotent). It never auto-commits — the human reviews and commits (commit-git §I). Exit codes: `0` ok / `2` user-argv error / `3` HANDOVER.md missing / `4` markers absent. See [ADR-020](./docs/adr/020-mmd-handover-subcommand.md) and [L-020](./docs/lessons-learned.md).

### Document-readme mode (`mmd document-readme`) — *new in v0.3.d*

The README has the same problem `HANDOVER.md` had: it carries human **intent** (the intro, command docs, the prose History) plus a few **mechanical** facts (current version, latest tag, ADR/lesson/release counts, the changelog) that drift the moment a slice lands and nothing refreshes them — for a while this file still claimed "Pre-v0.1" and its History stopped at v0.2e. `mmd document-readme` applies the proven `mmd handover` pattern to the README: it re-derives ONLY two marker-bounded mechanical blocks and rewrites them in place, leaving every human-authored byte untouched.

```bash
mmd document-readme --tests 1309            # refresh the Status + Changelog blocks; record 1309 passing tests
mmd document-readme --tests 1309 --dry-run  # print the rewritten README.md to stdout, write nothing
mmd document-readme --help
```

Two managed blocks (each bounded by an HTML-comment marker pair — the `mmd:readme:status` pair around the Status list under [Status](#status), the `mmd:readme:changelog` pair around the [Changelog](#changelog) list):
- **Status**: version (`package.json`), latest tag, ADR count, active-lesson count (via the authoritative `parseLessons`), reflexive-slice count (number of release tags), and the test count.
- **Changelog**: one markdown line per git tag, **newest first**, rendered from each tag's annotation message (`git for-each-ref … %(contents:subject)`). A lightweight (non-annotated) tag renders `(no annotation)`; an empty tag list renders an explicit "no tags yet" line.

It also prints a **doc-drift report** on stdout: any `bin/mmd.js` subcommand (and top-level flag like `--here` / `--catch` / `--label`) that the README doesn't mention. The report is informational (exit 0) and **writes nothing** to the README — surfacing the drift root cause (a new subcommand ships but the prose never mentions it) without ever touching the human narrative.

Like `mmd handover`, it is honest on every missing source (a failing git call → `(unavailable: <reason>)`), it **never** invents the test count (supply `--tests N` or it leaves an explicit `(run npm test to refresh)` placeholder), it never runs the suite or auto-commits, and running it twice with the same repo state + same `--tests` produces a byte-identical file (idempotent). If a marker pair is absent it refuses to guess where to write and exits 4 with the derived block printed (the handover contract). It **reuses** the handover machinery directly — `lib/handover/rewrite-markers.js` for the marker rewrite and the `lib/handover/build-state-block.js` git/version/count helpers — rather than duplicating them. Exit codes: `0` ok / `2` user-argv error / `3` README.md missing / `4` markers absent.

This is the **lite** doc-sync: the mechanical *meta* is now machine-maintained, while the prose History (the *story*) and the per-command docs stay human-owned. The full event-driven Documentalist (Diataxis coverage, ADR-drift detection, gStack `/document-generate`) lands in v0.5b. See [ADR-025](./docs/adr/025-document-readme-doc-sync.md).

### Web mode (no terminal — for non-technical users)  — *new in v0.2.5*

```bash
mmd serve
```

This starts a local HTTP server on `http://localhost:3000` (configurable) and auto-opens the default browser. A minimalist page lets anyone — including a 13-year-old kid — type a dream description, click "Go", watch progress stream live, and get a link to the generated PWA. Same machine as `mmd` runs on. No tunnel, no cloud, no account.

**Dream Catcher** *(v0.3.a-1, dial + editing in v0.3.a-2, CLI surface + profile threading in v0.3.b — see [ADR-023](./docs/adr/023-dream-catcher-cli-and-profile.md))* — instead of launching your dream verbatim, `mmd serve` (and, on a TTY, `mmd "<dream>"` — same core) refines it first through a short, friendly dialogue: you type a dream, pick who it's for (Enfant / Curieux / Pro), then choose **how involved you want to be** — an involvement dial with three levels:

- **Autonome** ("Je te fais confiance") — **0 questions**: one autonomous `bmad-product-brief` call synthesizes the scope straight from your dream + profile (the original a-1 path).
- **Équilibré** (the default) — **1 clarifying question** before the scope.
- **Guidé** — **2 (up to 3) clarifying questions** before the scope.

MMD asks one question at a time (a headless `claude -p` has no stdin, so multi-turn elicitation is MMD-orchestrated stateless calls — see [L-021](./docs/lessons-learned.md)), collects your answers, and synthesizes a small, buildable scope (one capability + at most two extras; Kid profiles get safe-by-default framing). You see the proposed scope on a card and can **✏️ Modifier / Edit** it in place before launching, then **Recommencer** (start over) or **C'est parti !** to launch the existing auto-dev pipeline with the (possibly edited) scope. If BMAD fails or returns nothing usable, the Dream Catcher is honest (universal §VI): it launches your **verbatim dream** with a visible note rather than fabricate a scope. The routes are `POST /api/catch/start|answer|edit|confirm` — `/answer` is **state-driven** (it advances profile → level → clarifying answers → scope and returns `{next}` ∈ `level | question | scope`), `/api/catch/edit` replaces the scope text in place; the legacy one-shot `POST /api/dream` still works unchanged. See [ADR-021](./docs/adr/021-dream-catcher.md), [ADR-022](./docs/adr/022-dream-catcher-dial-and-edit.md) and [L-021](./docs/lessons-learned.md).

```
┌─────────────────────────────────────────────────┐
│  Make My Dreams                                 │
├─────────────────────────────────────────────────┤
│  Décris ton rêve / Describe your dream          │
│  ┌───────────────────────────────────────────┐  │
│  │  une appli pour dessiner sur la caméra    │  │
│  └───────────────────────────────────────────┘  │
│  [ Vas-y / Go ]                                 │
│                                                 │
│  Progress: ▓▓▓▓▓░░░░░ 38%  Phase 3 / 4         │
│  Last update: 14:23:42                          │
│                                                 │
│  ✅ Ton rêve est prêt !                         │
│  [ Open my app ]  [ Start a new dream ]         │
└─────────────────────────────────────────────────┘
```

Env vars:
- `MMD_SERVE_PORT` — server port (default 3000; tries 3000-3010 if 3000 is in use)
- `MMD_SERVE_NO_OPEN=1` — skip auto-opening the browser (useful for CI / SSH)
- `MMD_SERVE_ALLOW_RANDOM=1` — required to allow `MMD_SERVE_PORT=0` (ephemeral, for tests)
- `MMD_SERVE_RATE_LIMIT_PER_HOUR` — successful-run cap per rolling hour (default 10). Only `exitCode == 0` runs consume capacity; failed runs are free retries.

**Working directory**: run `mmd serve` from the directory where you want `demo/` to live (typically the project root). The server spawns subprocesses with `cwd = process.cwd()` and serves `/demo/<slug>/*` from `<cwd>/demo`.

Stop with `Ctrl+C`. The server prints `À bientôt ! / Bye!` and exits cleanly.

**Security**: the server binds to `127.0.0.1` only (never accessible from another machine on your network or the internet). Path traversal on `/demo/<slug>/*` is blocked. CSP headers locked to `'self'`. No cookies, no tracking. Audited per `.specify/memory/constitution/security.md`.

## History

This repo started as `extend-bmad` — a customization of BMAD that combined quick-dev, party mode, adversarial review loops and Spec Kit-style constitution injection (see `install-mmd.sh`, formerly `install-auto-dev.sh`). After comparative usage of Spec Kit, OpenSpec, BMAD and gStack, the scoping evolved into Make My Dreams: an accessibility and orchestration layer that sits on top of these frameworks rather than replacing them. The full design rationale is in [MAKE_MY_DREAMS.md](./MAKE_MY_DREAMS.md), with 14 versioned iterations documenting how every decision was reached.

**v0.2a (2026-05-17)** delivered the reflexive bootstrap [§7](./MAKE_MY_DREAMS.md) in practice via the `--here` mode flag: the same `mmd` CLI now works on greenfield (creates `demo/<slug>/`) and on any existing git repo in place (creates a slice branch and modifies cwd). This closes the gap surfaced by [L-009](./docs/lessons-learned.md) — that the walking-skeleton wrapper was silently capping the design's "MMD must work on any project, including itself" intent. See [SPEC_V02A.md](./SPEC_V02A.md) for the 7 ACs and [ADR-005](./docs/adr/005-here-mode-explicit-flag-not-auto-detect.md) for why `--here` is a named flag rather than auto-detected.

**v0.2c (2026-05-17)** delivered the Project Onboarder walking skeleton: a `mmd discover [<path>]` subcommand that scans/ingests/infers/reports against any existing repo and produces `mmd-discovery-report.md` for human validation. A new constitution-enforced gate blocks `mmd --here` and `mmd <dream>` on brownfield targets until the report is `--approve`d (bypassable via `--skip-onboarding` for conscious overrides). This is the operational closure of the L-009 pattern in the brownfield dimension: auto-dev no longer runs blind. See [SPEC_V02C.md](./SPEC_V02C.md), [ADR-008](./docs/adr/008-project-onboarder-walking-skeleton.md), and the L-015 capture in [`docs/lessons-learned.md`](./docs/lessons-learned.md) (fourth reflexive use of `mmd --here`).

**v0.2.f (2026-05-17)** turned gStack from a documentation claim into a runtime reality. Three coordinated changes: (1) `install-mmd.sh` installs + functionally verifies `bun` and gStack (responds to `--version` / `gstack-config`, not just file presence); (2) `mmd ship [<branch>] [--dry-run]` invokes the gStack `ship` skill via `claude -p` with PATH forced to include `~/.bun/bin` — the first MMD subcommand that actually calls a non-BMAD pillar; (3) `scripts/audit-pillars.sh` reports `INVOKED (count)` / `NOT INVOKED` per pillar against the slice range and runs automatically inside every `mmd ship`. This is the operational closure of [L-012](./docs/lessons-learned.md) (gStack named as a pillar but never invoked across 11 slices). See [SPEC_V02F.md](./SPEC_V02F.md) for the 8 ACs and [ADR-007](./docs/adr/007-gstack-effective-via-ship-subcommand.md) for the design rationale.

**v0.2.g (2026-05-18)** delivered the Medium gStack walking skeleton: three more skill wrappers (`mmd qa`, `mmd cso`, `mmd document-release`) sharing a reusable `lib/skills/<name>/*` pattern extracted from v0.2.f's `lib/ship/*`. The shared `lib/skills/_common/invoke-claude.js` carries the PATH-forcing, race-safe log-stream finish (the v0.2.f L-013 fix preserved), heartbeat, and ENOENT-mapping for every current and future skill wrapper. After v0.2.g, adding the next gStack skill (e.g. `/context-save`, `/freeze`) is genuinely a 1-hour exercise rather than a 1-week design problem. `audit-pillars.sh` now reports gStack invocations across 4 distinct skill names (ship + qa + cso + document-release), taking the L-012 gap from "1 of 41 skills used" to "4 of 41". See [SPEC_V02G.md](./SPEC_V02G.md) for the 7 ACs and [ADR-009](./docs/adr/009-medium-gstack-integration-pattern.md) for the design rationale (why extract the shared layer after only one skill, why the new commands bypass the discovery gate, why we did NOT fold the skills inside `auto-dev`'s pipeline — Heavy is still v0.5+).

**v0.2e (2026-05-18)** delivered the **autolearning composer**: every `mmd` subprocess invocation (autodev, ship, qa, cso, document-release) now passes its prompt through a deterministic keyword-overlap matcher against `docs/lessons-learned.md` BEFORE spawning `claude -p`. Matched lessons' rules are prepended to the prompt; a `composer.json` audit trail is written alongside the run log. A new `mmd lessons` subcommand lists active lessons + injection counts, previews matches for any input, and prints individual lesson bodies. `scripts/audit-pillars.sh --with-composer` rolls up adoption across a slice. Pure-function library (`lib/composer/{parse-lessons,match,format,audit,usage-stats}.js`), sub-100ms on the live lessons file, no LLM call, no embedding model — see [ADR-010](./docs/adr/010-composer-minimal-keyword-overlap.md) for the design rationale. After v0.2e, the autolearning loop from [§6.5](./MAKE_MY_DREAMS.md) is operational end-to-end: failures captured as new lessons reach every future prompt automatically. Sixth reflexive use of `mmd --here` after L-010 / L-011 / L-013 / L-015 / L-016.

**v0.2.5 → v0.3.3 (2026-05-18 → 2026-05-31)** — condensed arc (full detail per slice in each `SPEC_V0*.md` + `docs/adr/`): **v0.2.5** the `mmd serve` web UI (the accessibility unlock — see scoping v14); **v0.2.h–v0.2.13** prompt-grounding precheck (L-015 code-enforced), the Five-Whys `mmd unblock`, composer categorization, the lite Documentalist (`mmd document-lessons`, which auto-promoted its first lessons into the constitution), and 3-pillars install hardening (Spec Kit + OpenSpec + Ralph Loop); **v0.2.14** the `wip-uncommitted-since-N-min` stall signal; **constitution v2.1.0** added §VII "Human-readable first"; **v0.2.15** human-readable slice-branch names (`--label`); **v0.2.16** `mmd handover` (auto-refreshes this file's mechanical State block). Then **v0.3.0 → v0.3.3 — Dream Catcher**: the conversational dream-refinement feature on web *and* CLI (3 involvement levels Autonome/Équilibré/Guidé, editable scope), backed by a headless `bmad-product-brief` elicitation, with audience profiles (Kid/Curious/Pro) threaded into the build and bound to constitution modules via the new Layer-C composer (`lib/constitution-compose.js`). This whole arc was built reflexively — 18 `mmd --here` slices, 1268 tests.

The folder will be renamed `make-my-dreams/` after v0.1 is validated. The repo itself can be renamed at any time on the git host.

## Status

<!-- mmd:readme:status:start -->
- **Version**: `0.4.1` (package.json)
- **Latest tag**: `v0.4.1`
- **ADRs**: 26 (ADR-001..ADR-026)
- **Active lessons**: 17 active
- **Reflexive slices (release tags)**: 25
- **Tests**: 1343 passing
- _Mechanical block — regenerated by `mmd document-readme`; the prose History and command docs are human-authored._
<!-- mmd:readme:status:end -->

The bulleted block above (version, tag, counts) is machine-maintained by `mmd document-readme`; the prose below is the human-owned story.

**v0.3.4** (2026-06-01) — actively developed and **usable today**: the CLI, the `mmd serve` web UI, and the auto-dev pipeline all work. MMD is built through a **reflexive bootstrap** (MMD develops MMD) — the live slice/test/ADR/lesson counts are in the mechanical block above (they used to drift in this prose until `mmd document-readme` started maintaining them).

What works now: **Dream Catcher** (conversational dream refinement on web *and* CLI — pick who it's for and how involved you want to be, get a small buildable scope, edit it, launch); `mmd serve` (local web UI for non-technical users); `mmd "<dream>"` / `mmd --here` (greenfield + brownfield auto-dev); plus `mmd handover`, `mmd unblock`, `mmd discover`, `mmd ship`, `mmd qa`, `mmd cso`, `mmd document-release`, `mmd document-lessons`, `mmd lessons`, `mmd bench`. Audience **profiles** (Kid / Curious / Pro) now shape the generated app via the constitution composer.

Next on the roadmap (see [MAKE_MY_DREAMS.md](./MAKE_MY_DREAMS.md)): a lite doc-sync Documentalist, then v0.4 stateless Orchestrator + auto-handoff, v0.5 Conductor, v0.5b full Documentalist. See [BOOTSTRAP.md](./BOOTSTRAP.md) for the active plan, [docs/adr/](./docs/adr/) for decisions, and [PROBLEMS.md](./PROBLEMS.md) for the 26 documented dev-by-AI problems.

## Changelog

One line per release, newest first, generated from each git tag's annotation by `mmd document-readme`. This is the *mechanical* release list; the narrative **History** above is the human-owned story of why each slice happened.

<!-- mmd:readme:changelog:start -->
- **v0.4.1** — sealed oracle on --here: mmd --here --sealed. Extracted surface-agnostic runSealedPipeline (coder injected); MMD can now seal-test its own slices. Greenfield unchanged. 1343 tests. 21st reflexive --here use.
- **v0.4.0** — Bundle B: sealed-test oracle (mmd --sealed). Two-phase tester→seal→coder→verify catches the agent-rewrites-the-test failure (P-04) + blast-radius stub. First correctness hardening of MMD's auto-dev. 1337 tests. 20th reflexive --here use.
- **v0.3.4** — mmd document-readme (Documentalist-lite): the mmd handover pattern applied to the README. Regenerates Status + Changelog (from git tag annotations) between markers + a drift report. Closes doc drift at the root. 1309 tests. 19th reflexive --here use.
- **v0.3.3** — Layer C: profile→constitution-module composer. MMD_PROFILE now injects real kid.md/pro.md/safe-by-default modules into the build prompt. 1268 tests. 18th reflexive --here use.
- **v0.3.2** — Dream Catcher CLI surface (TTY-gated mmd dream + --catch/--no-catch) + MMD_PROFILE threading (Kid → safe-by-default). v0.3 complete: web + CLI + meaningful profile. 1224 tests. 17th reflexive --here use.
- **v0.3.1** — Dream Catcher involvement dial (Autonome/Équilibré/Guidé) + scope editing. Core complete. 1186 tests. 16th reflexive --here use.
- **v0.3.0** — Dream Catcher walking skeleton: web dream → profile → autonomous bmad-product-brief scope → confirm → auto-dev. First v0.3 milestone. 1145 tests. 15th reflexive --here use.
- **v0.2.16** — mmd handover subcommand (L-020): auto-refresh the mechanical State block, never fabricate intent. 1087 tests. 14th reflexive --here use, 1st with --label.
- **v0.2.15** — human-readable branch names for mmd --here (--label + boilerplate strip). Embodies constitution universal §VII. 1055 tests.
- **v0.2.14** — L-019 closure: WIP-salvage stall signal (wip-uncommitted-since-N-min) + composer L-015 regression-lock. 1043 tests, +18. 13th reflexive mmd --here use.
- **v0.2.13** — Spec Kit + OpenSpec + Ralph Loop install hardening (L-012 fully closed)
- **v0.2.12** — Documentalist lite (autolearning §6.5 fully operational)
- **v0.2.11** — Conductor preconditions hardening (prompt-grounding check)
- **v0.2.10** — Composer categorization (context-aware filter)
- **v0.2.9** — MMD-on-MMD findings closure (L-017 + cso LOW-1/2 + qa High-1/2/3 + e2e t.skip)
- **v0.2.8** — Five Whys Escalation (mmd unblock)
- **v0.2.7** — Composer minimal (lessons auto-injection)
- **v0.2.6** — Medium gStack (mmd qa + mmd cso + mmd document-release)
- **v0.2.5** — mmd serve: accessibility unlocked for non-tech users
- **v0.2.4** — Project Onboarder walking skeleton (mmd discover)
- **v0.2.3** — gStack effective (install hardening + mmd ship + audit-pillars)
- **v0.2.2** — dream-bench v0 (mmd bench)
- **v0.2.1** — --here mode (self / brownfield-in-place)
- **v0.2.0** — FAST engine (trimmed auto-dev)
- **v0.1.0** — v0.1 walking skeleton
<!-- mmd:readme:changelog:end -->

## Components

- [`MAKE_MY_DREAMS.md`](./MAKE_MY_DREAMS.md) — full scoping document (v19, ~1700 lines)
- [`PROBLEMS.md`](./PROBLEMS.md) — annex: 26 documented problems and techniques
- [`BOOTSTRAP.md`](./BOOTSTRAP.md) — step-by-step execution plan
- [`HANDOVER.md`](./HANDOVER.md) — session handover (state + intent); its State block is auto-refreshed by `mmd handover`
- `SPEC_V0*.md` — one frozen spec per slice (the v0.1 walking skeleton through the latest [`SPEC_V03C.md`](./SPEC_V03C.md)); `docs/adr/` holds 24 ADRs
- [`install-mmd.sh`](./install-mmd.sh) — self-contained installer; installs + functionally verifies the pillars (BMAD + adv module + auto-dev workflow, bun, gStack, and — since v0.2.13 — Spec Kit / OpenSpec / Ralph Loop).

## Quick start

```bash
bash install-mmd.sh .            # install the pillars + the auto-dev workflow
npm install -g .                 # put `mmd` on your PATH
mmd serve                        # open the web UI (easiest — for anyone)
# …or, from a terminal:
mmd "une appli pour dessiner"    # interactive Dream Catcher dialogue, then auto-dev
mmd --here "add a dark-mode toggle"   # modify the current git repo in place
```

## License

MIT — see [LICENSE](./LICENSE) (to be added in v0.1).
