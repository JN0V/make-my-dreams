# Minimal lessons fixture — used by composer unit tests.

---

## L-001 — keyword match works for simple words

**Status**: active
**Date**: 2026-05-18
**Origin**: test fixture
**Context**: trivial
**Rule**: be careful with git checkout when an agent is running.
**To promote if**: 5 reuses (counter: 0)
**Keywords for matching**: alpha, bravo, gamma

---

## L-002 — milestone is skipped from matching

**Status**: milestone (smoke test only)
**Date**: 2026-05-18
**Origin**: test fixture
**Rule** (operative implication): milestones are markers, not auto-injected rules.
**Keywords for matching**: alpha, bravo, gamma, milestone

---

## L-003 — multi-word keywords + boundary handling

**Status**: active
**Date**: 2026-05-18
**Origin**: test fixture
**Context**: testing word-boundary regex
**Rule**: when `git branch -d` warns, STOP.
**To promote if**: 3 reuses
**Keywords for matching**: git branch -d | claude -p | mmd --here

---

## L-005 — high-score lesson for topN tie-break

**Status**: active
**Date**: 2026-05-18
**Origin**: test fixture
**Rule**: this rule has many matching keywords for topN tests.
**Keywords for matching**: alpha, bravo, gamma, delta, epsilon, zeta
