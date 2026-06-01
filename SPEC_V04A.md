# Make My Dreams — v0.4.a Spec: Bundle B — sealed-test oracle (`mmd --sealed`)

> The first real correctness-hardening of MMD's own auto-dev. The roadmap's v0.4 bundled four things; investigation (2026-06-01) showed externalized state + orchestration already exist and the 70% auto-handoff is **blocked by `claude -p`'s opacity** (deferred to the v0.5 Conductor). What's genuinely new AND high-value is **Bundle B**: a **sealed-test oracle** that stops auto-dev from the classic AI failure of *making a test pass by rewriting the test, not the code* (PROBLEMS.md P-04 — 24% of SWE-bench-Pro "verified" patches are actually wrong). Because the auto-dev workflow lives in gitignored `_bmad/`, the enforcement lives entirely at the **MMD layer**: an opt-in `mmd --sealed "<dream>"` runs a **two-phase, MMD-orchestrated** flow — a **tester** sub-agent derives acceptance tests from the dream *without seeing any implementation*, MMD **seals** them (sha256 manifest), the **coder** (the existing auto-dev) implements against a sealed dir it is told is read-only, then MMD **verifies** the seal (tamper = fail) and re-runs the sealed tests as an independent oracle. Plus a **blast-radius stub** (P-05). Opt-in via `--sealed`; default behavior unchanged. The surface-agnostic core (`lib/sealed-tests/`) leaves `--here` + Standard-engine adoption for a follow-up.

---

## 1. Goal of v0.4.a

```
mmd --sealed "une appli pour dessiner"
  1. TESTER   claude -p: "derive acceptance tests from this dream into test/sealed/ — do NOT implement"
  2. SEAL     MMD records a manifest { <file>: sha256 } of test/sealed/*
  3. CODER    existing auto-dev runs; its prompt states "test/sealed/ is the SEALED ORACLE — read-only, do not modify"
  4. VERIFY   MMD re-hashes test/sealed/*:
                • any file changed/removed → TAMPER → non-zero exit + the tampered list (P-04)
                • intact → re-run the sealed tests as the independent oracle; failures flag the slice
  5. BLAST    stub: changed files + their direct importers → status.json.blast_radius (P-05)
```

Deliverables:
1. **`lib/sealed-tests/` core** (pure where possible, I/O injected):
   - `manifest.js` — `buildManifest(dir, readdirFn, readFileFn)` → `{ file: sha256 }`; `verifyManifest(dir, manifest, …)` → `{ tampered: string[], removed: string[], added: string[] }`. Pure over injected fs.
   - `tester-prompt.js` — pure: build the tester `claude -p` prompt from the dream (+ `slice.md` if present), instructing it to write acceptance tests into the sealed dir and to NOT implement the app.
   - `blast-radius.js` — pure stub: given changed files + a file lister/reader, return `{ changed: string[], importers: string[] }` by grepping `import …`/`require(…)` of the changed files. (AST is a v0.5 upgrade.)
2. **The `--sealed` orchestration** (in `bin/mmd.js`, greenfield path): tester invocation → seal → auto-dev (coder, prompt marks the sealed dir read-only) → verify → re-run sealed → blast-radius → report; reuses `buildSubprocessEnv` + the `MMD_AUTODEV_CMD` test seam for the tester call (same as auto-dev).
3. **`--sealed` flag** in `lib/argv-parser.js` (boolean, default false, composes with engine/session flags).
4. **Honest reporting** (universal §VI): the tester failing, the seal being empty, or git/test errors are reported explicitly — never a fabricated "sealed OK". A tamper or a sealed-test failure is surfaced loudly (the whole point); MMD does NOT auto-merge a tampered slice.

**Not in this slice** (deferred): `--sealed` on `--here` and as a Standard-engine default (core is surface-agnostic — easy follow-up); AST-based blast radius; property-based / golden-trace oracles (P-09 deeper); modifying the BMAD `_bmad/` workflow itself (enforcement stays MMD-layer).

