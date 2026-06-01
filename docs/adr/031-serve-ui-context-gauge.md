# ADR-031 — serve-UI context gauge + an opt-in "Monitor context" web toggle

**Status**: Accepted
**Date**: 2026-06-01
**Deciders**: MMD core (self-dev, 26th reflexive `mmd --here`, 13th with `--label`)
**Parent design**: [docs/specs/SPEC_V05C.md](../../SPEC_V05C.md) (FROZEN). Makes the v0.5.b live context monitor ([ADR-030](./030-live-context-monitor.md)) **visible** in the `mmd serve` web UI — third user-facing step of the v0.5 **Conductor** (MAKE_MY_DREAMS.md Layer 6 — orchestration/observability).

## Context

v0.5.b ([ADR-030](./030-live-context-monitor.md), L-027) added `--monitor`, which writes the orchestrator's live context fill to `status.json.context = {model, window, tokens, pct, estimated}` (plus a sibling `ready_for_handoff` marker once 70% is crossed). But that data is only readable by someone tailing JSON in a terminal. The whole point of `mmd serve` is the **non-technical user** (the daughter at the web page, MAKE_MY_DREAMS.md §1) — who never sees it. The monitor was real but invisible.

The gap (L-009 — design vs current code): the *design* wants the user to **watch** the context fill toward the eventual auto-handoff; the *current code* only persisted the numbers. v0.5.c closes the visibility half of that gap. The auto-handoff/resume itself stays future.

Two sub-questions:
1. **How does the web page get the context numbers?** `mmd serve` already has `GET /api/status/<slug>`, which returns the build's `status.json`. The monitor already writes `context` there.
2. **How does a web launch turn the monitor on?** The web launch spawns `node bin/mmd.js <dream>` with no `--monitor`. Something has to opt in.

## Decision

A small **context gauge** in the progress view, fed by polling `/api/status/<slug>.context`, plus an **opt-in "Monitor context (advanced)" checkbox** that appends `--monitor` to the web launch. Unchecked (the default) is byte-for-byte today's web behavior.

### 1. `/api/status` exposes `context` (additive, back-compatible)

`handleStatus` already returns the parsed `status.json` verbatim. v0.5.c folds the sibling `ready_for_handoff` marker into a **boolean on the returned `context` object** (`context.ready_for_handoff`) so the gauge has a single object to read. The fold happens only when `context` is a plain object; absent/malformed `context` → key omitted / passed through unchanged, and a missing/malformed `status.json` behaves exactly as before. Nothing else in the response shape changes.

### 2. Opt-in "Monitor context" toggle threads `--monitor`

The dream form gets a checkbox. The choice is made on the form but only takes effect at **launch**, so the client captures it at submit and sends `monitor` in the launch body. Both launch routes — `POST /api/dream` (legacy) and `POST /api/catch/confirm` (the Dream Catcher path the UI actually uses) — validate it as a **strict boolean** (only literal `true`; any junk → `false`, security.md input validation) and pass it to `launchJobAndRespond`, which threads `--monitor` **before** the dream via the pure helper `buildMmdAutodevArgs`. With the toggle off, the spawn args are **byte-for-byte today's** (`[mmdEntry, dream]` — no `--monitor`, no `--output-format`), asserted by a test. This is the same opt-in discipline ADR-030 applied at the CLI, now at the web edge: the default web run is the path that also builds MMD, so it must not change. The 202 response gains an additive `slug` so the client can poll status without re-deriving the server-side slugifier in the browser (L-007).

### 3. A pure `renderGauge(context)` helper + best-effort polling

The gauge render is a **pure function** `renderGauge(context) -> html` in `bin/serve-ui/gauge.js` (exported for node unit tests; also attached to `window.MMDGauge` for the browser). It produces a bar (% of the window, pct clamped 0–100), humanized `tokens / window` (`337000 → 337k`, `1000000 → 1.0M`), the model id (HTML-escaped), a fixed 70% threshold marker, and a "⚠️ ready for handoff" badge iff `context.ready_for_handoff`. No / empty context → `''` (the caller hides the element). `app.js` polls `GET /api/status/<slug>` every ~3 s while a monitored job runs and re-renders the gauge, stopping on completion.

### 4. Polling, not SSE-push (decoupling)

Context is surfaced by **polling `/api/status`**, not by adding context events to the SSE stream. Polling keeps the gauge entirely **decoupled** from the progress feed: a slow/failed poll is swallowed (`try/catch`, best-effort) and **never breaks the page or the SSE stream**. Pushing context over SSE would mean a new event type, a protocol change, and coupling the gauge's failure modes to the progress stream — for a value that only needs a coarse ~3 s refresh. The scale assumption (one in-flight web job, polled every ~3 s) makes polling trivially cheap.

### 5. Why opt-in keeps the default web run + SSE untouched

The toggle defaults off. Off → no `monitor` in the launch body → spawn args unchanged → no `status.json.context` → no polling started → gauge stays hidden. The page and SSE progress behave exactly as before. On → the launch appends `--monitor`; the SSE progress **still works** because v0.5.b's monitored branch re-renders human-readable text to stdout (not raw JSON), which the server forwards unchanged. So even the monitored path doesn't change the SSE contract.

### 6. CSP-safe gauge markup

The default serve page runs under a strict CSP (`style-src 'self'`, no `unsafe-inline`). So the gauge uses **no inline `style=` attributes**: the bar is a native `<progress value=pct>` (an attribute, not a style) and the fixed 70% threshold tick is positioned by an external CSS class in `style.css`. This was a real bug caught during implementation — an earlier draft used `style="width:..."` which the browser CSP would have silently dropped.

## Consequences

**Positive**: the v0.5.b monitor is now visible to the exact audience `mmd serve` exists for — a live bar climbing toward 70% with the token count and model, and a handoff badge at the threshold. Pure render helper is unit-tested without a browser. Default web run + SSE provably unchanged (opt-in, asserted). No new dependency. The gauge is the natural on-ramp to the eventual auto-handoff.

**Negative / limits (honest, universal.md §VI + L-027 §3)**: the gauge shows the **orchestrator's** context, not per-sub-agent — labelled as such, but a user could still over-read it. Polling adds ~1 request / 3 s during a monitored run (trivial at single-user scale, but not free). The gauge needs `--monitor`, which is itself opt-in, so the default experience still shows no gauge. The auto-handoff the gauge points toward is still not built.

**Deferred**: making `--monitor` the web default; SSE-pushed context events; the auto-handoff/resume; a CLI/TUI gauge.

## Alternatives considered

- **SSE-push the context** — rejected (§4): protocol change + couples the gauge to the progress stream's failure modes for a coarse-refresh value.
- **Make `--monitor` the web default** — rejected: changes the default spawn (the bootstrap path), violating the ADR-030 safety contract. Stays opt-in.
- **Re-derive the slug in the browser** — rejected (L-007): duplicates the server-side slugifier; instead the launch response carries the slug.
- **Inline-style bar width** — rejected (§6): blocked by the page CSP; native `<progress>` + external CSS is CSP-safe.

## References

- [docs/specs/SPEC_V05C.md](../../SPEC_V05C.md) — the frozen spec.
- [ADR-030](./030-live-context-monitor.md) — the `--monitor` context monitor this gauge displays.
- [ADR-029](./029-conductor-notifications.md) — the first Conductor brick (notifications).
- L-027 — stream-json usage → context %; orchestrator-not-sub-agent; opt-in for spawn-changing features.
- L-007 — don't duplicate the slugifier; carry the slug instead.
