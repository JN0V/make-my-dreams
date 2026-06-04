# Make My Dreams — v0.8.0 Spec: the Test Curator goes POLYGLOT (adapter architecture)

> **Correctness failure being fixed.** The Test Curator (`mmd test-health`, v0.7.6–v0.7.8) is hard-wired to JavaScript: it detects `test()`/`it()` calls, the MMD-specific `@smoke/@unit/...` tag convention, `import`/`require` module syntax, and brace-matched bodies. On a **Rust / Python / C / Go / React** repo it would find ~nothing or fabricate garbage — a direct violation of MMD's mission (work on **any** technology) and of the brand-new **constitution §VIII (technology-agnostic analysis)**. This slice makes the Test Curator polyglot, and **proves it** with a real second-language adapter.
>
> **The fix = adapter architecture** (MMD's "orchestrate, don't reimplement" philosophy): a **generic core** (redundancy math, clustering, thresholds, report) that knows NOTHING about any language, plus per-technology **adapters** that discover tests in their ecosystem and normalize them into one shape the core consumes. The existing JS logic becomes the **JS adapter** — one adapter, not *the* tool. A **language-detection gate** picks the matching adapter(s) for the target repo; an **unsupported stack is refused HONESTLY** (`no Test Curator adapter for <stack> yet`) — never analyzed with the wrong language's rules (the §VIII / §VI detect-and-refuse rule). And a real **Python adapter** ships in this slice so genericity is demonstrated, not promised.
>
> Coverage stays **out of this slice** (it was about to be built JS-specific via `node --test`; per §VIII it must be polyglot — each adapter's native coverage tool → lcov/cobertura — a follow-up once the adapter model exists).

---

## 1. Goal of v0.8.0

```
mmd test-health  →  detect the target's stack(s)  →  run the matching adapter(s)  →  generic core → report

  JS repo (package.json)      → JS adapter      → same report as today (byte-for-byte for MMD itself)
  Python repo (pyproject/…)   → Python adapter  → tests discovered, clustered, stratified
  JS + Python repo            → BOTH adapters   → aggregated corpus
  Rust repo (Cargo.toml)      → no adapter yet  → HONEST refusal: "no Test Curator adapter for Rust yet
                                                   (supported: JavaScript/TypeScript, Python). Not analyzing —
                                                   running the JS scanner on Rust would fabricate numbers (§VIII)."
```

Deliverables:
1. **Adapter contract + registry** (`lib/test-curator/adapters/`): a documented interface every adapter implements — `id`, `displayName`, `matches(repoSignals)` (does this repo use my stack? — from manifest presence: `package.json`→JS, `pyproject.toml`/`setup.py`/`requirements.txt`→Python, `Cargo.toml`→Rust, `go.mod`→Go, …), `discoverTests({repoRoot, files})` → a normalized array of test entries `{file, line, title, stratum|null, body|null, targets|null}` + per-file metrics, and **capability flags** (`supportsBodies` for body-similarity redundancy, `supportsStratification`, `supportsCoverage`). A registry resolves which adapter(s) match a repo.
2. **JS adapter** (`lib/test-curator/adapters/javascript.js`): the EXISTING scan / extract-bodies / `@`-tag / target logic, moved behind the contract — **no behavior change for a JS repo** (running `mmd test-health` on MMD itself produces the same report — asserted). The `@smoke/@unit/...` convention, `import`/`require`, brace-bodies, `node --test` assumptions live HERE, not in the core.
3. **Generic core** (`lib/test-curator/{redundancy,report}.js` + scan orchestration): operates ONLY on the normalized adapter output, with **zero language assumptions**. Stratification is generic (the core counts strata; the *stratum value* comes from the adapter — JS from `@`-tags, others from their own convention or `null`). When an adapter lacks a capability (e.g. no `body` extractor → no near-duplicate pairs), the core **honestly notes it's unavailable for that stack** rather than silently empty (§VI).
4. **Honest language gate** (§VIII): the subcommand detects the stack(s); runs every matching adapter and aggregates; if **no adapter matches**, it **refuses with a clear message** naming the detected stack + the supported list — exit non-zero, NO garbage report. (A repo with a mix runs the supported adapters and notes the unsupported ones.)
5. **Python adapter** (`lib/test-curator/adapters/python.js`) — the **proof of genericity**: discovers pytest/unittest tests (`def test_*` functions, `class Test*` methods) in `.py` test files, extracts project-module targets (`import x` / `from x import …` resolving under the repo), derives a stratum where a convention exists (pytest markers like `@pytest.mark.smoke`, else `null`), and declares its capability flags honestly (e.g. body-similarity may be `false` for v1 — indentation bodies are a separate extractor — so the core reports clustering + stratification for Python and notes redundancy-pairs as "not available for the Python adapter yet"). This makes `mmd test-health` produce a real, honest report on a **Python** repo — demonstrating the core is language-neutral.
6. **Docs + ADR**: the adapter architecture + the §VIII compliance, the JS-was-the-bug story, the capability-flag honesty model, coverage deferred-but-polyglot.

**Mission validation**: `mmd test-health` on MMD (JS) → identical report to v0.7.8. On a fixture **Python** repo (`def test_*` files + pytest markers) → a real report (tests discovered, stratified, clustered; redundancy honestly marked unavailable). On a fixture **Rust** repo (`Cargo.toml` + `#[test]`) → an **honest refusal**, not a fabricated zero-or-garbage report. The JS-only blindness is gone; adding Rust/Go/etc. is a new adapter, not a rewrite.

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: adapter contract + registry (stack-agnostic core boundary)
**Given** a repo's signals (which manifests are present)
**When** the registry resolves adapters
**Then**: there is a documented adapter interface (`id`, `displayName`, `matches(signals)`, `discoverTests({repoRoot, files})` → normalized entries `{file, line, title, stratum|null, body|null, targets|null}` + per-file metrics, capability flags `supportsBodies`/`supportsStratification`/`supportsCoverage`); the registry returns ALL adapters whose `matches` is true (a polyglot repo → multiple), and `[]` when none match. Pure where possible (detection from a passed-in signal set / injected fs).
Tag: `@unit` (registry resolves JS-only, Python-only, both, none).

### AC-2: JS adapter — no behavior change for a JS repo
**Given** the MMD repo (JavaScript)
**When** `mmd test-health` runs through the JS adapter
**Then**: the report is **the same** as v0.7.8 (the JS adapter wraps the existing scan/extract/tag/target logic — assert the corpus counts, stratification, untagged, redundancy pairs, and clusters are unchanged on MMD itself). All JS-specific assumptions (`test()/it()`, `@`-tags, `import`/`require`, brace bodies) live in `lib/test-curator/adapters/javascript.js`, NOT in the core.
Tag: `@integration` (MMD self-run report unchanged) + `@unit` (JS adapter discovers JS fixtures).

### AC-3: generic core — zero language assumptions
**Given** normalized test entries from ANY adapter
**When** the core (redundancy + report) runs
**Then**: it computes stratification counts, untagged (entries with `stratum===null`), oversized files, near-duplicate pairs (ONLY for adapters with `supportsBodies`), and target clusters — referencing NO language syntax. An adapter without a capability → the core renders an honest "not available for the <stack> adapter" note for that section (never a silent empty that reads as "clean"). The core has no `import` of any adapter (dependency points core ← adapters, not the reverse).
Tag: `@unit` (core on synthetic normalized entries from a fake adapter; capability-absent → honest note).

### AC-4: honest language gate — refuse, never fake (§VIII / §VI)
**Given** a target repo
**When** `mmd test-health` runs
**Then**: it detects the stack(s), runs every matching adapter, aggregates the corpus, and the report names which stacks were analyzed; when **no** adapter matches the detected stack, it **refuses honestly** — a clear message naming the detected stack and the supported list, **non-zero exit, no report file written / no fabricated numbers**. A mixed repo runs supported adapters and notes the unsupported ones. (This is the rule that would have stopped the JS-only bug.)
Tag: `@integration` (fixture Rust repo → honest refusal, no garbage; fixture JS repo → analyzed; mixed → supported analyzed + unsupported noted).

### AC-5: Python adapter — genericity PROVEN on a non-JS stack
**Given** a Python repo (pytest/unittest)
**When** `mmd test-health` runs
**Then**: the Python adapter discovers tests (`def test_*` functions + `unittest` `class Test*` methods) with file/line/title, derives `stratum` from pytest markers where present else `null`, extracts project-module `targets` (imports resolving under the repo), and declares its capability flags; the core produces a **real, honest report** for the Python repo — stratification + clustering present, redundancy-pairs honestly marked unavailable if `supportsBodies` is false. A genuinely non-JS repo yields a genuine analysis, proving the core is language-neutral.
Tag: `@integration` (fixture Python repo → tests discovered + clustered + honest capability notes) + `@unit` (Python adapter discovery on fixtures).

### AC-6: docs + ADR
**Given** v0.8.0 ships
**When** docs are read
**Then**: a new ADR documents the polyglot adapter architecture — the JS-only bug it fixes, constitution §VIII compliance, the contract + capability-flag honesty model, detect-and-refuse on unsupported stacks, and that coverage is deferred-but-will-be-polyglot (native tool per adapter → lcov). `README.md` + `CLAUDE.md` update the Test Curator description (polyglot via adapters; supported stacks; honest refusal otherwise). `mmd document-readme --tests N` + `mmd handover --tests N` refresh the mechanical blocks.
Tag: `@unit` anchors.

---

## 3. Architecture (incremental)

```
lib/test-curator/
  adapters/
    index.js          NEW — the contract + registry (resolveAdapters(signals) → adapter[])
    javascript.js     NEW — the EXISTING scan/extract-bodies/@-tag/target logic, behind the contract (no behavior change)
    python.js         NEW — pytest/unittest discovery + targets + marker-stratum (proof of genericity)
  scan.js             REFACTOR — JS-specific bits move into adapters/javascript.js (or it becomes the JS adapter's internals)
  extract-bodies.js   MOVE/REUSE — becomes JS-adapter-internal (brace bodies + JS imports are a JS concern)
  redundancy.js       KEEP generic — operates on normalized entries (no JS syntax); honors capability flags
  report.js           KEEP generic — renders strata/untagged/oversized/redundancy/clusters from normalized data + honest capability notes
bin/test-curator/test-health.js  MODIFY — detect stack(s) via signals, resolve adapter(s), aggregate, or HONEST refuse if none; write report
docs/adr/0NN-*.md     NEW — polyglot Test Curator adapter architecture (§VIII)
README.md / CLAUDE.md / HANDOVER.md / package.json  MODIFY — 0.8.0
```

### Files modified / added
```
make-my-dreams/
├── lib/test-curator/adapters/{index,javascript,python}.js   # NEW — contract + registry + 2 adapters
├── lib/test-curator/{scan,extract-bodies}.js                # refactor — JS bits become JS-adapter-internal
├── lib/test-curator/{redundancy,report}.js                  # keep generic — capability-flag aware
├── bin/test-curator/test-health.js                          # modified — detect/resolve/aggregate/honest-refuse
├── test/unit/test-curator-adapters.test.js                   # NEW — AC-1 registry + AC-2/AC-5 adapter discovery
├── test/integration/test-health-polyglot.test.js              # NEW — AC-4 (Rust refuse) + AC-5 (Python report) + AC-2 (JS unchanged)
├── docs/adr/0NN-polyglot-test-curator.md                      # NEW
├── README.md / CLAUDE.md / HANDOVER.md                        # modified
└── package.json                                              # modified — 0.8.0
```

---

## 4. Out of scope for v0.8.0 (→ follow-ups)
- ❌ **Coverage** — deferred, and when built it MUST be polyglot per §VIII (each adapter runs its native coverage tool → parse lcov/cobertura in a shared parser). NOT `node --test` baked into the core.
- ❌ **More adapters** (Rust, Go, C, …) — the architecture makes each a small new file; ship JS + Python now (Python proves genericity), add others on demand. Until then they hit the honest refusal.
- ❌ **Python body-similarity redundancy** — indentation-body extraction is a separate extractor; the Python adapter may declare `supportsBodies:false` for v1 (clustering + stratification still work; redundancy honestly marked unavailable).
- ❌ **Retrofitting blast-radius / coherence-graph / doc-refs to polyglot** — they are ALSO JS-specific (flagged in HANDOVER under §VIII); separate slices. This slice fixes the Test Curator (the one the user hit).
- ❌ **Scale assumption**: a handful of stacks per repo; discovery is a bounded scan per adapter.

## 5. Implementation hints (for auto-dev)
1. Read this SPEC + constitution **universal §VIII** (the rule this enforces) + the existing `lib/test-curator/{scan,extract-bodies,redundancy,report}.js` and `bin/test-curator/test-health.js`. The refactor must keep the JS path's output identical (AC-2 is the regression lock).
2. Dependency direction: **core ← adapters** (the core must not import any adapter; the subcommand wires the registry). Adapters normalize to the shared entry shape; the core never sees a language token.
3. Capability flags are the honesty mechanism (§VI): an adapter that can't extract bodies sets `supportsBodies:false`; the report says "redundancy pairs: not available for the <stack> adapter" — never an empty section that reads as "no duplicates."
4. The honest refusal (AC-4) is the heart of the §VIII fix: detect the stack, and if unsupported, print the detected stack + supported list and exit non-zero WITHOUT writing a report or emitting numbers. Test it with a Rust fixture (`Cargo.toml` + a `#[test]` file).
5. Reuse `lib/discover`'s stack-detection signals where sensible (manifest presence), but keep the adapter `matches()` self-contained + injectable for tests.
6. The Python adapter is the proof — keep it real but minimal: `def test_*` + `unittest.TestCase` method discovery, `import`/`from` project-target extraction, pytest-marker stratum else null. A fixture Python repo in the tests must yield a genuine (non-empty, honest) report.
7. Operational rules for the slice launch: `MMD_TIMEOUT_MS=0`, commit incrementally per AC, spec-frozen directive; do NOT cite a to-be-created `docs/adr/*.md` path literally.
8. Constitution bindings: universal (**§VIII the headline**, §I SRP — core vs adapters, §II KISS, §VI honesty — capability flags + detect-and-refuse, §VII readable refusal/notes), ai-coding, commit-git, testing (tag every test; red-green; JS-unchanged regression lock + Python + Rust-refuse fixtures), error-handling, documentation, brownfield (polyglot is the brownfield mission).

## 6. Definition of done
1. All 6 ACs met (AC-2 JS-unchanged + AC-4 honest-refuse + AC-5 Python-proof are the gates).
2. Full suite passes (current 1754 + new tests).
3. `mmd test-health` on MMD (JS) → byte-for-byte the v0.7.8 report. On a fixture Python repo → a real honest report. On a fixture Rust repo → an honest refusal, no garbage.
4. The core (`redundancy.js`, `report.js`) imports NO adapter and contains NO language syntax; all JS assumptions are inside `adapters/javascript.js`.
5. README + CLAUDE.md + the new ADR in place; `mmd document-readme --tests N` + `mmd handover --tests N` run (drift green).
6. Version bumped to `0.8.0`.
7. Slice merged (ff-only) + tag `v0.8.0`.
8. The Test Curator is technology-agnostic per §VIII — proven on Python, honest on the unsupported. The same §VIII reckoning is queued for blast-radius / coherence-graph / doc-refs, and coverage will be built polyglot. MMD's analysis tooling stops being secretly JavaScript-only.

---

*Spec v0.8.0 — the Test Curator goes polyglot: a language-neutral core + per-technology adapters (JS refactored in place with zero behavior change, a real Python adapter proving genericity), an honest detect-and-refuse gate for unsupported stacks (constitution §VIII / §VI), capability-flag honesty for partial adapters. Coverage deferred but will be polyglot. Fixes the JS-only Test Curator correctness failure.*
