# ADR-010: Composer minimal — keyword-overlap, deterministic, sub-100ms

**Date**: 2026-05-18
**Status**: Accepted
**Authors**: Sébastien (project owner), auto-dev (Standard engine, v0.2e slice)

## Context

[MAKE_MY_DREAMS.md §6.5](../../MAKE_MY_DREAMS.md) defined the **compounding autolearning loop**: every failure encountered during MMD development must produce a deterministic test+fix AND a documented lesson in `docs/lessons-learned.md`. When the same keywords appear in a future prompt, the matched lesson's rule MUST be auto-injected into the prompt so the LLM downstream applies the rule.

Post-v0.2.g (2026-05-18) `docs/lessons-learned.md` had accumulated more than a dozen lessons (the live count grows with every slice), each with a documented `Rule:` paragraph and a `Keywords for matching:` list. Zero of them were auto-injected. Every reference was inserted manually by the project owner (Cowork — the manual Documentalist). §6.5b's claim that lessons "are auto-injected on keyword match" was true of the **design** and false of the **current implementation** — the L-009 pattern, third occurrence after the wrapper-narrowness gap (L-009) and the gStack pillar drift (L-012).

v0.2e ships the **minimal walking-skeleton composer** that closes the gap end-to-end:

```
mmd <dream> / mmd --here / mmd ship / mmd qa / …
   │
   ▼
[1] subcommand handler builds the prompt body
   │
   ▼
[2] composeLessons(promptBody, repoRoot/docs/lessons-learned.md)
       → { composedPrompt, matched: Lesson[] }
   │
   ▼
[3] write composer.json alongside the run log
   │
   ▼
[4] spawn claude -p with composedPrompt (existing path, unchanged)
```

Six architectural choices had to be settled:

- **Q1.** What matching algorithm? Embedding-based semantic? LLM-driven? Keyword overlap?
- **Q2.** Where to inject — top of the prompt, bottom, middle of system message?
- **Q3.** Should the composer ALSO increment lessons' `To promote if N reuses` counter?
- **Q4.** What's the right cap on injected lessons per prompt?
- **Q5.** Should constitution modules (Layer A/B/C/D) flow through the same composer?
- **Q6.** What's the escape hatch when composer misbehaves?

## Decision

v0.2e is **deliberately minimal**. Each choice favors deterministic, transparent, cheap.

### Q1 — Keyword-overlap matching, not semantic

The matcher is a case-insensitive word-boundary regex over the prompt text, scored by the count of distinct lesson keywords present. Pure function, no LLM call, no embedding model, no network. Sub-100ms on the live lessons file (measured at single-digit ms during v0.2e dev with the file size at slice time).

**Why not semantic (embedding cosine)?**

- **Cost**: every `mmd` invocation would call an embedding endpoint OR ship a model. Either path has setup friction (auth, network, gigabytes-on-disk) that contradicts MMD's "deliver an MVP in minutes" promise.
- **Determinism**: keyword-overlap gives the same result every time. Embedding outputs drift across model versions, hardware (GPU vs CPU), and library updates. That drift is invisible to the user — bugs surface as silent miss-injections months later.
- **Transparency**: `mmd lessons match "<prompt>"` shows exactly which keywords hit. With embeddings, the answer is "the cosine was 0.42" — opaque and not actionable for refining the lesson's keyword list.
- **Calibration**: keyword-overlap is easy to tune. If L-003 should match more often, the human adds `worktree, parallel branches` to its `Keywords for matching:` line. With embeddings the tuning knobs are temperature/threshold — global and hard to reason about.
- **v0.5b can evolve this**: nothing in `composeLessons`'s API prevents swapping the matching layer behind it. We expect to add a hybrid (keyword for fast pre-filter, semantic for tie-break) when we have data on the keyword approach's misses. v0.2e doesn't commit either way.

**Why not LLM-driven matching (separate cheap LLM call)?**

- Adds an extra LLM round-trip on the critical path of every MMD subprocess invocation, which is the exact opposite of "deliver an MVP in minutes". An auto-dev run already costs $0.50–$5; we don't want to add $0.10 per skill wrapper call.
- LLMs hallucinate at a non-zero rate. A composer that occasionally produces a wrong lesson list breaks the trust contract.

### Q2 — Inject at the TOP of the prompt, in a fixed format

The composed prompt prepends a `## Active lessons (auto-injected by composer v0.2e)` section before the original prompt body. Format is byte-deterministic (snapshot-tested).

**Why TOP?**

