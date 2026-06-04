# ADR-054 — The transparent Conductor: monitor + hybrid auto-handoff default-on

**Status**: accepted
**Date**: 2026-06-04
**Slice**: v0.15.a (make the proven v0.14.0 hybrid auto-handoff the DEFAULT, instead of opt-in behind `--auto-handoff`)

## Context — opt-in was the wrong product default

The Conductor's job (vision §4.2) is to be **INVISIBLE** — the user should never
think about context limits. The orchestrator monitors its own context, hands the
run off to a fresh successor when it fills, and the build completes regardless of
how long it runs.

Through v0.5.b → v0.14.b that machinery was built **opt-in**, behind
`--monitor` / `--auto-handoff`. The gate was deliberate caution (L-027): the
`--output-format stream-json` spawn the monitor needs *changes how auto-dev is
launched*, and the default text spawn is the **reflexive bootstrap** that builds
MMD itself — so we pinned the default args byte-for-byte and required an explicit
flag.

That caution made sense **while the hybrid was unproven**. Two things changed:

1. **The hybrid is now PROVEN LIVE** (v0.14.0, ADR-053): cooperative incitation
   *and* the enforce backstop both fired on real runs (AC-5 proven both paths).
2. **A flag is exactly what the audience can't pass.** A non-technical
   `serve` / Dream-Catcher user — the whole accessibility mission — will never type
   `--auto-handoff`. Leaving the Conductor opt-in means the people who most need an
   invisible context manager never get one. The flag turned a safety feature into a
   power-user toggle.

So the proven hybrid must become the **DEFAULT**, with one clean escape hatch.

## Decision — flip the defaults, keep one opt-out, keep the legacy flags inert

The monitored spawn **and** the v0.14.0 hybrid handoff loop now run **by default**
on `mmdream --here`, the greenfield path, and `serve`. This is a **defaults flip +
a single opt-out + back-compat handling** — **no handoff logic is re-implemented**.
The entire v0.14.0 machinery (the loop, `decideHandoff` + its v0.13.1 gate,
`shouldForceHandoff`, the abort seam, the monitor, the resume relaunch, the v0.11
alignment gate) is **reused UNCHANGED**.

- **`buildAutodevArgs`** (`lib/invoke-autodev.js`): the `monitor` parameter now
  defaults to `true`, so the default CLI args **include** `--output-format
  stream-json --verbose`. `monitor:false` is the byte-for-byte historical shape.
- **`resolveConductorMode(env)`** (`lib/argv-parser.js`): a new pure resolver —
  default `{monitor:true, autoHandoff:true}`; the single opt-out
  **`MMD_NO_AUTO_HANDOFF=1`** → both `false`. It reads ONLY the env, so the legacy
  `--auto-handoff` / `--monitor` flags are **accepted-but-inert no-ops** (kept in
  `KNOWN_FLAGS` so old scripts never hit an "unknown flag" error; they parse and
  change nothing — the Conductor is already on).
- **`bin/mmd.js`** dispatch resolves the conductor mode from the env opt-out (not
  the flags) and threads it into `runHereMode` and the greenfield path identically.
- **`serve`** (`lib/server.js`): the spawned greenfield build is Conductor-default-on
  in the child, so serve threads **no `--monitor`**; the "Monitor context (advanced)"
  web checkbox is **retired** and the gauge polls/shows transparently whenever
  context data exists. `MMD_NO_AUTO_HANDOFF=1` (inherited via the `MMD_` env
  allowlist) opts the whole machine out.

`MMD_AUTODEV_MODEL` still composes into the spawn; the alignment gate still runs
**once** on true completion (after the loop returns the final successor's result).

## Why this is safe (the retired byte-for-byte-default-spawn contract)

The earlier "default spawn must be byte-for-byte unchanged" contract was
**self-imposed caution**, and we **retire it** here — deliberately, with the
escape hatch preserved:

- **`stream-json` changes only the OUTPUT FORMAT, not the agent's work.** The
  monitor re-renders the stream into human-readable progress; the build the agent
  produces is identical. The bootstrap self-build now runs monitored by default
  and the suite stays green + the result is unaffected.
- **The hybrid only acts at the threshold.** Below it, the Conductor is a no-op
  plus a negligible stream-json parse cost.
- **The v0.13.1 no-false-handoff gate is preserved.** A run that crosses the
  threshold but reaches **no new phase boundary** is never killed; the cooperative
  path still works when the agent obeys; the enforce backstop still fires when it
  doesn't — all reachable now **without a flag** (proven by the AC-4 default-on
  integration tests).
- **`MMD_NO_AUTO_HANDOFF=1` restores today's EXACT behavior** — a plain text spawn,
  one un-looped invocation, no monitor — the bootstrap/cost escape hatch for any
  wary case. The spawn-pin tests are **inverted** (default has stream-json; the
  opt-out is byte-for-byte the historical args) so the contract is locked in both
  directions.

## Open question, noted (not blocking)

Whether the orchestrator genuinely **saturates** on a real slice is unmeasured —
it delegates each phase to a fresh sub-agent, so it may stay light. Default-on is
SAFE regardless (the hybrid only acts at the threshold; below it it is inert + the
parse cost). If real runs never approach the threshold, a later slice may
downscope — but default-on **with an opt-out** is the correct, reversible product
default now. (Separately, `contextWindowFor('sonnet')` mis-estimates Sonnet's
window — a small fix tracked independently; the default model is correctly
detected, so it does not block the flip.)

## Consequences

- **Positive**: the Conductor is invisible — the §4.2 intent. A plain
  `mmdream --here` / serve / greenfield run monitors + hands off transparently with
  no flag and no checkbox. Zero new handoff logic; everything reuses v0.14.0. The
  opt-out and inert legacy flags mean nothing breaks for existing scripts.
- **Negative / limits**: every default run now pays the negligible stream-json
  parse cost and runs monitored (the bootstrap included) — `MMD_NO_AUTO_HANDOFF=1`
  is the escape hatch. The saturate question stays open (above). Removing the
  legacy flags entirely is deferred to a future major.

## Alternatives considered

- **Stay opt-in** — rejected: it defeats the accessibility mission (the audience
  can't pass a flag) now that the hybrid is proven; opt-in was caution for an
  unproven feature, not a product stance.
- **A new `--transparent` / config toggle to opt IN per run** — rejected: still a
  flag the end-user won't pass; the right default IS on, with one opt-out.
- **Keep the byte-for-byte default-spawn contract and monitor via a side channel** —
  rejected: there is no side channel for the orchestrator's own context usage; the
  only source is the `stream-json` stream, which changes the spawn. Since
  stream-json is output-format-only, changing the default spawn is safe.
- **Remove `--auto-handoff` / `--monitor` now** — rejected: keeping them inert is
  free back-compat; a future major may drop them.

See docs/specs/SPEC_V015A.md, ADR-053 (the proven hybrid this makes default — note its
"Default-on — rejected (L-027)" alternative is the decision this ADR reverses now
that the hybrid is proven), ADR-051 (cooperative), ADR-050 (resume), ADR-030 (the
monitor), ADR-049 (the alignment gate that still runs once), L-027 (the opt-in
spawn-changing-observability rule this retires), L-004/§VI (the green-by-fakes trap
the AC-4 default-on tests guard against).
