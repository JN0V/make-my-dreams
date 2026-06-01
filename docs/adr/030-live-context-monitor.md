# ADR-030 — Live context monitor: an opt-in `--monitor` that parses stream-json into a context % + a 70% READY_FOR_HANDOFF signal

**Status**: Accepted
**Date**: 2026-06-01
**Deciders**: MMD core (self-dev, 25th reflexive `mmd --here`, 12th with `--label`)
**Parent design**: [docs/specs/SPEC_V05B.md](../../SPEC_V05B.md) (FROZEN). Second brick of the v0.5 **Conductor** (MAKE_MY_DREAMS.md Layer 6 — orchestration/observability), following the notification fan-out ([ADR-029](./029-conductor-notifications.md)).

## Context

The Conductor needs to **see** how full the orchestrator's context window is during a long auto-dev run — the precursor to the eventual auto-handoff/resume (start a fresh context before the current one degrades — P-01 context rot, ai-coding.md §IV). Token visibility was the open question; it is now answered:

`claude -p --output-format stream-json --verbose` emits one JSON object per line:
- a `system`/init event carrying the **model** (e.g. `claude-opus-4-8[1m]` — the `[1m]` suffix signals the **1M** context window; a plain id is the standard 200K),
- `assistant` events whose `message.usage` reports `input_tokens` + `cache_read_input_tokens` + `cache_creation_input_tokens` (+ `output_tokens`), and
- a final `result` event with a top-level `usage`.

Summing **input + the two cache buckets** gives the size of the prompt the model just processed — i.e. how full its context window is. Dividing by the window gives a live **context %**. (See L-027.)

The risk: the default text-spawn path is the one `mmd --here` uses to build **everything, including MMD itself** (the reflexive bootstrap, MAKE_MY_DREAMS.md §7). A regression there breaks self-development. So the question for v0.5.b was *how to add stream-json parsing without endangering the bootstrap path*.

## Decision

Add the monitor as an **opt-in `--monitor` flag** that switches auto-dev to a stream-json spawn; leave the default spawn **byte-for-byte untouched**.

### 1. Opt-in protects the bootstrap (the central safety decision)

`--monitor` is a boolean in its own `MONITOR_FLAGS` group (composes with engine/mode/sealed — no mutex). When **absent** (the default), `buildAutodevArgs` returns the historical `['-p', '/bmad-adv-auto-dev <prompt>']` — **no `--output-format`** — and the stdout tee is the historical raw passthrough. When **present**, and only for the real CLI, the args append `--output-format stream-json --verbose`, and a line-buffering consumer replaces the raw tee. A unit test pins the invariant ("default args contain no `--output-format`"); an integration test proves the default path still writes no `status.json.context`. The default path that builds MMD is therefore provably unchanged — the same discipline that made notifications safe to ship first (ADR-029 §5), now applied to the riskier spawn-changing brick.

### 2. A pure parser (`lib/conductor/stream-parse.js`) + a tee consumer

The math/parse is **pure, no I/O, never throws** (a partial or non-JSON line → `null`, never a crash inside a live stream's data handler):
- `parseStreamEvent(line)` → `{ type, model?, usage?, text? }` or `null`. `model` comes from the **system** event (the only one carrying the `[1m]` suffix — the `assistant` event's `message.model` lacks it, so we deliberately do not read it); `usage` from `assistant.message.usage` or the top-level `result.usage`; `text` from the assistant content parts (for the readable tee).
- `contextWindowFor(model)` → `{ window, estimated }`: `[1m]` → `{1_000_000,false}`; a known `claude-(opus|sonnet|haiku)…` → `{200_000,false}`; unknown/empty → `{200_000,true}`. The object shape is deliberate: it is the only way to carry the honest `estimated` flag inside the spec's 4-function API without inventing an exact figure for an unrecognized model (universal §VI). Callers pass `.window` to `contextPct`.
- `contextTokens(usage)` → `input + cache_read + cache_creation` (output excluded — it is produced, not consumed-on-the-way-in; missing fields → 0).
- `contextPct(usage, window)` → `{ tokens, pct }` (`pct = tokens/window`, 0 for a non-positive window — never NaN/Infinity).

The tee consumer (`makeMonitorConsumer`, in `invoke-autodev.js` because it touches the streams) buffers stdout into lines, re-renders **human-readable** progress — the assistant text + periodic `[monitor] context X% (tokens/window)` lines, **never the raw JSON** — and tracks the running **MAX** context, calling `onContext({model,window,tokens,pct,estimated})` on each new max. `MMD_QUIET=1` still silences the terminal tee while preserving the log (as today).

### 3. The 70% signal + `context_70` notification (reuse, debounced)

`bin/mmd.js` threads `flags.monitor` into `invokeAutodev` on **both** the greenfield and `--here` paths and wires `onContext` to:
- write `status.json.context = {model,window,tokens,pct,estimated}` live (best-effort, chained); and
- on the **first** crossing of `MMD_HANDOFF_THRESHOLD` (default `0.70`, a custom value in `(0,1]` honored): write a `ready_for_handoff` marker (`{at,threshold,pct,tokens,window,model,estimated}`) into `status.json`, log a `READY_FOR_HANDOFF` line, and fire a **`context_70`** notification **exactly once** (debounced) by reusing the v0.5.a fan-out (`lib/conductor/notify.js`, no-op unless `MMD_NOTIFY_URL` is set). `context_70` joined the closed event set with a ⚠️ presentation; the metadata-only body shape is unchanged.

All side effects are **best-effort**: a status-write or notify fault is swallowed and never changes the run's exit code (error-handling.md; mirrors `maybeNotify`).

### 4. The signal makes the Conductor SEE; it does NOT stop the run

Crossing 70% is an **observability + early-warning** signal, not an action. The run is **not** stopped — there is no auto-handoff yet. Auto-handoff/resume-in-fresh-context is deliberately deferred: auto-dev is a **monolithic** BMAD call, so "handoff of what, to where" needs MMD-orchestrated steps that do not exist yet. v0.5.b makes the context visible so that the future handoff has something to trigger on.

### 5. Honesty caveats (what the number is and isn't)

- **Orchestrator context, not per-sub-agent.** The top-level stream sees only the macro auto-dev loop's context. The Phase 1–4 sub-agents run in their own fresh contexts (the workflow's whole point); the monitor does not see those. The `[monitor]` line and `status.json.context` are explicitly the *orchestrator's* window. (Today's gap vs the design — L-009 discipline — recorded so it is not mistaken for the whole picture.)
- **`estimated` is never a fabricated %.** An unrecognized model yields `estimated:true` + the documented 200K default window rather than a confident-but-wrong figure (universal §VI).

## Consequences

**Positive**: the Conductor can now SEE context filling up, on greenfield and `--here`, with `status.json.context` available for a future serve-UI gauge; the early-warning ping reuses the proven notification channel; the bootstrap path is provably untouched.

**Negative / residual**: no auto-handoff yet (deferred — the run still rides one context to the end); per-sub-agent context is invisible (only the orchestrator's); `--monitor` does not currently compose with the sealed pipeline's spawn (the two-phase `--sealed` flow is a separate opt-in — a follow-up if both are wanted together).

**Deferred**: the actual auto-handoff/resume; making `--monitor` the default (would re-introduce the bootstrap risk — kept opt-in); per-sub-agent accounting; a serve-UI context gauge driven by `status.json.context`.

See [docs/specs/SPEC_V05B.md](../../SPEC_V05B.md), [ADR-029](./029-conductor-notifications.md), and [L-027](../lessons-learned.md).
