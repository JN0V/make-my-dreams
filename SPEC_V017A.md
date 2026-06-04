# Make My Dreams — v0.17.0 Spec (slice v0.17.a): align the result to the ORIGINAL expectation — frozen oracle + dual-face verify

> *(The re-framed v0.6. Sébastien's principle, verbatim: "il faut trouver une solution où on s'aligne — ou on aligne le résultat — à ce qui était attendu à l'origine." NOT a catalogue of gStack skills by deliverable type — the CORE guarantee: the delivered result matches what the user originally asked, and is corrected if it doesn't.)*
>
> **What exists (don't reinvent).** The **semantic** face already runs on the normal path: the v0.11 alignment judge grades the implementation against the ask and iterates (bounded) on a gap. The independent expectation-oracle idea also exists (the v0.4 sealed tester derives blind acceptance tests from the dream) but is `--sealed`-only.
>
> **The two gaps this slice closes.**
> 1. **The anchor is soft + driftable.** The judge grades against "the dream / `.mmd/shared/slice.md`" — but `slice.md` is written by the build and the spec phase can *polish* it, so the build can quietly **redefine its own success** (the drift Sébastien fears). The original expectation must be **frozen** at run-start and used as the immutable oracle.
> 2. **The deterministic face is absent on `--here`.** Reality Check is **SKIPPED in `--here`** today ("no PWA to open"). So nothing checks the change *actually works* (tests pass, the thing runs). "Aligned" must mean BOTH "fulfils the ask" (semantic) AND "actually works" (deterministic) — both anchored to the frozen original expectation.
>
> **The shape.** (a) Freeze the original expectation at run-start. (b) Verify the result against it on both faces — semantic (the v0.11 judge, re-anchored to the frozen expectation) + deterministic (un-skip Reality Check on `--here`: run the project's tests + a `run.json`-kind "does it run" check). (c) Align: iterate (reuse the v0.11 bounded loop) on a gap on either face; an unresolved gap is reported honestly, never a fabricated pass.

---

## 1. Goal of v0.17.a

```
run start  →  FREEZE the original expectation → .mmd/shared/expectation.md (immutable):
                the original dream verbatim + the Dream-Catcher scope (greenfield) / the dream (--here).
                The build may write slice.md/spec, but expectation.md is the ORACLE and is never overwritten.

run end (before "done")  →  DUAL-FACE alignment gate, both anchored to expectation.md:
   SEMANTIC   : the v0.11 judge grades the impl against expectation.md (not the mutable slice).
   DETERMINISTIC (un-skipped on --here): does it actually WORK?
       - run the project's test command if one exists (package.json test / detected) → must pass
       - a run.json-kind "does it run" check (web-static → open/screenshot no-error; cli → run + exit 0; else honest skip)
   ALIGNED   : both faces pass  → done.
   GAP       : either face fails → iterate (bounded, MMD_ALIGN_MAX_ITERS) with feedback naming the unmet expectation;
               unresolved after the cap → exit 7, honest report, NOT done (never a fabricated pass).
   MMD_SKIP_ALIGN=1 still opts the whole gate out (back-compat).
```

Deliverables:
1. **Freeze the original expectation** (`lib/conductor/expectation.js` + wiring): at run-start (greenfield + `--here`), write `.mmd/shared/expectation.md` from the ORIGINAL dream (+ the Dream-Catcher scope when present) — written ONCE, treated as immutable (a re-run/resume does not overwrite an existing one). Pure builder + a thin writer; never throws. This is the oracle the gate verifies against, so the build's own spec-polishing cannot move the goalposts (anti-drift).
2. **Re-anchor the semantic judge to the frozen expectation** (`bin/mmd.js` alignment gate): the v0.11 judge grades against `expectation.md` (the frozen original ask) rather than the mutable `slice.md`. Reuses `buildJudgePrompt`/the iterate loop unchanged — only the anchor source changes.
3. **Deterministic face — un-skip Reality Check on `--here`** (`lib/reality-check.js` + `bin/mmd.js`): in `--here` mode, instead of the blanket SKIP, run the deterministic checks — (a) the project's test command if detected (e.g. `npm test` / the `package.json` `test` script), must pass; (b) a `run.json`-kind appropriate "does it run" check (web-static → the existing open+screenshot+no-JS-error; cli → run the `run` command, exit 0; service/other/none → honest SKIPPED with a reason, never a fabricated pass). Greenfield keeps its existing web check, now also anchored.
4. **Dual-face alignment + iterate** (`bin/mmd.js`): the completion gate passes only when BOTH faces are satisfied; a failure on either → the existing bounded iterate loop (re-launch with feedback that names the unmet expectation / the failing check); an unresolved gap → exit 7, status records which face failed, NOT done. `MMD_SKIP_ALIGN=1` opts out (today's behavior). The result is honest at every branch (§VI).
5. **Docs + ADR**: ADR-056 (align-to-original-expectation, the frozen oracle + anti-drift, the dual-face semantic+deterministic verify, un-skip on `--here`, reuse of v0.11/v0.4/run.json, the bounded iterate; why this is the re-framed v0.6, not a gStack-skill catalogue); README + CLAUDE.md + `/mmdream` note; mechanical blocks; version → 0.17.0.

**Mission validation**: an implementation that drifts from the original dream is caught by the SEMANTIC face (judge vs the frozen `expectation.md`); one that fulfils the ask but doesn't actually work (tests red / won't run) is caught by the DETERMINISTIC face (now active on `--here`, not skipped); either gap triggers a bounded align-iterate; an unresolved gap is reported honestly (exit 7, not done); `expectation.md` is frozen so the build cannot redefine its own success. The result is verified against what was originally expected — both "does what was asked" and "actually works."

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: the original expectation is frozen (immutable oracle)
**Given** a greenfield or `--here` run start
**When** the expectation is captured
**Then**: `.mmd/shared/expectation.md` is written from the ORIGINAL dream (+ Dream-Catcher scope when present), ONCE; an existing `expectation.md` (resume/re-run) is NOT overwritten; the pure builder never throws on odd input. The build's later edits to `slice.md`/spec do not change `expectation.md`.
Tag: `@unit` (pure builder from dream/scope; immutability — second call no-ops) + `@integration` (expectation.md written at run start; not overwritten on re-run).

### AC-2: the semantic judge is anchored to the frozen expectation
**Given** the alignment gate (judge seam)
**When** it grades
**Then**: the judge prompt is built against `expectation.md` (the frozen original ask), not the mutable `slice.md`; the v0.11 iterate loop + the sacred fallback are otherwise unchanged.
Tag: `@unit`/`@integration` (the judge prompt references the frozen expectation; gate behavior preserved).

### AC-3: the deterministic face runs on `--here` (no more blanket skip)
**Given** a completed `--here` change with a detected project test command
**When** the deterministic face runs
**Then**: it runs the project's tests (must pass) + a `run.json`-kind "does it run" check (web→open/screenshot; cli→run+exit 0; service/other/none→honest SKIPPED with a reason); a red test suite or a non-running build is a deterministic FAIL (not skipped, not faked). When no test command + no runnable kind is detectable → honest SKIPPED naming why (never a fabricated pass). Greenfield's existing web check is preserved.
Tag: `@unit`/`@integration` (tests-pass → ok; tests-red → fail; no-detectable-check → honest skip; the old blanket `--here` skip is gone).

### AC-4: dual-face gate + bounded align-iterate + honest gap
**Given** the completion gate with both faces
**When** it runs
**Then**: done only if BOTH faces pass; a failure on EITHER → the bounded iterate loop (`MMD_ALIGN_MAX_ITERS`) with feedback naming the unmet expectation/failing check; an unresolved gap after the cap → exit 7, status records the failing face, NOT done; `MMD_SKIP_ALIGN=1` opts the whole gate out (today's behavior). Never a fabricated pass on any branch (§VI).
Tag: `@unit`/`@integration` (both-pass→done; semantic-gap→iterate; deterministic-gap→iterate; unresolved→exit 7 not-done; SKIP_ALIGN→off).

### AC-5: docs
**Then**: ADR-056 lands; README + CLAUDE.md + `/mmdream` (the frozen-expectation oracle + dual-face gate + `MMD_SKIP_ALIGN`); mechanical blocks; version → 0.17.0.
Tag: `@unit`/`@integration` (ADR-056 exists; docs mention the expectation oracle + dual-face; version bumped).

---

## 3. Out of scope (deferred)

- **The full polymorphic gStack catalogue** (orchestrate `/design-review`, `/cso`, `/canary`, `/devex-review` by deliverable type) — this slice does the CORE (anchor + the two universal faces: tests + does-it-run). Adding the richer gStack skills per deliverable type is the follow-up that extends the deterministic face.
- **A full sealed-test suite on the normal path** (an independent tester writing blind acceptance tests for EVERY run) — heavier (a tester LLM per run); `--sealed` remains the opt-in for that. This slice's oracle is the frozen dream/scope + the judge, not a generated test suite.
- **Live AC** for the deterministic-on-`--here` behavior is automated here (we run real test commands against fixtures), but a real end-to-end `--here` run that genuinely iterates on a deterministic FAIL is an operator/live confirmation worth capturing post-merge.

---

## 4. Operational notes for the implementer

- REUSE: the v0.11 judge (`buildJudgePrompt`/`parseJudgeVerdict`/`invokeJudge`) + the bounded iterate loop + the v0.10 `run.json` reader (`lib/greenfield/run-descriptor.js`) + `lib/reality-check.js`. This slice ADDS the frozen-expectation oracle + the deterministic face on `--here` + the dual-face gating; it does NOT re-implement the judge or the loop.
- `expectation.md` lives in `.mmd/shared/` (alongside slice.md/vision.md) and is the immutable oracle — write-once, never overwrite (resume-safe). It is the anchor for BOTH faces.
- The deterministic test-command detection must be technology-agnostic where feasible (per universal §VIII) — detect the project's test entry (npm `test` script, etc.); when undetectable, honest SKIPPED, never a fabricated pass.
- Keep `MMD_SKIP_ALIGN=1` opting the whole gate out (back-compat). The alignment gate stays default-on.
- Commit incrementally per AC (L-019). Tests tagged per stratum.
