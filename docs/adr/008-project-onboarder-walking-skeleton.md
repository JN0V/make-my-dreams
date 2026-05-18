# ADR-008: Project Onboarder walking skeleton — `mmd discover`

Date: 2026-05-17
Status: Accepted

## Context

[`docs/lessons-learned.md` L-009](../lessons-learned.md) named the gap: MMD claimed to "work on any project, including itself" while the walking-skeleton wrapper was greenfield-only. v0.2a closed half the gap with `--here` (in-place modification). The other half — *MMD's auto-dev runs blind on a brownfield project* — remained until v0.2c.

[MAKE_MY_DREAMS.md §6.7](../../MAKE_MY_DREAMS.md) defines the **Project Onboarder**: a `mmd discover [<path>]` subcommand that runs a 4-phase pipeline (SCAN → INGEST → INFER → REPORT) on an existing repo and produces a human-validated `mmd-discovery-report.md`. Until validated, subsequent `mmd --here` and `mmd <dream>` invocations are blocked.

This ADR records four coupled design choices for v0.2c's walking skeleton.

## Decision

v0.2c delivers a deterministic, walking-skeleton Project Onboarder with four design constraints that distinguish it from a "full" implementation.

### 1. The validation gate is blocking by default

When `mmd --here` or `mmd <dream>` is invoked from a directory that LOOKS brownfield (any of `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `requirements.txt`, or a populated `src/`) AND no validated discovery report exists, MMD refuses to proceed and prints the AC-7 message. Bypass requires the explicit `--skip-onboarding` flag.

**Why blocking?** Per [scoping §6.7 + Bundle A risks](../../MAKE_MY_DREAMS.md), the dominant brownfield failure mode is auto-dev hallucinating a stack ("looks like a Vue project, let me add React") and producing changes that violate unwritten conventions. A blocking gate forces the user through a 5-minute validation loop that catches stack misidentification at the cheapest possible moment. The friction is constitutional (`brownfield.md` §V: "Phase 0 discovery before any code") and is intentionally visible — no config file silently disables it in v0.2c.

**Why not auto-trigger?** Scoping §6.7's "Auto-trigger by the Tech Architect" relies on a Worker construct that doesn't exist yet (deferred to v0.5+). In v0.2c the user runs `mmd discover` manually. The blocking gate ensures they cannot forget.

**MMD self-exemption.** When cwd contains `MAKE_MY_DREAMS.md` AND no report exists, the gate stays quiet — the wrapper would otherwise refuse to develop MMD itself, defeating the reflexive bootstrap §7. If a report DOES exist, MMD honors its status regardless (so MMD can still be onboarded — see the L-015 capture at the end of `docs/lessons-learned.md`).

### 2. INFER is deterministic in v0.2c; LLM augmentation is a stub

The INFER phase produces `.mmd/shared/project-onboarder/inferred.md` from filesystem inspection + git log scan — no LLM call. The `--infer-with-claude` flag is accepted, wired through, and writes an explicit "not yet implemented" note to the inferred markdown (per [`ai-coding.md`](../../.specify/memory/constitution/ai-coding.md) §I — failure honesty over fabrication).

**Why deterministic?** Walking-skeleton tradeoffs:
- **Cost**: A real LLM call per discovery would price-gate the gate itself. v0.2c is meant to be runnable infinitely on personal projects.
- **Reproducibility**: Deterministic SCAN + INFER produces byte-identical reports given the same inputs (modulo timestamp). Tests can assert on report shape without LLM stubs.
- **Auditability**: When the report is wrong, the user can grep the code for the misdetection (e.g. "why did it think this was vitest?") instead of speculating about a black-box inference.

LLM augmentation lands in v0.2c+ when the Worker construct exists and the call can be a real Worker invocation rather than a one-off `claude -p` shell-out.

### 3. Three fixture cases ship (Rich / BMAD-sprawl / Blank), not more

[SPEC_V02C](../../SPEC_V02C.md) AC-6 names exactly three canonical cases plus an Already-onboarded refresh path. Each gets its own `test/fixtures/discover-repos/<case>/` directory with a minimal but realistic structure and an `@integration` test asserting on the produced report.

**Why three and not five?** The three are the three explicit "concrete cases" in scoping §6.7. A fourth ("rich Python project") would be valuable but doesn't add a new code path — the Python detector is exercised by the unit test in `test/unit/discover-scan.test.js`. KISS (`universal.md` §II): one fixture per **code path**, not per **language**.

### 4. v0.2c excludes auto-trigger, story-vs-code cross-check, vision.md synthesis

These all live in scoping §6.7 as "concrete cases" but require capabilities that don't exist yet:

- **Auto-trigger by Tech Architect**: needs the Worker construct (v0.5+).
- **Story-vs-code cross-check**: needs deeper AST + import-graph reasoning than v0.2c's grep-only scope (an `explorer` Worker in scoping terms).
- **Implicit ADR extraction from commits**: needs a commit-classification pipeline (deferred).
- **Synthesized `vision.md` from grouped stories**: same dependency.
- **Archival plan for dormant stories**: needs the cross-check above as a prerequisite.

The walking skeleton **names** these gaps in the report's "Hypotheses to validate" section (e.g. "15 stories detected, 5 marked done — recommend cross-check vs real code (deferred to v0.2c+)") so the user sees the boundary instead of trusting v0.2c output as if it were complete. This applies L-009 systematically.

## Consequences

### Positive

- The reflexive bootstrap (§7) gains its **first brownfield-aware** dimension. After v0.2c, `mmd --here` on a brownfield without a validated report is a constitution-enforced "stop, run discover first" rather than the silent "auto-dev hallucinates the stack" failure mode that motivated [L-009](../lessons-learned.md).
- The 552-test suite (430 + 122 v0.2c tests) provides high regression confidence — the pure modules (`classify.js`, `safe-write.js`) are exhaustively unit-tested; the phase modules are unit-tested with synthetic fixtures; AC-7 end-to-end is integration-tested on real tmp git repos.
- `assertSafeWritePath` makes the non-intrusion invariant **mechanically enforced** rather than convention-based. A future regression that tries to write to `<target>/src/index.js` from a discover phase fails loud at the call site.
- The four DISCOVERY_CASES (`rich`, `bmad-alone`, `blank`, `already-onboarded`) define a closed enum that downstream consumers (v0.2c+ Tech Architect, dream-bench v0.3+ context routing) can branch on without string magic.

### Negative

- The blocking gate adds friction for users who legitimately want to run `mmd --here` on a brownfield without onboarding. `--skip-onboarding` is the escape valve but it requires conscious bypass. Will measure: if the override fires more than 20% of the time in real use, the default needs revisiting.
- v0.2c has NO LLM-augmented inference. Deterministic INFER is faithful but skin-deep — it cannot infer architectural patterns the way a Worker would. Sophisticated brownfield projects will still need the user to fill gaps manually in the report.
- The 4 fixture cases cover the three named cases plus refresh, but exotic stacks (Cargo workspaces, Bazel monorepos, Lerna repos) are NOT exercised. Discoveries against them may surface unanticipated behavior.

### Follow-up

- **v0.2c+**: implement story-vs-code cross-check (the `explorer` worker in scoping §6.7 Case B). This is the biggest source of value for the BMAD-sprawl case.
- **v0.2c+**: implement `vision.md` synthesis from grouped "done" stories (Case B).
- **v0.5+**: Tech Architect auto-trigger replaces the manual `mmd discover` step. The blocking gate becomes a fallback rather than the primary entry.
- **v0.3+**: dream-bench feeds discovery output into its per-dream context. Today bench dreams are greenfield-only; once `mmd discover` is real, bench can include "run `mmd --here` on this brownfield fixture" as a canonical dream.
- **Long-term**: a `mmd discover --watch` mode that re-runs whenever the user adds methodology markers, so onboarding is a continuous background process rather than a one-shot gate.
