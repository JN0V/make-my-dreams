# Make My Dreams — v0.19.0 Spec (slice v0.19.a): `mmdream document` — the autonomous Documentalist (orchestrator)

> *(Sébastien, 2026-06-05: "on ne devrait pas avoir trop de commandes spécifiques documentaliste. pour moi c'est un agent qui agit sur l'ensemble des doc, en s'assurant qu'elles sont à jour, complètes, concises avec des liens structurés." And: it should "runner de manière auto et mettre à jour, consolider, compacter, corriger ce qui doit l'être" — you don't pick sub-commands; you launch the agent and it does the maintenance.)*
>
> **The problem this closes:** the Documentalist shipped incrementally (v0.2 → v0.7) as **6 separate commands** — `handover`, `document-readme`, `document-review`, `document-compact` (the four maintenance hats) plus the two mis-filed `document-lessons` (really the autolearning loop) and `document-release` (really a generation face). The vision was always **one** agent (`MAKE_MY_DREAMS.md` §6.4); the CLI surface never got consolidated. So the owner must remember and stitch 4 commands by hand to do what is conceptually one job.
>
> **This slice = the ORCHESTRATOR.** A single `mmdream document` that runs the four maintenance hats — **mettre à jour · (détecter le drift) · consolider/compacter · liens structurés** — in one autonomous pass, **reusing the already-built capabilities** (no logic re-implemented), and **auto-committing the mechanical/lossless changes** (the agreed "le mécanique/sans perte → commité direct"). The 4 maintenance commands become deprecated aliases (kept working — Sébastien's "alias + deprecate" choice). `document-lessons` + `document-release` stay **out of scope** (different agents).
>
> **What this slice deliberately does NOT do (later slices):** the **drift CORRECTOR** (auto-fix dangling links / stale counts — v0.20) and the **semantic conciseness** (prose cutting on an oracle-gated branch with auto-merge — v0.21, which absorbs the long-owed README-conciseness task). This slice ships the safe spine: orchestrate + auto-commit the lossless work + one unified report. Risk is near-zero because every step is an existing, tested capability; the only new behavior is the wiring + the atomic commits of lossless changes.

---

## 1. Goal of v0.19.a

```
mmdream document            → ONE autonomous maintenance pass over the whole doc set:
   1. met à jour     — refresh HANDOVER State block + README Status/Changelog blocks   (lossless → auto-commit)
   2. détecte        — write the coherence/drift/conformance/completeness dashboard
                        (docs/coherence-review.md) — DETECT only this slice (corrector = v0.20)
   3. consolide      — archive shipped root SPEC_V*.md → docs/specs/ + rewrite refs     (lossless → auto-commit)
   4. liens          — report the doc↔code↔ADR coupling for the changed files
   → prints ONE unified report: what was committed, the drift findings, the coupling.

mmdream document --check     → CI/pre-push GATE mode: run the detection, exit 1 on any conformance drift,
                               0 clean (reuses the document-review --check contract). No auto-commit (read-only gate).
mmdream document --dry-run   → preview the whole pass, change nothing, commit nothing (clean tree after).
```

Deliverables:
1. **`mmdream document` orchestrator** (`bin/documentalist/document.js`, `runDocument(opts)` + dispatch/USAGE/`SUBCOMMANDS`): a thin coordinator that **calls the existing capabilities** — the handover State-block rewriter (`lib/handover/*`), the README block rewriter (`lib/documentalist/document-readme` path), the coherence/drift detection + dashboard render (`document-review` path), and the SPEC archival (`document-compact` path / `lib/documentalist/compact.js`) — **no detection/render/plan logic duplicated**. SRP: the orchestrator only sequences + commits + reports.
2. **Auto-commit the lossless/mechanical changes** (the agreed "commité direct"): each logical step that produced a lossless change is committed atomically with a conventional message (`docs(document): refresh mechanical blocks`, `docs(document): archive N shipped SPECs`). `--no-commit` writes to the tree without committing; `--dry-run` previews and changes nothing. Commits land on the current branch (typically `main`) — these are **regenerable doc meta**, the `commit-git.md` §IV.7 documented-doc-tweak exception; the **risky prose cutting that needs a branch is NOT in this slice**.
3. **Unified report**: one human-readable summary (universal §VII) — per-step outcome (committed / nothing-to-do / dry-run preview), the drift findings (count + the dashboard path), and the coupling summary. Honest (§VI): a step that found nothing says so; a step that could not run (e.g. no `HANDOVER.md`) reports the wall, never a fabricated success.
4. **`--check` gate mode** (teeth, reused): `mmdream document --check` runs detection and exits **1** on any conformance drift / **0** clean — the exact `document-review --check` contract (argv→2, not-git→5). In `--check` mode the pass is **read-only beyond the dashboards** (no auto-commit) — it is the CI/pre-push gate.
5. **Deprecate the 4 maintenance aliases**: `handover`, `document-readme`, `document-review`, `document-compact` each print a one-line deprecation notice pointing at `mmdream document` (or the relevant facet, e.g. `--check`, `--since`) **and still perform their existing behavior** (back-compat — nothing in CLAUDE.md / `/mmdream` / tests / muscle memory breaks). `document-lessons` + `document-release` are **untouched** (not deprecated — autolearning + generation are different agents; one comment line in the dispatch records the boundary).
6. **Docs + ADR + live capture**: ADR-058 (the one-agent consolidation, the reuse-not-reimplement shape, the auto-commit-lossless / branch-the-risky boundary, the deprecation path, the deferred corrector + conciseness slices); README + CLAUDE.md + `/mmdream`; mechanical blocks; version → 0.19.0. **AC-live:** run `mmdream document` on MMD itself and capture the unified pass (blocks refreshed + committed, dashboard written, any shipped SPECs archived, coupling reported).

**Mission validation**: a user runs **one** command (`mmdream document`) and the whole doc set is maintained — blocks current, drift surfaced, shipped SPECs archived, coupling reported — with the lossless work committed automatically, no sub-command stitching. The 6-command sprawl becomes one agent (+ deprecated aliases + two correctly-separated neighbors). The genuinely-new corrective muscle (auto-fix drift, cut prose) is honestly deferred to v0.20 / v0.21.

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: `mmdream document` orchestrates the four maintenance hats in one pass
**Given** a git repo with the MMD docs
**When** `mmdream document` runs
**Then**: it (a) refreshes HANDOVER State + README Status/Changelog blocks, (b) writes `docs/coherence-review.md` (drift/conformance/completeness detection), (c) archives shipped root `SPEC_V*.md` → `docs/specs/` with references rewritten, (d) prints a unified report. It **reuses** the existing `run*`/lib functions (asserted: no duplicated detection/render/plan logic — the orchestrator imports them).
Tag: `@integration` (one invocation performs all four steps via the real underlying functions).

### AC-2: auto-commit the lossless changes; `--no-commit` / `--dry-run` escape hatches
**Given** the pass produced mechanical/lossless changes
**When** `mmdream document` runs (default)
**Then**: each lossless step is committed atomically with a conventional, human-readable message; **no prose is cut** (risky semantic compaction deferred). `--no-commit` writes the changes but creates no commit; `--dry-run` previews and leaves a **clean tree** (no write, no commit). 
Tag: `@integration` (default → commits exist with the expected messages; `--dry-run` → `git status` clean; `--no-commit` → tree dirty, no new commit).

### AC-3: `--check` gates (teeth), read-only
**Given** a repo with / without conformance drift
**When** `mmdream document --check` runs
**Then**: exit **1** on any conformance drift (dangling refs / stale facts / stale promises / deprecated-surface — the `document-review --check` set), **0** clean; argv→2; not-a-git-repo→5. In `--check` mode the pass is **read-only beyond the dashboards** — it does **not** auto-commit (CI/pre-push gate).
Tag: `@integration` (drift → exit 1 no commit; clean → exit 0).

### AC-4: the 4 maintenance commands become deprecated aliases (back-compat)
**Given** a user runs `handover` / `document-readme` / `document-review` / `document-compact`
**When** invoked
**Then**: each prints a one-line deprecation notice pointing at `mmdream document` (or the facet) **and still performs its existing behavior unchanged**. `document-lessons` + `document-release` print **no** deprecation (different agents) and behave exactly as before.
Tag: `@integration`/`@unit` (each alias warns + still works; the two neighbors untouched).

### AC-5: reuse + safety (no logic duplication, lossless-only writes)
**Given** the orchestrator
**When** it runs
**Then**: the dashboards/blocks it writes are byte-for-byte what the existing commands write (same builders); the only writes are the existing lossless ones (refreshed blocks, archived SPECs, the dashboards) — **no prose cut, no doc deleted**; `--dry-run` leaves a clean tree. Pure helpers (sequencing decisions / report assembly) are unit-tested and never throw.
Tag: `@unit`/`@integration` (a pure step-planner/report builder; lossless-only write set asserted).

### AC-6: docs + live capture
**Then**: ADR-058 lands; README + CLAUDE.md + `/mmdream` document `mmdream document` (the one-agent pass, `--check`, `--dry-run`, the deprecation of the 4 aliases, the deferred v0.20/v0.21); mechanical blocks refreshed; version → 0.19.0. Running `mmdream document` on MMD itself is captured (the unified pass output).
Tag: `@unit`/`@integration` (ADR-058 exists; docs mention `mmdream document`; version bumped).

---

## 3. Out of scope (deferred)

- **The drift CORRECTOR (v0.20 — "corrige")** — this slice DETECTS drift (writes the dashboard) but does NOT auto-fix it. Turning findings into safe auto-corrections (dangling links → repaired, stale counts → updated, deprecated tokens → rewritten), committed direct, is the next slice.
- **Semantic conciseness (v0.21 — "concise")** — cutting/sharding the over-cap docs (README rewrite, `MAKE_MY_DREAMS.md`), the changelog→`CHANGELOG.md` extraction, on an **oracle-gated branch** (drift + judge verify lossless) with **auto-merge ff-only** or honest stop on info-loss. Absorbs the long-owed README-conciseness task.
- **Removing the deprecated aliases** — they stay working this slice (alias + deprecate); removal is a future major.
- **Event-driven / scheduled triggering** (run `document` automatically after each slice / pre-push) — the agent is one command here; wiring a trigger is a follow-up opt-in.
- **Folding `document-release` (produce) into the agent** — deliberately left separate (generation vs maintenance, Diataxis §6.3 vs §6.4).

## 4. Operational notes for the implementer

- **Reuse, do NOT reimplement** (DRY, §6.4 spine): the orchestrator imports and calls the existing rewriters/detectors/planners. If a function isn't cleanly callable (e.g. logic lives inside a `bin/*` `run*` that also does process.exit), extract the pure core minimally — but add no second detection/render path. The four capabilities stay the single source of truth.
- **Auto-commit boundary**: only **lossless/mechanical** changes are committed this slice (regenerable blocks, `git mv` SPEC archival + ref rewrites, the dashboards). This fits `commit-git.md` §IV.7 (doc meta). The individual commands keep their "never auto-commit" promise (back-compat) — `document` is the new higher-level agent that commits. **No prose cutting on `main`** here (that's the v0.21 branch+oracle path).
- **`--check` is the gate, `default` is the fixer, `--dry-run` previews** — three clean modes; `--check` never commits.
- **Honest unified report** (§VI/§VII): per-step committed / nothing-to-do / wall; never fabricate a step's success. Lead with plain prose, codes second.
- **Deprecation notices** are one human-readable line each, to stderr, non-fatal (the command still runs). Keep them quiet enough not to break scripted output parsing.
- Validate the whole pass on MMD itself (AC-6). Commit incrementally per AC (L-019). Tag tests per stratum (`@unit`/`@integration`).
