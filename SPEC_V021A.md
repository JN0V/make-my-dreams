# Make My Dreams — v0.21.0 Spec (slice v0.21.a): the Documentalist detects + ACTS — MOVE the surplus, DELETE the false/deprecated

> *(Sébastien, 2026-06-06, after auditing the live README: "même les infos sont fausses ! comment le documentaliste peut-il être passé à côté d'un truc aussi visible ?" The README claims "MMD adds local parallelization via git worktrees" — UNBUILT (Conductor step D, deferred) — still teaches the now-deprecated `document-review`/`document-readme`/`document-compact` as primary (39 mentions), and is 918 lines / 4.6× the 200-line cap with a 739-line `## Usage` wall, the changelog inline, and Quick start buried at line 905.)*
>
> **The diagnosis (agreed):** this README is not "what a Documentalist produces badly" — it is **what you get WITHOUT a real Documentalist**. The current one only refreshes marker-bounded mechanical blocks + detects a NARROW drift (dangling refs, counts, a tiny curated deprecated set, version promises). It is **blind to the three defects that matter here**: a prose **capability-lie**, a freshly-**deprecated surface still taught as primary**, and **structure/length**. An "exhaustive audit" over today's check-set would still wave all three through — the muscles don't exist. We add them, and we ACT.
>
> **The action model (Sébastien's correction, the heart of this slice) — TWO operations by the nature of the content:**
> - **Surplus** (true but verbose — a condensation problem): **MOVE** it to a linked sibling file ("see X for details"). Byte-lossless. Nothing true is lost; the landing doc just gets shorter.
> - **False / deprecated / no-longer-current**: **DELETE** it. Not moved — *relocating a lie is pointless*. Removed outright. You cannot lose *true* information by erasing *false* information.
>
> Both are **deterministic** (no `claude` needed). The only safety line is **precision** (the secret-scan/deps-gate shape — *high-confidence gates/acts, uncertain only advises*): a HIGH-confidence detection (a false capability claim, a deprecated-command mention) is **auto-removed when it can be excised cleanly** (a whole line / section / discrete list item — the worktrees case is a list item → clean); a removal that would malform the prose (a falsehood buried mid-sentence) is **FLAGGED for review** rather than mutilating the sentence. Everything runs through git (reversible) and the drift detector re-validates the doc afterward (no new dangling refs, still well-formed).
>
> **§VIII / L-009 — general, not README-hardcoded:** every check + both actions operate on ANY markdown doc in ANY repo, driven by a doc's **role** (a landing/concise doc has a tight budget + gets condensed; a reference doc like `MAKE_MY_DREAMS.md` is *legitimately* long and is NOT condensed). No "shard everything over cap." Deterministic, **precision-first** (v0.7.b — a doc auditor that cries wolf is useless), honest about what it acts on vs flags.

---

## 1. Goal of v0.21.a

```
mmdream document   → the autonomous pass now ALSO:
   DETECTS (deterministic):
     - capability-lies   : a prose present-tense claim of a capability the inventory/roadmap says is UNBUILT
                           (reuses roadmap-reconcile) — e.g. "MMD adds … git worktrees".
     - deprecated surface: a command taught as PRIMARY that the code marks [DEPRECATED]
                           (the set is DERIVED from the real deprecation notices) — e.g. the 39 `document-*`.
     - structure         : role-aware — a CONCISE/landing doc over budget, inline changelog, oversized sections.
   ACTS (deterministic, role-aware, auto-commit; precision-first):
     - MOVE  (surplus, true-but-verbose): extract the over-budget sections + the changelog of a CONCISE-role doc
             into linked siblings (changelog → CHANGELOG.md; big sections → docs/<stem>-<slug>.md), leaving a link.
             Byte-lossless (content moved, not rewritten). A REFERENCE-role doc is NOT moved.
     - DELETE (false / deprecated, HIGH-confidence + cleanly-excisable): remove the false capability claim /
             the deprecated-as-primary mention outright (whole line / section / list item). A removal that would
             malform prose → FLAGGED for review, not done. Validated after: doc still well-formed, no new dangling refs.
mmdream document --dry-run  → previews the moves + deletions + flags; changes nothing (clean tree).
mmdream document --check    → the gate now also fails on a capability-lie / deprecated-surface finding (teeth).
```

Deliverables:
1. **Capability-lie detection** (`lib/documentalist/conformance.js` + reuse `lib/documentalist/roadmap-reconcile.js`): pure `checkCapabilityClaims({docText, inventory, roadmap})` → `{doc,line,claim,capability,confidence,removable}` where a **present-tense prose claim** of a named capability reconciliation classifies **unbuilt/unknown** is flagged; `confidence:'high'` only for a curated, asserted trigger (the roadmap's unbuilt capability names + known cases like "worktrees parallelization"); a "deferred"/"planned"/"future"/"roadmap" mention is NOT a claim (not-a-claim guard); `removable:true` when the claim is a whole line / discrete list item (cleanly excisable). Pure, never throws, labelled heuristic.
2. **Deprecated-surface-as-primary detection** (`lib/documentalist/conformance.js`): extend `checkDeprecatedSurface` so the deprecated set is **DERIVED from the real `[DEPRECATED]` notices** emitted by the CLI (parse them from the alias dispatch in `bin/mmd.js` — truth over a hand list; `document-*` included automatically), flag a doc presenting a deprecated command as the **primary** way (recommend-cue-governs, v0.18 `cueGovernsToken`), suppress a "(deprecated alias)"/historical mention, mark `removable`/`confidence`. Pure, never throws.
3. **Role-aware structure assessment** (new pure `lib/documentalist/doc-structure.js`): `assessDocStructure({docPath, docText, role, budget})` → `{overBudget, lineCount, oversizedSections, changelogInline}`. A **role** model (`concise`/`landing` vs `reference`) sets the budget: a landing doc (README) → the §6.4 ~200 cap; a reference doc → exempt. Pure, never throws, labelled heuristic.
4. **The two actions** (pure planners + the I/O in the bin), **precision-first**:
   - **MOVE** — `planExtraction({docPath, docText, role, sections, existingSiblings})` → moves each oversized `##` section + the changelog of a CONCISE-role doc into a linked sibling, leaving a one-line link; **byte-lossless**, **idempotent**, **reversible**, REFERENCE-role never planned.
   - **DELETE** — `planRemovals({docText, findings})` → for each HIGH-confidence + `removable` finding (capability-lie / deprecated-as-primary), a precise removal (whole line / section / list-item excision that fixes the surrounding separators so the sentence stays well-formed); a non-cleanly-excisable finding is RETURNED as `flagged`, not removed. **Idempotent** (already-removed → no-op), **reversible** (git). The bin applies both, **auto-commits** (separate atomic commits: "move surplus" / "remove false-or-deprecated"), and the **drift detector re-validates** (doc well-formed, no new dangling refs). Pure planners, never throw.
5. **Wire into `mmdream document`** (`bin/documentalist/document.js`): a conciseness/correction step runs the structure assessment → the MOVE + the DELETE (role-aware; default-applied, `--dry-run` previews, `--no-commit` honored); the three detections feed the unified report + the `--check` gate (capability-lie / deprecated-surface now fail `--check`). Flagged (non-removable) items are reported, never auto-edited. v0.19 read-only-beyond-its-writes invariants preserved. On MMD itself: README 918 → ~150 (surplus moved), the worktrees lie **removed**, the deprecated `document-*` surface flagged/removed where it is a clean primary-mention.
6. **Docs + ADR + version + live capture**: ADR-060 (the two-operation model — move-surplus / delete-false — the precision-first clean-excise-or-flag rule, role-awareness, why deleting a detected falsehood is not the risky-rewrite category); README updated (it IS the live target — capture before/after line count + that the worktrees lie is gone); CLAUDE.md; mechanical blocks; version → 0.21.0. **AC-live:** run `mmdream document` on MMD and capture README 918→~150 + the worktrees lie **removed** + the deprecated surface handled + no new dangling refs + the doc still well-formed.

**Mission validation**: the exact defects Sébastien spotted are now fixed by the agent itself — the worktrees capability-lie is **deleted**, the deprecated `document-*` surface is removed/flagged, the README is condensed **losslessly** for its true content (changelog → CHANGELOG.md, Usage → docs/usage.md), and a reference doc is correctly left long. The Documentalist keeps docs TRUE (it removes falsehoods, not just flags) and CONCISE (it moves surplus, role-aware) — it acts, precision-first.

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: capability-lie detection (pure, precision-first, removable-aware)
**Given** a doc asserting present-tense a capability the inventory/roadmap classifies unbuilt
**When** `checkCapabilityClaims(...)` runs
**Then**: the claim is flagged with `confidence` + `removable` (the "worktrees" list-item case → high + removable); a "deferred/planned/future" mention is NOT flagged; pure, never throws, no false positive on MMD's true claims (AC-6).
Tag: `@unit` (unbuilt-claimed → flagged high; future-framed → not; list-item → removable; null-safe).

### AC-2: deprecated-surface DERIVED from real notices, flagged/removable when primary
**Given** the CLI emits `[DEPRECATED] … use: mmdream document` for `document-review`/etc.
**When** the check runs over a doc teaching `document-review` as primary
**Then**: it is flagged (set derived from the real notices — `document-*` auto-included); a "(deprecated alias)"/historical mention is suppressed; `removable`/`confidence` set; pure, never throws.
Tag: `@unit` (derived set includes document-*; primary-teach → flagged; alias-note → not).

### AC-3: role-aware structure assessment (pure)
**Given** a CONCISE-role doc over budget + a REFERENCE-role doc legitimately long
**When** `assessDocStructure(...)` runs
**Then**: the concise doc reports overBudget + oversized sections + changelogInline; the reference doc is NOT over budget (role exempt); pure, never throws, labelled heuristic.
Tag: `@unit` (concise over-budget flagged; reference exempt; section sizing correct).

### AC-4: the two actions — MOVE lossless, DELETE the false/deprecated (clean-or-flag)
**Given** a CONCISE-role over-budget doc with a changelog, an oversized section, a high-confidence false list-item claim, and a falsehood buried mid-sentence
**When** `planExtraction(...)` + `planRemovals(...)` run and the bin applies them
**Then**: the changelog → `CHANGELOG.md` and the oversized section → `docs/<stem>-<slug>.md`, each replaced by a link, **byte-identical** (lossless); the false list-item is **removed** with separators fixed (sentence still well-formed); the mid-sentence falsehood is **flagged, NOT removed**; both idempotent; REFERENCE-role untouched; the doc is valid markdown + no new dangling refs after. Pure planners, never throw.
Tag: `@unit`/`@integration` (lossless move; clean removal; messy → flagged; idempotent; reference untouched; well-formed after).

### AC-5: wired into `mmdream document` + `--check` teeth + `--dry-run` preview
**Given** `mmdream document` on a repo with an over-budget concise doc + a capability-lie + a deprecated surface
**When** it runs (default / `--dry-run` / `--check`)
**Then**: default MOVES the surplus + DELETES the high-confidence removable falsehoods/deprecations (atomic auto-commits) + reports the flagged (non-removable) items; `--dry-run` previews + leaves a clean tree; `--check` fails on a capability-lie / deprecated-surface finding; non-removable items are flagged, never auto-edited. v0.19 invariants preserved.
Tag: `@integration` (default moves+deletes+commits+flags; dry-run clean; check fails on the new findings).

### AC-6: docs + live capture
**Then**: ADR-060 lands; README updated + (the live target) condensed to budget with the worktrees lie **removed** — before/after captured; CLAUDE.md; mechanical blocks; version → 0.21.0. Running `mmdream document` on MMD shows README 918→~150 + worktrees lie gone + deprecated surface handled + no new dangling refs + well-formed.
Tag: `@unit`/`@integration` (ADR-060 exists; docs updated; version bumped; live capture recorded).

---

## 3. Out of scope (deferred)

- **LLM prose-beautification** — rewriting true-but-wordy prose tighter (the pitch, a paragraph) is genuine generative improvement; not needed for THIS slice (move + delete are deterministic) and stays a later opt-in. This slice does NOT rewrite prose — it MOVES surplus and DELETES falsehoods, both verbatim-or-excise.
- **Detecting general "obsolete narrative"** beyond the high-confidence categories (false capability-claims, deprecated-surface) — fuzzy; stays flagged, an LLM/heuristic enrichment later.
- **Auto-removing a falsehood buried mid-sentence** (non-cleanly-excisable) — flagged here; a careful surgical rewrite needs the deferred LLM pass.
- **Generic reference-doc sharding** (`MAKE_MY_DREAMS.md`) — role says "leave it"; separate later design.
- **Role inference** — role is heuristic-by-filename for now (README/landing = concise; MAKE_MY_DREAMS/ADR/SPEC = reference); a smart classifier deferred.

## 4. Operational notes for the implementer

- **Two operations, by content nature**: MOVE = surplus-but-TRUE → linked sibling, byte-lossless. DELETE = FALSE/deprecated → removed outright (relocating a lie is pointless). Never rewrite wording — move verbatim or excise.
- **Precision is the only safety line** (secret-scan/deps-gate shape): auto-act ONLY on HIGH-confidence + cleanly-excisable findings; uncertain or messy → FLAG, never mutilate. Re-validate after every action (valid markdown, no new dangling refs) — the drift detector is the oracle. Everything is on git (reversible).
- **Role-aware, not blanket** ([[readme-conciseness-documentalist-role]]): only CONCISE/landing docs are condensed; reference docs left long.
- **Derive, don't hand-curate** (v0.7.d golden rule): the deprecated set from the real `[DEPRECATED]` notices; built/unbuilt from `roadmap-reconcile`/inventory.
- **Deterministic, no `claude`**: detection + move + delete are all computable.
- Pure planners/checkers split from I/O (SRP), never throw. Atomic commits (move / delete separate, L-019). Tag tests per stratum. The README IS the live target — capture before/after.
