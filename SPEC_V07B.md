# Make My Dreams — v0.7.b Spec: the Documentalist checks DRIFT — is the doc still TRUE? (`mmd document-review` conformance)

> The Documentalist's primary value is **not** keeping docs short — it is keeping them **true**: ensuring what was *written* (SPECs, ADRs, README, `MAKE_MY_DREAMS.md`, the roadmap) still **conforms to what was actually built**, and surfacing the **drift** when it doesn't. A short-but-wrong doc is worse than a long-but-right one. (Compaction — archiving the SPEC sprawl, sharding over-cap docs — is the secondary "stay tidy" half, deferred to v0.7.c.)
>
> v0.7.a gave the Documentalist a *roadmap-level* detection (designed-vs-built reconciliation + doc-health). v0.7.b deepens it to **per-claim conformance**: scan the docs for things they *assert exist* and verify each against reality. Mostly deterministic (reuse the v0.7.a inventory + a code-artifact reference extractor) — a dangling reference is unambiguous drift. A bounded fact-conformance pass catches stale counts/versions in prose. An opt-in `--with-claude` adds *semantic* drift judgment (does a SPEC/ADR's description still reflect the code's behavior?) reusing the v0.4.d judge pattern, with the sacred honest fallback.
>
> This is **detect-before-correct**: v0.7.b only **reports** drift (advisory, in `docs/coherence-review.md`). It never rewrites doc prose to "fix" it — auto-correcting content is a high-risk content edit that the Documentalist earns only after its detection is trusted. The owner sees, on demand, exactly where the docs have stopped telling the truth.

---

## 1. Goal of v0.7.b

```
$ mmd document-review
  ...existing sections (Designed vs built · Doc health · Inventory)...

  ## Drift / conformance  (does the doc still match reality?)
  ### Dangling references (a doc claims an artifact that does not exist)
  - ⚠️ docs/adr/021-...md:42 → `lib/dream-catcher/elicit.js` — file not found (renamed/removed?)
  - ⚠️ HANDOVER.md:118 → `mmd discover --approve` ✓ · `bin/foo.js` ✗ not found
  - ⚠️ README.md:88 → ADR-099 — no docs/adr/099-*.md
  ### Stale facts (a prose claim disagrees with the live inventory)
  - ⚠️ README.md:31 says "30 ADRs" — inventory has 35
  - ⚠️ CLAUDE.md:60 says "v0.5.2" as current — latest tag is v0.7.0
  (heuristic — advisory only; the Documentalist flags drift, it does NOT edit your docs)
```

Deliverables:
1. **Code-artifact reference extractor** (`lib/documentalist/doc-refs.js`): a pure function that pulls, from a doc's text, the artifacts it *claims exist* — code file paths (`lib/…`, `bin/…`, `test/…`, `docs/…/*.md`), subcommand mentions (`mmd <name>`), `ADR-NNN` numbers, and `lib/` module names. Distinct from the grounding extractor (`lib/here-mode/extract-file-refs.js`, which is input-focused and intentionally ignores `.js`/`.ts`) — this one targets code artifacts to verify they still exist. Pure, line-aware (reports line numbers), never throws.
2. **Conformance checker** (`lib/documentalist/conformance.js`): pure functions `checkArtifactConformance({ docRefs, inventory, fileExistsFn })` → dangling references `{doc, line, ref, kind, reason}`, and `checkFactConformance({ docs, inventory })` → stale-fact mismatches for **bounded, low-false-positive** claims only — explicit counts (`N subcommands` / `N ADRs` / `N (active) lessons`) and "current/latest version X" claims — compared to the live inventory; conservative (ignore clearly-historical "as of vX" / "in v0.2.x" narrative). Pure, never throws, honestly labelled heuristic.
3. **`mmd document-review` surfaces a "Drift / conformance" section** (`lib/documentalist/coherence-report.js` + the subcommand): the dangling references + stale facts, advisory, **flag-only — never edits any doc**. The opt-in `--with-claude` extends to *semantic* drift (read a SPEC/ADR + the code it describes → does the description still hold?), honest fallback when absent/unparseable (never a fabricated "conformant"). The report stays strictly read-only beyond `docs/coherence-review.md`.
4. **Live validation on MMD**: the scan runs clean on valid references (no false positives on real file/subcommand/ADR refs) and catches a deliberately dangling reference; any genuine drift on the repo is reported honestly. DoD-captured.

