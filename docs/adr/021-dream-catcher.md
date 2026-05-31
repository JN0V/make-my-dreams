# ADR-021 — Dream Catcher: BMAD-backed scope refinement before auto-dev (v0.3.a-1)

**Status**: Accepted
**Date**: 2026-05-31
**Deciders**: MMD core (self-dev, 15th reflexive `mmd --here`, 2nd with `--label`)
**Parent design**: [SPEC_V03A.md](../../SPEC_V03A.md) (FROZEN) — this ADR records the
walking-skeleton decisions implemented in [SPEC_V03A1.md](../../SPEC_V03A1.md).

## Context

Today `mmd "<dream>"` and the `mmd serve` web form take a dream **verbatim** and
launch auto-dev immediately. A 13-year-old's "une appli pour dessiner" goes
straight to the pipeline with zero clarification, so the result is a guess. The
Dream Catcher inserts a short, friendly **refinement step** that turns a vague
one-line dream into a small, buildable scope **before** auto-dev runs.

Two design pillars, both resolved in the parent design conversation:

1. **Stand on a BMAD elicitation skill, don't reinvent question generation.**
   Each elicitation turn is a headless `claude -p "/bmad-product-brief …"` call —
   the exact spawn pattern MMD already uses for `/bmad-adv-auto-dev`
   ([invoke-autodev.js](../../lib/invoke-autodev.js)). MMD orchestrates; BMAD
   facilitates.
2. **The user picks an involvement level** — Autonome → Équilibré → Guidé. v0.3.a-1
   ships ONLY the **Autonome** path; the multi-turn dial + scope editing land in
   v0.3.a-2.

A crucial reality from the smoke test (see L-021): a headless `claude -p`
subprocess has **no stdin**, so BMAD's own interactive loop cannot run inside one
call. Interactivity therefore lives at the **MMD layer** (the web UI collects
answers), and BMAD is invoked **statelessly per turn**. "Autonome" = ONE stateless
call (zero questions → scope). "Guidé" = N MMD-driven stateless calls (a-2). The
dial controls *how many turns MMD runs*, not a flag inside one BMAD call.

## Decision

Ship the thinnest end-to-end vertical (walking skeleton, L-009), web-only:

```
[web] dream → [web] profile (1 question) → ONE autonomous /bmad-product-brief call
      → [web] scope card → [web] "C'est parti !" → existing auto-dev pipeline
```

Key choices:

- **Surface-agnostic core** under `lib/dream-catcher/`, all I/O injected so the
  web layer, a future CLI/TTY layer (v0.3.b), and the unit tests drive the same
  code with no real claude/web/fs:
  - `session.js` — the `dream → profile → synthesize → scope → confirm` state
    machine, with a no-op `clarify()` **seam** between `profile` and `synthesize`
    so a-2 inserts clarifying turns without a rewrite.
  - `elicit.js` — builds the profile-aware **autonomous** prompt (headless,
    no-questions, walking-skeleton cap of one capability + ≤2 extras, Kid
    safe-by-default framing) and runs `claude -p`, reusing `buildSubprocessEnv`
    + args-array/`shell:false` + timeout from `invoke-autodev.js`.
  - `parse-reply.js` — pure `reply → {scope}|{unparseable}`; trivial for the
    autonomous path (the reply IS the scope) but isolated so a-2 can add the
    `{question}` shape, and so empty/short/garbage replies are caught here.
  - `profile.js` — `Kid|Curious|Pro` enum + French UI-label aliases + tone hints;
    default `Curious`.
- **Web wiring** in `lib/server.js`: `/api/catch/start|answer|confirm`, session
  state in an in-memory map (single-user localhost). The legacy `POST /api/dream`
  is **kept untouched** (back-compat) — the shared `launchJobAndRespond()` helper
  is the only refactor, so both paths launch identically (DRY).
- **Honest fallback (universal §VI).** On ANY BMAD failure — spawn error,
  non-zero exit, timeout, empty/unparseable reply — the chain falls back to
  launching the **verbatim dream** with a visible note, and NEVER fabricates a
  scope. This mirrors the 5-Whys sacred `escalate-to-user` fallback (ADR-011).
- **`status.json` carries the refined scope + profile** at confirm time
  (`dream:scope`, `profile`). **Honest limitation (L-009):** the spawned
  `bin/mmd.js` pipeline owns and re-initializes `status.json` on launch, so in
  production the `profile` field is authoritative only until the subprocess
  rewrites it. Threading the profile *into* the subprocess (`MMD_PROFILE`) is
  deliberately deferred to v0.3.a-2 (SPEC_V03A1 §4 out-of-scope) — this slice
  proves the chain, not the full profile propagation.

## Consequences

- The whole chain — web input → profile → headless BMAD → scope card → confirm →
  existing auto-dev — works through one clean, tested vertical, with a
  surface-agnostic core ready for a-2 to extend (dial + scope editor + CLI/TTY).
- The autonomous call can run for tens of seconds; `/api/catch/answer` disables
  the 30 s per-request timeout for that long-poll (as the SSE handler does).
- Out of scope (a-2 unless noted): the Équilibré/Guidé multi-turn dial, scope
  editing before launch, the CLI/TTY surface (a-3 / v0.3.b), full `MMD_PROFILE`
  config, and multi-user/auth (stays single-user localhost).

This is the first user-facing Dream Catcher slice: it converts a vague dream into
a tiny buildable scope before the pipeline ever starts — narrowing toward a
walking-skeleton scope, never brainstorming more features.