- Empirically, Claude reads top context first (the prompt is processed in order, and attention is biased toward early tokens given equal weight). Putting the rules at the top maximizes the chance they shape early decisions.
- Symmetric to the project constitution injection at the very top of every `claude -p /bmad-adv-auto-dev …` invocation (commit-git.md `Branch first: never commit directly to main` — the constitution always comes first).

**Why a fixed format and not a per-skill template?**

- Same as keyword-overlap: deterministic, transparent, testable. A custom template per skill would multiply maintenance and make `mmd lessons --show` ambiguous.

### Q3 — No automatic counter increment in v0.2e

§6.5 says "once a lesson reaches N=5 validated re-uses, it is promoted into the relevant constitution module". The "reuse counter" lives in each lesson's frontmatter (`**To promote if**: 5 reuses validated (counter: 1)`). The composer COULD increment that counter on every match — but in v0.2e it does NOT.

**Why?**

- The composer matches keywords against a prompt; that's not the same as a **validated re-use**. A validated re-use means the rule was actually applied by the LLM downstream and the outcome was correct. Today MMD has no way to verify the latter — that's the Documentalist Worker's job (v0.5b).
- An over-eager auto-increment would inflate counters and promote lessons prematurely. Premature promotion is hard to reverse (the lesson gets folded into a constitution module + removed from `lessons-learned.md`).
- The composer DOES emit a `composer.json` audit trail next to every run log. v0.5b's Documentalist Worker can read those audits + downstream outcome signals to compute the real counter. The composer feeds the data; the Documentalist makes the decision.

### Q4 — Top-N=5 default, configurable

The composer caps injected lessons at the top-5 by match score (with ties broken by lesson id ascending for deterministic ordering). Configurable per call via `composeLessons(prompt, path, { topN })`.

**Why 5?**

- 5 lessons × ~200 chars/rule ≈ 1KB of prefix. Negligible against the typical 10-50KB prompt body.
- More than 5 dilutes the signal — the LLM starts treating them as low-priority context.
- Fewer than 5 risks missing a relevant lesson when the prompt overlaps with several past failures.

### Q5 — Composer is for `lessons-learned.md` ONLY in v0.2e

Composing constitution modules (Layer A/B/C/D dynamic loading per profile) is explicitly out-of-scope. The constitution composition is a v0.5b concern.

**Why split?**

- The two problems look superficially similar but have very different inputs:
  - Lessons-learned: append-only, keyword-matched, per-prompt match list (variable size).
  - Constitution modules: fixed set, profile-driven, deterministic via `constitution-bindings.yaml` (loaded once per skill/worker invocation).
- Folding both into one composer would tangle two different data models and two different injection points. v0.2e keeps them separate so we can evolve each independently.

### Q5.b — Content SHA instead of mtime for cache invalidation

SPEC AC-2 originally called for the parser to return entries "version-stamped against the file's modification time for cache invalidation". The implementation uses a **content SHA-256 prefix (12 hex chars ≈ 48 bits)** instead. Rationale:

- **Filesystem mtime is unreliable on copy/clone**: `git worktree add` produces a worktree whose `docs/lessons-learned.md` shares its content with the source but typically gets a fresh mtime. Content hash treats them as identical (correct); mtime treats them as different (wrong).
- **mtime drifts under formatting-only edits**: a `prettier` pass on the file or a no-op rewrite (e.g. line-ending normalization) bumps mtime but doesn't change semantics. Content hash absorbs the no-op.
- **Content hash is observable**: the composer.json audit trail records `lessons_file_sha`, which lets `mmd lessons` and `audit-pillars.sh --with-composer` group runs by the lesson-set they were composed against.

The trade-off cost: computing a SHA over the file is slightly slower than reading mtime via `stat()`. At single-digit-ms total compose time on the current file size, this is negligible — re-evaluate if the file grows past ~10 MB.

### Q6 — `MMD_COMPOSER_DISABLED=1` escape hatch + ENOENT no-op

Two failure modes are explicitly safe:

