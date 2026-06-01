# ADR-035 — The Documentalist checks DRIFT: is the doc still TRUE? (conformance over tidiness)

**Status**: accepted
**Date**: 2026-06-01
**Slice**: v0.7.b (`mmd document-review` gains a "Drift / conformance" section)
**Supersedes/extends**: [ADR-034](./034-documentalist-coherence-review.md) (the v0.7.a roadmap-level detection)

## Context

v0.7.a gave the Documentalist a *roadmap-level* detection: a designed-vs-built
reconciliation (what did MMD plan vs what did it ship) plus doc-health flags
(length-cap, SPEC sprawl). Useful, but it answers a coarse question.

The Documentalist's **primary** value is not keeping docs *short* — it is keeping
them **true**. A doc drifts when what it *says* (a file path it cites, a
subcommand it names, an ADR it references, a count it states) no longer matches
what was actually **built**. A short-but-wrong doc is worse than a long-but-right
one. Compaction (archiving the SPEC sprawl, sharding over-cap docs) is the
*secondary* "stay tidy" half — deliberately reordered to v0.7.c.

We need per-claim conformance: scan the docs for things they *assert exist* and
verify each against reality.

## Decision

Add a **deterministic "Drift / conformance" section** to `mmd document-review`,
built **detect-before-correct** (flag-only; it NEVER edits a doc to "fix" it).

1. **Code-artifact reference extractor** (`lib/documentalist/doc-refs.js`, pure):
   `extractDocRefs(text)` pulls the artifacts a doc *claims exist* — file paths
   under `lib/`/`bin/`/`test/`/`docs/` (`.js`/`.md`), backticked `mmd <subcommand>`
   mentions, `ADR-NNN` numbers, and bare `lib/<module>` names — line-aware,
   deduped by kind, never throws. Distinct in purpose from the grounding
   extractor (`lib/here-mode/extract-file-refs.js`, which is input-focused and
   ignores `.js`): this one verifies code artifacts still exist.

2. **Conformance checker** (`lib/documentalist/conformance.js`, pure):
   - `checkArtifactConformance({docRefs, inventory, fileExistsFn})` returns the
     refs that DON'T resolve (missing file, unknown subcommand, ADR with no
     inventory entry, lib module absent) — a dangling reference is *unambiguous*
     drift. Without a `fileExistsFn` it stays silent on file refs (never
     fabricates "missing").
   - `checkFactConformance({docs, inventory})` returns mismatches for a
     **bounded, low-false-positive** set only — explicit `N subcommands|ADRs|
     (active) lessons` counts and "current/latest version X" — vs the live
     inventory, ignoring clearly-historical narrative ("as of vX", "in v0.2.x").
     A current-version claim is flagged only when *behind* the latest tag.

3. **Opt-in `--with-claude` semantic drift**: a separate spawn-seam pass
   (`MMD_DOCUMENT_REVIEW_CMD`) that flags where a doc's *description* likely no
   longer reflects behavior even though its cited paths still exist. Honest
   fallback (an explicit "unavailable" note) on absent/non-zero/empty — NEVER a
   fabricated "conformant" verdict (the sacred uncertain discipline).

## Precision is the priority (AC-4)

A drift section that cries wolf is useless, so the design favours precision over
recall:

- **Fenced code blocks are skipped** by the extractor (architecture sketches /
  example output routinely hold illustrative, future paths).
- **Subcommands are captured only inside inline code** (the way docs format a
  real command), so prose ("we pulled it from the spec") yields no phantom
  `from` subcommand.
- **Placeholder paths** (`docs/adr/0NN-slug.md`, `lib/<module>/x.js`) are not
  collected (they are templates, not claims).
- **Fact conformance runs only on the living current-state docs**
  (README / CLAUDE / HANDOVER). ADRs and `lessons-learned.md` are *point-in-time*
  records: a count they state was true when written, so they are scanned for
  dangling *code* references only, not for facts.
- **Subcommand authority is derived from the real `bin/mmd.js` dispatch**, not
  just the `SUBCOMMANDS` export — *truth over tidiness*: `mmd lessons` is
  dispatched yet missing from the export, and treating it as dangling would be a
  false positive.

On MMD itself the scan reports **7 dangling references + 2 stale facts**, all
genuine drift (planned/never-built subcommands cited in old ADRs, two moved
files, and two stale ADR counts in README/HANDOVER), with **zero** false
positives on the dozens of valid references — exactly the precision+recall the
detector must earn before v0.7.c lets the Documentalist *act* (compaction) and
any later prose auto-correction.

## Consequences

- The Documentalist can now tell the owner, on demand, **where the docs have
  stopped telling the truth** — without touching a single doc. `mmd
  document-review` stays **strictly read-only beyond `docs/coherence-review.md`**
  (asserted by an integration test).
- Auto-*correcting* drift (rewriting prose to match reality) is a high-risk
  content edit, earned only once detection is trusted — out of scope here.
- Flag-reference conformance (`--sealed`/`--monitor`) is deferred (no clean flag
  inventory yet). Unbounded NLP claim-checking is the `--with-claude` job, not
  the deterministic core.

*Truth over tidiness; detect-before-correct. Compaction is the secondary v0.7.c
step; the coherence graph is v0.7.d.*
