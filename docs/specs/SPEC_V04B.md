# Make My Dreams — v0.4.b Spec: `--sealed` on `--here` (reflexive sealed oracle)

> v0.4.a shipped the sealed-test oracle for the greenfield path (`mmd --sealed "<dream>"`). Its core (`lib/sealed-tests/`) is surface-agnostic, but the orchestration (`runSealedGreenfield` in `bin/mmd.js`) is wired only to greenfield. v0.4.b extends it to **`mmd --here --sealed`** — so MMD can seal-test **its own development slices** (the reflexive payoff: the same anti-P-04 oracle that guards a generated app now guards MMD modifying itself). The TESTER → SEAL → VERIFY → re-run → BLAST steps are identical across surfaces; only the **CODER** step differs (greenfield: `buildCoderPrompt` + `invokeAutodev` on `demoDir`; `--here`: `buildHerePrompt` + `invokeAutodev` on the slice branch). So v0.4.b **extracts a surface-agnostic `runSealedPipeline`** (coder injected as a callback), refactors greenfield to use it (behavior unchanged — existing `--sealed` tests stay green), and wires the `--here` coder. Still opt-in; the sealed dir lives in the target repo's gitignored `.mmd/shared/sealed-tests/` (ephemeral per-run oracle, not committed).

---

## 1. Goal of v0.4.b

```
mmd --here --sealed "add a dark-mode toggle"   (on an existing repo / on MMD itself)
  TESTER  → blind acceptance tests for the dream → <target>/.mmd/shared/sealed-tests/
  SEAL    → sha256 manifest (+ empty-seal / incomplete-seal guards)
  CODER   → existing --here auto-dev on the slice branch (buildHerePrompt), told the sealed dir is read-only
  VERIFY  → tamper/removed → non-zero, slice NOT done (anti-P-04)
  re-run  → sealed tests as the independent oracle
  BLAST   → changed files + importers → status.json.blast_radius
```