- `MMD_COMPOSER_DISABLED=1` in the env → composer returns the raw prompt unchanged, writes a `{ disabled: true }` composer.json. Debugging knob for when the composer is suspected of misbehaving in production.
- `docs/lessons-learned.md` missing (e.g. brownfield target that hasn't run `install-mmd.sh`) → composer returns `{ missing: true }`, no error, raw prompt preserved.

Other I/O errors raise a warning written to the run log header (`[composer] warning: <message>`) and the run proceeds with the raw prompt. Per `error-handling.md` §III ("graceful degradation"): observability data is best-effort, never load-bearing for the actual work.

## Consequences

**Positive**

- The autolearning loop is operational end-to-end. New lessons captured via the Documentalist Worker pattern (`docs/lessons-learned.md`) automatically reach every future `mmd` invocation without human-in-the-loop.
- `mmd lessons` makes composition introspectable. Drift between the file's content and what gets injected is detectable in seconds.
- `scripts/audit-pillars.sh --with-composer` extends the L-012 pillar audit with a new pillar — "Composer activity" — that surfaces adoption metrics over time.
- Determinism + sub-100ms means we can run the composer on every CI build without budget concerns.

**Negative**

- Keyword-overlap is a brittle matcher: a lesson whose keywords don't match the natural-language prompt vocabulary will be silently missed. Mitigation: the `**Keywords for matching**:` field in each lesson is explicit — humans can refine it when they observe a miss.
- The `mmd lessons` injection-count column reflects EVERY composer.json sidecar under `.mmd/local/`, including runs that started but failed early. Counts may slightly over-represent real injections. Acceptable for v0.2e (we're optimizing for "is the lesson getting hit at all"); v0.5b's Documentalist can refine.
- No backpressure when the lessons file grows past ~100 entries. The matcher is O(N×K) where N is active lessons and K is keywords per lesson. At 100×10 = 1000 regex tests per invocation it's still well under the perf budget. Re-evaluate at 500 lessons.

## Trust boundary (security note)

The composer injects each matched lesson's `Rule:` body **verbatim** at the TOP of the prompt that goes to `claude -p`. That makes `docs/lessons-learned.md` part of the trust boundary: anything the file says is treated by the downstream LLM as authoritative project guidance.

**Implications**:

- The lessons file is a **trusted text source**. In the MMD repo, it is committed and code-reviewed like any other source file — that is the safety. The threat model is "trusted committer typos a rule" (acceptable — caught in PR review), not "untrusted third party authors rules".
- When `install-mmd.sh` deploys MMD on a brownfield project, the project's own `docs/lessons-learned.md` (created or not) is what gets read. Operators MUST treat that file the same way they treat third-party `CLAUDE.md` or `.claude/commands/*.md`: a malicious rule body could attempt prompt injection against the downstream LLM (e.g. instructing it to disregard the project constitution, exfiltrate secrets, run dangerous commands).
- The `MMD_COMPOSER_DISABLED=1` escape hatch is the operational mitigation when a lessons file's provenance is in doubt.

This trust boundary is consistent with `security.md` §I.A04 (insecure-design) and matches how Spec Kit handles its constitution: rules in the file shape the LLM's behavior, so the file MUST be reviewed with the same rigor as code.

## Alternatives considered

- **Embedding-based semantic matching**: rejected (Q1) — cost, determinism, transparency, calibration.
- **LLM-driven matching as a separate cheap call**: rejected (Q1) — latency + cost + hallucination risk.
- **Inject lessons in the SYSTEM message instead of the user message**: rejected — gStack skills and bmad-adv-auto-dev have specific system messages; composing into them would be invasive. Top-of-user-prompt is the universal hook.
- **Increment the reuse counter on every match**: rejected (Q3) — confuses "match" with "validated re-use" and risks premature promotion.
- **Compose constitution modules in the same pass**: deferred to v0.5b (Q5) — different data model, different invariants, deserves its own design.
- **Per-skill custom injection templates**: deferred — every gStack skill could ideally have different rules ("qa always gets L-005", "ship always gets L-008"). Defer until we have data on what works at the universal top-of-prompt level.

## Reflexive note

v0.2e is the **sixth use of `mmd --here`** to develop MMD — after L-010 (trivial), L-011 (dream-bench feature), L-013 (wrapper-modifying), L-015 (Conductor pre-condition gap surfaced), L-016 (timeout + spec-polish trap surfaced). If v0.2e lands clean, the pattern is solid enough to elevate "`mmd --here` is the supported workflow" from rule-in-lessons (L-011) to explicit statement in `commit-git.md` — see SPEC_V02E §6 DoD #12.

## References

- SPEC: [SPEC_V02E.md](../../SPEC_V02E.md)
- Scoping: [MAKE_MY_DREAMS.md §6.5](../../MAKE_MY_DREAMS.md) + §6.5b autolearning loop
- Lessons file: [docs/lessons-learned.md](../lessons-learned.md)
- Prior ADRs: ADR-001 (gStack as backbone), ADR-008 (Project Onboarder), ADR-009 (Medium gStack integration pattern)
