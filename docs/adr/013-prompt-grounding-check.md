# ADR-013: Prompt-grounding check — verify cited files exist on the base before spawn

**Date**: 2026-05-30
**Status**: Accepted
**Authors**: Sébastien (project owner), auto-dev (Standard engine, v0.2.h slice)

## Context

The Conductor (today: `lib/here-mode.js`, driven by `bin/mmd.js`) validates only
git-domain-general preconditions before launching auto-dev: cwd is a git repo,
the working tree is clean, the slice branch can be created. It does **not**
introspect the dream/prompt content. L-015 ([`docs/lessons-learned.md`](../lessons-learned.md))
captured the cost: launching `mmd --here "implement v0.2.g per SPEC_V02G.md"`
when `SPEC_V02G.md` had never actually landed on `main` (a `git merge --ff-only`
that silently no-op'd because the spec branch was *behind* main). Auto-dev would
have spent 30–90 minutes reading a non-existent file and producing nonsense. The
operational mitigation — manually running `git show <base>:<spec> > /dev/null`
before every launch — works but is human-in-the-loop and forgettable.

v0.2.h ships the automated check, on the same architecture as the v0.2.l
composer ([ADR-012](./012-composer-categorization.md)): a small pure function, a
single wiring point, exhaustive tests, and an env-var escape hatch.

## Decision

Before slice-branch creation (and therefore before `spawn`), `mmd --here`:

1. `extractFileRefs(dream)` — a pure, closed-pattern regex extractor returns the
   repo-relative paths the dream cites.
2. `verifyGrounding({ files, baseSha, repoRoot })` — runs `git cat-file -e
   <baseSha>:<file>` per file and returns the subset that does not exist.
3. If any are missing → exit **6** with a multi-line message listing each
   missing path and the remediation ("commit them to the base first, or remove
   the references"). Escape hatch: `MMD_SKIP_GROUNDING=1` bypasses the check
   entirely with a warning.

### Why closed-pattern regex over LLM/semantic extraction

Deterministic, cost-free, and sub-100ms (one `git cat-file` fork per cited
file; typical dreams cite 1–3 files). The closed set — `SPEC_*.md`, `docs/*.md`
(which subsumes `docs/adr/*.md`), `.specify/memory/*.md`, and the root tokens
`MAKE_MY_DREAMS.md` / `PROBLEMS.md` / `BOOTSTRAP.md` / `CLAUDE.md` /
`README.md` / `package.json` — covers ~95% of real MMD dreams. A semantic /
LLM-based extractor would add latency, cost, and nondeterminism to a check whose
whole value is being a cheap fail-fast gate. Semantic extraction and fuzzy path
matching are explicitly deferred (SPEC_V02H §1 non-features; v0.5+).

### Why exit code 6

Consistency with the established `error-handling.md` §II / v0.2.j exit-code map,
where 6 is the "environmental / precondition failure that is not a crash" class
(the same code `--here` already uses for a post-checkout state-init failure). A
grounding failure is precisely a precondition failure, not a user-argv error
(2) and not a subprocess crash (7), so it reuses 6 rather than minting a new
code.

### Why the escape hatch (`MMD_SKIP_GROUNDING=1`)

The closed-pattern regex is deliberately narrow; it **will** have false
positives for unusual paths (a file that lives somewhere the patterns don't
know, or a path the user typed differently than the on-disk name). Blocking
such a launch entirely is worse than the problem the check solves — it would
turn a 30-min mistake into a hard wall for a legitimate run. The escape hatch
makes the check defensive rather than authoritarian: the default is safe, and
the opt-out is one env var away, loudly warned, and recorded as "at the user's
risk". It is the same philosophy as `--skip-onboarding`: a named, observable
bypass for the cases the gate cannot reason about.

## Consequences

**Positive**: L-015 is closed in code — the next time a dream cites a file
absent from the base, the check fires in <100ms with a friendly, actionable
error instead of consuming auto-dev time on a nonsensical prompt. The extractor
and verifier are pure and independently tested, so the behavior is pinned by
unit tests with zero git/LLM dependency. The wiring is a single, fail-fast point
that creates no branch on failure.

**Negative / deferred**: the closed pattern set means a cited file outside the
set is *not* checked (a silent false negative — no worse than today's
zero-introspection baseline, but not complete coverage). Mis-typed or unusual
paths can produce false positives, mitigated by the escape hatch and by the fact
that the extracted list is what's checked (the user can see exactly which paths
fired). Recursive verification (does the cited file's own references exist?) and
cross-worktree verification are out of scope. Broader detection and fuzzy
matching are future hardening (SPEC_V02H §4).

## Related

- L-015 (the origin — Conductor preconditions miss prompt-grounding), L-009 (the
  design-vs-implementation drift pattern this is the third instance of).
- [ADR-012](./012-composer-categorization.md) — the v0.2.l composer whose
  "pure function + single wiring point + escape hatch" shape this mirrors.
- [ADR-011](./011-five-whys-escalation.md) — the v0.2.j exit-code map this
  reuses code 6 from.
- `.specify/memory/constitution/ai-coding.md` §VI — the rule this check enforces
  automatically.
- SPEC_V02H — the 5 ACs + DoD.
