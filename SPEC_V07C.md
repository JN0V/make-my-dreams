# Make My Dreams — v0.7.c Spec: the Documentalist compacts — SPEC archival (`mmd document-compact`)

> The Documentalist can now **detect** (v0.7.a roadmap gaps + doc-health) and **check truth** (v0.7.b per-claim drift). v0.7.c gives it its first **action**: §6.4.3 *active compaction*. Its own dashboard already names the job — **34 `SPEC_V*.md` files sprawled at the repo root**, the owner's #1 "the docs are becoming incomprehensible" pain. `mmd document-compact` archives them into `docs/specs/` with an index and rewritten references.
>
> Scope is the **lowest-risk, highest-value** compaction first — *act on the safe thing before the hard thing* (the action-side mirror of v0.7.a/b's detect-first caution). Archiving SPEC files is mechanical and fully reversible (`git mv` preserves history); it directly clears the root sprawl. The **higher-risk semantic compaction** — sharding the 6 over-cap docs (`MAKE_MY_DREAMS.md` 1722 lines, etc.), which needs judgment about section boundaries and cross-references — is **deferred** (a later `document-compact` capability), so the Documentalist earns trust on safe relocations before it touches prose structure.
>
> **Built-in self-validation (the v0.7.a/b synergy):** after compaction moves the SPECs, every doc that referenced `SPEC_V0XX.md` would dangle — so the reference rewrite is mandatory, and **the v0.7.b Drift detector is the proof it was complete**: post-compaction, `mmd document-review` must show **no new dangling SPEC references**. Detection guards the action.
>
> Safety contract: `document-compact` only **moves** SPEC files and **rewrites references to them**; it never edits doc *content*, never deletes, is **idempotent** (re-run = no-op once archived), `--dry-run`-able, and fully reversible via git. The live 34-SPEC archival on MMD is the operator's **post-merge** step (AC-4) — so the auto-dev slice never archives its own in-flight `SPEC_V07C.md` mid-build (tests exercise the logic on fixtures).

---

## 1. Goal of v0.7.c

```
$ mmd document-compact --dry-run
  Would archive 34 SPEC_V*.md → docs/specs/ (git mv), write docs/specs/INDEX.md,
  and rewrite N references across K tracked markdown files. Nothing changed (dry-run).

$ mmd document-compact
  Archived 34 SPEC_V*.md → docs/specs/ (history preserved via git mv)
  Wrote docs/specs/INDEX.md (34 entries, newest-first)
  Rewrote N references (SPEC_V0XX.md → docs/specs/SPEC_V0XX.md) across K files
  Root SPEC sprawl resolved. Run `mmd document-review` to confirm no dangling refs.

$ mmd document-compact          # idempotent
  Nothing to archive — no SPEC_V*.md at the repo root. (no-op)
```

Deliverables:
1. **Pure compaction planner** (`lib/documentalist/compact.js`): given the root `SPEC_V*.md` list (+ existing `docs/specs/`), produce a deterministic plan — `moves[] {src, dst}`, the `INDEX.md` content (one entry per SPEC: filename + parsed version + the SPEC's title line, newest-first), and the reference rewrites. Pure, no I/O, never throws.
2. **`mmd document-compact` subcommand** (`bin/documentalist/document-compact.js`): executes the plan — `git mv` each root SPEC into `docs/specs/` (preserves history), writes `docs/specs/INDEX.md`, rewrites references (`SPEC_V0XX.md` → `docs/specs/SPEC_V0XX.md`) in tracked markdown. **`--dry-run`** reports the plan without touching anything. **Idempotent** (no root SPECs → no-op; already-prefixed refs never double-prefixed). Moves files + rewrites reference *paths* only — NEVER edits doc prose, NEVER deletes. Dispatch follows the `document-*` contract.
3. **Reference integrity** (validated by the Drift detector): after compaction, no tracked markdown holds a dangling root-level `SPEC_V0XX.md` link to a moved file. Deterministic exact-filename token rewrite, idempotent (never matches an already-`docs/specs/`-prefixed path).
4. **Live operator validation (post-merge)**: `mmd document-compact` on MMD archives the 34 SPECs, the suite stays green, `git log --follow` reaches a moved SPEC's history, and `mmd document-review` reports **no dangling SPEC refs** + drops the sprawl flag. DoD-captured.

**Mission validation**: on a fixture repo with several root `SPEC_V*.md`, `--dry-run` prints the plan and changes nothing; `mmd document-compact` moves them under `docs/specs/`, writes a newest-first `INDEX.md`, rewrites references, and a second run is a clean no-op. On MMD (post-merge): the 34-SPEC root sprawl is gone, history preserved, tests green, and `mmd document-review` confirms **zero dangling SPEC references** (the rewrite was complete) and no longer flags the sprawl. No doc *content* changed.

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: pure compaction planner
**Given** root `SPEC_V*.md` filenames (+ their title lines) and the current `docs/specs/` state
**When** `planCompaction({ specs, existingArchive })` runs
**Then**: it returns `{ moves: [{src, dst}], indexMarkdown, referenceRewrites: [{from, to}] }` — `dst` = `docs/specs/<name>`, `indexMarkdown` lists each SPEC newest-first (filename + parsed version + title line), `referenceRewrites` maps each `SPEC_V0XX.md` token → `docs/specs/SPEC_V0XX.md`. Pure, deterministic, never throws; empty `specs` → empty plan (no-op). Already-archived SPECs (in `existingArchive`, absent at root) are not re-planned.
Tag: `@unit` (several SPECs / none / already-archived).

### AC-2: `mmd document-compact` executes the plan (+ `--dry-run`, idempotent)
**Given** a repo with root `SPEC_V*.md` files
**When** `mmd document-compact` runs (and separately `--dry-run`)
**Then**: it `git mv`s each root SPEC into `docs/specs/` (creating the dir), writes `docs/specs/INDEX.md`, applies the reference rewrites in tracked markdown, and prints a summary. `--dry-run` prints the same plan but changes **nothing** (assert clean tree after). A re-run with no root SPECs is a **no-op** (exit 0). It NEVER edits doc content beyond reference paths, NEVER deletes. A non-git repo / `git mv` failure is reported honestly (non-zero), never half-applied.
Tag: `@integration` (fixture git repo: dry-run no-op · real run moves+indexes+rewrites · second run no-op).

### AC-3: reference integrity (no dangling links, idempotent rewrite)
**Given** tracked markdown referencing root SPECs (`[SPEC_V06A.md](SPEC_V06A.md)`, `see SPEC_V03B.md`, ``[`SPEC_V05C.md`](SPEC_V05C.md#anchor)``)
**When** the reference rewrite runs (and is re-run)
**Then**: every moved SPEC's `SPEC_V0XX.md` path token → `docs/specs/SPEC_V0XX.md` (link targets AND prose mentions); an already-`docs/specs/`-prefixed path is unchanged (idempotent — no `docs/specs/docs/specs/`); a SPEC that did NOT move is untouched. Pure exact-token transform. **Cross-check**: a post-compaction `mmd document-review` finds no dangling SPEC reference (the v0.7.b detector validates the rewrite).
Tag: `@unit` (link/prose/anchor/already-prefixed forms) + `@integration` (post-run: no dangling `](SPEC_V` link; drift scan clean for SPECs).

### AC-4: live operator validation on MMD (post-merge) — DoD gate
**Given** merged v0.7.2 on MMD (34 root SPECs)
**When** the operator runs `mmd document-compact`
**Then**: the 34 SPECs move under `docs/specs/` with `INDEX.md`, references are rewritten, **the full suite stays green**, `git log --follow` on a moved SPEC reaches its original history, and `mmd document-review` shows **no dangling SPEC refs** + drops the sprawl flag. No doc *content* changed. Captured in HANDOVER. (Post-merge so the slice never archives its own in-flight `SPEC_V07C.md`.)
Tag: `@e2e` (operator/scripted, documented).

### AC-5: docs + ADR
**Given** v0.7.c ships
**When** docs are read
**Then**: a new ADR documents the Documentalist's first *action* — act-on-the-safe-thing-first (SPEC archival is mechanical/reversible; doc-sharding is deferred semantic work); the move-only/no-content-edit/idempotent/reversible safety contract; the Drift-detector-as-validation synergy; and that new SPECs still get created at root per slice and are archived by a later `document-compact` run (the §6.4 periodic-consolidation model). `README.md` + `CLAUDE.md` document `mmd document-compact` and note that shipped SPECs live under `docs/specs/`. `mmd document-readme --tests N` + `mmd handover --tests N` refresh the mechanical blocks (drift report green).
Tag: `@unit` anchors (ADR/README markers; help-text snapshot).

---

## 3. Architecture (incremental)

```
lib/documentalist/compact.js          NEW — pure planCompaction(...) → {moves, indexMarkdown, referenceRewrites} + the idempotent reference-rewrite transform
bin/documentalist/document-compact.js NEW — subcommand: gather root SPECs → plan → (dry-run? print : git mv + write index + rewrite refs) → summary
bin/mmd.js                            MODIFY — dispatch `document-compact` + USAGE + SUBCOMMANDS
docs/specs/                           NEW (created by the post-merge operator run) — archived SPEC_V*.md + INDEX.md
docs/adr/0NN-*.md                     NEW — Documentalist active-compaction (SPEC archival) ADR
README.md / CLAUDE.md / HANDOVER.md   MODIFY
package.json                          MODIFY — 0.7.2
```

### Files modified / added
```
make-my-dreams/
├── lib/documentalist/compact.js                       # NEW — pure planner + rewrite
├── bin/documentalist/document-compact.js               # NEW — subcommand
├── bin/mmd.js                                           # modified — dispatch + USAGE
├── test/unit/documentalist-compact.test.js              # NEW — AC-1 + AC-3 (planner + rewrite forms)
├── test/integration/document-compact.test.js             # NEW — AC-2/AC-3 (fixture repo: dry-run/run/no-op/integrity)
├── docs/adr/0NN-documentalist-active-compaction.md         # NEW
├── README.md / CLAUDE.md / HANDOVER.md                     # modified
└── package.json                                            # modified — 0.7.2
```
*(`docs/specs/` + the 34 moved SPECs + `INDEX.md` land in the **post-merge operator run** — AC-4 — not the auto-dev slice.)*

---

## 4. Out of scope for v0.7.c (→ later)
- ❌ **Sharding the over-cap docs** (`MAKE_MY_DREAMS.md`, README, HANDOVER, PROBLEMS, BOOTSTRAP, lessons-learned) — semantic, judgment-heavy, cross-ref-fragile. A later `document-compact` capability once SPEC archival is trusted.
- ❌ **Changing the SPEC-creation workflow** — new SPECs keep landing at root per slice; periodic `document-compact` archives them (§6.4 model).
- ❌ **Editing SPEC content / deduping / summarizing** — relocation + reference integrity only, never content rewriting.
- ❌ **The coherence graph** (v0.7.d — derived doc↔code↔ADR traceability + staleness-on-diff). Separate slice, own design conversation.
- ❌ **Scale assumption**: ~34 SPECs + a few hundred references — a small deterministic pass.

## 5. Implementation hints (for auto-dev)
1. Read this SPEC; the v0.7.a/b `lib/documentalist/*` pure-builder style + `bin/documentalist/document-{review,…}.js` for the subcommand/dispatch contract (`bin/mmd.js` dispatch + USAGE + SUBCOMMANDS); `docs/coherence-review.md` (the sprawl flag this slice resolves).
2. Keep `planCompaction` + the reference-rewrite PURE (no fs/git) — the subcommand does the I/O. Parse each SPEC's title line (`# Make My Dreams — vX.Y Spec: …`) for the index entry + version; newest-first by version.
3. Use `git mv` (not fs rename) so history is preserved (AC-4 asserts `git log --follow`). On a non-git repo or `git mv` failure, report honestly + non-zero; never half-apply.
4. The reference rewrite: an exact `SPEC_V\d+[A-Z]?\d?\.md` token → `docs/specs/` prefix, ONLY when not already prefixed (idempotency — guard against `docs/specs/docs/specs/`). Test the tricky forms: `](SPEC_V06A.md)`, `](SPEC_V05C.md#anchor)`, bare prose `SPEC_V03B.md`, ``[`SPEC_V07A.md`](SPEC_V07A.md)``, and an already-prefixed one (untouched).
5. **Do NOT run `mmd document-compact` against the live MMD repo inside the slice** — it would move this slice's own `SPEC_V07C.md` mid-build. Validate on FIXTURE repos in tests; the real 34-SPEC archival is the operator's post-merge step (AC-4).
6. `--dry-run` must be a true no-op (assert clean tree after). Print the plan either way.
7. Operational rules for the slice launch: `MMD_TIMEOUT_MS=0`, commit incrementally per AC, spec-frozen directive; do NOT cite a to-be-created `docs/adr/*.md` or `docs/specs/*.md` path literally (grounding false-trip on output paths) — describe them as "a new ADR in the ADR folder" / "an archive folder under docs/".
8. Constitution bindings: universal (§I SRP — pure planner + thin subcommand, §II KISS — relocation only, sharding deferred, §VI honesty — dry-run truthful, failures reported not half-applied, §VII readable index + summary), ai-coding, commit-git (git mv preserves history — this IS git hygiene), testing (tag every test; red-green; fixtures), error-handling (planner never throws; git failure → honest non-zero), documentation, brownfield.

## 6. Definition of done
1. All 5 ACs met (AC-4 is the live operator gate).
2. Full suite passes (current 1597 + new tests).
3. `mmd document-compact --dry-run` is a true no-op; the real run archives root SPECs → `docs/specs/` + index + reference rewrites; a second run is a clean no-op; no doc content changed.
4. Post-merge operator run on MMD: 34 SPECs archived, history preserved (`git log --follow`), suite green, `mmd document-review` shows no dangling SPEC refs + the sprawl flag gone. Captured in HANDOVER.
5. README + CLAUDE.md + the new ADR in place; `mmd document-readme --tests N` (drift green) + `mmd handover --tests N` run.
6. Version bumped to `0.7.2`.
7. Slice merged (ff-only) + tag `v0.7.2`; then the operator runs the live archival (AC-4) and commits the moved SPECs + index + rewritten refs.
8. 31st reflexive use of `mmd --here`. The Documentalist now **acts**: it detected the SPEC sprawl (v0.7.a), guards the docs' truth (v0.7.b), and clears the sprawl here (v0.7.c) — safe, reversible, idempotent, validated by its own Drift detector. The owner's #1 doc pain (34 files at root) is gone; the harder semantic compaction (sharding the over-cap docs) is the trusted-next step, then the coherence graph (v0.7.d).

---

*Spec v0.7.c — the Documentalist's first action: `mmd document-compact` archives the root `SPEC_V*.md` sprawl into `docs/specs/` with an index and rewritten references — move-only, idempotent, reversible, never editing content, validated by the v0.7.b Drift detector (no dangling refs after). Act on the safe thing first; semantic doc-sharding is the deferred next. The 34-SPEC archival is run live, post-merge, by the operator.*
