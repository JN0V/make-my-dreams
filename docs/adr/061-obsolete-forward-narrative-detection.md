# ADR-061: The Documentalist detects OBSOLETE forward-looking narrative

Date: 2026-06-07
Status: Accepted

## Context

After v0.21 condensed MMD's own `README.md` (919 → 101 lines, the worktrees
capability-lie removed, the deprecated surface fixed), one visible class of
falsehood remained. README line 73 still read:

> *Next on the roadmap (see MAKE_MY_DREAMS.md): a lite doc-sync Documentalist,
> then v0.4 stateless Orchestrator + auto-handoff, v0.5 Conductor, v0.5b full
> Documentalist.*

Every one of those has **shipped** — we are at v0.21+. The README presents
**done work as "next"**: a roadmap line the project has long overtaken. Sébastien
named the category *"plus du tout à l'ordre du jour"* (no longer on the agenda),
which v0.21 (ADR-060) explicitly deferred.

This is the **inverse** of the v0.21 capability-lie:

- `checkCapabilityClaims` (v0.21) flags a **present-tense** claim of an **UNBUILT**
  capability ("MMD adds … git worktrees" while worktrees is the deferred Parallel
  Conductor) — a *done*-claim of a not-built thing.
- `checkObsoleteForwardClaims` (this ADR) flags a **forward-looking** claim ("next
  / coming / planned / then vX / on the roadmap") of an **already-BUILT** capability
  or a version **≤ the current version** — a *future*-claim of an already-done thing.

Same machinery, inverted signal.

## Decision

Add a new pure, deterministic, never-throws check
`checkObsoleteForwardClaims({docText, inventory, roadmap, currentVersion})` in
`lib/documentalist/conformance.js` and wire it into `mmdream document`'s Step 5
(conciseness / correction) and the `--check` gate.

### The signal — DERIVED, not hand-listed (v0.7.d golden rule)

A forward-looking line is **stale** when its forward cue governs EITHER:

- **(a) a version token ≤ the current version** — high-confidence, deterministic.
  "then v0.4 …" while we are at v0.21 is stale because v0.4 ≤ v0.21. The current
  version comes from the analyzed repo's `package.json`; the compare reuses the
  same loose 3-part semver shape as the v0.18 version helpers.
- **(b) a BUILT capability** — ALL of the distinctive NAME tokens of SOME built
  roadmap capability appear on the line. "Built" is **REUSED from
  `reconcileRoadmap`** (no second classifier), so a feature that later ships
  auto-converts its old "next: X" mention into a finding, and a future item that
  ships stops being a false positive.

### Precision-first (the v0.7.b discipline — a detector that cries wolf is useless)

- A forward cue governing a **genuinely-UNBUILT** capability ("next: voice mode"
  while voice is unbuilt) is the **CORRECT roadmap** and is **NOT flagged** (AC-4).
- A forward cue + a **FUTURE version** (> current) is a real plan — **NOT flagged**.
- A **past-tense / historical** framing ("was next", "originally planned", "used
  to be next", "was coming") is **suppressed** (the not-a-claim guard family) — it
  correctly narrates a past plan.
- Fenced code blocks are skipped (a doc may quote an old roadmap snippet).

### Act — reuse the v0.21 flag-or-clean-delete split

- A **discrete list item** naming **only** past versions (no surviving future
  plan) is `removable:true` (whole-line) and is **cleanly DELETED** via the
  existing `planRemovals` (`lib/documentalist/compact-action.js`).
- A **multi-clause forward prose sentence** (the README line-73 case) is
  `removable:false` → **FLAGGED for review, never auto-rewritten**. Rewriting a
  roadmap to the *current* roadmap is semantic generation — deferred (the LLM
  prose pass). A list item that *also* names a real future version is likewise
  flagged, not deleted (deleting it would drop a real plan).

### Teeth — `mmdream document --check`

`--check` now fails (exit 1) on a stale forward-looking finding, mirroring the
v0.21 capability-lie / deprecated-surface gates. The roadmap heuristic stays
advisory and does NOT gate.

## Live capture (AC-5)

`mmdream document --check` on MMD itself reports, with **zero false positives** on
the dozens of valid refs and on genuine future items elsewhere:

```
OBSOLETE FORWARD: README.md:73 — forward cue names v0.4, at or below the current version
                  (flagged; rewrite is semantic, deferred)
```

Exactly the line-73 case. It is FLAGGED (a multi-clause prose sentence), not
auto-deleted — the high-confidence detection without the risky semantic rewrite.

## Consequences

Combined with v0.21, the Documentalist now keeps docs TRUE across all three drift
directions:

- **unbuilt-claimed-as-done** — capability-lie (v0.21).
- **deprecated-as-current** — deprecated-surface (v0.18/v0.21).
- **done-claimed-as-future** — obsolete forward narrative (this ADR).

## Out of scope (deferred)

- **Rewriting a stale roadmap line to the CURRENT state** — semantic generation
  (the deferred LLM prose pass). This slice flags it + cleanly deletes shipped
  list-items, but does not author the new roadmap.
- **General obsolescence beyond forward-claims** — a paragraph describing a
  *removed* feature, or stale-but-not-forward narrative, is fuzzier; this slice
  targets the high-confidence forward-claim-of-shipped pattern.
