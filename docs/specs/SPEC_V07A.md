# Make My Dreams — v0.7.a Spec: the Documentalist's coherence review (`mmd document-review`)

> The docs have become hard to follow: 32 `SPEC_V*.md` files at the repo root, `MAKE_MY_DREAMS.md` at 1722 lines (violating its own §6.4 "200-line cap" rule), a roadmap (§9) whose build order diverged massively from reality — capabilities planned but never built (auto-handoff, Dream Expander, Plan-Review, Bundle A Security, the full Documentalist itself), and no single place that says *what MMD actually is today vs what was designed*. This is exactly the problem `MAKE_MY_DREAMS.md` §6 prescribes the **Documentalist** to solve: *"consolidate more than produce."*
>
> The full Documentalist (event-driven Worker, Diataxis generation, autolearning, active compaction) is large and has two faces: **detect** (§6.4 — coherence review: duplicates, superseded ADRs, drift, length-cap violations, designed-vs-built gaps) and **produce** (§6.3 — Diataxis docs). v0.7.a builds the **detect** face first, and **report-only** (no file moves/deletions yet): it earns trust in the Documentalist's *judgment* before v0.7.b grants it *compaction* powers (archiving SPECs, sharding `MAKE_MY_DREAMS.md`). The project owner's own framing makes this the right first step: the gap audit is a **detection test** — verify the detector before the bulldozer.
>
> Method (the MMD pattern — deterministic core, optional LLM): a **deterministic inventory** of MMD's real surface (subcommands, tags, ADRs, `lib/` modules, per-doc line counts, SPEC sprawl, lesson count) + a **deterministic roadmap reconciliation** (parse the §9 roadmap, match each planned capability against the inventory → built / partial / unbuilt) → a single regenerable **coherence report**. An opt-in `--with-claude` enriches the reconciliation with judgment the keyword heuristic can't reach (mirrors `discover --infer-with-claude`); the deterministic report always works without it. The headline acceptance test: running `mmd document-review` on MMD itself **reproduces the manual gap audit's big rocks** (auto-handoff, Dream Expander, Plan-Review Worker, Bundle A Security, full Documentalist, polymorphic Reality Check) and flags the `MAKE_MY_DREAMS.md` length-cap violation + the 32-SPEC sprawl.

---

## 1. Goal of v0.7.a

```
$ mmd document-review
  Coherence review written to docs/coherence-review.md

  # MMD Coherence Review
  ## Designed vs built (roadmap §9 reconciliation — heuristic)
  | Capability (roadmap) | Version | Signal | Status |
  |---|---|---|---|
  | Dream Catcher conversational | v0.3 | subcmd+lib dream-catcher | ✅ built |
  | Stateless auto-handoff @70%  | v0.4 | monitor only, no handoff | 🟡 partial |
  | Dream Expander (divergent)   | v0.3a| (none)                   | ❌ unbuilt |
  | Bundle A Security            | v0.2b| (none)                   | ❌ unbuilt |
  | Documentalist (full)         | v0.5b| lite only                | 🟡 partial |
  ...
  ## Doc health
  - ⚠️ MAKE_MY_DREAMS.md: 1722 lines (cap 200 per §6.4.4) — split candidate
  - ⚠️ 32 SPEC_V*.md at repo root — sprawl, archive candidate (v0.7.b)
  ## Inventory  (12 subcommands · 33 ADRs · 21 lessons · tags v0.1.0..v0.6.1)
```

Deliverables:
1. **Deterministic inventory** (`lib/documentalist/inventory.js`): a pure-ish gatherer of MMD's documented surface — subcommands (parsed from the CLI dispatch / a known source), git tags, ADR list (from `docs/adr/`), `lib/` module names, per-doc line counts for the key human docs (+ a cap flag), the root `SPEC_V*.md` count, the active-lesson count. Reads the filesystem; never throws (degrades to partial inventory).
2. **Deterministic roadmap reconciliation** (`lib/documentalist/roadmap-reconcile.js`): a pure function that parses the `MAKE_MY_DREAMS.md` §9 roadmap into `{version, capability}` entries and classifies each as **built / partial / unbuilt** by matching its name against the inventory (subcommand / lib-module / ADR-title / tag keyword presence). Honest heuristic — clearly labelled as such, never authoritative.
3. **`mmd document-review` subcommand** (`bin/documentalist/document-review.js`): assembles the coherence report — the designed-vs-built reconciliation table, doc-health flags (length-cap violations, SPEC sprawl), and the inventory summary — writes it to `docs/coherence-review.md` (regenerable, tracked) and prints a summary. **Read-only**: it never moves, deletes, or rewrites any other file. Opt-in `--with-claude` enriches the reconciliation via a `claude -p` pass (graceful fallback to the deterministic report when absent/unparseable — the sacred `uncertain` discipline, never a fabricated verdict).
4. **Self-validation**: running it on MMD reproduces the manual gap audit's big rocks + flags the known doc-health issues. DoD-captured.

