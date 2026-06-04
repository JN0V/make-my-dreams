# ADR-056 — Align the result to the ORIGINAL expectation: frozen oracle + dual-face verify

**Status**: accepted
**Date**: 2026-06-04
**Slice**: v0.17.a (freeze the original expectation at run start; re-anchor the semantic judge to it; un-skip the deterministic Reality Check on `--here`; dual-face alignment gate with bounded iterate)

## Context — the build could quietly redefine its own success, and nothing checked it actually worked

MMD already had a *semantic* alignment face on the normal run path: the v0.11
behavioral judge (ADR-049) grades the implementation against WHAT WAS ASKED and
iterates (bounded) on a gap. But two holes let a run drift from the original ask:

1. **The anchor was soft and driftable.** The judge graded against "the dream /
   `.mmd/shared/slice.md`" — and `slice.md` is written by the build, which the spec
   phase can *polish*. So the build could quietly **redefine its own success**: a
   later, looser slice.md is an easier bar than the original ask. The thing Sébastien
   fears, verbatim: *"il faut trouver une solution où on s'aligne — ou on aligne le
   résultat — à ce qui était attendu à l'origine."*

2. **The deterministic face was absent on `--here`.** Reality Check was a blanket
   SKIP in `--here` mode ("no PWA to open"), so nothing checked the change *actually
   works* — tests could be red, the thing could fail to run, and the run would still
   be marked done as long as the judge was satisfied. "Aligned" must mean BOTH
   "fulfils the ask" (semantic) AND "actually works" (deterministic).

This is the re-framed v0.6 — NOT a catalogue of gStack skills by deliverable type,
but the CORE guarantee: the delivered result matches what was originally asked, and
is corrected when it doesn't.

## Decision

**(1) Freeze the original expectation at run start (immutable oracle).** A new pure
module `lib/conductor/expectation.js` writes `.mmd/shared/expectation.md` ONCE from
the ORIGINAL dream (+ the Dream-Catcher scope when present). It is written at run
start on both the `--here` and greenfield paths and is **never overwritten** on a
re-run/resume (`buildExpectationContent` is a pure builder; `writeExpectation` is a
thin write-once writer over an injected fs — both never throw). The build may
rewrite slice.md/spec all it likes; the oracle the gate verifies against does not
move. This is the anti-drift heart.

**(2) Re-anchor the semantic judge to the frozen expectation.** `runAlignmentGate`
now grades the judge against `expectation.md` (via the pure, injected-reader
`resolveAlignmentAnchor`), not the mutable slice.md / in-memory dream. When the
oracle is absent (e.g. `MMD_SKIP_ALIGN=1` skipped the write, or an early error) it
falls back HONESTLY to the in-memory dream — never throws, never fabricates. The
v0.11 iterate loop + the sacred `uncertain` fallback are otherwise unchanged.

**(3) Un-skip the deterministic Reality Check on `--here`.** `lib/reality-check.js`
gains `hereRealityCheck` (and a technology-agnostic `detectTestCommand`): in
`--here` mode it runs the project's test command if one is detectable
(npm/pytest/cargo/make — universal §VIII) and a `run.json`-kind "does it run" check
(web-static → the existing open+screenshot+no-JS-error; cli → run the `run` command,
exit 0; service/other/none → honest SKIPPED). A red suite or a non-running build is
a deterministic FAIL; when nothing is detectable it SKIPs honestly — never a
fabricated pass, never throws. Greenfield keeps its existing web check.

**(4) Dual-face alignment gate + bounded iterate.** `runAlignmentGate` runs BOTH
faces: the deterministic Reality Check and the semantic judge (anchored to the
oracle). The run is aligned only when both are satisfied; a failure on EITHER drives
the existing bounded iterate loop (`MMD_ALIGN_MAX_ITERS`) with feedback naming the
failing face (deterministic: "tests red: …" via `buildDeterministicFeedback`;
semantic: the unmet ACs via the existing `buildGapFeedback`; both → combined via
`combineFaceFeedback`). An unresolved gap → exit 7 (the existing behavioral-gap
code), with `status.json.judge.face` recording which face failed
(`semantic` | `deterministic` | `both`). `MMD_SKIP_ALIGN=1` opts the WHOLE gate out
(today's back-compat behavior, exactly). Honest at every branch (§VI).

## Consequences

- **Anti-drift**: the build cannot move its own goalposts — the oracle is frozen at
  run start and immutable across resumes/iterations.
- **Both faces, one anchor**: the result is verified against the ORIGINAL ask both
  semantically ("does what was asked") and deterministically ("actually works"),
  with a bounded correction loop on either gap.
- **`--here` is no longer un-checked**: the deterministic face runs on the normal
  `--here` path; a red suite / non-running build is caught, not silently passed.
- **Reuse, not reinvention**: the v0.11 judge (`buildJudgePrompt` /
  `parseJudgeVerdict` / `invokeJudge`) + the iterate loop + the v0.10 `run.json`
  reader + the existing web Reality Check are reused verbatim; this slice adds the
  frozen oracle, the `--here` deterministic face, and the dual-face gating.
- **Back-compat**: `MMD_SKIP_ALIGN=1` restores the pre-v0.17 behavior exactly. Zero
  new dependencies (regex + Node built-ins — the L-024 vanilla bar).
- **Honest testability boundary (§VI)**: the gate's wiring, the pure helpers, the
  deterministic face, and the frozen-oracle write/anchor are all covered by
  unit/integration tests with fake claude + injected exec. A real end-to-end
  `--here` run that genuinely iterates on a *deterministic* FAIL (and a real judge)
  remains an operator/live confirmation worth capturing post-merge.

## Deferred (out of scope)

- The **full polymorphic gStack catalogue** (orchestrate `/design-review`, `/cso`,
  `/canary`, `/devex-review` by deliverable type) — this slice does the CORE (the
  anchor + the two universal faces: tests + does-it-run). The richer gStack skills
  per deliverable type extend the deterministic face later.
- A **full sealed-test suite on the normal path** (an independent tester writing
  blind acceptance tests for EVERY run) — heavier; `--sealed` remains the opt-in.
  This slice's oracle is the frozen dream/scope + the judge, not a generated suite.
