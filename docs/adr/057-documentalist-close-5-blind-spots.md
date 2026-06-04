# ADR-057 — Documentalist: closing the 5 blind-spots — wider surface, honest reconciliation, deprecated/promise checks, and a `--check` gate

**Status**: accepted
**Date**: 2026-06-04
**Slice**: v0.18.a (detect MORE truth, classify it HONESTLY, enforce it — all deterministic, precision-first, read-only beyond `docs/coherence-review.md`)

## Context — "le documentaliste fait mal son travail"

The Documentalist's whole value is keeping the docs TRUE. It failed at that twice,
and a third time this session — proving five distinct blind-spots, not one bug:

1. **The scan surface was markdown-only.** `CONFORMANCE_TRUTH_DOCS` was
   README / CLAUDE / HANDOVER / lessons + ADRs. It scanned **no `.sh`, no
   `--help`/USAGE, no `printf` strings** — exactly where the stale
   `/bmad-adv-auto-dev` "try this" recommendation lived (in `install-mmd.sh`
   output). A real stale claim was 100% outside scope.
2. **Existence ≠ currency.** It flagged a *dangling* ref (a cited file was
   deleted) but never *stale advice* — a token that still exists but is no longer
   the recommended surface (`/bmad-adv-auto-dev` as the entry point vs `mmdream`).
   The only way to surface that was the opt-in `--with-claude`, never routinely run.
3. **The fact set was too narrow.** `checkFactConformance` covered counts +
   "current version X" and ignored historical narrative — but missed
   **version-pinned promises that came due** (README's "License — to be added in
   **v0.1**" while LICENSE has existed for many versions).
4. **No teeth.** Detect-only, on-demand, report-only. Even drift it COULD see just
   sat in the dashboard. There was no gate, so nothing in pre-push / CI could fail
   on drift.
5. **The roadmap reconciliation was a false-comfort name-match.** It lifted a
   capability to 🟡 *partial* on a **tag NUMBER** match ("Voice mode" read partial
   only because a v0.11.x tag existed — v0.11 was the alignment gate, not voice) or
   a generic weak token ("parallel worktrees"), when both are ❌ unbuilt. A
   misleading "partial" hides a real "unbuilt" — the worst failure mode for a
   truth-keeper.

The through-line: detect **more** truth (surface + currency + promises), classify
it **honestly** (no false partial), and make it **enforceable** (teeth).

## Decision

Stay **deterministic** (no `claude` — these signals are exactly computable; an LLM
adds cost + non-determinism for no gain, contrast the opt-in `--with-claude`),
**precision-first** (the v0.7.b discipline — a drift report that cries wolf is
useless), and **read-only beyond `docs/coherence-review.md`** (the safety heart).

### AC-1 — honest roadmap reconciliation (no false "partial")

`lib/documentalist/roadmap-reconcile.js`: a `partial`/`built` verdict now REQUIRES
at least one **STRONG capability-NAME match** (a subcommand / lib-module name whose
full token-set appears in the capability). A weak related-token match OR a
shipped-tag NUMBER alone is **no longer** evidence the named capability shipped —
it is classified **`unknown`** (honestly "can't tell from names alone"), never a
falsely-comforting `partial`. A genuinely half-built **compound** (some concepts
strongly matched, some not) still reads `partial`; truly no signal still reads
`unbuilt`. "Voice mode" / "parallel worktrees" become `unknown`/`unbuilt`.

### AC-2 — broaden the conformance surface beyond markdown

New pure `lib/documentalist/ux-text-surface.js` builds a **UX-text surface** from
the user-facing strings OUTSIDE the markdown truth docs: shell-script `printf`/
`echo` output (line-positioned back to the source line) + the CLI `--help`/USAGE
text (read **statically** from `bin/mmd.js`'s `USAGE` template — deterministic, no
subprocess). The dangling-ref scan, the AC-3 deprecated-surface check, and the
AC-4 promise check all run over markdown docs PLUS this wider surface. Additive —
the markdown checks are unchanged.

### AC-3 — deterministic deprecated-surface check

`conformance.js` `checkDeprecatedSurface(texts, opts)`: a curated, high-confidence
config of deprecated→current tokens (`/bmad-adv-auto-dev`-as-entry → `mmdream`;
a bare `mmd <command>` recommendation → `mmdream`). A token is flagged ONLY when a
recommendation cue ("try"/"run"/"→"/…) **governs** it (sits in a short window
before it), and negated / legacy / historical / deprecated / "instead of"
framings are suppressed (the v0.7.b not-a-claim guard). The bare-`mmd` rule is
tightly scoped to a command invocation, so the **deliberately-kept** `mmd`
surfaces (`MMD_*` env vars, `.mmd/` paths, `bin/mmd.js`, composer keys) are NEVER
flagged. Pure, never throws.

### AC-4 — version-pinned-promise-come-due check

`conformance.js` `checkVersionPinnedPromises(texts, {currentVersion})`: a forward
promise pinned to a version that came DUE — "to be added in vX" / "coming in vX" /
"TODO by vX" / "will be added in vX" where the current version ≥ vX — is flagged.
A still-future promise (current < vX) and a past-tense/historical "as of vX" /
"added in vX" are NOT flagged (a negative lookbehind keeps "to be added in vX"
from being swallowed by the past-tense "added in vX" marker). Bounded, pure.

### AC-5 — teeth: `document-review --check`

`bin/documentalist/document-review.js` gains `--check`: it runs the full review,
writes the **same** dashboard, then sets the exit from **conformance drift only** —
exit **1** if ANY dangling ref / stale fact / stale promise / deprecated-surface
finding, **0** when clean. Same gate contract as `secret-scan`/`deps-gate`
(argv → 2, not-a-git-repo → 5). The **roadmap heuristic does NOT gate** (it is
noisy — advisory only, mirroring deps-gate's "single signals stay advisory").
`--check` is rejected when combined with `--since`/`--dry-run`. The plain
`document-review` (no `--check`) is **unchanged**: report-only + read-only beyond
the dashboard (a plain run with drift present still exits 0 and changes only
`docs/coherence-review.md` — asserted).

## Consequences

- The roadmap table no longer shows a falsely-comforting "partial" for an unbuilt
  capability — the worst failure mode of a truth-keeper is gone.
- A stale recommendation in `install-mmd.sh`/`--help` (a deprecated primary token)
  and a version-pinned promise that came due are now caught **deterministically**,
  routinely, without `--with-claude`.
- Drift is **enforceable**: `document-review --check` fails pre-push / CI on drift
  while the plain run stays advisory + read-only — the v0.7 detect-before-act arc
  now reaches "enforce".
- Precision is held: every new check is curated + guarded so MMD's own docs do not
  light up with false positives (validated by running `document-review` on MMD
  itself — the false partials are gone, the new checks surface real findings or
  honestly none).

### Deferred (out of scope)

- **Auto-FIXING drift** — this slice DETECTS + GATES; auto-rewriting a stale
  doc/script is a later, human-reviewed action.
- **LLM semantic-drift** stays the opt-in `--with-claude` enrichment.
- **Wiring `--check` into a pre-commit hook** — the gate is built; enabling it
  (like the secret-scan/deps-gate sample hook) is a follow-up opt-in.
- **Aggressive semantic compaction** of over-cap docs — separate.

See SPEC_V018A.md for the full Given/When/Then acceptance criteria.
