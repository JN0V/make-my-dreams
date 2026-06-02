# ADR-044 — Polyglot doc→code reference extractor: the drift detector sees any language (§VIII)

**Status**: accepted
**Date**: 2026-06-02
**Slice**: v0.8.2 (polyglot doc→code refs — the Documentalist drift detector goes language-agnostic)

## Context

v0.8.0 (ADR-042, Test Curator) and v0.8.1 (ADR-043, import graph) paid down two of the
JavaScript-only debts that constitution **§VIII (technology-agnostic analysis,
NON-NEGOTIABLE)** named. ADR-042/043 both explicitly queued a third: the Documentalist's
**doc→code reference extractor** (`lib/documentalist/doc-refs.js`, ADR-035 / v0.7.b).

That extractor is the input half of the **drift / conformance** detector: it gathers the
code artifacts a doc CLAIMS exist (file paths, `mmd <subcommand>`, `ADR-NNN`, bare
`lib/<module>`), and `conformance.js` flags the ones that no longer resolve (dangling).
But its `FILE_PATH` matcher was **secretly JavaScript+MMD-only**: it matched a code-file
reference ONLY under `lib/`, `bin/`, `test/`, or `docs/`, ending in `.js` or `.md`. So on a
**Python / Rust / Go / Java / …** repo, a doc citing `src/foo.py` or `src/main.rs` was
**invisible** — the drift detector silently saw nothing and reported a clean bill of health
it had no basis for. That is the §VIII failure: an analysis hard-wired to one language's
layout, silently-emptying a measurement that doesn't apply (a §VI honesty violation too).

Unlike the Test Curator (whole-repo, refuse-if-unsupported) the doc-ref extractor is a pure
text scanner with no stack to detect — the generalization is in the **pattern + the
resolution filter**, not an adapter registry. The MMD-specific patterns (`mmd <subcommand>`,
`ADR-NNN`, `lib/<module>`) are MMD conventions, not language-bound: they simply do not match
on a non-MMD repo, which is correct — so only the file-path matcher needed to change.

## Decision

Broaden the `FILE_PATH` matcher to be **language-agnostic**, and move precision from a
**hardcoded directory allowlist** to a **repo-derived** one.

### 1. Broader candidates (`lib/documentalist/doc-refs.js`)

`FILE_PATH` now matches a path-like token with **at least one directory segment** and one of
the **common source/doc extensions** — `js, ts, jsx, tsx, mjs, cjs, py, rs, go, java, rb, c,
h, cpp, hpp, cc, cs, php, swift, kt, scala, md` — under **ANY top-level directory** (not only
`lib|bin|test|docs`). The lookbehind/lookahead boundaries are preserved (a path is never
glued onto a preceding word; a leading-dot directory like `.specify/memory/x.md` is not
half-captured; a `https://` URL is not captured because the `:` after the scheme is not a
path char). A bare `main.py` with **no** directory segment is still not a code-artifact claim.

### 2. Precision held by two derived guards (no new false positives)

Broadening recall would cry wolf without two precision levers — and the §VIII precision
priority is "no new false positives on a real repo's references":

- **Pure structural guard (mid-path extension).** A source extension in a NON-final segment
  (`…\.<ext>\/…`) means the token is a slash-joined LIST written as prose
  (`CLAUDE.md/HANDOVER.md`, `kid.md/pro.md`), not a real path — a real path's only extension
  is terminal. Rejected at extraction time, language-agnostic.
- **Repo-rooted resolution filter (`conformance.js`, injected `repoTopDirs`).** A file ref is
  judged dangling ONLY when it is rooted at a **real top-level directory of the analyzed
  repo** — i.e. its first path segment is in `repoTopDirs`, which
  `bin/documentalist/document-review.js` derives from the repo's actual directories. This is
  the **derived, not-hardcoded successor** to the old `lib|bin|test|docs` allowlist: same
  precision, now any repo layout (`src/`, `app/`, `cmd/`, `internal/`, …). A non-rooted token
  — a shorthand like `adapters/javascript.js` (real path `lib/…/adapters/…`), a relative
  markdown link like `adr/020-x.md`, an illustrative example like `pkg/mod.py` — is not a
  claim about THIS repo's exact path, so it is skipped. Absent/empty `repoTopDirs` → filter
  OFF (back-compat judge-all); the real caller always supplies it.

The extractor stays **pure** (text in, findings out — candidates broad); precision is enforced
downstream where the repo is known, matching the v0.7.b "candidates then resolve" architecture.

## Consequences

- **The drift detector works on any-language repos.** A Python/Rust/Go doc citing a missing
  `src/foo.py` / `src/main.rs` is now flagged dangling at its exact `doc:line`; an existing
  non-JS source file is not flagged. Validated by a Python+Rust fixture integration test.
- **MMD's own drift report is byte-for-byte equivalent** — the same 4 pre-existing baseline
  refs it already tolerated (two retired-code citations in historical records + two
  rejected/renamed-subcommand mentions in ADRs), **zero** new false positives. The
  broadening surfaced six would-be false positives on MMD's own docs (slash-joined doc lists,
  shorthand adapter paths, illustrative ADR examples, a relative ADR link); both guards
  remove all six without editing a single shipped doc.
- **`--since` coherence graph is unaffected.** Its doc→code edges already resolve via exact
  `trackedSet.has(...)`, so broadened candidates that don't resolve simply contribute no edge
  — no phantom neighbors.
- **Zero new dependencies** (regex + a `readdirSync` of the repo root). The honest residual:
  recall is bounded to repo-rooted refs (a ref under a directory that does not exist at the
  repo root is not judged) — a deliberate precision-first choice, consistent with the v0.7.b
  "a drift section that cries wolf is useless" discipline.

Remaining §VIII analysis debt after this slice: **coverage** (deferred for all adapters, and
will be polyglot when built — each ecosystem's native tool → lcov/cobertura, never
`node --test` baked into a core). Queued in HANDOVER.