**Mission validation**: `mmd document-review` on the MMD repo produces `docs/coherence-review.md` whose reconciliation table marks auto-handoff/Dream-Expander/Plan-Review/Bundle-A/full-Documentalist/polymorphic-Reality-Check as unbuilt-or-partial (matching the hand audit), flags `MAKE_MY_DREAMS.md` over the 200-line cap and the 32-SPEC sprawl, and lists the real inventory (12 subcommands, 33 ADRs, 21 lessons, the tag range). The owner stops re-discovering the gaps — the Documentalist surfaces them on demand. Nothing else in the repo is modified.

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: deterministic inventory
**Given** the MMD repo (or a fixture repo)
**When** the inventory gatherer runs
**Then**: it returns a structured object with the documented surface — `subcommands[]`, `tags[]`, `adrs[]` (number + title), `libModules[]`, `docLineCounts` (per key doc, with a `overCap` flag against a configured cap), `specCount` (root `SPEC_V*.md`), `lessonCount`. It reads the filesystem and **never throws**: a missing dir / unreadable file degrades that field to empty/`null` rather than crashing (error-handling §III). Pure given an injected reader where practical (testable on fixtures).
Tag: `@unit` (fixture repo) + `@integration` (real inventory on MMD non-empty).

### AC-2: deterministic roadmap reconciliation (heuristic, honest)
**Given** the `MAKE_MY_DREAMS.md` §9 roadmap text + an inventory object
**When** `reconcileRoadmap({ roadmapText, inventory })` runs
**Then**: it parses the `### vX.Y — Title` roadmap headers into `{version, capability}` entries and classifies each **built / partial / unbuilt** by matching the capability against the inventory (subcommand / lib-module / ADR-title / tag keyword signals); the result is a pure, stable transform clearly framed as a **heuristic** (the renderer says so). It MUST classify, at minimum, these as unbuilt-or-partial on today's MMD: auto-handoff@70%, Dream Expander, Plan-Review Worker, Bundle A Security, full Documentalist, polymorphic Reality Check — and these as built: Dream Catcher, `mmd discover`, `mmd serve`, sealed-test oracle, the Conductor notification/monitor bricks. Malformed roadmap / empty inventory → degrades sensibly (everything "unknown"), never throws.
Tag: `@unit` (exhaustive: a fixture roadmap + crafted inventories; assert the known built/unbuilt classifications).

### AC-3: `mmd document-review` writes the coherence report, read-only
**Given** the `mmd document-review` subcommand
**When** it runs (with and without `--with-claude`)
**Then**: it assembles the report (reconciliation table + doc-health flags [length-cap violations, SPEC sprawl] + inventory summary), writes `docs/coherence-review.md` (regenerable; a header states it is generated + how to refresh), and prints a short summary. It is **strictly read-only beyond that one file** — it never moves, deletes, or edits any other file (assert: no other path under the repo changes across a run). `--with-claude` adds an LLM reconciliation-enrichment block; when `claude` is absent, errors, or returns an unparseable reply, it falls back to the deterministic report with an honest note (never a fabricated enrichment). The dispatch follows the existing `document-*` subcommand contract (exit-code + help-text parity).
Tag: `@integration` (run → file written, only that file changed, `--with-claude` fallback path via an injected/`MMD_*_CMD` seam).

