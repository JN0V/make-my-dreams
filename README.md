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

## Usage

### CLI mode (terminal)

```bash
cd ~/Documents/make-my-dreams
mmd "a drawing app that overlays an image on the camera feed"
# → creates ./demo/drawing-app-overlays-image-camera-feed/ with a working PWA
```

Env vars: `MMD_AUTODEV_CMD` (override subprocess for testing), `MMD_AUTODEV_MODE` (`cli` | `test` — explicit, replaces the v0.1 path heuristic), `MMD_QUIET=1` (suppress subprocess output on the terminal; log file preserved), `MMD_TIMEOUT_MS` (default 1800000), `MMD_REALITY_CHECK_BACKEND` (`mcp` | `playwright` | `skip`), `MMD_DREAM_MAX_LEN` (default 500).

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

`--here`-specific env vars:
- `MMD_HERE_PROTECTED_BRANCHES` — comma-separated list (default `main,master`). `--here` from a protected branch is NOT an error — the slice branch is still created from HEAD. This env var documents the protected names for future Conductor enforcement.

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

### Web mode (no terminal — for non-technical users)  — *new in v0.2.5*

```bash
mmd serve
```

This starts a local HTTP server on `http://localhost:3000` (configurable) and auto-opens the default browser. A minimalist page lets anyone — including a 13-year-old kid — type a dream description, click "Go", watch progress stream live, and get a link to the generated PWA. Same machine as `mmd` runs on. No tunnel, no cloud, no account.

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

**v0.2.f (2026-05-17)** turned gStack from a documentation claim into a runtime reality. Three coordinated changes: (1) `install-mmd.sh` installs + functionally verifies `bun` and gStack (responds to `--version` / `gstack-config`, not just file presence); (2) `mmd ship [<branch>] [--dry-run]` invokes the gStack `ship` skill via `claude -p` with PATH forced to include `~/.bun/bin` — the first MMD subcommand that actually calls a non-BMAD pillar; (3) `scripts/audit-pillars.sh` reports `INVOKED (count)` / `NOT INVOKED` per pillar against the slice range and runs automatically inside every `mmd ship`. This is the operational closure of [L-012](./docs/lessons-learned.md) (gStack named as a pillar but never invoked across 11 slices). See [SPEC_V02F.md](./SPEC_V02F.md) for the 8 ACs and [ADR-007](./docs/adr/007-gstack-effective-via-ship-subcommand.md) for the design rationale.

The folder will be renamed `make-my-dreams/` after v0.1 is validated. The repo itself can be renamed at any time on the git host.

## Status

Pre-v0.1. See [BOOTSTRAP.md](./BOOTSTRAP.md) for the active dev plan, [docs/adr/](./docs/adr/) for architectural decisions, and [PROBLEMS.md](./PROBLEMS.md) for the catalog of 26 documented dev-by-AI problems and how MMD addresses each.

## Components

- [`MAKE_MY_DREAMS.md`](./MAKE_MY_DREAMS.md) — full scoping document (v14, ~1000 lines)
- [`PROBLEMS.md`](./PROBLEMS.md) — annex: 26 documented problems and techniques
- [`BOOTSTRAP.md`](./BOOTSTRAP.md) — step-by-step execution plan
- [`SPEC_V01.md`](./SPEC_V01.md) — the v0.1 walking skeleton spec
- [`install-mmd.sh`](./install-mmd.sh) — self-contained installer; currently installs Phase A (BMAD + adv module + auto-dev workflow), MMD's **Standard engine**. Future phases (B–F) added incrementally with each MMD version.

## Quick start

(Coming with v0.1 — currently the repo is a design + bootstrap workspace, not yet a usable CLI.)

## License

MIT — see [LICENSE](./LICENSE) (to be added in v0.1).
