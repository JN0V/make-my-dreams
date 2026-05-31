# ADR-024 — Layer C: a runtime profile → constitution-module composer

**Status**: Accepted
**Date**: 2026-05-31
**Deciders**: MMD core (self-dev, 18th reflexive `mmd --here`, 5th with `--label`)
**Parent design**: [SPEC_V03C.md](../../SPEC_V03C.md) (FROZEN). Builds directly on
[ADR-023](./023-dream-catcher-cli-and-profile.md) (which threaded `MMD_PROFILE` into the
build and consumed it minimally) and realises the "Layer C" long described in
[CLAUDE.md](../../CLAUDE.md) "Constitution diffusion mechanisms".

## Context

MMD propagates its modular constitution through three layers (CLAUDE.md):

- **Layer A** — the Claude Code session auto-loads `CLAUDE.md`.
- **Layer B** — `install-mmd.sh` materialises the auto-dev workflow which injects the
  constitution into each phase sub-agent.
- **Layer C** — the **MMD CLI subprocess**: `lib/invoke-autodev.js` injects the
  constitution into the prompt passed to `claude -p`, because a headless subprocess does
  not necessarily share the parent's `CLAUDE.md`.

Until now Layer C was only *partly* real. v0.3.b (ADR-023) threaded the chosen audience
profile to the build as `MMD_PROFILE` and consumed it **minimally**: `buildPrompt` stated
the profile and, for **Kid**, appended a single hand-typed safe-by-default line. That
closed the "dead variable" gap (L-022) but it was an explicit **stopgap** — the bindings
table (`.specify/memory/constitution-bindings.yaml`) already mapped each profile to a real
module set (`Kid → [universal, ai-coding, safe-by-default, kid]`), and the composer that
was supposed to read it (`lib/constitution-compose.js`) did **not yet exist**. CLAUDE.md
described it as "planned v0.2". The gap between design and implementation was named, not
hidden (L-009): a Kid build and a Pro build differed by one prose line, not by the
constitution modules the design intends.

## Decision

### 1. A runtime composer, `lib/constitution-compose.js`

Three small parts, deliberately separated by responsibility (universal §I.S):

- **`parseBindings(yamlText)`** — a hand-rolled YAML-lite parser. Exposes at least
  `defaults.always` (string[]) and `profiles` (map profile → string[]); other dimensions
  (skills/workers/engines/contexts/cli) are captured generically for future extension.
  Tolerates comments, blank lines and the `key: [a, b]` inline-list shape. **Never throws**
  — malformed input yields empty lists.
- **`resolveModules({ profile }, bindings)`** — pure. Returns `defaults.always ∪
  profiles[profile]`, **deduplicated**, in **deterministic order** (defaults first, then
  the profile's additions). Unknown/absent profile → `defaults.always` only.
- **`composeConstitution({ profile, bindingsPath?, moduleDir?, readFileFn? })`** — reads
  each resolved `<moduleDir>/<name>.md`, concatenates them with a clear per-module header
  (`## Constitution — <name>`), **skips** a missing/unreadable module with an inline note,
  and returns the text — or **`null`** when nothing is composable. It is **synchronous**
  (the caller `buildPrompt` is a synchronous prompt assembler) and takes an injected
  `readFileFn` so the unit suite never touches real fs.

### 2. `buildPrompt` injects the composed modules, with a graceful fallback

When `MMD_PROFILE` is set, `buildPrompt` states the profile **and** injects
`composeConstitution({ profile })`. This **supersedes** the v0.3.b hardcoded Kid line — the
rule now lives inside the injected `safe-by-default.md` + `kid.md` (and more). If the
composer returns `null` (bindings file or every module unreadable), `buildPrompt` falls
back to the v0.3.b minimal Kid line. The composer call is also wrapped defensively, so a
composer fault is treated as `null` rather than crashing the build. There is **no
double-inject**: the hardcoded line is the fallback path only. An **unset** `MMD_PROFILE`
leaves the prompt **byte-for-byte unchanged** (back-compat).

### Why a runtime composer (not static text)

The bindings table is the single source of truth for "which modules apply to whom". Baking
the per-profile module text into `buildPrompt` would duplicate that mapping and let it
drift (DRY §III). A runtime composer reads the table at build time, so editing the bindings
or a module file changes the injected constitution with no code change.

### Why hand-rolled YAML over a dependency

Same rationale as `lib/bench/load-dreams.js`: the repo is a **vanilla stack** (universal
§II KISS, SPEC_V01). The bindings file is one level deep (`section:` → `key: [list]`); a
small line-by-line state machine covers it. A full `yaml` npm package would add a
dependency (and slopsquatting surface — security.md) to parse a shape we fully control. If
the table ever grows nested/anchored YAML, revisit.

### Why it supersedes the v0.3.b stopgap

v0.3.b shipped the minimal consumption so the profile was meaningful *immediately* without
coupling that slice to the composer rework (ADR-023 "What is deliberately deferred"). v0.3.c
is that rework. Keeping the minimal line as the **fallback** preserves the honest
degradation contract while the composed modules become the normal path.

### The graceful-fallback contract (universal §VI)

A missing bindings file or module **never** breaks a build. `parseBindings` never throws;
`composeConstitution` skips an unreadable module with a visible inline note and returns
`null` when nothing is composable; `buildPrompt` then falls back to the v0.3.b line. We
degrade and say so, rather than fabricate or crash over a missing doc.

### Deferred: engine / context / skill / worker dimensions

`constitution-bindings.yaml` also binds `skills`, `workers`, `engines`, `contexts`, `cli`.
v0.3.c composes by **profile** only (the `MMD_PROFILE` ask). `resolveModules` is built to
extend — a future slice can take the union across several dimensions (e.g. profile ∪ engine
∪ context) before reading the files. Composing those now would be speculative (universal
§II YAGNI); the parser already captures them so the data is ready.

## Consequences

- **Positive**: a Kid build now carries the **actual** `safe-by-default.md` + `kid.md` text
  (no social, no commerce, hardware-permission-on-gesture, accessibility, …), not a single
  line; a Pro build carries `pro.md`. The bindings table is finally load-bearing at
  runtime. Layer C, described as "planned", now **exists**. The profile story is closed end
  to end (status.json → `MMD_PROFILE` → bindings → modules → prompt).
- **Negative / accepted**: only the profile dimension is composed (engine/context/skill
  deferred — named, not hidden, L-009). The composer reads ≤ ~6 small files per build with
  no caching; fine at this scale (SPEC_V03C §4), revisit for a huge table.
- **Honesty (universal §VI)**: the degradation path is explicit and tested — unreadable
  bindings/modules fall back to the minimal line with a visible note, never a fabricated or
  crashing build.

## References

- [SPEC_V03C.md](../../SPEC_V03C.md) — the slice spec (FROZEN)
- [ADR-023](./023-dream-catcher-cli-and-profile.md) — profile threading + the minimal v0.3.b consumption this supersedes
- [CLAUDE.md](../../CLAUDE.md) — "Constitution diffusion mechanisms" (Layers A/B/C)
- [`.specify/memory/constitution-bindings.yaml`](../../.specify/memory/constitution-bindings.yaml) — the bindings table read at runtime
- [L-022](../lessons-learned.md) — don't thread a variable nothing consumes (the producer/consumer pairing this completes)
- [L-009](../lessons-learned.md) — communicate the design/implementation gap (the deferred dimensions)
- [`lib/bench/load-dreams.js`](../../lib/bench/load-dreams.js) — the hand-rolled YAML-lite precedent