### AC-4: self-validation on MMD (the detection test) — DoD gate
**Given** the MMD repo at v0.7.0
**When** `mmd document-review` runs there
**Then**: `docs/coherence-review.md` reproduces the manual gap audit's big rocks (auto-handoff, Dream Expander, Plan-Review, Bundle A Security, full Documentalist, polymorphic Reality Check classified unbuilt/partial), flags `MAKE_MY_DREAMS.md` over the 200-line cap and the 32-SPEC root sprawl, and lists a correct inventory (subcommand count, ADR count, lesson count, tag range matching reality). Captured in HANDOVER as the validation that the Documentalist's *detection* is trustworthy — the prerequisite for granting it *compaction* in v0.7.b.
Tag: `@e2e` (scripted/manual, documented — judgment comparison against the known audit).

### AC-5: docs + ADR
**Given** v0.7.a ships
**When** docs are read
**Then**: a new ADR documents the Documentalist's first slice — detect-before-act (why report-only first: validate judgment before granting compaction), the deterministic-inventory + heuristic-reconciliation method (+ opt-in `--with-claude`), and that v0.7.b will add active compaction (archive SPECs, shard `MAKE_MY_DREAMS.md`) once detection is trusted. `README.md` + `CLAUDE.md` document `mmd document-review`. `mmd document-readme --tests N` + `mmd handover --tests N` refresh the mechanical blocks (and `document-readme`'s drift report must stay green — the new subcommand is documented).
Tag: `@unit` anchors (ADR/README markers; help-text snapshot).

---

## 3. Architecture (incremental)

```
lib/documentalist/inventory.js         NEW — pure-ish gather: subcommands/tags/ADRs/libModules/docLineCounts/specCount/lessonCount
lib/documentalist/roadmap-reconcile.js NEW — pure parse §9 + classify built/partial/unbuilt (heuristic)
lib/documentalist/coherence-report.js  NEW — pure render: inventory + reconciliation + doc-health → markdown
bin/documentalist/document-review.js   NEW — subcommand: gather → reconcile → render → write docs/coherence-review.md + summary;
                                       --with-claude opt-in enrichment (injected spawn; graceful fallback)
bin/mmd.js                             MODIFY — dispatch `document-review` (mirror the document-* contract + USAGE line)
docs/coherence-review.md               NEW (generated) — the living designed-vs-built + doc-health dashboard
docs/adr/0NN-*.md                      NEW — Documentalist coherence-review ADR (detect-before-act)
README.md / CLAUDE.md / HANDOVER.md    MODIFY
package.json                           MODIFY — 0.7.0
```

### Files modified / added
```
make-my-dreams/
├── lib/documentalist/{inventory,roadmap-reconcile,coherence-report}.js   # NEW (pure cores)
├── bin/documentalist/document-review.js                                   # NEW — subcommand
├── bin/mmd.js                                                              # modified — dispatch + USAGE
├── test/unit/documentalist-inventory.test.js                               # NEW — AC-1
├── test/unit/documentalist-roadmap-reconcile.test.js                        # NEW — AC-2
├── test/unit/documentalist-coherence-report.test.js                         # NEW — render
├── test/integration/document-review.test.js                                 # NEW — AC-3 (write + read-only + --with-claude fallback)
├── docs/coherence-review.md                                                 # NEW (generated, tracked)
├── docs/adr/0NN-documentalist-coherence-review.md                           # NEW
├── README.md / CLAUDE.md / HANDOVER.md                                       # modified
└── package.json                                                              # modified — 0.7.0
```

---

## 4. Out of scope for v0.7.a (→ v0.7.b and beyond)
- ❌ **Active compaction** — archiving the 32 SPECs into `docs/specs/` + index, sharding `MAKE_MY_DREAMS.md`, deleting/shortening obsolete sections. **v0.7.b** (granted once detection is trusted). v0.7.a only *reports* these as candidates.
- ❌ **Diataxis doc generation** (`docs/{tutorials,how-to,reference,explanation}` from the code — §6.3 "produce" face) — **v0.7.c+**.
- ❌ **Event-driven triggering** (auto-run on `slice_done`/`error_fixed`) — v0.7.a is manual (`mmd document-review`). Event wiring later.
- ❌ **Autolearning reuse-counter / promotion-after-5 / 6-month archival** (§6.5 full) — a separate concern from doc coherence; not this slice.
- ❌ **gStack `/document-generate` orchestration** — the deterministic native path ships first; gStack delegation is a later option.
- ❌ **Scale assumption**: one repo, a few dozen docs/roadmap entries — a small scan. The reconciliation is a bounded keyword match, no performance concern.

