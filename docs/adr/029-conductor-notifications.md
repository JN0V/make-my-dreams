# ADR-029 — Conductor notifications: an opt-in, best-effort Layer-6 webhook fan-out on run end

**Status**: Accepted
**Date**: 2026-06-01
**Deciders**: MMD core (self-dev, 24th reflexive `mmd --here`, 11th with `--label`)
**Parent design**: [docs/specs/SPEC_V05A.md](../../SPEC_V05A.md) (FROZEN). First brick of the v0.5 **Conductor** (MAKE_MY_DREAMS.md Layer 6 — orchestration/observability). Directly addresses the recurring user feedback "I keep having to ask where things are" when a detached run finishes.

## Context

MMD runs auto-dev **detached** (`setsid … mmd --here "<dream>"`) so a slice can churn for 30–90 minutes while the user does something else. The cost of that: **silence**. A user who walks away has no signal when the run finishes or fails — they come back and poll (`git log`, `status.json`, `pgrep`). Polling is the *symptom of a missing push*: the run knows exactly when it ends; the user shouldn't have to discover it.

The v0.5 Conductor design has several candidate pieces — a `stream-json` live **context monitor** (watch `claude -p --output-format stream-json` for the 70% `READY_FOR_HANDOFF` point), an actual **auto-handoff/resume**, a `tmux`/Remote-Control layer, and this **notification fan-out**. The question for v0.5.a was *which piece first*.

## Decision

Ship the **notification fan-out first**, as an opt-in, best-effort webhook POST on run lifecycle events (**done / failed**).

### 1. A pure core + an injected sender (`lib/conductor/notify.js`)

- `shouldNotify(env)` → boolean: the **opt-in gate**, true iff `MMD_NOTIFY_URL` is a non-empty string. When false the caller builds **no payload** and makes **no network call** — zero overhead, the safe default.
- `buildNotification({ event, slice, state, summary, env })` → `{ url, method:'POST', headers, body }`: **PURE**, never throws. The JSON body is run **metadata only** — `{ event, slice, state, summary, ts, message }` — and carries a `message` one-liner (`✅/❌ <slice> finished/failed (<summary>)`) so ntfy-style sinks, which render the request body as the notification text, read nicely. Honest: it **never fabricates a summary** (uses what it is given, else a fixed neutral phrase).
- `sendNotification(payload, { fetchFn, timeoutMs })` → `{ ok, status?, error? }`: **best-effort**. 2xx → `{ ok:true, status }`; non-2xx → `{ ok:false, status }`; a thrown/rejected fetch → `{ ok:false, error }`; exceeding `timeoutMs` (default 5 s, enforced with an `AbortController` raced against a timer) → `{ ok:false, error:'timeout' }`. It **never throws** and **never blocks beyond the timeout**. `fetchFn` defaults to the global `fetch`; tests inject a fake so no real network is hit.

### 2. Wiring: fire after the final `writeStatus`, on both surfaces

`bin/mmd.js` calls a small `maybeNotify()` helper right after the final `writeStatus(done/failed)` on **both** the greenfield and `runHereMode` completion paths (the success path and both failure branches per surface). With `MMD_NOTIFY_URL` set, `done → run_done`, `failed → run_failed`. The `done` summary is enriched with the repo's latest tag when available (`git describe --tags --abbrev=0`, best-effort); the `failed` summary is the reason.

### 3. Best-effort is the contract (never-fail)