**Mission validation**: `mmd --sealed "a counter app with + and − buttons"` writes acceptance tests into `test/sealed/`, runs auto-dev to implement, and — if auto-dev had quietly weakened or deleted a sealed test — exits non-zero naming the tampered file; on a clean run, the sealed tests pass as an independent oracle and the blast radius is logged.

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: `--sealed` flag
**Given** `lib/argv-parser.js`
**When** parsed
**Then**: `--sealed` is a recognized boolean flag (in `KNOWN_FLAGS`), default false, composes with engine/session/mode flags; `parseArgv`'s `flags` shape gains `sealed`.
Tag: `@unit`.

### AC-2: Seal manifest — build + verify (pure)
**Given** a sealed directory and injected fs
**When** `buildManifest` then `verifyManifest` run
**Then**: `buildManifest` returns a deterministic `{ relPath: sha256 }` over the dir's files; `verifyManifest` against a later state returns `tampered` (content changed), `removed` (gone), and `added` (new) lists; identical state → all empty; never throws on a missing dir (returns empty / explicit).
Tag: `@unit`.

### AC-3: Tester prompt + invocation (independent oracle, honest fallback)
**Given** a dream (+ optional `slice.md`)
**When** the tester prompt is built and the tester `claude -p` is invoked
**Then**: the prompt instructs the agent to **derive acceptance tests from the dream/spec into the sealed dir** and **explicitly NOT implement** the app (the oracle must be blind to the implementation); invocation reuses `buildSubprocessEnv` + honors the `MMD_AUTODEV_CMD` test seam; if the tester fails or writes nothing, MMD reports it explicitly and aborts the sealed run (no silent "no tests" pass — §VI).
Tag: `@unit` (prompt) + `@integration` (fake claude writes a sealed test file).

### AC-4: End-to-end `--sealed` orchestration + tamper enforcement
**Given** `mmd --sealed "<dream>"` on the greenfield path
**When** it runs (tester → seal → coder/auto-dev → verify → re-run)
**Then**: the coder's auto-dev prompt states the sealed dir is read-only; after auto-dev, MMD re-verifies the manifest — if any sealed file is `tampered`/`removed`, MMD exits non-zero listing them and does NOT treat the slice as done (anti-P-04); if intact, MMD re-runs the sealed tests and reports pass/fail (a failure flags the slice); a clean run proceeds. The default (no `--sealed`) path is byte-for-byte unchanged.
Tag: `@integration` (fake claude: tester writes a sealed test; a "good" coder leaves it → pass; a "tampering" coder edits it → non-zero + named).

### AC-5: Blast-radius stub
**Given** a set of changed files + injected file access
**When** `computeBlastRadius` runs
**Then**: it returns the changed files plus their **direct importers** (found by grepping `import`/`require` references to each changed file); the result is written to `status.json.blast_radius`; an empty/զunavailable input yields an explicit empty result, never a crash. (AST-accurate analysis is a documented v0.5 upgrade.)
Tag: `@unit`.

### AC-6: Docs + ADR + lesson
**Given** v0.4.a ships
**When** the docs are read
**Then**: an ADR numbered 026 documents the sealed-test oracle (why MMD-layer not BMAD-workflow — `_bmad/` is gitignored; the two-phase tester/coder split; hash-manifest tamper enforcement; P-04/P-05/P-09 mapping; the deferral of `--here`/Standard-default + AST blast radius); `docs/lessons-learned.md` gains a formal **L-023** entry (Category/Applies to/Keywords) on "an independent, sealed test oracle catches the agent-rewrites-the-test failure that ordinary self-graded tests miss"; `README.md` documents `mmd --sealed`.
Tag: `@unit` anchors.

---

## 3. Architecture (incremental)

```
lib/sealed-tests/
  manifest.js        NEW — buildManifest / verifyManifest (pure, injected fs)
  tester-prompt.js   NEW — pure: dream(+slice.md) → tester claude -p prompt (derive tests, do NOT implement)
  blast-radius.js    NEW — pure stub: changed files → + direct importers

bin/mmd.js           MODIFY — greenfield path: if flags.sealed, run tester→seal→auto-dev(read-only sealed)→verify→re-run→blast
lib/argv-parser.js   MODIFY — add 'sealed' boolean flag
lib/invoke-autodev.js  reuse — buildSubprocessEnv + the MMD_AUTODEV_CMD seam (tester + coder calls)
lib/state.js         reuse/extend — status.json.blast_radius field
```

