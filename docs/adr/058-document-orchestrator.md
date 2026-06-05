# ADR-058 — `mmdream document`: the autonomous Documentalist orchestrator (one agent, not six commands)

**Status**: accepted
**Date**: 2026-06-05
**Slice**: v0.19.a (consolidate the Documentalist's four maintenance hats behind ONE command that reuses the built capabilities and auto-commits the lossless work)

## Context — "c'est un agent, pas une liste de sous-commandes"

Sébastien, verbatim (2026-06-05): *"on ne devrait pas avoir trop de commandes
spécifiques documentaliste. pour moi c'est un agent qui agit sur l'ensemble des
doc, en s'assurant qu'elles sont à jour, complètes, concises avec des liens
structurés."* And: it should *"runner de manière auto et mettre à jour, consolider,
compacter, corriger ce qui doit l'être"* — you don't pick sub-commands; you launch
the agent and it does the maintenance.

The Documentalist shipped incrementally (v0.2 → v0.7) as **six separate commands**:

- `handover` — refresh HANDOVER.md's mechanical State block (v0.2.p)
- `document-readme` — refresh README.md's Status + Changelog blocks (v0.3.d)
- `document-review` — write the coherence/drift/conformance dashboard (v0.7.a → v0.18.0)
- `document-compact` — archive the root `SPEC_V*.md` sprawl into `docs/specs/` (v0.7.c)

plus two **mis-filed neighbors** that are conceptually different agents:

- `document-lessons` — really the autolearning loop (lesson counters + promotion)
- `document-release` — really a generation face (release-notes draft)

The vision (`MAKE_MY_DREAMS.md` §6.4) was always **one** agent; the CLI surface
never got consolidated. So the owner had to remember and stitch four commands by
hand to do what is conceptually one job — *"mettre à jour · détecter le drift ·
consolider/compacter · liens structurés."*

## Decision

Ship the **ORCHESTRATOR**: a single `mmdream document` that runs the four
maintenance hats in **one autonomous pass**, **reusing** the already-built
capabilities (no detection/render/plan logic re-implemented), and **auto-committing
the mechanical/lossless changes**.

1. **A thin coordinator (`bin/documentalist/document.js`, `runDocument`).** SRP: it
   SEQUENCES + COMMITS + REPORTS only. Every step calls the existing, tested
   capability — the single source of truth stays put (DRY, universal §III):
   - **Step 1 (met à jour)** — refresh HANDOVER's State block + README's Status +
     Changelog blocks, via the SAME `lib/handover/*` + `lib/readme-sync/*` builders
     and the SAME marker rewriter the two commands use.
   - **Step 2 (détecte)** — write `docs/coherence-review.md` via document-review's
     `gatherRealInventory` + `scanDrift` (newly `export`ed) + the `reconcileRoadmap`
     / `renderCoherenceReport` libs. NO second detector.
   - **Step 3 (consolide)** — archive shipped root `SPEC_V*.md` → `docs/specs/` via
     `lib/documentalist/compact.js`'s pure `planCompaction` + idempotent
     `applyReferenceRewrites` + `git mv`.
   - **Step 4 (liens)** — report the doc↔code↔ADR coupling for the files changed
     this pass, via document-review's `buildSinceCoupling` + `renderCoupledChanges`.

2. **Auto-commit the lossless work (the agreed "le mécanique/sans perte → commité
   direct").** Default mode commits the lossless changes in two atomic, conventional
   commits — `docs(document): refresh mechanical blocks and coherence dashboard`
   then `docs(document): archive N shipped SPECs into docs/specs/`. This fits
   `commit-git.md` §IV.7 (regenerable doc meta). The individual commands keep their
   never-auto-commit promise (back-compat); `document` is the new higher-level agent
   that commits. **No prose is cut** — the risky semantic compaction that needs a
   branch is NOT in this slice.

3. **Three clean modes + a gate.** `--no-commit` writes without committing;
   `--dry-run` previews and leaves a clean tree (no write, no commit); `--check` is
   the CI/pre-push GATE — run detection, exit **1** on any conformance drift, **0**
   clean (the exact `document-review --check` contract: argv→2, not-git→5),
   read-only beyond the dashboards (no auto-commit). The modes are mutually
   exclusive where they contradict (rejected at parse — fail fast, error-handling §I).

4. **One unified, human-readable report** (universal §VII — lead with prose):
   per-step committed / nothing-to-do / wall, the drift findings, the coupling.
   Honest at every branch (§VI): a step that found nothing says so; a step that hit
   a wall (no `HANDOVER.md`, missing markers, unreadable roadmap) reports the wall —
   never a fabricated success.

5. **Deprecate the 4 maintenance commands as back-compat aliases.** `handover`,
   `document-readme`, `document-review`, `document-compact` each print one non-fatal
   `[DEPRECATED]` line to stderr pointing at `mmdream document` (placed AFTER
   `--help` + arg parsing, so `<cmd> --help` is unaffected) and **still perform
   their existing behavior unchanged** — nothing in CLAUDE.md / `/mmdream` / tests /
   muscle memory breaks. `document-lessons` + `document-release` are deliberately
   **untouched** (autolearning + generation are different agents — Diataxis §6.3 vs
   §6.4).

## Consequences

**Positive.** The 6-command sprawl becomes one agent (+ deprecated aliases + two
correctly-separated neighbors). A user runs ONE command and the whole doc set is
maintained — blocks current, drift surfaced, shipped SPECs archived, coupling
reported — with the lossless work committed automatically, no sub-command
stitching. Risk is near-zero: every step is an existing, tested capability; the
only new behavior is the wiring + the atomic commits of lossless changes (covered
by 12 new tests + the unchanged 54 tests of the underlying commands).

**Constraints / honest deferrals.**
- **The drift CORRECTOR is v0.20.** This slice DETECTS drift (writes the dashboard)
  but does NOT auto-fix it. Turning findings into safe auto-corrections (dangling
  links repaired, stale counts updated, deprecated tokens rewritten) is the next
  slice.
- **Semantic conciseness is v0.21.** Cutting/sharding the over-cap docs on an
  oracle-gated branch with auto-merge (the long-owed README-conciseness task) is
  deliberately NOT here — it is lossy, so it needs a branch + a judge, not a
  direct commit on the current branch.
- **Removing the deprecated aliases** is a future major (alias + deprecate this
  slice).
- **Event-driven / scheduled triggering** (run `document` automatically after each
  slice / pre-push) is a follow-up opt-in.

**Reuse over reinvention (the §6.4 spine).** The orchestrator imports and calls the
existing rewriters/detectors/planners. The only new code is the coordinator + the
pure `parseDocumentArgs` / `buildDocumentReport` helpers (unit-tested, never throw)
+ the auto-commit helper. The four capabilities stay the single source of truth —
a bug fixed in `scanDrift` or `planCompaction` is fixed for both the alias and the
orchestrator.