**Mission validation**: `mmd document-review` on MMD now includes a "Drift / conformance" section that (a) flags every doc reference to a code artifact that no longer exists, with file:line, (b) flags prose count/version claims that disagree with the live inventory, and (c) does NOT false-positive on the many valid references — proven by planting one dangling ref in a fixture (caught) and asserting the real repo's valid refs are not flagged. The Documentalist can now tell the owner, on demand, *where the docs have drifted from reality* — without touching a single doc.

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: code-artifact reference extractor (pure, line-aware)
**Given** a doc's text
**When** `extractDocRefs(text)` runs
**Then**: it returns the artifacts the text *claims exist* with line numbers — code file paths under `lib/`,`bin/`,`test/`,`docs/` (incl. `.js`/`.md`), `mmd <subcommand>` mentions, `ADR-NNN` references, and `lib/<module>` names — de-duplicated, each tagged with its `kind`. It is PURE, never throws, and is conservative about what counts as a "claimed artifact" (e.g. inside a fenced code block illustrating *future* paths it should not over-collect — or, if that's hard, it over-collects and the conformance step's allow-list handles it; the SPEC accepts either as long as false positives on the real repo are near-zero per AC-4). Distinct in purpose from the grounding extractor.
Tag: `@unit` (file-path / subcommand / ADR / module forms; multi-line; code-fence handling).

### AC-2: conformance checker — artifacts + bounded facts (pure)
**Given** extracted doc refs + the v0.7.a inventory + a `fileExistsFn`
**When** `checkArtifactConformance(...)` and `checkFactConformance(...)` run
**Then**: artifact conformance returns the refs that **don't resolve** — a file path that doesn't exist, an `mmd <name>` that isn't a real subcommand, an `ADR-NNN` with no `docs/adr/NNN-*.md`, a `lib/<module>` not in the inventory — each `{doc, line, ref, kind, reason}`; valid refs are NOT returned. Fact conformance returns mismatches for **bounded** claims only — explicit `N subcommands`/`N ADRs`/`N (active) lessons` counts and "current/latest version X" — vs the inventory, ignoring historical narrative ("as of v0.2.x"). Both are PURE, deterministic, never throw, and are framed as heuristics. Empty/odd input → empty result.
Tag: `@unit` (dangling vs valid refs; count/version match + mismatch; historical mention NOT flagged).

### AC-3: `document-review` renders the Drift section — flag-only, opt-in LLM
**Given** the `mmd document-review` subcommand
**When** it runs (with and without `--with-claude`)
**Then**: `docs/coherence-review.md` gains a **"## Drift / conformance"** section listing dangling references (file:line) + stale facts, advisory and clearly heuristic, stating the Documentalist flags but never edits docs. It remains **strictly read-only beyond `docs/coherence-review.md`** (assert no other path changes). `--with-claude` adds a *semantic drift* sub-pass (SPEC/ADR description vs the code it cites) via the injected `MMD_DOCUMENT_REVIEW_CMD` seam, falling back honestly (an "(LLM drift check unavailable)" note) when absent/non-zero/unparseable — never a fabricated verdict. Existing sections (designed-vs-built, doc-health, inventory) are unchanged (back-compat).
Tag: `@integration` (run → Drift section present, only the one file changed, `--with-claude` fallback path).

