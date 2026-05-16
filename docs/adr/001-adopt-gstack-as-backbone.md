# ADR-001: Adopt gStack as the runtime backbone

**Date**: 2026-05-16
**Status**: Accepted
**Authors**: Sébastien (project owner)

## Context

After comparative audit of Spec Kit, OpenSpec, BMAD, gStack and Ralph Loop (see [MAKE_MY_DREAMS.md](../../MAKE_MY_DREAMS.md) §2 and §3.2), gStack covers ~70% of the runtime skills MMD would otherwise have to build from scratch — with a production maturity MMD cannot match in the short term.

The pivot toward "MMD = orchestration layer on top of gStack" was enacted in scoping v10.

## Decision

MMD uses gStack as its runtime backbone. MMD Workers invoke gStack skills at runtime rather than reimplementing them. MMD focuses its development effort on its **6 real differentiators** (cf MAKE_MY_DREAMS.md §3.2):

1. Multi-audience accessibility (Kid → Pro)
2. Reflexive bootstrap + autolearning
3. Worktrees parallelization
4. Brownfield Project Onboarder
5. Stateless hierarchical orchestration
6. 3 engines with Mode Router

`install-mmd.sh` (formerly `install-auto-dev.sh`, renamed in v13) is kept as the bootstrap for MMD's **Standard engine** (BMAD + adv module + auto-dev workflow + project constitution).

## Audit results (v0.0)

The 10 most critical gStack skills (the ones MMD will depend on per §3.3 orchestration map) were checked on **2026-05-16**.

### Environment validated

| Component | Version | Status |
|---|---|---|
| Node.js | v20.19.5 | ✓ OK |
| npm | 10.8.2 | ✓ OK |
| Bun | 1.3.14 | ✓ OK (installed during v0.0) |
| Git | 2.34.1 | ✓ OK |
| Claude Code CLI | 2.1.140 | ✓ OK |
| BMAD | 6.6.0 | ✓ Installed via `install-mmd.sh` |
| gStack | v1.39.1.0 (commit f589770) | ✓ Cloned to `~/.claude/skills/gstack` |

### Critical skills smoke-test

Each skill verified present with a non-empty `SKILL.md` file. Live interactive testing of each skill in a Claude Code session (typing the slash-command, observing behavior end-to-end) is deferred to the moment we actually invoke it from a MMD Worker — at which point any incompatibility surfaces immediately and is fixed in the `mmd-gstack-invoke` wrapper.

| Skill | Present | SKILL.md size | Notes |
|---|---|---|---|
| `/office-hours` | ✓ | 2092 lines | Dream Catcher / Plan-Review dependency |
| `/design-consultation` | ✓ | 1577 lines | Mockup Generator dependency |
| `/plan-ceo-review` | ✓ | 2223 lines | Plan-Review Worker (CEO mode) |
| `/plan-eng-review` | ✓ | 1750 lines | Plan-Review Worker (Eng mode) |
| `/qa` | ✓ | 1647 lines | Reality Check (functional mode) |
| `/cso` | ✓ | 1439 lines | Security Worker — Reality Check (security mode) |
| `/context-save` | ✓ | 993 lines | Context Worker — handoff primitive |
| `/context-restore` | ✓ | 874 lines | Context Worker — handoff primitive |
| `/document-release` | ✓ | 1261 lines | Documentalist — post-ship doc sync |
| `/ship` | ✓ | 3054 lines | Dream Delivery |

**Total skills observed in gStack v1.39.1.0**: 64 directories with a `SKILL.md` (more than the ~41 initially reported in the v1 analysis — the ecosystem has grown).

## Consequences

### Immediate

- MMD development unblocked for v0.1 (the walking skeleton uses only Standard engine; gStack invocation comes in v0.2+).
- `install-mmd.sh` is fixed (`--yes` + `--directory` now passed to BMAD non-interactive install — see commit `b2f82f2`).
- gStack version pinned at **v1.39.1.0 (commit f589770)** for this MMD development cycle. Bumps will go through dream-bench (cf §11 decision #35).
- All gStack invocations will go through the `mmd-gstack-invoke` wrapper (to be designed in v0.2 alongside Bundle A Security).

### Long-term

- If gStack disappears or breaks compatibility, MMD can fall back to a fork of these 10 critical skills (low effort given each SKILL.md is self-contained markdown + a small handler).
- New gStack skills discovered after v0.0 are evaluated by the automated watch (`dev-ai-watch`, v0.8) and optionally integrated as new MMD Workers.

## References

- https://github.com/garrytan/gstack (commit f589770 — pinned)
- [MAKE_MY_DREAMS.md §3.2 — Implementation strategy](../../MAKE_MY_DREAMS.md)
- [MAKE_MY_DREAMS.md §3.3 — MMD ↔ gStack orchestration map](../../MAKE_MY_DREAMS.md)
- [BOOTSTRAP.md Step 4 — Audit script](../../BOOTSTRAP.md)
- [PROBLEMS.md — 26 documented dev-by-AI problems](../../PROBLEMS.md)