A notification is a **side channel**, never part of the run's outcome. A delivery failure (dead URL, non-2xx, timeout, network down) logs a single stderr line and is **dropped** — the run's exit code and `status.json` are computed exactly as before. This is the error-handling discipline that a non-essential egress must degrade, never propagate (and the reason `sendNotification` is contracted never to throw; the wiring's try/catch is defense-in-depth on top).

### 4. Least disclosure on egress (security)

The payload is user-configured egress to the **user's own sink** (ntfy / Pushover / Slack/Discord webhook / Telegram bridge / any URL). It carries **run metadata only** — slice id, state, a short summary, a timestamp. **No secrets, no env, no code, no file contents** (security.md — least disclosure on an outbound channel). The opt-in `MMD_NOTIFY_URL` is the user's explicit consent to that egress.

Note: `MMD_NOTIFY_URL` itself (which *may* embed a token for some sinks, e.g. a Telegram bridge) reaches the auto-dev child via the existing `MMD_*` env allowlist in `lib/invoke-autodev.js` — consistent with how every other `MMD_*` var is forwarded. The child runs the BMAD workflow, not `bin/mmd.js`'s completion paths, so it never fires a notification (no double-send). The URL is **never logged** — the best-effort failure line prints only the event name + the status/error, never the URL or the body.

### 5. Why notifications first (cleanest + safest)

- **Purely additive** — it does **not** touch the auto-dev spawn. The `stream-json` context monitor *does* (it changes how the child is launched and parsed), so it is riskier and deferred.
- **Opt-in** — a no-op when `MMD_NOTIFY_URL` is unset, so the default behavior is byte-for-byte unchanged.
- **Best-effort** — it can never change a run's result, so the blast radius of a bug here is "a missed ping", not "a broken run".
- It **directly fixes the proactive-feedback gap** — the "I keep having to ask" feedback — which the other Conductor pieces don't address on their own.

## Deferred to v0.5.b (stated, not hidden — universal §VI)

- **The `stream-json` live context monitor + the 70% `READY_FOR_HANDOFF` signal.** This was **de-risked separately**: `claude -p --output-format stream-json` *does* expose per-event `usage` (input/output tokens) + the model id, so a context-budget monitor is feasible. But it **changes the auto-dev spawn** (different output format, a stream parser, a liveness/heartbeat reader), so it is a riskier slice than this one — hence v0.5.b, not v0.5.a.
- **The actual auto-handoff / resume-in-fresh-context.** auto-dev is a monolithic BMAD workflow; "handoff of *what*" needs MMD-orchestrated steps that don't exist yet.
- **`stalled` / `70%` / progress notification events** (need the monitor), **per-event filtering / multiple sinks / retry queues** (one URL, two events — KISS), and the **Layer 5 `tmux`/Remote-Control** opt-in.

## Consequences

- **Positive**: a detached run now **pushes** a ✅/❌ signal when it ends — the user stops polling. Purely additive, opt-in, best-effort: zero behavior change when unset, and a notification failure can never break a run. Zero new dependencies (the global `fetch` + a pure module). Both surfaces (greenfield + `--here`) notify.
- **Negative**: one best-effort POST per run end when opted in (trivial). The summary is intentionally terse (metadata only) — a user wanting rich detail still opens `status.json`.
- **Neutral**: notifications fire on the two **non-sealed** completion paths; a `--sealed` run's own done/failed reporting is handled inside `runSealedPipeline` and is **not** wired in this slice (named here so the gap is explicit, not silent — L-009). Extending the fan-out to the sealed surface, adding progress events, or per-event filtering are later decisions.

## Alternatives considered

- **Make notification failures fatal (block the run on a bad sink).** Rejected: a side channel must never change the run's outcome. A dead URL breaking a 90-minute run would be the opposite of helpful.
- **Always-on (no opt-in).** Rejected: egress must be the user's explicit choice (no surprise outbound traffic), and the default must stay byte-for-byte unchanged.
- **Embed run detail / logs in the payload.** Rejected on least-disclosure grounds — metadata only; the user's sink is outside MMD's trust boundary.
- **Do the `stream-json` context monitor first.** Rejected for v0.5.a: it changes the spawn (riskier). Notifications are the cleanest/safest first brick; the monitor follows in v0.5.b on the de-risk finding that `stream-json` exposes `usage`.
- **A long/unbounded send timeout.** Rejected: a slow sink must never delay the run's exit — hence the short bounded timeout via `AbortController` + race.