### AC-4: live validation on MMD — precision + recall — DoD gate
**Given** the MMD repo
**When** `mmd document-review` runs
**Then**: the Drift section does **not** false-positive on the repo's many valid references (precision — a spot set of known-good refs to real files/subcommands/ADRs is NOT flagged), and a **deliberately dangling reference** (planted in a fixture doc, or a temp doc in the test) **is** flagged with the right file:line (recall). Any genuine drift discovered on the real repo is reported as-is in HANDOVER (honest — if the repo is clean, say so). This validates the conformance detector is trustworthy before v0.7.c lets the Documentalist *act* (compaction) and any later auto-correction.
Tag: `@e2e`/`@integration` (planted dangling ref caught; real valid refs not flagged).

### AC-5: docs + ADR
**Given** v0.7.b ships
**When** docs are read
**Then**: a new ADR documents the Documentalist's **conformance/anti-drift** mission as the *primary* value (truth over tidiness; compaction is the secondary v0.7.c step), the deterministic artifact + bounded-fact checks (+ opt-in `--with-claude` semantic drift), and detect-before-correct (flag-only; auto-correcting prose is a later, trust-gated step). `README.md` + `CLAUDE.md` note the Drift/conformance section of `mmd document-review`. `mmd document-readme --tests N` + `mmd handover --tests N` refresh the mechanical blocks (drift report green).
Tag: `@unit` anchors (ADR/README markers).

---

## 3. Architecture (incremental)

```
lib/documentalist/doc-refs.js        NEW — pure extractDocRefs(text) → claimed artifacts (file paths/subcommands/ADR-NNN/lib modules) w/ line numbers
lib/documentalist/conformance.js     NEW — pure checkArtifactConformance(...) + checkFactConformance(...) → drift findings
lib/documentalist/coherence-report.js MODIFY — render the new "## Drift / conformance" section (advisory, flag-only)
bin/documentalist/document-review.js MODIFY — gather doc refs across tracked docs → conformance → into the report; --with-claude semantic-drift sub-pass (injected seam, honest fallback)
docs/adr/0NN-*.md                    NEW — Documentalist conformance / anti-drift ADR (truth over tidiness; detect-before-correct)
README.md / CLAUDE.md / HANDOVER.md  MODIFY
package.json                         MODIFY — 0.7.1
```

### Files modified / added
```
make-my-dreams/
├── lib/documentalist/doc-refs.js                          # NEW — pure ref extractor
├── lib/documentalist/conformance.js                        # NEW — pure artifact + fact checks
├── lib/documentalist/coherence-report.js                   # modified — Drift section
├── bin/documentalist/document-review.js                    # modified — gather refs + conformance + --with-claude drift
├── test/unit/documentalist-doc-refs.test.js                 # NEW — AC-1
├── test/unit/documentalist-conformance.test.js               # NEW — AC-2
├── test/integration/document-review-drift.test.js             # NEW — AC-3/AC-4 (Drift section, read-only, planted dangling ref, precision)
├── docs/adr/0NN-documentalist-conformance-drift.md            # NEW
├── README.md / CLAUDE.md / HANDOVER.md                        # modified
└── package.json                                              # modified — 0.7.1
```

---

