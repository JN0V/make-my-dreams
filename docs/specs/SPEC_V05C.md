# Make My Dreams — v0.5.c Spec: serve-UI context gauge (+ opt-in web monitor toggle)

> Makes the v0.5.1 context monitor VISIBLE. `--monitor` writes `status.json.context = {model, window, tokens, pct, estimated, ready_for_handoff}` during a run, but a non-technical user (the daughter at the web page) never sees it. v0.5.c surfaces it in `mmd serve`: a small **context gauge** (a bar = % of the model's context window, with the token count, the model, a 70% threshold marker, and a "⚠️ ready for handoff" badge), polled from the existing `/api/status/{slug}` endpoint during the run. Because the gauge needs monitored data, v0.5.c also adds an **opt-in "Monitor context" checkbox** to the dream form: when checked, the web launch appends `--monitor` to the `node bin/mmd.js <dream>` spawn (line 611 of `lib/server.js`) — which is clean (just a flag) and SSE-compatible (v0.5.1's monitored branch re-renders human-readable progress to stdout, so the existing progress stream is unaffected). Unchecked = byte-for-byte the current web behavior (no `--monitor`, no gauge). Pure read/display + one opt-in flag; no SSE protocol change, no risk to the default path.

---

## 1. Goal of v0.5.c

```
[web form]  dream  + ☐ "Monitor context (advanced)"
   checked → launch spawns: node bin/mmd.js --monitor "<dream>"   (writes status.json.context)
   unchecked → node bin/mmd.js "<dream>"  (today's behavior, unchanged)

[web page during run]  poll GET /api/status/<slug> every ~3s
   → if .context present: render gauge
       ▓▓▓▓▓░░░░░  34%  (337k / 1.0M tokens · claude-opus-4-8[1m])   [70% ┊ marker]
       + "⚠️ ready for handoff" badge when context.ready_for_handoff
   → if absent: gauge hidden (monitoring off)
```

Deliverables:
1. **`/api/status/{slug}` exposes `context`** (`lib/server.js` `handleStatus`): include `status.json.context` (model/window/tokens/pct/estimated/ready_for_handoff) in the response when present; omit/null when absent. Additive, back-compatible.
2. **Opt-in web monitor toggle**: the dream form gets a "Monitor context (advanced)" checkbox; `POST /api/dream` (and the catch `/confirm` path) accept a `monitor` boolean; `launchJobAndRespond` appends `--monitor` to the `node bin/mmd.js` args when true. Default (false/absent) → no `--monitor` (current args byte-for-byte).
3. **Context gauge** (`bin/serve-ui/`): a small render helper + DOM that polls `/api/status/{slug}` during a run and draws the gauge from `.context` — bar (pct of window), `tokens/window` (humanized, e.g. `337k / 1.0M`), the model, a 70% threshold marker, and a `ready_for_handoff` badge. Hidden/neutral when `.context` is absent. Best-effort polling (a failed poll never breaks the page).

**Not in this slice** (deferred): making `--monitor` the web default (stays opt-in); SSE-pushed context events (polling is simpler + decoupled); the auto-handoff/resume itself; a CLI TUI gauge.

**Mission validation**: a user ticks "Monitor context", submits a dream, and watches a live bar climb toward 70% with the token count + model; at 70% a "ready for handoff" badge appears; without the tick, the page behaves exactly as today (no gauge, no `--monitor`).

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: `/api/status/{slug}` returns `context` when present
**Given** a `demo/<slug>/.mmd/shared/status.json` that has (or lacks) a `context` block
**When** `GET /api/status/<slug>` is served
**Then**: the JSON response includes `context` (model, window, tokens, pct, estimated, ready_for_handoff) when status.json has it; when absent, `context` is omitted/null; the rest of the status response is unchanged (back-compat); a missing/malformed status.json behaves exactly as today.
Tag: `@integration` / `@unit`.

### AC-2: Opt-in web monitor toggle threads `--monitor`
**Given** the dream form + `POST /api/dream` (and the catch `/confirm`)
**When** a dream is submitted with `monitor:true`
**Then**: `launchJobAndRespond` spawns `node bin/mmd.js --monitor "<dream>"` (assert `--monitor` is in the args); with `monitor` false/absent, the spawn args are byte-for-byte the current ones (assert NO `--monitor`); the `monitor` value is validated as a boolean (junk → false).
Tag: `@integration` (captured spawn args via the `MMD_AUTODEV_CMD` seam or an injected spawn).

### AC-3: Context gauge renders from `.context`
**Given** a status response with a `context` block
**When** the UI's gauge render helper runs
**Then**: it produces a bar reflecting `pct` (clamped 0–100%), a humanized `tokens/window` (e.g. `337k / 1.0M`), the model string, a 70% threshold marker, and a "⚠️ ready for handoff" badge iff `ready_for_handoff`; given no `context`, it renders nothing / a hidden state. The render helper is a pure function of the context object (testable without a browser).
Tag: `@unit` (pure render helper) + `@integration` (served assets present + wired to polling).