Deliverables:
1. **Extract `runSealedPipeline`** (surface-agnostic, in `bin/mmd.js` or a new `lib/sealed-tests/pipeline.js`): performs TESTER → SEAL (+ the empty-seal / incomplete-seal integrity guards) → **coder (injected callback)** → VERIFY → re-run → BLAST, with the honest-failure handling (`failStatus`/exit 6) parameterized. The `coder` callback receives the sealed dir + context and runs the actual implementation, returning the auto-dev result.
2. **Refactor `runSealedGreenfield`** to call `runSealedPipeline` with the greenfield coder (`buildCoderPrompt` + `invokeAutodev` on `demoDir`). Behavior byte-for-byte unchanged — the v0.4.a `--sealed` integration tests MUST stay green.
3. **Wire `--here --sealed`**: in `runHereMode`, when `flags.sealed`, run `runSealedPipeline` with the `--here` coder (`buildHerePrompt` + `invokeAutodev` on the slice branch). The sealed dir is `<absTargetDir>/.mmd/shared/sealed-tests/`; the tester derives acceptance tests from the dream (the `--here` flow has no `slice.md`).
4. **`buildHerePrompt` gains a sealed-dir read-only note** (optional `sealedDir` param) so the `--here` coder is told the oracle is read-only (mirroring `buildCoderPrompt`).
5. **`--sealed` composes with `--here`** (argv + USAGE updated; v0.4.a's "greenfield only" wording corrected). The default (`--here` without `--sealed`) path is unchanged.

**Not in this slice** (deferred, per v0.4.b candidates): `--sealed` as a Standard-engine default; AST-accurate blast radius; property-based / LLM-as-judge oracle (deeper P-09).

**Mission validation**: `mmd --here --sealed "add X"` writes blind acceptance tests under the target's `.mmd/shared/sealed-tests/`, runs the `--here` auto-dev on the slice branch against the read-only oracle, and — if auto-dev weakened/deleted a sealed test — exits non-zero naming it and does NOT mark the slice done; a clean run re-runs the sealed tests + logs the blast radius. The greenfield `--sealed` path is unchanged.

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: Surface-agnostic `runSealedPipeline` extracted; greenfield unchanged
**Given** the v0.4.a greenfield sealed orchestration
**When** the shared steps are extracted into `runSealedPipeline({ targetDir, sealedDir, dream, slice, coder, logPath, onFail, ... })` and `runSealedGreenfield` is refactored to call it with the greenfield coder
**Then**: `runSealedPipeline` performs TESTER → SEAL (incl. the empty-seal AND incomplete-seal guards) → `coder(...)` → VERIFY → re-run → BLAST, returning an exit code (0 clean; 6 any sealed failure); the greenfield `--sealed` behavior is byte-for-byte unchanged and all existing v0.4.a `--sealed` tests pass without modification.
Tag: `@unit` / `@integration` (existing greenfield sealed tests green).

### AC-2: `--sealed` composes with `--here`
**Given** `lib/argv-parser.js` + the USAGE text
**When** parsed / printed
**Then**: `mmd --here --sealed "<dream>"` parses cleanly (both flags true); the USAGE/`--sealed` description no longer says "greenfield only" and notes it works with `--here` too; no new mutex.
Tag: `@unit`.

### AC-3: `runHereMode` honors `--sealed`
**Given** `mmd --here --sealed "<dream>"`
**When** `runHereMode` runs (after the slice branch is created)
**Then**: it invokes `runSealedPipeline` with `sealedDir = <absTargetDir>/.mmd/shared/sealed-tests/` and a `--here` coder that runs `buildHerePrompt` (now told the sealed dir is read-only) + `invokeAutodev` on the slice branch; the tester derives acceptance tests from the dream (no `slice.md` required); status.json transitions and the existing `--here` reporting are preserved. Without `--sealed`, `runHereMode` is unchanged.
Tag: `@integration` (fake claude: tester writes a sealed test; clean here-coder leaves it).

### AC-4: Tamper enforcement on `--here`
**Given** a `--here --sealed` run whose coder modifies or deletes a sealed test
**When** VERIFY runs
**Then**: MMD exits non-zero listing the tampered/removed files, sets status `failed` with an explicit reason, and does NOT mark the slice done (anti-P-04) — identical contract to greenfield; a clean run re-runs the sealed tests (failure flags the slice) and logs the blast radius to `status.json.blast_radius`.
Tag: `@integration` (fake claude: tampering here-coder → exit 6 + named).

### AC-5: Docs + ADR + README
**Given** v0.4.b ships
**When** the docs are read
**Then**: ADR-026 is extended (or a new ADR-027 added) noting the pipeline extraction + the `--here` surface (and the reflexive value: MMD seals its own slices); `README.md`'s `--sealed` section documents `mmd --here --sealed` and corrects the "greenfield only" wording; `CLAUDE.md` operational notes mention that MMD slices MAY now be launched with `--sealed`.
Tag: `@unit` anchors.

---

## 3. Architecture (incremental)

```
bin/mmd.js                      MODIFY — extract runSealedPipeline (coder as callback);
                                refactor runSealedGreenfield to call it; wire --sealed into runHereMode
lib/sealed-tests/pipeline.js    NEW (optional) — if the pipeline is cleaner as its own module
lib/here-mode.js                MODIFY — buildHerePrompt gains an optional sealedDir read-only note
lib/argv-parser.js              (no change if `sealed` already composes) — verify --here + --sealed compose
lib/sealed-tests/{manifest,tester-prompt,blast-radius}.js   REUSED unchanged
```

### Files modified / added
```
make-my-dreams/
├── bin/mmd.js                                   # modified — extract pipeline + --here wiring
├── lib/sealed-tests/pipeline.js                 # NEW (if extracted to a module)
├── lib/here-mode.js                             # modified — buildHerePrompt sealed-dir note
├── test/integration/sealed-here.test.js         # NEW — --here --sealed (clean + tamper)
├── test/integration/sealed-run.test.js          # modified if needed — greenfield unchanged proof
├── test/unit/argv-parser.test.js                # modified — --here + --sealed compose
├── docs/adr/026-sealed-test-oracle.md           # modified (or NEW 027) — pipeline + --here surface
├── README.md                                    # modified — --sealed works on --here
├── CLAUDE.md                                     # modified — MMD slices may use --sealed
└── package.json                                 # modified — 0.4.1
```

---

## 4. Out of scope for v0.4.b
- ❌ `--sealed` as a Standard-engine default (still opt-in).
- ❌ AST-accurate blast radius (grep stub stays; AST is a separate slice).
- ❌ Property-based / LLM-as-judge oracle (deeper P-09).
- ❌ Committing the sealed tests (they live in gitignored `.mmd/shared/sealed-tests/` — ephemeral per-run oracle).
- ❌ **Scale assumption**: one slice, one sealed dir per run — unchanged from v0.4.a.

## 5. Implementation hints (for auto-dev)
1. Read SPEC_V04B.md (this) and the v0.4.a code it extends: `runSealedGreenfield` + `invokeSealedTester` in `bin/mmd.js`, `lib/sealed-tests/*`, and `runHereMode` + `buildHerePrompt` in `bin/mmd.js`/`lib/here-mode.js`.
2. Extract the SHARED steps (TESTER, SEAL + both integrity guards, VERIFY, re-run, BLAST, honest `failStatus`/exit-6) into `runSealedPipeline`; inject the **coder** as a callback `async (sealedDir, ctx) => invokeResult`. Greenfield passes the `buildCoderPrompt`+`invokeAutodev(demoDir)` coder; `--here` passes the `buildHerePrompt(+sealedDir)`+`invokeAutodev(sliceBranch)` coder. Do NOT duplicate the pipeline.
3. The greenfield refactor MUST be behavior-preserving — run the existing v0.4.a `--sealed` integration tests unchanged as the regression guard.
4. `--here` sealed dir = `<absTargetDir>/.mmd/shared/sealed-tests/` (gitignored, like greenfield's). The tester grounds on the dream (no `slice.md` in `--here`).
5. Reuse the `MMD_AUTODEV_CMD` fake seam for the `--here` integration test (tester writes a sealed test; clean here-coder leaves it → pass; tampering here-coder edits/deletes it → exit 6 + named). Never hit real claude.
6. Constitution bindings: universal (§VI, §VII), ai-coding, commit-git, testing, error-handling, documentation.

## 6. Definition of done
1. All 5 ACs met.
2. Full suite passes (current 1337 + new tests); the v0.4.a greenfield `--sealed` tests pass UNCHANGED.
3. `mmd --here --sealed "<dream>"` runs tester→seal→here-coder→verify→re-run→blast; a tampered sealed file → non-zero + named + slice not done; a clean run → sealed tests re-run + blast radius logged; greenfield `--sealed` and plain `--here` both unchanged.
4. README + CLAUDE.md + ADR (026 extended or 027) in place.
5. Version bumped to `0.4.1`.
6. Slice merged (ff-only) + tag `v0.4.1`.
7. 21st reflexive use of `mmd --here` (8th with `--label`). The sealed oracle now reaches MMD's own development surface — a future MMD slice can be launched with `mmd --here --sealed` to guard its own correctness.

---

*Spec v0.4.b — extend the sealed-test oracle to `mmd --here --sealed` by extracting a surface-agnostic `runSealedPipeline` (coder injected) and wiring the `--here` coder. Greenfield behavior unchanged. The reflexive payoff: MMD can seal-test its own slices. Standard-default + AST blast radius + LLM-judge remain future.*
