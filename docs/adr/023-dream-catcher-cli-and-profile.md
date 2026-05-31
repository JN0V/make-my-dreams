# ADR-023 — Dream Catcher CLI surface + profile threading into the build

**Status**: Accepted
**Date**: 2026-05-31
**Deciders**: MMD core (self-dev, 17th reflexive `mmd --here`, 4th with `--label`)
**Parent design**: [SPEC_V03A.md](../../SPEC_V03A.md) (FROZEN) — this ADR records the
decisions implemented in [SPEC_V03B.md](../../SPEC_V03B.md), the final v0.3 piece. It
builds directly on [ADR-021](./021-dream-catcher.md) (the surface-agnostic core) and
[ADR-022](./022-dream-catcher-dial-and-edit.md) (the dial + scope editing).

## Context

v0.3.0 / v0.3.1 built the Dream Catcher on a **surface-agnostic core**
(`lib/dream-catcher/session.js`): a pure state machine `setDream → setProfile →
setLevel → answerClarify… → confirm` with the elicitation runner injected, plus the
involvement dial (`level.js`) and audience profile (`profile.js`). That core was wired
to exactly ONE surface — the **web** (`mmd serve`, `lib/server.js` over HTTP). Two gaps
remained between the *design* and the *implementation* (L-009 discipline — name the gap,
don't present it as a boundary):

1. **No terminal surface.** A Pro running `mmd "<dream>"` in a terminal got the legacy
   one-shot path: the dream was launched verbatim, with none of the profile/level/scope
   refinement the web user enjoyed. The core was explicitly built to be surface-agnostic,
   so this was missing wiring, not a missing capability.
2. **The profile was a dead variable.** The chosen profile was persisted to
   `status.json.profile` and then... nothing read it. The actual build (`auto-dev`) never
   saw it, so a Kid dream and a Pro dream produced byte-for-byte identical prompts. A
   variable nothing consumes is an observability defect (see [L-022](../lessons-learned.md)).

## Decision

### 1. CLI/TTY surface — a thin readline driver over the SAME core

`lib/dream-catcher/cli-driver.js` exposes `runCliDreamCatcher({dream, io, elicit})`. It
drives the session core turn by turn exactly as `lib/server.js` does over HTTP — there is
**no new dialogue logic**, only terminal I/O. Everything external is **injected**:

- `io` — a readline-like channel `{ ask(prompt) → Promise<string|null>, print(text) }`.
  `ask` returns `null` on EOF, which is the load-bearing **abort** signal.
- `elicit` — the elicitation runner (the real `runElicit`, or a fake in tests).

This DI keeps the driver pure over its seams, so unit tests script stdin + a fake elicit
and an integration test drives the real `runElicit` (fake `claude` via `MMD_AUTODEV_CMD`)
— the real `claude` is **never** called from tests (mirrors the core's existing design).
`bin/mmd.js#createReadlineIo` is the production `io` (a `node:readline/promises` channel).

**Best-effort editing** (`[M]odifier`): if `$EDITOR` is set, the scope round-trips through
a temp file (`lib/dream-catcher/editor.js`); otherwise a single-line replacement prompt.
A rich in-terminal editor is explicitly out of scope (SPEC_V03B §4).

### 2. TTY-gated trigger (greenfield only, never `--here`)

`resolveShouldCatch(flags, isTTY)` = `flags.catch || (isTTY && !flags['no-catch'])`. The
dialogue is **ON by default on a TTY** (so the terminal user gets the conversation), with
`--catch` / `--no-catch` overrides (mutually exclusive — exit 2). It is **never** run under
`--here`: brownfield self-modification is a dev flow, not an end-user dream. A non-TTY
without `--catch` skips the dialogue and launches the verbatim dream (today's behavior,
**CI-safe**); `--catch` on a non-TTY exits 2 ("needs a terminal"); an aborted dialogue
(EOF / restart→EOF) does **not** launch. On confirm the refined scope replaces the dream,
the slug is re-derived, and the chosen profile is persisted to `status.json`.

### 3. Profile threading WITH minimal-but-real consumption

The profile reaches the build via the `MMD_PROFILE` env var on **both** launch paths:
- CLI greenfield (`bin/mmd.js`): `process.env.MMD_PROFILE` is set before `invokeAutodev`.
- Web confirm (`lib/server.js`): `MMD_PROFILE` is added to the spawned child's env.

`buildSubprocessEnv` already allowlists every `MMD_*` var, so no allowlist change was
needed. **Consumption** lives in `buildPrompt` (`lib/invoke-autodev.js`): when
`MMD_PROFILE` is set it states the audience profile in the prompt, and for **Kid** it
injects the **safe-by-default** directive (no network, no third parties, offline, no
accounts/UGC, age-appropriate). An **unset** `MMD_PROFILE` leaves the prompt byte-for-byte
unchanged (back-compat: every existing greenfield/CI run is unaffected). Default `Curious`
— never empty.

### What is deliberately deferred

The **full runtime constitution binding** — reading `constitution-bindings.yaml` to inject
the `kid.md` / `pro.md` modules per profile — is a **composer evolution**, its own slice.
v0.3.b ships the minimal consumption (state the profile; Kid → safe-by-default) so the
profile is meaningful *now*, without coupling this slice to the composer rework.

## Consequences

- **Positive**: Dream Catcher now works from both the browser AND the terminal over one
  shared core (no duplicated dialogue logic — DRY, §III). The profile is no longer dead:
  a Kid dream carries safe-by-default constraints into the actual build. The CLI driver is
  fully testable without a real TTY or real `claude`.
- **Negative / accepted**: terminal scope editing is best-effort (not a rich editor); the
  profile→constitution-module binding is still pending (named, not hidden — L-009). The CLI
  driver assumes a single synchronous dialogue per invocation (fine for one user at a
  terminal — SPEC_V03B §4 scale note).
- **Honesty (universal §VI)**: the honest fallback is inherited from the core — a BMAD
  failure launches the verbatim dream with a visible note, never a fabricated scope.

## References

- [SPEC_V03B.md](../../SPEC_V03B.md) — the slice spec (FROZEN)
- [ADR-021](./021-dream-catcher.md), [ADR-022](./022-dream-catcher-dial-and-edit.md) — the core + dial
- [L-021](../lessons-learned.md) — headless `claude -p` has no stdin (why elicitation is MMD-orchestrated)
- [L-022](../lessons-learned.md) — don't thread an env var nothing consumes (observability)
