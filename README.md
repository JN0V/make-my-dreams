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

## History

This repo started as `extend-bmad` — a customization of BMAD that combined quick-dev, party mode, adversarial review loops and Spec Kit-style constitution injection (see `install-mmd.sh`, formerly `install-auto-dev.sh`). After comparative usage of Spec Kit, OpenSpec, BMAD and gStack, the scoping evolved into Make My Dreams: an accessibility and orchestration layer that sits on top of these frameworks rather than replacing them. The full design rationale is in [MAKE_MY_DREAMS.md](./MAKE_MY_DREAMS.md), with 14 versioned iterations documenting how every decision was reached.

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