### AC-4: Safety + back-compat
**Given** the toggle unchecked (default)
**When** a dream runs
**Then**: no `--monitor` is passed, no gauge is shown, and the page + SSE progress behave byte-for-byte as today; with the toggle checked, the SSE progress still works (v0.5.1's monitored branch re-renders readable text to stdout, which the server forwards); the gauge poll is best-effort — a failed/slow `/api/status` poll logs nothing fatal and never blocks the page or the SSE stream.
Tag: `@integration`.

### AC-5: Docs + ADR
**Given** v0.5.c ships
**When** docs are read
**Then**: ADR-031 documents the gauge + opt-in web monitor toggle (reads `status.json.context`; polling over SSE-push; why opt-in keeps the default web run + SSE untouched; the gauge is the visible payoff of the v0.5.1 monitor); `README.md`/`CLAUDE.md` note the "Monitor context" toggle + the gauge in the `mmd serve` section.
Tag: `@unit` anchors.

---

## 3. Architecture (incremental)

```
lib/server.js          MODIFY — handleStatus includes .context; POST /api/dream + /confirm accept `monitor`;
                       launchJobAndRespond appends --monitor to the node bin/mmd.js args when monitor:true
bin/serve-ui/
  index.html           MODIFY — "Monitor context (advanced)" checkbox + a #context-gauge element
  app.js               MODIFY — pass monitor in the submit; poll /api/status/<slug> during a run; renderGauge(context)
  style.css            MODIFY — gauge bar + 70% marker + badge styles
lib/conductor/…        reuse — status.json.context is produced by v0.5.1 (--monitor); this slice only DISPLAYS it
```

### Files modified / added
```
make-my-dreams/
├── lib/server.js                                # modified — context in status, monitor flag, --monitor arg
├── bin/serve-ui/{index.html,app.js,style.css}   # modified — toggle + gauge + polling
├── lib/serve-ui-gauge.js (or inline pure helper) # NEW (optional) — pure renderGauge(context) for unit test
├── test/unit/serve-ui-gauge.test.js              # NEW — AC-3 pure render
├── test/integration/serve-context-gauge.test.js  # NEW — AC-1/AC-2/AC-4 (status.context, --monitor arg, opt-in)
├── docs/adr/031-serve-ui-context-gauge.md         # NEW
├── README.md / CLAUDE.md                          # modified — Monitor toggle + gauge
└── package.json                                  # modified — 0.5.2
```

---

## 4. Out of scope for v0.5.c
- ❌ `--monitor` as the web default (stays opt-in — keeps the default web run + SSE untouched).
- ❌ SSE-pushed context events (polling `/api/status` is simpler + decoupled).
- ❌ The auto-handoff/resume itself (v0.5 future).
- ❌ A CLI/TUI gauge (web only).
- ❌ **Scale assumption**: one in-flight web job, polled every ~3 s — trivial.

## 5. Implementation hints (for auto-dev)
1. Read SPEC_V05C.md (this), `handleStatus` + `launchJobAndRespond` in `lib/server.js` (the spawn is `node bin/mmd.js <dream>` — just append `--monitor` before the dream when `monitor:true`), and `bin/serve-ui/app.js` (the SSE engine + the existing `/api/status` shape).
2. Keep the gauge render a PURE helper `renderGauge(context) -> html/string` (unit-tested) so the browser glue stays thin. Humanize tokens (337000 → `337k`, 1000000 → `1.0M`).
3. Poll `/api/status/<slug>` every ~3 s while a job is running; stop on completion. Best-effort: wrap the fetch in try/catch — a failed poll must never break the page or the SSE stream.
4. Opt-in is the safety contract: `monitor` defaults false; unchecked → spawn args byte-for-byte today's (assert it). With `--monitor`, the SSE still works because v0.5.1's monitored branch re-renders human-readable text to stdout (not raw JSON).
5. `context` in `/api/status` is additive — never break the existing status response shape.
6. Constitution bindings: universal (§VI, §VII), ai-coding, commit-git, testing, error-handling, security (web input — validate the `monitor` boolean), documentation, observability, safe-by-default (Kid web users).

## 6. Definition of done
1. All 5 ACs met.
2. Full suite passes (current 1423 + new tests).
3. `mmd serve` + "Monitor context" → a dream run shows a live gauge (bar/%/tokens/model/70% marker/handoff badge) polled from `/api/status`; unticked → no gauge + unchanged page/SSE; a failed poll never breaks the page.
4. README + CLAUDE.md + ADR-031 in place.
5. Version bumped to `0.5.2`.
6. Slice merged (ff-only) + tag `v0.5.2`.
7. 26th reflexive use of `mmd --here` (13th with `--label`). The v0.5.1 context monitor is now visible to a non-technical web user — the daughter can watch the context fill, the natural bridge toward an eventual auto-handoff.

---

*Spec v0.5.c — surface the v0.5.1 context monitor in `mmd serve`: a context gauge polled from `/api/status/<slug>.context`, plus an opt-in "Monitor context" checkbox that appends `--monitor` to the web launch. Pure read/display + one opt-in flag; default web run + SSE untouched. Makes the monitor visible to non-technical users.*
