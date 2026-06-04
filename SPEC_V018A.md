# Make My Dreams — v0.18.0 Spec (slice v0.18.a): close the Documentalist's 5 blind-spots

> *(Sébastien: "le documentaliste fait mal son travail." Proven twice — it missed stale install-script text + a stale README promise, and this session it called "Voice mode" 🟡 partial because a v0.11.x tag number matched, though v0.11 was the alignment gate. The Documentalist's whole value is keeping docs TRUE; these gaps let falsehoods through. Close all five — grounded in `bin/documentalist/document-review.js` + `lib/documentalist/{conformance,doc-refs,roadmap-reconcile}.js`.)*
>
> **The 5 gaps (from the blind-spots audit):**
> 1. **Surface is markdown-only** — `CONFORMANCE_TRUTH_DOCS` is README/CLAUDE/HANDOVER/lessons + ADRs. It scans **no `.sh`, no `--help`/USAGE, no printf strings** — exactly where the stale `/bmad-adv-auto-dev` "try this" lived (in `install-mmd.sh` output).
> 2. **Existence ≠ currency** — it flags a dangling ref (cited file deleted) but NOT stale *advice* (a still-existing token recommended as primary when the real surface moved on, e.g. `/bmad-adv-auto-dev` vs `mmdream`). Only reachable via the opt-in `--with-claude`, never routinely run.
> 3. **Fact set too narrow** — `checkFactConformance` covers counts + "current version X", and ignores historical narrative. It misses **version-pinned promises that came due** (README's "License — to be added in **v0.1**" while LICENSE has long existed).
> 4. **No teeth** — detect-only, on-demand, report-only; even drift it CAN see just sits in the dashboard. No gate.
> 5. **Roadmap reconciliation is a false-comfort name-match** — "Parallel Conductor + worktrees v0.9 🟡 partial" (matched on `lib/conductor/` existing) / "Voice mode partial" (matched a v0.11.x tag number) when both are ❌ unbuilt. A misleading "partial" hides a real "unbuilt".
>
> **Through-line:** the Documentalist must detect *more* truth (surface + currency + promises), classify it *honestly* (no false partial), and be *enforceable* (teeth). Stays **deterministic** (no `claude` needed — these are computable), **read-only beyond `docs/coherence-review.md`**, and **precision-first** (a drift report that cries wolf is useless — the v0.7.b discipline).

---

## 1. Goal of v0.18.a

```
mmdream document-review            → richer, HONEST dashboard:
   - roadmap reconciliation no longer claims "partial" on a weak signal (tag-number / generic dir match) →
     a capability with no real NAME match against the surface is honestly "unknown"/"unbuilt", not a false "partial"
   - conformance now scans BEYOND markdown: install-mmd.sh printf + the CLI --help/USAGE text (UX-text drift)
   - deterministic DEPRECATED-SURFACE check: a known-stale token recommended as primary (e.g. `/bmad-adv-auto-dev`
     as the entry point) is flagged — no --with-claude needed
   - version-pinned PROMISES that came due ("to be added in v0.1", "Coming in vX") with current version past vX → flagged
mmdream document-review --check     → exits 1 if any conformance drift (dangling refs / stale facts / stale promises /
   deprecated-surface) is found; same gate shape as secret-scan/deps-gate (0 clean · 1 drift · 2 argv · 5 not-git).
   Writes the dashboard as today; --check ADDS the gate (for pre-push / CI). The plain (no --check) run stays report-only.
```

Deliverables:
1. **Honest roadmap reconciliation** (`lib/documentalist/roadmap-reconcile.js`): stop treating a tag-NUMBER match or a generic `lib/<dir>` existence as evidence of a capability. Classify **built/partial/unbuilt** only on a real **name match** of the capability against the concrete surface (subcommands, lib module names, ADR titles); a weak/no signal → **`unknown`** (honestly "can't tell"), never a falsely-comforting `partial`. The "Voice mode"/"parallel worktrees" false-partials become `unknown`/`unbuilt`. Pure, never throws, clearly-labelled heuristic.
2. **Broaden the conformance surface** (`bin/documentalist/document-review.js` + `lib/documentalist/conformance.js`): scan user-facing strings beyond markdown — `install-mmd.sh` (and sibling scripts') printf/echo output + the CLI `--help`/USAGE text — for the conformance checks (a "UX-text drift" surface). Dangling-ref + the new checks run over this wider surface, not just `CONFORMANCE_TRUTH_DOCS`.
3. **Deterministic deprecated-surface check** (`lib/documentalist/conformance.js`): a pure check flagging a **known-deprecated/stale-advice token** presented as current/primary (config: e.g. `/bmad-adv-auto-dev` recommended as THE entry vs the current `mmdream`/`/mmdream`; a bare `mmd ` command vs `mmdream`). Deterministic (no `--with-claude`), precision-first (only a curated, high-confidence deprecated set; negated/"legacy"/"historical" mentions suppressed like the v0.7.b not-a-claim guard).
4. **Version-pinned-promise check** (`lib/documentalist/conformance.js`): detect promises/TODOs pinned to a version that **came due** — "to be added in `v0.1`", "Coming in `vX`", "TODO by `vX`" where the current version > vX → flagged as a stale promise (the README License case). Bounded + precision-first (only explicit version-pinned future promises, not historical "as of vX").
5. **Teeth — `document-review --check`** (`bin/documentalist/document-review.js` + dispatch/USAGE): a `--check` flag that exits **1** when any conformance drift (dangling refs / stale facts / stale promises / deprecated-surface) is found, **0** when clean — the same gate contract as `secret-scan`/`deps-gate` (argv→2, not-git→5). It still writes `docs/coherence-review.md`; `--check` adds the gate (pre-push/CI). The roadmap **heuristic does NOT gate** (too noisy — advisory only, mirroring deps-gate's "single signals stay advisory"). Plain `document-review` stays report-only + read-only beyond the dashboard (asserted).
6. **Docs + ADR + live capture**: ADR-057 (the 5 gaps + the detect-more/classify-honestly/add-teeth fixes, deterministic + precision-first + read-only, why the heuristic doesn't gate); README + CLAUDE.md + `/mmdream`; mechanical blocks; version → 0.18.0. **AC-live:** run `mmdream document-review` on MMD itself and capture that the false "partial"s are gone (honest unknown/unbuilt) and the new checks surface real findings (or honestly none).

**Mission validation**: the roadmap table no longer shows a falsely-comforting "partial" for an unbuilt capability (Voice/worktrees → unknown/unbuilt); a stale recommendation in `install-mmd.sh`/`--help` (a deprecated primary token) is caught deterministically; a version-pinned promise that came due is flagged; `document-review --check` exits 1 on drift (gateable in CI/pre-push) while the plain run stays advisory + read-only. The Documentalist now detects more truth, classifies it honestly, and can enforce it.

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: honest roadmap reconciliation (no false "partial")
**Given** a roadmap capability whose only "match" is a tag number or a generic dir
**When** `reconcileRoadmap(...)` classifies it
**Then**: it is `unknown` (or `unbuilt`), NOT `partial`; `built`/`partial` require a real capability-NAME match against the concrete surface (subcommands / lib module names / ADR titles); a genuinely half-built compound stays `partial`; pure, never throws, labelled heuristic. The "Voice mode"/"parallel worktrees" cases no longer read `partial`.
Tag: `@unit` (weak tag/dir match → unknown not partial; real name match → built/partial; null-safe).

### AC-2: conformance scans beyond markdown (scripts + --help/USAGE)
**Given** a repo whose `install-mmd.sh` printf or CLI `--help`/USAGE contains a stale user-facing claim
**When** `document-review` runs
**Then**: those surfaces are included in the conformance scan (a "UX-text drift" surface), so a stale string there is reachable (not 100% outside scope as today). Markdown docs still scanned; the wider surface is additive.
Tag: `@unit`/`@integration` (a stale token in a script/USAGE is detected; markdown still works).

### AC-3: deterministic deprecated-surface check (no --with-claude)
**Given** a known-deprecated/stale-advice token presented as current/primary
**When** the check runs
**Then**: it is flagged deterministically (config-driven curated set); negated/"legacy"/"historical"/"deprecated" framings are suppressed (precision-first, not-a-claim guard); pure, never throws.
Tag: `@unit` (deprecated-as-primary → flagged; "legacy X" framing → not flagged; empty/odd → none).

### AC-4: version-pinned-promise-come-due check
**Given** a doc with "to be added in vX" / "Coming in vX" / "TODO by vX" and the current version > vX
**When** the check runs
**Then**: it is flagged as a stale promise; an as-of/historical "vX" narrative is NOT flagged; a future-pinned promise (current < vX) is NOT flagged; pure, bounded, never throws.
Tag: `@unit` (due promise → flagged; historical/future → not; null-safe).

### AC-5: `document-review --check` gates (teeth) + plain run still report-only
**Given** a repo with / without conformance drift
**When** `mmdream document-review --check` runs
**Then**: exit **1** if any conformance drift (dangling refs / stale facts / stale promises / deprecated-surface) is found, **0** when clean; argv error → 2; not-a-git-repo → 5 (mirrors secret-scan/deps-gate). The roadmap heuristic does NOT affect the exit (advisory). It still writes `docs/coherence-review.md`; the plain `document-review` (no `--check`) is unchanged + **read-only beyond the dashboard** (asserted).
Tag: `@integration` (drift → exit 1; clean → exit 0; plain run read-only + report-only; `--check` adds only the gate).

### AC-6: docs + live capture
**Then**: ADR-057 lands; README + CLAUDE.md + `/mmdream` (the wider scan, the deprecated/promise checks, `--check`); mechanical blocks; version → 0.18.0. Running `document-review` on MMD itself shows the false "partial"s gone + the new checks' real findings (captured honestly).
Tag: `@unit`/`@integration` (ADR-057 exists; docs mention `--check` + the new checks; version bumped).

---

## 3. Out of scope (deferred)

- **Auto-FIXING drift** — this slice still DETECTS + GATES (detect-before-act, the v0.7 arc). Auto-rewriting a stale doc/script is a later, human-reviewed action.
- **LLM semantic-drift** (`--with-claude`) — stays the opt-in enrichment; this slice makes the high-value currency/deprecation checks DETERMINISTIC so they run routinely without it.
- **Aggressive semantic compaction** of the over-cap docs — separate (needs a propose-cuts-for-review model).
- **Wiring `--check` into a pre-commit hook** — the gate is built here; enabling it (like the secret-scan/deps-gate sample hook) is a follow-up opt-in.

## 4. Operational notes for the implementer

- Keep it **deterministic** (no `claude` spawn) — the corpus/surface signal is exactly computable; an LLM adds cost + non-determinism for no gain here (contrast `--with-claude`, kept opt-in).
- **Precision-first** (v0.7.b discipline): every new check curated + guarded (negation/legacy/historical suppression) so MMD's own docs don't light up with false positives. Validate on MMD itself (AC-6).
- **Read-only beyond `docs/coherence-review.md`** stays the safety heart — assert `git status` shows only that path after a plain run; `--check` writes the same dashboard + sets the exit code, nothing else.
- The deprecated-surface set is a small curated config (start with the known ones: `/bmad-adv-auto-dev`-as-primary, bare `mmd ` vs `mmdream`); easy to extend.
- Commit incrementally per AC (L-019). Tests tagged per stratum.
