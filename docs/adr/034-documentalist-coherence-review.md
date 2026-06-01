# ADR-034 — The Documentalist's first slice: a report-only coherence review (`mmd document-review`), detect before act

**Status**: Accepted
**Date**: 2026-06-01
**Deciders**: MMD core (self-dev, 29th reflexive `mmd --here`)
**Parent design**: [SPEC_V07A.md](../../SPEC_V07A.md) (FROZEN). First brick of the §6.4 **Documentalist** (the *detect* face); follows the document-* family ([ADR-025](./025-document-readme-doc-sync.md)).

## Context

MMD's own docs had drifted into exactly the mess `MAKE_MY_DREAMS.md` §6 prescribes the **Documentalist** to prevent: 33 `SPEC_V*.md` files at the repo root, `MAKE_MY_DREAMS.md` at 1722 lines (violating its own §6.4.4 "200-line cap"), and a §9 roadmap whose planned build order diverged massively from what actually shipped — capabilities planned but never built (auto-handoff, Dream Expander, Plan-Review Worker, Bundle A Security, the full Documentalist itself, polymorphic Reality Check). There was no single place that answered *"what is MMD today vs what was designed?"*, so the owner kept re-discovering the same gaps by hand.

The full Documentalist (event-driven Worker, Diataxis doc generation, autolearning, active compaction) is large and has two faces:
- **detect** (§6.4 — coherence review: duplicates, superseded ADRs, drift, length-cap violations, designed-vs-built gaps), and
- **produce** (§6.3 — Diataxis docs).

### The honest scoping decision: detect before act (universal §VI)

The temptation was to build the whole thing — including **compaction** (archive the 33 SPECs, shard `MAKE_MY_DREAMS.md`, delete superseded sections). That is the high-value payoff, but it is also **destructive and irreversible**: a tool that moves and deletes docs based on a *judgment of what is obsolete* must first earn trust in that judgment. Granting the bulldozer before validating the detector is how a "helpful cleanup" silently deletes something load-bearing (anti-P-04, the design-vs-substrate failure mode).

So v0.7.a builds **only the detect face, and report-only**: it surfaces the gaps and the doc-health smells, writes them to a regenerable dashboard, and changes **nothing else**. The owner reads the report and decides. v0.7.b will grant *compaction* — but only once the detection has been validated against the known hand audit (the AC-4 gate). The gap audit IS the detector's acceptance test: verify the detector before the bulldozer.

## Decision

### 1. A deterministic inventory + a heuristic reconciliation (the MMD pattern)

Mirroring every existing MMD builder (composer, handover, document-readme — pure core, optional LLM), `mmd document-review` is built from three **pure** modules + one thin I/O subcommand:

- **`lib/documentalist/inventory.js`** — `gatherInventory(deps)` reads MMD's documented surface through **injected** fs/git readers: subcommands (the known `SUBCOMMANDS` list), git tags, ADR list + titles, `lib/` module names, per-doc line counts (with an `overCap` flag against the 200-line §6.4 cap), the root `SPEC_V*.md` sprawl count, and the active-lesson count. It **never throws**: a missing dir / unreadable file degrades that one field to empty/`null` (the honest signal is emptiness, never a fabricated count — error-handling §III, universal §VI).
- **`lib/documentalist/roadmap-reconcile.js`** — a PURE `reconcileRoadmap({ roadmapText, inventory })` that parses the §9 `### vX.Y — Title` headers into `{version, capability}` and classifies each **built / partial / unbuilt** by matching the capability **name** against the inventory (subcommand / lib-module / ADR-title / tag signals). It is a **clearly-labelled heuristic, not an audit**: a single fully-matched capability → built; a compound where only some concepts match → `partial` (the honest middle: "part shipped, part didn't"); no signal → `unbuilt` (the honest default for "we can't find it"). Malformed input → `unknown`, never throws.
- **`lib/documentalist/coherence-report.js`** — a pure render of inventory + reconciliation + doc-health flags to markdown, with a generated-by banner and the heuristic disclaimer.
- **`bin/documentalist/document-review.js`** — wires the real fs/git into the pure cores, writes the report, prints a summary.

**Why a name-matching heuristic, not an LLM by default**: pure, free, offline, deterministic, no hallucination — and good enough to reproduce the hand audit's big rocks (validated: all six come out unbuilt/partial). Its blind spot is real and acknowledged: it sees *names*, not *behaviour*, so it cannot tell "full Documentalist" from the lite version that shipped (it correctly hedges those to `partial` via the compound rule, but can over-credit a capability that shipped under a matching lib name — e.g. v0.10 "Full Dream Catcher Web UI" reads "built" off `lib/dream-catcher`). That blind spot is exactly what the opt-in LLM pass is for.

### 2. `mmd document-review` is strictly read-only beyond one generated file

The subcommand writes **EXACTLY** `docs/coherence-review.md` (a regenerable, tracked dashboard with a "do not hand-edit" header) and **nothing else** — no moves, no deletes, no edits to any other path. An integration test pins this: after a run, `git status` shows only `docs/coherence-review.md`. This read-only contract is the safety heart of "detect before act" — the detector physically cannot do what only the (future, trusted) compactor may.

### 3. Opt-in `--with-claude`, graceful honest fallback (the sacred uncertain discipline)

`--with-claude` layers an LLM judgment pass on top of the deterministic reconciliation via the `MMD_DOCUMENT_REVIEW_CMD` spawn seam (mirroring `MMD_QA_CMD` et al.). The LLM output is rendered as **commentary under its own heading** — it never mutates the deterministic table, so it cannot manufacture a verdict. On absent / non-zero / empty / unparseable claude, it falls back to the deterministic report with an honest "(LLM enrichment unavailable)" note — **never a fabricated classification** (universal §VI, L-021).

## Consequences

- **Positive**: the owner stops re-discovering the gaps by hand — `mmd document-review` surfaces designed-vs-built + doc-health on demand. The detector is validated against the known audit (AC-4) before any destructive power is granted. The three pure cores are fixture-tested without a real repo; the subcommand's read-only contract is pinned end-to-end.
- **Negative / accepted**: the reconciliation is a name-match heuristic with a known blind spot (lite-vs-full, renamed capabilities). It is labelled as such everywhere it appears; `--with-claude` is the escape hatch. The generated report is a tracked file that drifts until regenerated — the banner says so.
- **Deferred to v0.7.b (active compaction)**: archiving the root SPECs into `docs/specs/` + an index, sharding `MAKE_MY_DREAMS.md`, deleting/shortening superseded sections — the *act* face, granted now that *detection* is trusted. Diataxis doc generation (the §6.3 *produce* face) and event-driven triggering remain v0.7.c+.

## Alternatives considered

- **Build the full Documentalist (detect + compact) in one slice** — rejected: granting irreversible compaction before validating the detector's judgment is the unsafe order. Detect-before-act is the whole point of this slice.
- **LLM-first reconciliation** — rejected as the default: non-deterministic, costs tokens, can hallucinate a confident "built". The deterministic heuristic reproduces the audit's big rocks on its own; the LLM is an opt-in enrichment, not the engine.
- **Write the report somewhere untracked / print-only** — rejected: a tracked `docs/coherence-review.md` is a living dashboard the owner (and future tooling) can diff over time; the read-only contract already guarantees it is the *only* thing written.
