# ADR-022 — Dream Catcher involvement dial + scope editing

**Status**: Accepted
**Date**: 2026-05-31
**Deciders**: MMD core (self-dev, 16th reflexive `mmd --here`, 3rd with `--label`)
**Parent design**: [docs/specs/SPEC_V03A.md](../../SPEC_V03A.md) (FROZEN) — this ADR records the
decisions implemented in [docs/specs/SPEC_V03A2.md](../../SPEC_V03A2.md), completing the Dream
Catcher core begun in [ADR-021](./021-dream-catcher.md) (the v0.3.a-1 walking skeleton).

## Context

The walking skeleton ([ADR-021](./021-dream-catcher.md)) shipped only the **Autonome**
path: one autonomous `bmad-product-brief` call turned a dream into a scope, with no way
for the user to be more involved and no way to revise the scope before launching. It left
two explicit seams: a `clarify()` async hook in `session.js` and a `{question}` shape
stubbed in `parse-reply.js`. This slice fills them to deliver the two remaining
frozen-design pieces:

1. **The involvement dial** — the user chooses how involved they want to be:
   **Autonome / Équilibré (default) / Guidé**, which MMD maps to **0 / 1 / 2–3**
   clarifying turns before the scope is synthesized.
2. **Scope editing** — the user can revise the synthesized scope (plain text) before
   confirming, so a wrong guess does not force a full restart.

The hard reality from [L-021](../lessons-learned.md) still governs the design: a headless
`claude -p` subprocess has **no stdin**, so BMAD's interactive loop cannot run inside one
call. Multi-turn elicitation therefore lives at the **MMD layer** — MMD asks one question
per stateless call, collects the user's answer in the web UI, and only synthesizes after
the last answer. The dial controls *how many turns MMD runs*, not a flag inside one BMAD
call.

## Decision

### Level → turn-count mapping

A new `lib/dream-catcher/level.js` mirrors `profile.js`: a frozen
`Autonome | Équilibré | Guidé` enum with friendly + ASCII + English aliases, defaulting to
**Équilibré**, and a `turnsForLevel()` mapping:

| Level     | Clarifying turns |
|-----------|------------------|
| Autonome  | 0 (the a-1 path — one synthesize straight from dream + profile) |
| Équilibré | 1                |
| Guidé     | 2 (may go up to a `MAX_TURNS = 3` cap) |

Like profiles, an absent / unknown / non-string level normalizes to the default and never
throws — the level arrives from an untrusted web client.

### State-driven `/api/catch/answer`

Rather than add `/level` or `/clarify` public routes (which would break the frozen
SPEC_V03A API), `/api/catch/answer` becomes **state-driven**: the session decides whether
the incoming `answer` is a profile, a level, or a clarifying answer based on its current
state, and the response `{next}` ∈ `level | question | scope` tells the front end what to
render. The flow is now:

```
dream → profile → LEVEL → [question → answer] × (0|1|2–3) → scope (editable) → confirm → auto-dev
```

`setProfile` now only advances to the new `LEVEL` state (it no longer synthesizes).
`setLevel` either runs the one Autonome synthesize (N=0) or asks the first question (N>0).
Each clarifying answer is recorded in `answers[]`; the single synthesize fires only after
the Nth answer. **Exactly one synthesize call happens per completed flow, at every level.**

### Deterministic `{question}` / `{scope}` output tagging

Detecting "is this reply a question or a scope?" by heuristic would be fragile. Instead the
`ask_question` and `synthesize` prompts instruct BMAD to **tag** their output with an
explicit leading marker — `QUESTION:` for a clarifying question, `SCOPE:` for a scope — and
`parse-reply.js` keys off the tag, not on guessing (the L-021 spirit: MMD controls each
turn's intent). An **untagged** reply keeps the a-1 behavior (the whole reply is the scope),
so the Autonome prompt and all its existing tests are unchanged.

### Scope editing

`session.editScope(text)` replaces the scope in place (validated non-empty, length-capped),
**stays in SCOPE**, makes no BMAD call and no relaunch. A new `POST /api/catch/edit
{sessionId, scope}` route exposes it with the same CSRF/Host/content-type preflight and
capped-body parsing as the other catch routes; editing outside SCOPE is rejected. A
subsequent `/confirm` naturally launches the edited scope because it reads `session.scope`.

### Honest fallback preserved on every turn

The universal §VI honest fallback is intact at every turn: a synthesize that returns no
usable scope falls back to the **verbatim dream** (never a fabricated scope), and an
`ask_question` turn that yields no usable question **degrades gracefully** — the session
synthesizes with whatever answers it has rather than hang or invent a question.

## Consequences

- The Dream Catcher core is complete: a child can pick **Guidé**, answer two friendly
  questions, see a tailored scope, edit one line, and launch — while an **Autonome** user
  still goes straight from profile to scope (the a-1 path, behavior-preserved).
- The frozen SPEC_V03A API holds: the only new public route is `/edit`; `/answer` stays one
  route by being state-driven.
- The autonomous synthesize can run for tens of seconds; the level/clarify answer requests
  disable the per-request timeout for that long-poll and serialize behind the single
  in-flight synthesize guard (carried over from a-1).
- Still out of scope (→ v0.3.b): the CLI/TTY surface and full `MMD_PROFILE` threading into
  the auto-dev subprocess. Editing re-runs no elicitation — it is a plain text replace.

This completes the involvement dial + scope editing the walking skeleton deferred, filling
the seams ADR-021 left for exactly this slice.
