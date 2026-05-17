# ADR-005: `--here` mode is an explicit flag, not auto-detected

**Date**: 2026-05-17
**Status**: Accepted
**Authors**: Sébastien (project owner), auto-dev (Standard engine, v0.2a slice)

## Context

[SPEC_V02A](../../SPEC_V02A.md) introduces `--here`: a mode flag that asks MMD to modify the **current repository in place** instead of scaffolding `demo/<slug>/`. This unblocks the reflexive bootstrap [MAKE_MY_DREAMS.md §7](../../MAKE_MY_DREAMS.md) — without it, `mmd <dream>` could only produce external PWAs and self-development bypassed the supported path (see [`docs/lessons-learned.md`](../lessons-learned.md) L-009).

The question this ADR answers: **how should MMD decide whether to operate in greenfield mode or in-place mode?**

- Option A: **Explicit flag** — `mmd --here "<change>"` opts the user into in-place mode. Default behavior (no flag) stays greenfield.
- Option B: **Auto-detection** — `mmd "<change>"` inspects cwd and infers mode: "this cwd has `.mmd/shared/vision.md`" or "this cwd is a non-empty git repo with existing source" → switch to in-place.

v0.2a ships **Option A**.

## Decision

`--here` is an **explicit, named mode flag**. Auto-detection is rejected for v0.2a and is NOT on the v0.3+ roadmap unless empirical usage demonstrates the need.

Concretely:
- `mmd "<dream>"` (no flag) keeps v0.2 behavior: creates `demo/<slug>/` from any cwd, including inside the MMD repo itself.
- `mmd --here "<change>"` requires the user to explicitly opt in. The CLI then validates cwd is a clean git repo and creates a slice branch (see [`lib/here-mode.js`](../../lib/here-mode.js)).
- The two modes are mutually exclusive at runtime but compose freely with engine flags (`--here --fast` is valid).

## Consequences

### Why explicit (Option A) over auto-detection (Option B)

**1. Safety against accidental in-place mutation.**

Auto-detection invariably has false positives. A user running `mmd "add a button"` from inside their personal `~/Documents/` directory — which IS a git repo — would silently switch into in-place mode and start mutating files they didn't intend to modify. Even with a confirmation prompt, the framing primes the user to say yes ("of course this is a git repo, why is mmd asking?"). The destructive default-on pattern is exactly what `security.md` §A04 (Insecure Design) and `error-handling.md` §I (Fail Fast) push back on.

**2. Tool-choice discipline ([ai-coding.md](../../.specify/memory/constitution/ai-coding.md) §II).**

The constitution rules that "when multiple skills/tools could accomplish a task, prefer the one most narrowly scoped." A flag-named mode is narrower than an auto-detected mode by definition: the user has stated their intent. Auto-detection wraps an opinion ("this looks like a brownfield project") around the user's verb, which is the inverse of narrow.

**3. Reversibility and intent traceability.**

`mmd --here` produces a slice branch and a `status.json` that say `mode: "here"`. If a future invocation produces unexpected results, the audit trail (`decisions.log`) shows the user opted in. With auto-detection, the audit trail records the inferred mode but not the user's intent — a step removed from accountability, which is the opposite of what `observability.md` §III demands.

**4. KISS ([universal.md](../../.specify/memory/constitution/universal.md) §II).**

Auto-detection adds heuristics: "is this a git repo?", "does it have `.mmd/shared/`?", "does it have a `vision.md`?", "what if it has a `package.json` but no `.git`?". Each heuristic has edge cases; each edge case requires a test; each test compounds the loop's runtime. An explicit flag has zero heuristics and zero edge cases. The cost of typing `--here` is dwarfed by the cost of debugging an edge case in auto-detection.

**5. The opt-out path scales worse than the opt-in path.**

If auto-detection were the default and a user wanted greenfield in a brownfield context (e.g. "I'm in my home dir but I want a fresh demo in `./demo/foo/`"), they would need an explicit `--greenfield` or `--no-here` opt-out flag. This doubles the surface and breaks the symmetry: the existing v0.2 mental model is "default is greenfield, flags add behavior". Option A preserves that. Option B inverts it.

**6. L-009 alignment.**

L-009 names the gap as "implementation limitation" vs "design constraint". The fix is **adding a supported path**, not flipping the default. `--here` adds the supported path. The day a user wants in-place behavior, they type two words (`--here`) and get it. The day the user wants greenfield, they type one word (the dream) and get it. Neither path is silently overridden by inference.

### Trade-offs accepted

- **Discoverability cost**: a new user who runs `mmd "<dream>"` inside the MMD repo will get a `demo/<slug>/` directory (the v0.2 behavior), not the self-modification they may have hoped for. We accept this cost because: (a) the CLI usage / `--help` documents `--here` with a one-line explanation, (b) the README §"Self-modification mode (--here)" links it to its design intent, (c) the cost is "extra dir to delete and re-run with --here", not "silent in-place mutation".
- **No "smart suggestion"**: we explicitly do NOT detect "this looks like an existing project" and suggest `--here`. Suggestions become demands when AI agents read them and act; we prefer silence.
- **One more flag in the matrix**: `--fast | --standard | --deep` × `<no mode> | --here` = 6 effective combinations vs 3 before. We accept this because the mode and engine axes are orthogonal — they describe different things (how MMD works on the target vs which engine drives it).

### Future revisitation

Open a follow-on ADR proposing auto-detection ONLY if the following empirical evidence accumulates:

- 5+ user reports of "I wish `--here` had been inferred" — i.e. measured friction.
- A safe-by-default detection signal exists that has < 1% false-positive rate on a corpus of representative cwds.
- A migration path that does not silently downgrade safety (e.g. detection runs `--dry-run`, prints "I'd run in --here mode; OK?", waits for stdin).

Until then: `--here` is named, explicit, and required.

## References

- [SPEC_V02A.md](../../SPEC_V02A.md) — full v0.2a spec (7 ACs + 4 deferred future items)
- [MAKE_MY_DREAMS.md §7](../../MAKE_MY_DREAMS.md) — reflexive bootstrap design intent
- [`docs/lessons-learned.md`](../lessons-learned.md) L-009 — the failure that motivated v0.2a
- [`lib/here-mode.js`](../../lib/here-mode.js) — validation + slice-branch + prompt
- [`bin/mmd.js`](../../bin/mmd.js) `runHereMode()` — orchestrator
- [ADR-004](./004-fast-engine-trimmed-not-ralph.md) — precedent for "explicit flag over implicit inference"
- [`.specify/memory/constitution/security.md`](../../.specify/memory/constitution/security.md) §A04 — insecure design pushback against destructive defaults
- [`.specify/memory/constitution/ai-coding.md`](../../.specify/memory/constitution/ai-coding.md) §II — tool-choice discipline
