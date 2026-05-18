# Malformed lessons fixture — tolerated edge cases per AC-2.

---

## L-100 — no Status field at all

**Date**: 2026-05-18
**Rule**: this lesson is missing its Status — parser should warn but keep going.
**Keywords for matching**: alpha

---

## L-101 — no Rule field

**Status**: active
**Date**: 2026-05-18
**Origin**: test fixture
**Keywords for matching**: beta

---

## L-102 — no Keywords field

**Status**: active
**Date**: 2026-05-18
**Rule**: rule without keywords — will never match.

---

## L-103 — Rule with parenthetical

**Status**: active
**Date**: 2026-05-18
**Rule** (operative implication): parenthetical Rule label MUST still parse.
**Keywords for matching**: delta

---

## L-104 — keywords using pipe separator

**Status**: active
**Date**: 2026-05-18
**Rule**: pipe-separated keywords are tolerated.
**Keywords for matching**: foo bar | baz qux | quux

---

## L-105 — multi-line Keywords trigger F8 warning

**Status**: active
**Date**: 2026-05-18
**Rule**: only first line of keywords is parsed; later lines are dropped + warned.
**Keywords for matching**: alpha, bravo
charlie, delta

---

## L-106 No-separator header should fire F13 warning

**Status**: active
**Date**: 2026-05-18
**Rule**: this lesson should be dropped — its `## L-106 No-separator...` line lacks the canonical `—` separator.
**Keywords for matching**: should-not-leak
