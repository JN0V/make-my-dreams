# ADR-033 — Constitution suggestions (deterministic, non-destructive) + the discover-then-`--here` friction fix, and retiring the composer rework

**Status**: Accepted
**Date**: 2026-06-01
**Deciders**: MMD core (self-dev, 28th reflexive `mmd --here`)
**Parent design**: [SPEC_V06B.md](../../SPEC_V06B.md) (FROZEN). Follows [ADR-032](./032-transparent-first-run-setup.md) (v0.6.a made MMD *run* on a third-party repo; v0.6.b makes it a *good guest* of that repo's rules).

## Context

v0.6.a let `mmd --here` work on a repo other than MMD itself. Two things were left open.

1. **Whose constitution governs, and may MMD improve it?** The v0.6.a HANDOVER framed v0.6.b as *"the Layer-C composer should read the project's constitution instead of MMD's bundled modules."* The user's principle from the design conversation was narrower and clearer: **"sur un repo qui a déjà une constitution, on peut faire des suggestions d'amélioration, mais sinon elle reste."** The project owns its constitution; MMD never overwrites it; but when one exists, MMD may point out gaps.

2. **The documented discover→`--here` flow had friction.** `mmd discover` writes `.mmd/`, `mmd-discovery-report.md`, and (now) a `.gitignore` block — which dirties the tree. The v0.6.a first-run setup guard vetoes a dirty tree (so its post-setup `git add -A` can't sweep the user's uncommitted work). So the natural "run discover, read the suggestions, then `mmd --here`" sequence tripped exit 4 and forced a manual stash.

### The honest scoping correction (universal §VI)

On inspection, the "rewrite the Layer-C composer to read the project's constitution" framing is **largely moot**:

- On the `mmd --here` path (the third-party flow) `buildPrompt` short-circuits and the Layer-C composer is **never invoked**. The constitution that governs a `--here` build is **Layer B** — the BMAD auto-dev workflow configured with `constitution: '{project-root}/.specify/memory/constitution.md'`. So **the project's own constitution already governs** `--here` (the v0.6.a AC-6 live run confirmed: *"Context loaded: constitution v1.3.0 (.specify/memory/constitution.md)"*).
- The composer only runs on the **greenfield/profile** path, which builds a fresh app in `demo/` where there is **no project constitution to read**.

Rewriting the composer would therefore be low-value work against a non-problem (KISS/YAGNI). It is **dropped** and documented here rather than built. The real, wanted value is the **non-destructive suggestions** feature.

## Decision

### 1. A deterministic, pure suggestions checklist

`lib/discover/constitution-suggest.js` exposes `suggestConstitutionImprovements(constitutionText) → { present: string[], missing: Array<{theme, suggestion}> }`. It scans the text for common governance themes — **testing, commit/git workflow, security, error-handling, design principles (SOLID/KISS/DRY/separation), documentation, AI-coding hygiene** — by **case-insensitive keyword heuristic**, and reports which look present vs absent. Absent themes carry a plain-language `suggestion` (universal §VII — no MMD-internal module paths).

It is **PURE** (no fs, no network, no clock), **stable** (same input → same output), and **never throws**: empty / whitespace / non-string input degrades to "all missing" rather than crashing the discover pipeline (error-handling §III).

**Why deterministic, not an LLM** (matching MMD's existing pure builders — composer, handover, document-readme): pure, free, offline, no hallucination. An LLM-enriched mode (`discover --suggest-with-claude`) is a deferred future opt-in, mirroring `--infer-with-claude` (YAGNI).

### 2. Discover surfaces the suggestions — non-destructively ("elle reste")

`buildReport` gains a `constitutionText` arg and renders a **"## Constitution suggestions (advisory — your constitution is never modified)"** section: an explicit heuristic disclaimer, the themes that look present, and the missing-theme suggestions. The section is present **only** when a constitution exists; when none does, it is **omitted entirely** (no noise — the first-run setup materializes a default instead). The orchestrator (`bin/discover.js`) does the read and passes the text in; `buildReport` stays a pure transform. The renderer **labels the list a heuristic**, never an authoritative audit (universal §VI).

The non-destructive guarantee is the heart of "elle reste": discover **READS** `.specify/memory/constitution.md` and **never writes it** — pinned by an integration assertion that the file is byte-for-byte unchanged across a discover run.

### 3. The discover-then-`--here` friction fix (F7 intact)

- `bin/discover.js` ensures its scratch outputs (`.mmd/`, `mmd-discovery-report.md`) are `.gitignore`d in the target — an **idempotent, marked, append-only** block (`# MMD discovery scratch (auto-added by mmd discover)`), creating `.gitignore` if absent, never reordering or clobbering existing entries, never touching `constitution.md` or user files. `lib/discover/safe-write.js` adds the root `.gitignore` as the only new allowed write sink.
- A pure predicate `lib/onboarding/mmd-managed.js` (`isMmdManagedPath` / `isTreeCleanIgnoringMmd`, parsing `git status --porcelain`) answers "is this dirty path MMD-managed?". The first-run setup preflight in `bin/mmd.js` now treats a tree dirtied **only** by MMD-managed paths (`.mmd/`, `mmd-discovery-report.md`, `.gitignore`) as **clean** → the documented flow needs no manual stash.
- **F7 stays intact**: the predicate is deliberately narrow. ANY non-MMD dirty path makes the tree "not clean", so the guard still refuses with **exit 4** — the post-setup `git add -A` can never sweep a user's real uncommitted work.

## Consequences

- **Positive.** MMD is a considerate guest: it respects the project's constitution absolutely ("elle reste") and offers free, deterministic, non-destructive improvement suggestions when one exists. The documented discover→`--here` flow works without friction. The composer-rework non-problem is retired with an honest ADR rather than wasted code.
- **Honest limits (universal §VI, L-009).** The suggestions are a **keyword heuristic**, not an audit: a theme phrased unusually can be missed, and a passing mention counts as "present". The renderer says so. The friction fix is scoped to the **first-run setup preflight** (the not-yet-onboarded path the documented flow hits); `validateHereTarget`'s clean-tree check is unchanged, but discover's gitignore step keeps `.mmd/` + the report invisible to it anyway.
- **Deferred.** LLM-enriched suggestions; auto-applying suggestions (forbidden by design); modularizing a third-party monolithic constitution (Layer B reads the monolith fine); the Layer-C composer rework (retired, not deferred).

## References

- [SPEC_V06B.md](../../SPEC_V06B.md) — the frozen spec (AC-1..AC-5).
- [ADR-032](./032-transparent-first-run-setup.md) — v0.6.a first-run setup + `brownfield-app`.
- [ADR-024](./024-constitution-composer-layer-c.md) — the Layer-C composer (greenfield-only, as confirmed here).
- L-009 (design vs current code), universal §VI (honesty) + §VII (human-readable), §II (KISS/YAGNI).
