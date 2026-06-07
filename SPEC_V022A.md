# Make My Dreams — v0.22.0 Spec (slice v0.22.a): the Documentalist detects OBSOLETE forward-looking narrative

> *(Sébastien, 2026-06-07, after v0.21 condensed the README: the remaining defect is stale forward-looking prose. README line ~73 still says "Next on the roadmap: a lite doc-sync Documentalist, then v0.4 stateless Orchestrator + auto-handoff, v0.5 Conductor, v0.5b full Documentalist" — but ALL of those **shipped** (we are at v0.21). It claims as "next" things that are long done. This is the "plus du tout à l'ordre du jour" / obsolete-narrative category v0.21 explicitly deferred.)*
>
> **The pattern — the INVERSE of v0.21's capability-lie:**
> - v0.21 `checkCapabilityClaims` flags a **present-tense** claim of an **UNBUILT** capability ("MMD adds … git worktrees").
> - v0.22 flags a **forward-looking** claim ("next / coming / planned / then vX / on the roadmap") of an **already-BUILT** capability (or a version **≤ the current version**) — a roadmap line that the project has overtaken.
>
> Same machinery, inverted signal: it **reuses `roadmap-reconcile`'s built/unbuilt classification** + a **version comparison** against the current `package.json` version (the v0.18 version-compare). Stays **deterministic** (no `claude`), **precision-first** (the v0.7.b discipline — a genuinely-future roadmap item, e.g. "next: voice mode" while voice is unbuilt, is CORRECT and must NOT be flagged), and reuses the v0.21 **flag-or-clean-delete** action split: a discrete shipped item inside a forward-looking list is cleanly excised; a whole stale forward sentence/paragraph is **flagged for review** (rewriting a roadmap to the *current* roadmap is semantic — deferred).
>
> **§VIII / L-009 — general:** operates on any markdown doc in any repo; the "built/unbuilt" and "current version" come from the analyzed repo's own inventory, not MMD-specific assumptions.

---

## 1. Goal of v0.22.a

```
mmdream document   → the conciseness/correction step now ALSO detects OBSOLETE forward-looking narrative:
   - a forward cue (next / coming / planned / upcoming / on the roadmap / to be built / "then vX" / future)
     governing a capability the inventory classifies BUILT, OR a version reference <= the current version
     → flagged as a STALE forward-looking claim.
   - precision: a forward cue governing an UNBUILT capability (a real future item) is NOT flagged;
     a historical/past-tense framing ("was next", "originally planned") is NOT flagged.
   - ACT (reusing v0.21): a discrete BUILT item inside a forward-looking list is cleanly DELETED;
     a whole stale forward sentence is FLAGGED for review (current-roadmap rewrite is semantic, deferred).
mmdream document --check  → fails on a stale forward-looking claim (teeth, reused contract).
```

Deliverables:
1. **Obsolete-forward-narrative detection** (new pure check in `lib/documentalist/conformance.js`, e.g. `checkObsoleteForwardClaims({docText, inventory, roadmap, currentVersion})`): flags a finding `{doc,line,claim,capability,reason,confidence,removable}` when a **forward-looking cue** governs (a) a capability the reconciliation classifies **built**, or (b) a version token **≤ `currentVersion`**. Reuses `lib/documentalist/roadmap-reconcile.js` for built/unbuilt and a small semver-ish compare (the existing v0.18 version helper). **Precision-first**: a forward cue + an **unbuilt** capability → NOT a finding (real roadmap); a past-tense/historical framing ("was on the roadmap", "originally planned", "used to be next") → suppressed (the not-a-claim guard family); `removable:true` only for a discrete list item / whole line whose every named capability is built. Pure, never throws, labelled heuristic.
2. **Wire into the conciseness/correction step** (`bin/documentalist/document.js`): the new findings feed the unified report + the `--check` gate (a stale forward-looking claim fails `--check`, mirroring capability-lie/deprecated-surface); the v0.21 action applies — a `removable` built-item is DELETED (clean excision, separators fixed), a non-cleanly-excisable stale forward sentence is FLAGGED. Re-validate after (valid markdown, no new dangling refs). v0.19 invariants preserved.
3. **Docs + ADR + version + live capture**: ADR-061 (the inverse-of-capability-lie framing, the built-or-version-≤-current signal, precision rules, flag-vs-clean-delete reuse, why current-roadmap rewrite stays deferred); README/CLAUDE.md; mechanical blocks; version → 0.22.0. **AC-live:** run `mmdream document` (or `--check`) on MMD — README's "Next on the roadmap … Conductor … full Documentalist" line is **flagged** (every named capability is built / every version ≤ 0.22), and no genuinely-future item elsewhere is falsely flagged.

