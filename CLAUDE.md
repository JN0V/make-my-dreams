# Project memory for Claude Code — Make My Dreams (MMD)

> Claude Code auto-loads this file at the start of every session opened in this repo. It propagates the project constitution to ANY skill, slash-command, sub-agent, or interactive task running in this session — not just to MMD's `auto-dev` engine.

## What this project is

Make My Dreams (MMD) is an accessibility and orchestration layer for AI-driven development. It stands on top of Spec Kit, OpenSpec, BMAD, gStack, and Ralph Loop rather than replacing them. The full design rationale lives in [`MAKE_MY_DREAMS.md`](./MAKE_MY_DREAMS.md) (16+ versions of evolving scoping) and the documented dev-by-AI problems in [`PROBLEMS.md`](./PROBLEMS.md).

## Constitution — modular, loaded by binding

The project constitution is modular (v2.0+). Modules live in `.specify/memory/constitution/`. A bindings table at `.specify/memory/constitution-bindings.yaml` tells which modules apply to a given skill, worker, engine, profile, or context.

**For an LLM working in this repo session:**

If you are about to invoke a known skill, worker, or engine, look up its required modules in `constitution-bindings.yaml` and load only those. This keeps your context lean.

If you are doing ad-hoc work and don't know which modules apply, load these baselines:

@.specify/memory/constitution/universal.md
@.specify/memory/constitution/ai-coding.md
@.specify/memory/constitution/commit-git.md

Then add as needed:
- Touching tests? `@.specify/memory/constitution/testing.md`
- Touching security-sensitive code? `@.specify/memory/constitution/security.md`
- Producing documentation? `@.specify/memory/constitution/documentation.md`
- Handling runtime errors? `@.specify/memory/constitution/error-handling.md`
- Making architectural decisions? `@.specify/memory/constitution/architecture.md`
- Working on a Kid-profile project? `@.specify/memory/constitution/safe-by-default.md` + `@.specify/memory/constitution/kid.md`

The full index of modules and their loading rules is in [`.specify/memory/constitution.md`](./.specify/memory/constitution.md).

## Constitution diffusion mechanisms

The constitution is propagated through three complementary layers:

**Layer A — Claude Code session (this file).** Anthropic auto-loads `CLAUDE.md` at session start. Any skill, slash-command, sub-agent, or interactive task spawned in this session inherits these instructions. Covers gStack skills (`/qa`, `/cso`, etc.), `/loop`, `/ralph-loop`, and Task-tool sub-agents.

**Layer B — auto-dev pipeline.** `install-mmd.sh` materializes the `auto-dev` workflow that explicitly injects the constitution into each Phase 1–4 sub-agent. Independent of this file; redundant for safety.

**Layer C — MMD CLI subprocess.** `lib/invoke-autodev.js` injects the constitution into the prompt passed to `claude -p` when MMD runs `auto-dev` headless (CI, cron, dream-bench). Required because subprocess `claude` sessions do not necessarily share the parent's CLAUDE.md.

The composer (`lib/constitution-compose.js`, **shipped v0.3.c**) turns the bindings table into a function that returns the per-invocation module bundle as a string ready for prompt injection. `parseBindings` (hand-rolled YAML-lite, no external dep) reads `constitution-bindings.yaml`; `resolveModules({profile}, bindings)` resolves `MMD_PROFILE` to `defaults.always ∪ profiles[profile]` (deduped, deterministic); `composeConstitution({profile})` reads each `.specify/memory/constitution/<name>.md` and concatenates them under per-module headers. `buildPrompt` injects that block when `MMD_PROFILE` is set — so a Kid build carries the real `safe-by-default.md` + `kid.md` text and a Pro build carries `pro.md` — and falls back to a minimal line if the bindings/modules are unreadable (graceful, never crashes). Currently composes by **profile** only; engine/context/skill dimensions are a future slice (the resolver is built to extend). See [ADR-024](./docs/adr/024-constitution-composer-layer-c.md).

## Working agreements in this repo

- **Branch first**: never commit directly to `main` for non-trivial work. See `commit-git.md` for naming conventions.
- **Push immediately**: after every commit, `git push`. Uncommitted-and-unpushed work doesn't exist.
- **Red-green for every failure**: any failure (test, install script, pipeline, integration) triggers a deterministic red→green test pass before it's considered fixed. See `testing.md`.
- **Test stratification**: tag every test you write (`@smoke`, `@unit`, `@integration`, `@e2e`). See `testing.md` §V.
- **AI honesty**: report walls explicitly, don't fabricate success. See `ai-coding.md` §I.
- **Sealed self-dev (optional, v0.4.b)**: a MMD slice MAY now be launched with `mmd --here --sealed "<change>"`. An independent tester writes blind acceptance tests into the gitignored `.mmd/shared/sealed-tests/`, MMD seals them by hash, auto-dev implements on the slice branch, and MMD fails the slice (exit 6, files named) if any sealed test was weakened or deleted (anti-P-04, L-023). Use it when the slice's correctness must be guarded by an oracle the implementing agent cannot edit. See [ADR-026](./docs/adr/026-sealed-test-oracle.md). The sealed pipeline also logs a **blast radius** to `status.json.blast_radius`; as of v0.4.c this is **import-graph accurate** (not a grep stub) — `lib/sealed-tests/import-graph.js` parses + resolves module specifiers and records the transitive reverse closure (every file that imports a changed file directly or through a chain), with **zero new dependencies** (vanilla-stack) and a documented residual gap (computed/runtime specifiers, re-export aliasing, non-JS importers). See [ADR-027](./docs/adr/027-import-graph-blast-radius.md), L-024. As of **v0.4.d** the sealed pipeline adds a **behavioral judge** (`lib/sealed-tests/judge.js`, P-09) that runs **after** the deterministic sealed-test gate passes: a `claude -p` oracle grades the implementation against *what was asked* (the dream/ACs) and emits a tagged per-AC verdict. All ACs `MET` → proceed; any `NOT-MET`/`UNCERTAIN` (or an unparseable reply → the sacred `uncertain` fallback, never a fabricated `met`) → **exit 7 (behavioral-gap)**, slice not marked done, verdict written to `status.json.judge`. **Exit 7 is distinct from the tamper/seal exit 6** (a tampered seal still exits 6 *before* the judge runs), so "tests went red / check attacked" (6) and "tests green but behavior misses the ask" (7) are distinguishable. See [ADR-028](./docs/adr/028-llm-judge-behavioral-oracle.md), L-025.

## Repo-specific notes

- The workspace folder is `~/Documents/extend-bmad/` (will be renamed `make-my-dreams/` after v0.1 stabilization).
- The `mmd` CLI entry point is `bin/mmd.js`.
- Tests are in `test/integration/` (52/52 passing as of v0.1.0).
- BMAD install (`_bmad/`), BMAD outputs (`_bmad-output/`), bmb/tea outputs (`skills/`), and `.claude/` (Claude Code project-scoped mirror) are all gitignored — regenerated by `install-mmd.sh`.
- **Keep the docs' mechanical meta honest.** Two commands refresh marker-bounded mechanical blocks without touching human prose: `mmd handover` (HANDOVER.md's State block) and `mmd document-readme` (README.md's Status + Changelog blocks, the latter built from git tag annotations). After a slice that bumps the version, adds an ADR/lesson, or ships a tag, run `mmd document-readme --tests N` so the README's version/tag/counts/changelog don't drift (v0.3.d, ADR-025). Both never fabricate a number and never auto-commit.

---

*This file is part of MMD's constitution diffusion (Layer A). Last updated in `feat/constitution-diffusion` branch, after constitution v2.0 modularization.*
