# Make My Dreams — v0.5.a Spec: Conductor notifications (Layer 6 webhook fan-out)

> First brick of the v0.5 Conductor — and the real fix for "I keep having to ask where things are". MMD runs auto-dev detached (`setsid … mmd --here`), so a user who walks away has no signal when a 30–90-min run finishes or fails. v0.5.a adds an **opt-in notification fan-out**: when `MMD_NOTIFY_URL` is set, MMD POSTs a small JSON payload on run lifecycle events (**done / failed**) to a user-configured webhook (ntfy, Pushover, Slack/Discord webhook, Telegram bridge, or any URL). Chosen as the v0.5 starting point because it is the **cleanest + safest** Conductor piece: purely additive (it does NOT touch the auto-dev spawn — unlike the stream-json context monitor, deferred to v0.5.b), **opt-in** (no-op when unset), and **best-effort** (a notification failure NEVER changes the run's outcome or exit code). The token-visibility for the eventual 70% auto-handoff was de-risked separately (`claude -p --output-format stream-json` exposes `usage` + model) and is the v0.5.b foundation — but the auto-handoff itself stays future (auto-dev is a monolithic BMAD workflow; "handoff of what" needs MMD-orchestrated steps).

---

## 1. Goal of v0.5.a

```
mmd --here "<dream>"   (detached; user walks away)
   … auto-dev runs …
   → on completion: if MMD_NOTIFY_URL set → POST { event, slice, state, summary, ts }
       done   → "✅ <slice> finished (<tag/scope summary>)"
       failed → "❌ <slice> failed (<reason>)"
   → MMD exits normally regardless of the notification result
```

Deliverables:
1. **`lib/conductor/notify.js`** (pure core, injected sender):
   - `shouldNotify(env)` → boolean (true iff `MMD_NOTIFY_URL` is a non-empty string).
   - `buildNotification({ event, slice, state, summary, env })` → `{ url, method:'POST', headers, body }`. `event ∈ {run_done, run_failed}`. Body is JSON `{ event, slice, state, summary, ts }`; also include a plain `message` string so ntfy-style sinks (which use the body as the message) render nicely. Honest: never invents a summary it doesn't have.
   - `sendNotification(payload, { fetchFn, timeoutMs })` → `{ ok, status?, error? }`. Best-effort: a network error / non-2xx / timeout resolves `{ ok:false, error }` — **never throws**. Bounded by a short timeout (default ~5 s).
2. **Wiring** (greenfield + `--here` completion paths in `bin/mmd.js`): after `invokeAutodev` resolves and the final status is written (`done`/`failed`), if `shouldNotify(env)`, fire `sendNotification(buildNotification(...))`. A notify failure is logged and ignored — it does NOT affect the run's exit code or status. No-op when `MMD_NOTIFY_URL` is unset (zero network, zero behavior change — the default).
3. **Opt-in + safe**: only `MMD_NOTIFY_URL` activates it; the payload carries run metadata only (slice id, state, a short summary, timestamp) — no secrets, no code, no file contents. Documented as user-configured egress to the user's own sink.

**Not in this slice** (deferred): the stream-json live **context monitor** + `70%` READY_FOR_HANDOFF signal (v0.5.b — de-risked, but riskier: it changes the spawn); the actual **auto-handoff/resume**; `stalled`/`70%` notification events (need the monitor); per-event filtering config; the `tmux`/Remote-Control Layer 5.

**Mission validation**: with `MMD_NOTIFY_URL=https://ntfy.sh/<topic>` set, a detached `mmd --here "<dream>"` POSTs a "✅ finished / ❌ failed" message to that topic when the run ends; with the var unset, behavior is byte-for-byte unchanged (no network call); a dead/unreachable URL never breaks the run.

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: `shouldNotify` + `buildNotification` (pure)
**Given** an env and a run result
**When** `shouldNotify(env)` / `buildNotification({...})` run
**Then**: `shouldNotify` is true iff `MMD_NOTIFY_URL` is a non-empty string; `buildNotification` returns `{ url, method:'POST', headers:{'Content-Type':'application/json'}, body }` where `body` parses to `{ event, slice, state, summary, ts, message }`, `event ∈ {run_done, run_failed}`, `message` is a human one-liner (✅/❌ + slice + summary); it never fabricates a summary (uses what it's given, else a neutral phrase); pure, never throws.
Tag: `@unit`.

### AC-2: `sendNotification` is best-effort (never throws)
**Given** a payload + an injected `fetchFn`
**When** `sendNotification(payload, { fetchFn, timeoutMs })` runs
**Then**: a 2xx → `{ ok:true, status }`; a non-2xx → `{ ok:false, status }`; a thrown/rejected `fetchFn` (network down) → `{ ok:false, error }`; exceeding `timeoutMs` → `{ ok:false, error:'timeout' }`. It NEVER throws and NEVER blocks beyond the timeout.
Tag: `@unit`.

### AC-3: Wiring fires on done/failed, opt-in, never breaks the run
**Given** the greenfield and `--here` completion paths
**When** a run reaches `done` or `failed`
**Then**: with `MMD_NOTIFY_URL` set, MMD calls `sendNotification` with the matching event; with it unset, NO notification code runs (no network, no behavior change); a notify failure is logged but the run's exit code + status are unchanged (best-effort). Both surfaces (greenfield + `--here`) notify.
Tag: `@integration` (injected/captured sender — no real network).

### AC-4: Payload shape works for common sinks
**Given** a built notification
**When** inspected
**Then**: the JSON body suits generic webhooks (Slack/Discord/custom) AND the `message` field + plain-text rendering suits ntfy (`https://ntfy.sh/<topic>`); the payload contains run metadata only (slice, state, summary, ts) — NO secrets/tokens/file contents; the summary for `done` includes the slug + (if available) the latest tag or refined scope, for `failed` the reason.
Tag: `@unit`.

### AC-5: Docs + ADR + lesson
**Given** v0.5.a ships
**When** docs are read
**Then**: ADR-029 documents the Conductor notification fan-out — Layer 6; opt-in `MMD_NOTIFY_URL`; best-effort never-fail rationale; why notifications first (cleanest/safest, fixes proactive-feedback) and the deferral of the stream-json context monitor + auto-handoff to v0.5.b (with the de-risk finding that stream-json exposes `usage`); `README.md`/`CLAUDE.md` document `MMD_NOTIFY_URL` (with an ntfy example); `docs/lessons-learned.md` MAY add **L-026** (detached runs need a push signal; polling is the symptom of a missing fan-out).
Tag: `@unit` anchors.

---

## 3. Architecture (incremental)

```
lib/conductor/notify.js   NEW — shouldNotify + buildNotification (pure) + sendNotification (injected fetch, best-effort)
bin/mmd.js                MODIFY — greenfield + --here completion: fire notification on done/failed when opted in
lib/invoke-autodev.js     reuse — buildSubprocessEnv already passes MMD_* (MMD_NOTIFY_URL reaches subprocess too, harmless)
```

### Files modified / added
```
make-my-dreams/
├── lib/conductor/notify.js                   # NEW
├── bin/mmd.js                                 # modified — fire on done/failed (both surfaces)
├── test/unit/conductor-notify.test.js         # NEW — AC-1/AC-2/AC-4
├── test/integration/notify-wiring.test.js      # NEW — AC-3 (captured sender, opt-in, never-break)
├── docs/adr/029-conductor-notifications.md     # NEW
├── docs/lessons-learned.md                    # modified (optional L-026)
├── README.md / CLAUDE.md                      # modified — MMD_NOTIFY_URL
└── package.json                               # modified — 0.5.0
```

---

## 4. Out of scope for v0.5.a
- ❌ The stream-json live context monitor + `70%` READY_FOR_HANDOFF signal (v0.5.b — de-risked but changes the spawn).
- ❌ Actual auto-handoff / resume-in-fresh-context (needs MMD-orchestrated steps; auto-dev is monolithic BMAD).
- ❌ `stalled` / `70%` / progress notification events (need the monitor; v0.5.b).
- ❌ Per-event filtering / multiple sinks / retry queues (one URL, two events; KISS).
- ❌ Layer 5 `tmux`/Remote-Control opt-in.
- ❌ **Scale assumption**: one best-effort POST per run end — trivial.

## 5. Implementation hints (for auto-dev)
1. Read SPEC_V05A.md (this) + the greenfield and `runHereMode` completion paths in `bin/mmd.js` (where the final `writeStatus(done/failed)` happens — fire right after).
2. Keep `notify.js` PURE except `sendNotification`, which takes an injected `fetchFn` (default Node's global `fetch`); tests pass a fake. NEVER throw from `sendNotification` — wrap everything, honor `timeoutMs` (AbortController or a Promise.race).
3. Best-effort is the contract: a notify failure logs a single line and is dropped; the run's exit code/status are computed exactly as today. With `MMD_NOTIFY_URL` unset, do not even construct a payload (zero overhead, zero network — the safe default).
4. Payload = run metadata only (slice, state, summary, ts). NO secrets/env/file contents (security.md — least disclosure on egress). Include a `message` one-liner so ntfy renders it.
5. This is opt-in user-configured egress to the user's own sink — document it plainly (the user chooses ntfy/Slack/etc.).
6. Constitution bindings: universal (§VI, §VII), ai-coding, commit-git, testing, error-handling, security (egress/no-secrets), documentation, observability.

## 6. Definition of done
1. All 5 ACs met.
2. Full suite passes (current 1379 + new tests).
3. With `MMD_NOTIFY_URL` set, a `done`/`failed` run POSTs a ✅/❌ message (verified with a captured sender); with it unset, no network call + unchanged behavior; a dead URL never breaks the run. Both greenfield + `--here`.
4. README + CLAUDE.md + ADR-029 in place (with an ntfy example).
5. Version bumped to `0.5.0`.
6. Slice merged (ff-only) + tag `v0.5.0`.
7. 24th reflexive use of `mmd --here` (11th with `--label`). First v0.5 Conductor brick: detached runs now push a signal, directly addressing the "I keep having to ask" feedback; the stream-json context monitor + auto-handoff follow in v0.5.b.

---

*Spec v0.5.a — the Conductor's Layer-6 notification fan-out: opt-in `MMD_NOTIFY_URL`, a best-effort POST on run done/failed, never affecting the run. Cleanest + safest first v0.5 brick (no spawn change), and the real fix for detached-run silence. The stream-json context monitor (de-risked: `usage` is exposed) + the 70% auto-handoff are v0.5.b.*
