# Make My Dreams — v0.4.d Spec: LLM-as-judge behavioral oracle (P-09)

> The deepest correctness piece of Bundle B. The sealed-test oracle (v0.4.a–c) proves the code passes an *independent* test suite — but "tests prove the code does what it does, not what was **asked**" (PROBLEMS.md P-09). A suite can pass while the implementation misses the dream's actual intent (a test that's adequate-but-incomplete, an AC no test covers). v0.4.d adds a **behavioral oracle**: after the sealed tests re-run green, a **judge** sub-agent reads *what was asked* (the dream / ACs) + the produced implementation + the sealed tests, and grades each discernible acceptance criterion **met / not-met / uncertain** with a reason. It is a **second oracle behind the deterministic gate** — it runs only after the seal is intact and the tests pass, so it never replaces the hard test gate; it surfaces the behavioral gap the tests can't. Honest like the 5-Whys: an unparseable judge verdict falls back to **uncertain** (never a fabricated "met"). A `not-met` or `uncertain` verdict exits non-zero (distinct code 7 = behavioral-gap) and flags the slice for human review — it does NOT silently pass. Integrated into the existing `--sealed` pipeline (greenfield + `--here`); a future `--judge-advisory` (warn-only) is noted, not built.

---

## 1. Goal of v0.4.d

Extend `runSealedPipeline` with a final behavioral oracle:

```
… → VERIFY (seal intact) → re-run sealed tests (PASS — deterministic gate) →
  JUDGE  claude -p: "given WHAT WAS ASKED (dream/ACs) + the implementation + the sealed tests,
          grade each AC met/not-met/uncertain with a reason"
        → parse verdict (closed set; unparseable → uncertain, sacred fallback)
        → all met → proceed ;  any not-met/uncertain → exit 7 (behavioral-gap), slice flagged, verdict logged
  → BLAST
```

Deliverables:
1. **`lib/sealed-tests/judge.js`** (NEW, pure):
   - `buildJudgePrompt({ dream, slice, sealedDir, artifactsSummary })` — instructs a fresh agent to grade the implementation against **what was asked** (the dream / `slice.md` ACs), using the sealed tests + the produced artifacts as evidence; output a STRUCTURED, tagged verdict (one line per AC: `AC <id>: MET|NOT-MET|UNCERTAIN — <reason>`, plus an `OVERALL:` line) so parsing is deterministic (MMD controls the format, L-021 spirit).
   - `parseJudgeVerdict(text)` — parse into `{ verdicts: [{ ac, status: 'met'|'not-met'|'uncertain', reason }], overall: 'met'|'not-met'|'uncertain' }`; any unparseable/empty/odd output → `{ overall: 'uncertain', verdicts: [], reason }` (the **sacred fallback** — never fabricate `met`).