### Files modified / added
```
make-my-dreams/
├── lib/sealed-tests/{manifest,tester-prompt,blast-radius}.js   # NEW
├── bin/mmd.js                                                  # modified — --sealed orchestration
├── lib/argv-parser.js                                          # modified — --sealed flag
├── test/unit/sealed-tests-{manifest,tester-prompt,blast-radius}.test.js  # NEW
├── test/unit/argv-parser.test.js                              # modified — --sealed
├── test/integration/sealed-run.test.js                        # NEW — tester→seal→coder→verify (good + tamper)
├── docs/lessons-learned.md                                    # modified — L-023
├── docs/adr/026-sealed-test-oracle.md                         # NEW
├── README.md                                                  # modified
└── package.json                                                # modified — 0.4.0
```

---

## 4. Out of scope for v0.4.a
- ❌ `--sealed` on `--here` and as a Standard-engine default (surface-agnostic core makes these an easy follow-up).
- ❌ AST-accurate blast radius (grep-based stub here; AST in v0.5).
- ❌ Property-based testing / golden traces / LLM-as-judge on ACs (deeper P-09 — future).
- ❌ Modifying the BMAD `_bmad/` auto-dev workflow (enforcement is MMD-layer by design — `_bmad/` is gitignored).
- ❌ The v0.4 Orchestrator-formalization + 70% auto-handoff (already-handled / blocked by `claude -p` opacity — → v0.5 Conductor).
- ❌ **Scale assumption**: seals a handful of test files + greps a small generated app; AST/large-repo performance is a v0.5 concern.

## 5. Implementation hints (for auto-dev)
1. Read SPEC_V04A.md (this) and `lib/invoke-autodev.js` (the `claude -p` spawn + `buildSubprocessEnv` + the `MMD_AUTODEV_CMD` fake seam) — the tester call mirrors the coder call.
2. Keep `manifest.js`, `tester-prompt.js`, `blast-radius.js` PURE with injected fs (mirror the dream-catcher / handover injection style) so tests need no real claude/fs.
3. The integration test fake (`MMD_AUTODEV_CMD`) must distinguish the **tester** call (writes a file into the sealed dir) from the **coder** call (a "good" coder leaves the sealed file; a "tamper" variant edits it). Branch on a marker in the prompt, like the dream-catcher `fake-claude-elicit.sh` branches on mode.
4. Tamper = any `tampered`/`removed` entry from `verifyManifest` → non-zero exit + named files; never auto-mark the slice done. Honest on every failure (§VI) — tester-failed / empty-seal / git-error are explicit, not a silent pass.
5. Sealed tests live under a dedicated dir (e.g. `test/sealed/` in the generated demo, or `<demoDir>/.mmd/shared/sealed-tests/`) — pick one and keep it out of the coder's writable surface in the prompt.
6. Constitution bindings: universal (§VI, §VII), ai-coding, commit-git, **testing** (this slice is about test integrity), error-handling, security, documentation.

## 6. Definition of done
1. All 6 ACs met.
2. Full suite passes (current 1309 + new tests).
3. `mmd --sealed "<dream>"` runs tester→seal→coder→verify→re-run→blast; a tampered sealed file → non-zero exit naming it; a clean run → sealed tests pass + blast radius in status.json; the default path is unchanged.
4. README + ADR-026 + L-023 in place.
5. Version bumped to `0.4.0`.
6. Slice merged (ff-only) + tag `v0.4.0`.
7. 20th reflexive use of `mmd --here` (7th with `--label`). Bundle B's independent oracle now guards against the agent-rewrites-the-test failure — the first correctness hardening of MMD's auto-dev, opt-in via `--sealed`; `--here`/Standard adoption + AST blast radius follow.

---

*Spec v0.4.a — Bundle B sealed-test oracle: an opt-in `mmd --sealed` two-phase flow (tester writes blind acceptance tests → MMD seals by hash → coder implements against a read-only sealed dir → MMD verifies the seal + re-runs it as an independent oracle) + a blast-radius stub. MMD-layer enforcement (the BMAD workflow is gitignored). The v0.4 Orchestrator/auto-handoff is deferred to the v0.5 Conductor (blocked by `claude -p` token opacity).*