**Mission validation**: the Documentalist now catches the last visible class of README falsehood — describing shipped work as "next". A roadmap line the project has overtaken is flagged (and its cleanly-removable shipped items excised); a real future item is left untouched. Combined with v0.21, the Documentalist keeps docs TRUE across all three drift directions: unbuilt-claimed-as-done (capability-lie), deprecated-as-current (deprecated-surface), and **done-claimed-as-future (obsolete narrative)**.

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: obsolete-forward-narrative detection (pure, precision-first)
**Given** a doc line with a forward cue ("next on the roadmap: … Conductor", "then v0.5 Conductor") naming a BUILT capability or a version ≤ current
**When** `checkObsoleteForwardClaims(...)` runs
**Then**: it is flagged `{doc,line,claim,capability,confidence,removable}`; a forward cue naming an **unbuilt** capability ("next: voice mode") is NOT flagged; a past-tense/historical framing is NOT flagged; pure, never throws, labelled heuristic.
Tag: `@unit` (future-cue + built → flagged; future-cue + unbuilt → not; historical → not; version ≤ current → flagged; null-safe).

### AC-2: built/unbuilt + version signals are DERIVED, not hand-listed
**Given** the inventory/roadmap-reconcile classification + the current `package.json` version
**When** the check classifies a forward claim
**Then**: "built" comes from `roadmap-reconcile`/inventory and "≤ current" from a real version compare — no second hand-maintained list (the v0.7.d derive-don't-maintain rule). A capability that later ships flips a once-correct "next: X" into a finding automatically.
Tag: `@unit` (built signal from reconcile; version compare correct incl. 0.4 ≤ 0.22; reused helper).

### AC-3: wired into `mmdream document` + `--check` + action reuse
**Given** `mmdream document` on a repo with a stale forward-looking line
**When** it runs (default / `--check`)
**Then**: default flags it (and DELETES a cleanly-removable built list-item, FLAGS a non-excisable sentence); `--check` fails on a stale forward-looking finding; the report lists it; re-validation passes (valid markdown, no new dangling refs); v0.19 read-only-beyond-its-writes invariants preserved.
Tag: `@integration` (default flags/clean-deletes; check fails; dry-run clean; messy → flagged).

### AC-4: precision — no false positive on a real future roadmap
**Given** a doc with a genuinely-future item ("next: voice mode / game engine", unbuilt)
**When** the check runs
**Then**: it is NOT flagged; only forward claims of BUILT capabilities / past versions are flagged. Validated on MMD itself (AC-5) — zero false positive on real future items.
Tag: `@unit`/`@integration` (unbuilt-future → not flagged; built-future → flagged).

### AC-5: docs + live capture
**Then**: ADR-061 lands; README/CLAUDE.md note the obsolete-narrative detection; mechanical blocks; version → 0.22.0. Running `mmdream document` on MMD flags the "Next on the roadmap … Conductor … Documentalist" line (all built / versions ≤ current) with no false positive on a real future item; capture the finding.
Tag: `@unit`/`@integration` (ADR-061 exists; docs updated; version bumped; live finding captured).

---

## 3. Out of scope (deferred)

- **Rewriting the roadmap to the CURRENT state** — replacing a stale "next: X (shipped)" with the actual current roadmap is semantic generation; this slice flags it + cleanly deletes shipped list-items, but does not author the new roadmap (the deferred LLM prose pass).
- **General obsolescence beyond forward-claims** — a paragraph describing a *removed* feature, or stale-but-not-forward narrative, is fuzzier; this slice targets the high-confidence forward-claim-of-shipped pattern (the line-73 case).
- **The `mmdream document --tests N` → README-Status threading bug** (v0.21 residual: it populates HANDOVER but not the README block) — a separate small fix.

## 4. Operational notes for the implementer

- **Inverse of v0.21, same machinery**: reuse `roadmap-reconcile` (built/unbuilt) + the v0.18 version compare; do NOT build a second classifier. A forward cue + built capability (or version ≤ current) = stale; forward cue + unbuilt = correct roadmap.
- **Precision is the safety line** (v0.7.b): only flag a forward claim of a genuinely-BUILT capability / a past version; suppress historical/past-tense framings; auto-DELETE only a cleanly-excisable built list-item, FLAG the rest (no prose rewrite — that's deferred).
- **Derive, don't hand-curate** (v0.7.d): the "is it built?" and "is the version past?" signals come from the analyzed repo's inventory + `package.json`, so a newly-shipped feature auto-converts its old "next:" mention into a finding.
- **Deterministic, no `claude`**; pure check split from I/O (SRP), never throws; re-validate the doc after any action. Commit incrementally per AC (L-019). Tag tests per stratum. Capture the live MMD finding (AC-5).