2. **Judge invocation** in the pipeline: a `claude -p` judge call (reuse `buildSubprocessEnv` + the `MMD_AUTODEV_CMD` test seam, like the tester); runs ONLY after the sealed-test re-run passes; honest fallback on spawn/timeout failure → `uncertain` (never `met`).
3. **`runSealedPipeline` integration**: add the JUDGE step between the sealed re-run and BLAST. Verdict → `status.json.judge`. `overall === 'met'` (all ACs met) → proceed; any `not-met`/`uncertain` (or unparseable) → **exit 7** (behavioral-gap), slice NOT marked done, the per-AC verdict printed. Distinct from the tamper exit (6) so the two oracle failures are distinguishable.
4. **Both surfaces**: the judge runs in `--sealed` greenfield AND `--here --sealed` (it's in the shared pipeline).

**Not in this slice** (deferred): a `--judge-advisory` warn-only mode (judge runs but never blocks); multi-judge majority vote to dampen non-determinism; judging outside `--sealed`. These are noted in the ADR as the obvious next softeners.

**Mission validation**: on a `--sealed` run where the sealed tests pass but the app misses an AC the tests didn't cover, the judge returns `OVERALL: NOT-MET` naming that AC with a reason, MMD exits 7 and flags the slice (does NOT mark it done); when every AC is genuinely met, the judge returns `OVERALL: MET` and the run proceeds; an unparseable judge reply → `uncertain` → exit 7 (never a fabricated pass).

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: `buildJudgePrompt` + `parseJudgeVerdict` (pure, sacred fallback)
**Given** a dream (+ optional `slice.md`) and the sealed dir
**When** the judge prompt is built and a reply is parsed
**Then**: `buildJudgePrompt` asks the agent to grade the implementation against WHAT WAS ASKED (not just "do tests pass") and to emit the tagged per-AC format + an `OVERALL:` line; `parseJudgeVerdict` returns `{ verdicts:[{ac,status,reason}], overall }` with `status`/`overall` ∈ {met,not-met,uncertain}; any unparseable/empty reply → `{ overall:'uncertain', verdicts:[], reason }` — NEVER `met` (sacred fallback, universal §VI); pure, never throws.
Tag: `@unit`.

### AC-2: Judge invocation (honest fallback)
**Given** a sealed run past the test re-run
**When** the judge `claude -p` is invoked (reusing `buildSubprocessEnv` + the `MMD_AUTODEV_CMD` seam)
**Then**: a spawn/timeout/non-zero failure resolves to `overall: 'uncertain'` with an explicit reason (never `met`, never a crash); the judge call is forensically tee'd to a `*.judge.log` like the tester.
Tag: `@unit` (injected spawn) + `@integration` (fake claude judge).

### AC-3: `runSealedPipeline` JUDGE step + exit 7
**Given** the sealed pipeline (greenfield AND `--here`)
**When** the sealed tests re-run GREEN
**Then**: the JUDGE step runs next (before BLAST); `overall === 'met'` → proceed to BLAST + mark done; any `not-met`/`uncertain` → **exit 7** (behavioral-gap), slice NOT marked done, the per-AC verdict printed and written to `status.json.judge`; the judge runs ONLY after the deterministic test gate passed (a failed/tampered seal still exits 6 BEFORE the judge). The non-`--sealed` paths are unchanged.
Tag: `@integration` (fake judge: MET → done; NOT-MET → exit 7 + named AC).

### AC-4: Behavioral-gap caught where tests alone pass
**Given** a fake run where the sealed tests pass but the judge returns `NOT-MET` for an AC
**When** the pipeline runs
**Then**: MMD exits 7, prints the not-met AC + reason, and `status.json.judge.overall === 'not-met'`; the slice is NOT done — demonstrating P-09 (tests green ≠ asked-for behavior). An unparseable judge reply yields `uncertain` → exit 7 (escalate, no fabricated pass).
Tag: `@integration`.

### AC-5: Docs + ADR + lesson
**Given** v0.4.d ships
**When** docs are read
**Then**: ADR-028 documents the behavioral oracle — P-09; why the judge runs AFTER the deterministic test gate (second oracle, not a replacement); the tagged-output → deterministic parse; the sacred `uncertain` fallback; exit 7 vs 6; and the non-determinism caveat + the deferred `--judge-advisory` / multi-judge-vote softeners; `docs/lessons-learned.md` gains **L-025** ("a passing test suite is not proof of asked-for behavior — an independent judge against the dream catches P-09"); `README.md`/`CLAUDE.md` note the judge step + exit 7.
Tag: `@unit` anchors.

---

## 3. Architecture (incremental)

```
lib/sealed-tests/judge.js     NEW — buildJudgePrompt + parseJudgeVerdict (pure)
bin/mmd.js (runSealedPipeline) MODIFY — JUDGE step after the sealed re-run, before BLAST; exit 7 on gap;
                               + a judge invoker (claude -p, reuse buildSubprocessEnv + MMD_AUTODEV_CMD seam)
lib/state.js                  reuse — status.json.judge field
```

### Files modified / added
```
make-my-dreams/
├── lib/sealed-tests/judge.js                       # NEW
├── bin/mmd.js                                       # modified — JUDGE step in runSealedPipeline + invoker
├── test/unit/sealed-tests-judge.test.js             # NEW — AC-1 (prompt + parse + sacred fallback)
├── test/integration/sealed-judge.test.js            # NEW — AC-3/AC-4 (MET → done; NOT-MET/unparseable → exit 7)
├── test/fixtures/fake-claude-elicit.sh              # modified — branch a JUDGE mode (verdict output)
├── docs/adr/028-llm-judge-behavioral-oracle.md       # NEW
├── docs/lessons-learned.md                          # modified — L-025
├── README.md / CLAUDE.md                            # modified — judge step + exit 7
└── package.json                                     # modified — 0.4.3
```

---

## 4. Out of scope for v0.4.d
- ❌ `--judge-advisory` (warn-only, never blocks) — noted as the obvious softener; not built.
- ❌ Multi-judge majority vote to dampen non-determinism (future).
- ❌ Judging outside the `--sealed` pipeline (no standalone `mmd judge`).
- ❌ `--sealed` as a Standard-engine default (still opt-in; the last v0.4.x candidate, deliberately not done).
- ❌ **Scale assumption**: one judge call per sealed run over one slice's ACs — fine. Large AC sets would warrant chunking — not now.

## 5. Implementation hints (for auto-dev)
1. Read SPEC_V04D.md (this), `runSealedPipeline` + `invokeSealedTester` in `bin/mmd.js` (the judge invoker mirrors the tester), and `lib/conductor/five-whys.js`/`five-whys-prompt.js` for the closed-verdict-parse + sacred-fallback pattern this judge follows.
2. Make the judge output DETERMINISTICALLY parseable: the prompt dictates the exact line format (`AC <id>: MET|NOT-MET|UNCERTAIN — reason` + `OVERALL: …`); `parseJudgeVerdict` keys off those tags. Unparseable → `uncertain` (NEVER `met`) — the sacred fallback (universal §VI; mirrors the 5-Whys escalate-on-unparseable).
3. The judge runs ONLY after the sealed test re-run passes (it's a second oracle). A tampered/failed seal still exits 6 before the judge ever runs. Behavioral-gap = NEW exit 7 (distinct, documented).
4. Keep `judge.js` PURE (prompt build + parse); the spawn lives in the pipeline invoker, reusing `buildSubprocessEnv` + the `MMD_AUTODEV_CMD` fake seam. Extend the fake fixture to emit a verdict for a JUDGE-mode prompt (MET by default; a `MMD_FAKE_JUDGE_NOTMET=1` knob for the not-met test).
5. Honest at every step (§VI): judge spawn failure / timeout / empty → `uncertain` + explicit reason, never `met`, never a crash. Print the per-AC verdict; write it to `status.json.judge`.
6. Constitution bindings: universal (§VI honesty, §VII), ai-coding, commit-git, testing, error-handling, documentation.

## 6. Definition of done
1. All 5 ACs met.
2. Full suite passes (current 1362 + new tests).
3. A `--sealed` run: tests green + judge `OVERALL: MET` → slice done; tests green + judge `NOT-MET` → exit 7, slice flagged, verdict in `status.json.judge`; unparseable judge → `uncertain` → exit 7; a tampered seal still exits 6 before the judge. Works on greenfield AND `--here --sealed`.
4. README + CLAUDE.md + ADR-028 + L-025 in place.
5. Version bumped to `0.4.3`.
6. Slice merged (ff-only) + tag `v0.4.3`.
7. 23rd reflexive use of `mmd --here` (10th with `--label`). Bundle B now has BOTH oracles: the deterministic sealed-test gate (P-04) AND the behavioral judge against what-was-asked (P-09) — the last remaining v0.4.x candidate is `--sealed` as a Standard default (deliberately left opt-in).

---

*Spec v0.4.d — an LLM-as-judge behavioral oracle completing Bundle B: after the deterministic sealed-test gate passes, a judge grades the implementation against WHAT WAS ASKED (the dream/ACs), met/not-met/uncertain; not-met/uncertain → exit 7 (behavioral-gap), never a fabricated pass (sacred uncertain fallback). Runs in `--sealed` on both surfaces; `--judge-advisory` + multi-judge vote deferred.*