## 5. Implementation hints (for auto-dev)
1. Read this SPEC; `MAKE_MY_DREAMS.md` §9 (the `### vX.Y — Title` roadmap headers to parse) and §6.3/§6.4 (Diataxis + anti-proliferation, incl. the 200-line cap); the `document-*` subcommand family for the dispatch contract (`bin/documentalist/document-readme.js`, `bin/mmd.js` dispatch ~line 1318 + USAGE ~line 74); and `lib/handover/` / `lib/documentalist/` existing pure-builder style.
2. Keep the three `lib/documentalist/*` modules PURE (inventory takes an injected reader where it helps; reconcile + report are pure transforms) so the suite tests them on fixtures without fs. The subcommand does the I/O (gather → write the one file).
3. `reconcileRoadmap` is a heuristic — the renderer MUST label it so ("heuristic — matched roadmap capability names against the built inventory; not an authoritative audit"). Use a small signal map per capability (keywords → look in subcommands/lib/ADR-titles/tags). Conservative: when no signal, classify `unbuilt` (the honest default for "we can't find it"), `partial` when a weak/related signal exists (e.g. monitor exists but not handoff).
4. Read-only contract is the safety heart: `document-review` writes EXACTLY `docs/coherence-review.md` and nothing else. Add an integration assertion that no other tracked path changed across a run.
5. `--with-claude`: opt-in, injected spawn (an `MMD_*_CMD` seam like the others). On absent/non-zero/unparseable → deterministic report + an honest "(LLM enrichment unavailable)" note. NEVER fabricate classifications.
6. The generated `docs/coherence-review.md` carries a header: generated by `mmd document-review`, regenerate after material change — it is a dashboard, not hand-maintained.
7. Operational rules apply to the **launch of this slice** (an `mmd --here` run): `MMD_TIMEOUT_MS=0`, commit incrementally per AC, spec-frozen directive, do NOT cite a to-be-created `docs/adr/*.md` path literally (describe it as "a new ADR in the ADR folder"). Note: `docs/coherence-review.md` is a `.md` under `docs/` that the slice CREATES — describe it as "a generated coherence report under docs/" rather than citing the literal path, to avoid the grounding false-trip on output paths.
8. Constitution bindings: universal (§I SRP — three small pure modules + one subcommand, §II KISS — deterministic core, LLM opt-in, §VI honesty — heuristic labelled, read-only, no fabricated enrichment, §VII readable report + capability names), ai-coding, commit-git, testing (tag every test; red-green; fixtures for the pure cores), error-handling (inventory never throws; --with-claude graceful fallback), documentation (this IS the doc tool — exemplary docs), brownfield.

## 6. Definition of done
1. All 5 ACs met (AC-4 is the detection gate).
2. Full suite passes (current 1523 + new tests).
3. `mmd document-review` on MMD writes `docs/coherence-review.md` that reproduces the manual gap audit's big rocks + flags the doc-health issues + lists a correct inventory; nothing else in the repo changed by the run.
4. `--with-claude` enriches when available and falls back honestly when not.
5. README + CLAUDE.md + the new ADR in place; `mmd document-readme --tests N` (drift green — the new subcommand is documented) + `mmd handover --tests N` run.
6. Version bumped to `0.7.0`.
7. Slice merged (ff-only) + tag `v0.7.0`.
8. 29th reflexive use of `mmd --here`. The Documentalist exists — first as a **detector**: it can now tell the owner, on demand, what MMD designed vs what MMD became, and where the docs have drifted. v0.7.b will let it *act* on what it found (archive the SPEC sprawl, shard the oversized docs) now that we can trust what it sees.

---

*Spec v0.7.a — the Documentalist's coherence review: `mmd document-review` produces a regenerable designed-vs-built + doc-health dashboard (`docs/coherence-review.md`) from a deterministic inventory + a heuristic roadmap reconciliation (opt-in `--with-claude` enrichment). Report-only — detection earns trust before v0.7.b grants compaction. Its acceptance test is reproducing the manual gap audit.*
