# ADR-028 — LLM-as-judge behavioral oracle: a second oracle behind the deterministic test gate

**Status**: Accepted
**Date**: 2026-06-01
**Deciders**: MMD core (self-dev, 23rd reflexive `mmd --here`, 10th with `--label`)
**Parent design**: [SPEC_V04D.md](../../SPEC_V04D.md) (FROZEN). Maps to [PROBLEMS.md](../../PROBLEMS.md) P-09 ("a passing test suite proves the code does what it *does*, not what was *asked*"). Sits behind the sealed-test gate from [ADR-026](./026-sealed-test-oracle.md) (P-04) and the import-graph blast radius from [ADR-027](./027-import-graph-blast-radius.md).

## Context

The sealed-test oracle (v0.4.a–c) hardened MMD against P-04 — the agent rewriting its own check. The tester writes blind acceptance tests, MMD seals them by hash, the coder implements, MMD verifies the seal and re-runs the tests independently. When that passes, the slice is "done".

But "the sealed tests pass" answers a narrower question than "the implementation does what was asked". A test suite — even an independent one — can be **adequate-but-incomplete**: an acceptance criterion the tester simply didn't cover, an edge of the dream no assertion touches, a requirement satisfied in letter but not in spirit. All of those go green. That is P-09: **a passing suite proves the code does what the tests check, not what the dream asked for.** The deterministic gate cannot close this on its own, because the gap is precisely *the behavior no test encodes*.

The question for v0.4.d: how to surface that behavioral gap without weakening the hard gate we just built.

## Decision

Add a **second oracle behind the deterministic one**: an LLM-as-judge that grades the implementation against *what was asked*, and which runs **only after** the sealed tests re-run green.

### 1. A pure prompt + parse module (`lib/sealed-tests/judge.js`)

`buildJudgePrompt({ dream, slice, sealedDir, artifactsSummary })` instructs a fresh agent to grade the implementation against WHAT WAS ASKED (the dream / `slice.md` ACs), using the sealed acceptance tests + the produced artifacts as **evidence** — explicitly *not* "do the tests pass". It dictates a deterministic tagged output (MMD controls the format, the L-021 spirit): one line per AC `AC <id>: MET|NOT-MET|UNCERTAIN — <reason>`, then a final `OVERALL: …` line.

`parseJudgeVerdict(text)` keys off those tags and returns `{ verdicts: [{ ac, status, reason }], overall }` with `status`/`overall` in the closed set `{met, not-met, uncertain}`. Both are **pure** (no fs, no spawn) so the unit suite asserts them without a real claude.

### 2. Why the judge runs AFTER the deterministic test gate (not instead of it)

The judge is a softer oracle than a hash + a test run: it is non-deterministic and can be wrong. So it never *replaces* the hard gate — it runs strictly **downstream** of it. A tampered or removed seal still exits 6 *before* the judge is ever invoked (the anti-P-04 enforcement is untouched); a failing sealed re-run still exits 6. The judge only speaks once the code has already cleared the deterministic bar — its sole job is to catch the behavioral gap that a green-but-incomplete suite leaves open. This ordering means the worst a flaky judge can do is over-flag a slice for human review; it can never wave through a tamper or a red test.

### 3. The sacred `uncertain` fallback (never a fabricated `met`)

Mirroring the 5-Whys parser ([ADR-011](./011-five-whys-escalation.md), `lib/conductor/five-whys-parser.js`): any unparseable / empty / odd judge reply — and any judge spawn error, timeout (`status === null`), or non-zero exit — resolves to `overall: 'uncertain'` with an explicit reason. **Never `met`.** An oracle that can't be read must escalate to a human, not invent a pass (universal §VI). `parseJudgeVerdict` never throws; `invokeJudge` never crashes the run.

### 4. Exit 7 (behavioral-gap), distinct from exit 6 (tamper/seal)

`overall === 'met'` (every AC met) → proceed to BLAST and mark the slice done, with the verdict written to `status.json.judge`. Any `not-met` / `uncertain` → **exit 7**, the slice is NOT marked done, the per-AC verdict is printed and persisted to `status.json.judge`. Exit 7 is deliberately distinct from the tamper/seal-failure exit 6 so the two oracle failures are distinguishable by a human or a CI script: 6 means "the check was attacked or the tests went red"; 7 means "the tests are green but the implementation misses what was asked". The judge runs in the shared `runSealedPipeline`, so it covers **both** `mmd --sealed` (greenfield) and `mmd --here --sealed`.

## Non-determinism caveat (stated, not hidden — universal §VI)

A single LLM judge is non-deterministic: the same implementation can be graded `met` on one run and `uncertain` on another. We accept this because the judge can only *block* (exit 7 → human review), never *pass* something the deterministic gate already rejected — a false `not-met`/`uncertain` costs a human glance, not a silent regression. But the softness is real, and v0.4.d does not pretend otherwise. The obvious next softeners are **deferred** (SPEC §4), noted here so they aren't re-discovered later:

- **`--judge-advisory`** — a warn-only mode where the judge runs and prints its verdict but never blocks (exit stays 0). For teams that want the signal without the gate.
- **Multi-judge majority vote** — N independent judges, majority decides, to dampen single-run non-determinism. The closed-set parse already supports aggregating multiple verdicts.
- **Judging outside `--sealed`** — no standalone `mmd judge`; the oracle only exists behind the sealed gate for now.

## Consequences

- **Positive**: MMD now has BOTH oracles — the deterministic sealed-test gate (P-04) AND a behavioral judge against what-was-asked (P-09). A green-but-incomplete suite no longer silently marks a slice done; the gap is surfaced, named per-AC, and escalated. Honest at every failure branch. Zero new dependencies (pure module + the existing `claude -p` seam).
- **Negative**: the judge is non-deterministic and can over-flag (a `not-met`/`uncertain` on a genuinely-correct slice), costing a human review. It adds one `claude -p` call per sealed run.
- **Neutral**: the judge only gates behind the deterministic gate — it can never pass what the hard gate rejected. Promoting it to advisory-only, or to a multi-judge vote, is a separate later decision.

## Alternatives considered

- **Judge instead of / in place of the sealed-test gate** — replaces a deterministic, tamper-evident check with a non-deterministic one. Rejected: the judge is a *supplement* to the hard gate, never a substitute (it runs strictly downstream).
- **Judge before the test gate** — would let the judge speak about code that hasn't cleared the deterministic bar, conflating "tests red" with "behavior wrong". Rejected: the judge runs only after the seal is intact and the tests pass.
- **Free-form judge output parsed heuristically** — brittle and easy to mis-read as a pass. Rejected in favor of the MMD-dictated tagged format + closed-set parse + the sacred `uncertain` fallback (the same call as the 5-Whys verdict).
- **Block on a fabricated `met` when parsing fails** — the exact P-09-adjacent dishonesty we're guarding against. Rejected: unparseable always → `uncertain` → exit 7, never `met`.
