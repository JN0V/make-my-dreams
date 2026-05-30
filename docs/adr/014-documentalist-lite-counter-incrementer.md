# ADR-014: Documentalist lite — deterministic counter incrementer + auto-promote

Date: 2026-05-30
Status: Accepted
Slice: v0.2.i (SPEC_V02I)

## Context

The autolearning loop (scoping §6.5 / §6.5b) has two halves:

1. **Compose** — match lessons from `docs/lessons-learned.md` against a prompt
   and inject them. Operational since v0.2.7 (`lib/composer/*`), which writes a
   `*.composer.json` audit sidecar next to every `claude -p` run log.
2. **Promote** — once a lesson's `**To promote if**: N` counter reaches `N`,
   move the lesson out of the dynamic Layer F into the relevant constitution
   module so it becomes load-bearing by binding rather than by keyword luck.

Half (2) was stuck in manual mode: counters were incremented by hand, and only
when someone remembered — i.e. almost never. v0.2.i closes the second half with
a deterministic subcommand.

## Decision

Ship `mmd document-lessons [--dry-run] [--since <ts>]` backed by four small
modules under `lib/documentalist/` (pure where possible) plus a thin coordinator
in `bin/documentalist/`:

- `aggregate-injections.js` (pure) — tally, per lesson id, how many distinct
  runs injected it.
- `mutate-counters.js` (pure) — compute new counters + the promotion set.
- `serialize-lessons.js` (pure) — line-based, byte-identity-preserving edits to
  `docs/lessons-learned.md` (counter rewrite + block removal).
- `promote-lesson.js` — the only file-mutating module: append to the target
  constitution module, remove the block, write a promotion ADR.

Key decisions and their rationale:

- **Deterministic counter, no LLM judgment.** Promotion fires purely on
  `counter >= N`. The walking skeleton must be reproducible and free; semantic
  "is this *really* promotable?" judgment is deferred to the full Documentalist
  Worker (v0.5b). This keeps the loop honest and testable.
- **The lesson decides its destination module.** The target module is parsed
  from the lesson's own `**To promote if**` line (e.g. "promote to testing.md");
  absent a named module it defaults to `ai-coding.md`. The Documentalist does no
  re-categorization — authority lives with the lesson author.
- **Dedup by run, path as fallback key.** Composer audits do not currently carry
  a `run_id`. We dedup on `run_id` when present, else the audit file path. This
  prevents double-counting if the same run's audit is processed twice, without
  requiring a schema change to `lib/composer/audit.js`.
- **Skip milestone lessons.** L-010 / L-011 / L-013 / L-014 carry
  `Status: milestone` — historical anchors, not counter-tracked rules. They are
  never incremented and never promoted (enforced via the parsed `Status` line).
- **Byte-identical round-trip.** Because the v0.2.7 composer parser is lossy,
  serialization is line-based against the original text rather than a
  reconstruction from a model. With no mutations, the output is byte-identical to
  the input — covered by a regression test against the live lessons file.
- **Best-effort promotion atomicity.** A promotion is three file ops (module
  append, lessons removal, ADR write). Each is wrapped independently; a later
  failure does not undo earlier steps. The CLI surfaces partial failures with
  exit code 6 rather than pretending success (failure-honesty, ai-coding.md §I).

Exit codes: `0` ok / `2` user-argv error / `5` no composer.json found at all /
`6` partial failure.

## Consequences

- Every `mmd document-lessons` run materially advances the promotion state with
  no human-in-the-loop beyond the explicit invocation. The autolearning loop
  §6.5 is now operational in BOTH directions (compose + promote).
- Promotions are auditable: each writes a `docs/adr/<NNN>-lesson-L-<XXX>-promoted.md`.
- Out of scope (deferred): LLM promotability judgment, semantic
  re-categorization, cross-project aggregation, cron/`mmd ship`-hook triggering,
  a rollback subcommand, per-promotion confirmation prompts. These land with the
  full Documentalist Worker in v0.5b.

## Roadmap

v0.5b — full Documentalist Worker: cron-like auto-trigger + LLM-augmented
judgment layered on top of the deterministic math + file moves shipped here.