## 4. Out of scope for v0.7.b (→ later)
- ❌ **Auto-correcting drift** — rewriting doc prose to match reality. High-risk content edit; detect-before-correct. A later trust-gated capability.
- ❌ **Compaction / SPEC archival / doc-sharding** — the "stay tidy" half. **v0.7.c** (the archival SPEC is already drafted; it slides here).
- ❌ **The coherence graph** (derived doc↔code↔ADR traceability + staleness-on-diff) — **v0.7.d** (Sébastien's idea, own design conversation).
- ❌ **Flag-reference conformance** (`--sealed`/`--monitor` etc.) — no clean flag inventory yet; deferred. v0.7.b covers file paths, subcommands, ADR numbers, lib modules.
- ❌ **Unbounded fact-checking of arbitrary prose claims** — only the bounded, low-false-positive set (counts + current-version). Broad NLP claim-checking is the `--with-claude` job, not the deterministic core.
- ❌ **Scale assumption**: a few dozen docs, a few hundred references — a bounded deterministic scan. No performance concern.

## 5. Implementation hints (for auto-dev)
1. Read this SPEC; v0.7.a's `lib/documentalist/{inventory,coherence-report}.js` + `bin/documentalist/document-review.js` (extend, don't fork — the Drift section joins the existing report); `lib/here-mode/extract-file-refs.js` for contrast (grounding extractor is input-focused, ignores `.js` — `doc-refs.js` is the opposite purpose).
2. Keep `doc-refs.js` + `conformance.js` PURE (text/object in, findings out; inject `fileExistsFn`). The subcommand walks the tracked docs (git-tracked `*.md`), extracts refs, runs conformance, feeds the report.
3. Precision is the priority (AC-4): a noisy drift section that cries wolf is useless. When unsure whether a token is a real "claimed artifact", lean toward NOT flagging (conservative) — better to miss a drift than to flag a valid ref. The `--with-claude` pass is where nuance lives.
4. Bounded fact-checks only: match explicit `N subcommands|ADRs|lessons` and "current/latest version X" patterns; explicitly skip historical narrative ("as of vX", "in v0.2.x", "shipped in v0.5.b"). Compare to the inventory from v0.7.a.
5. `--with-claude` semantic drift: opt-in, injected seam, honest fallback (never fabricate "conformant"); reuse the v0.4.d judge discipline (unparseable → honest "unknown", not a pass).
6. Read-only contract holds: `document-review` still writes EXACTLY `docs/coherence-review.md`. Assert no other tracked path changes across a run (incl. the Drift pass).
7. Operational rules for the slice launch: `MMD_TIMEOUT_MS=0`, commit incrementally per AC, spec-frozen directive; do NOT cite a to-be-created `docs/adr/*.md` path literally (describe as "a new ADR in the ADR folder").
8. Constitution bindings: universal (§I SRP — two pure modules + a render extension, §II KISS — deterministic core + opt-in LLM, §VI honesty — flag-only, heuristic labelled, no fabricated conformance, precision-first, §VII readable file:line drift report), ai-coding, commit-git, testing (tag every test; red-green; precision + recall fixtures), error-handling (pure checks never throw; --with-claude graceful), documentation (the doc-truth tool — exemplary), brownfield.

## 6. Definition of done
1. All 5 ACs met (AC-4 is the precision+recall gate).
2. Full suite passes (current 1561 + new tests).
3. `mmd document-review` on MMD produces a "Drift / conformance" section: dangling artifact references (file:line) + bounded stale-fact mismatches, with near-zero false positives on valid refs; a planted dangling ref is caught; only `docs/coherence-review.md` changed.
4. `--with-claude` adds semantic drift when available, falls back honestly when not.
5. README + CLAUDE.md + the new ADR in place; `mmd document-readme --tests N` (drift green) + `mmd handover --tests N` run.
6. Version bumped to `0.7.1`.
7. Slice merged (ff-only) + tag `v0.7.1`.
8. 30th reflexive use of `mmd --here`. The Documentalist now guards **truth**, not just tidiness: on demand it tells the owner where the docs have stopped matching reality (dangling references, stale facts, and — with `--with-claude` — semantic drift). Correcting that drift, and compacting the sprawl, are the trusted-next steps (v0.7.c).

---

*Spec v0.7.b — the Documentalist checks DRIFT: `mmd document-review` gains a deterministic "Drift / conformance" section (dangling artifact references + bounded stale facts, + opt-in `--with-claude` semantic drift) that flags where the docs no longer match what was built. Truth over tidiness; flag-only (detect-before-correct). Compaction is the secondary v0.7.c step.*
