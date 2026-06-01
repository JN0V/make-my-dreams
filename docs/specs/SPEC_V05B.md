# Make My Dreams — v0.5.b Spec: live context monitor (`--monitor`, opt-in)

> The de-risked Conductor foundation. Token-visibility was proven: `claude -p --output-format stream-json --verbose` emits a `system` event carrying the model (→ context window, e.g. `claude-opus-4-8[1m]` = 1M) and `assistant`/`result` events carrying `usage` (`input_tokens` + `cache_read_input_tokens` + `cache_creation_input_tokens` + `output_tokens`). v0.5.b turns that into a **live context monitor**: an opt-in `mmd --monitor` spawns auto-dev in stream-json, parses `usage` as it streams, computes the **% of the context window** consumed, writes it to `status.json`, and at **70%** emits a `READY_FOR_HANDOFF` signal + a `context_70` notification (reusing v0.5.0's `MMD_NOTIFY_URL` fan-out). **Opt-in is deliberate and safety-critical**: the default text-spawn path is the one `mmd --here` uses to build everything *including MMD itself* — a bug there breaks the bootstrap. `--monitor` leaves that path byte-for-byte untouched. The monitor MAKES THE CONDUCTOR SEE (context filling up); the actual auto-handoff/resume stays future (auto-dev is a monolithic BMAD call — "handoff of what" needs MMD-orchestrated steps).

---

## 1. Goal of v0.5.b

```
mmd --monitor "<dream>"   (or mmd --here --monitor)
   spawn: claude -p "/bmad-adv-auto-dev …" --output-format stream-json --verbose
   parse each event:
     system   → model → context window (lookup; [1m] suffix → 1_000_000, else 200_000)
     assistant/result → usage → contextTokens = input + cache_read + cache_creation
   pct = max(contextTokens)/window  → write status.json.context = {model, window, tokens, pct, estimated?}
   pct ≥ 0.70 (MMD_HANDOFF_THRESHOLD) → write READY_FOR_HANDOFF + fire `context_70` notification (once)
   tee: render HUMAN-READABLE progress (assistant text + a "[monitor] context X% (a/b)" line), NOT raw JSON
   default (no --monitor): the existing text spawn + tee, UNCHANGED (bootstrap-safe)
```

Deliverables:
1. **`lib/conductor/stream-parse.js`** (pure, testable on the real stream-json sample):
   - `parseStreamEvent(line)` → `{ type, model?, usage?, text? }` or `null` for a non-JSON / partial line (tolerant, never throws).
   - `contextWindowFor(model)` → window size: a `[1m]` suffix → `1_000_000`; known 200K models → `200_000`; unknown → `200_000` + `estimated:true`.
   - `contextTokens(usage)` → `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` (the prompt the model just processed); tolerant of missing fields.
   - `contextPct(usage, window)` → `{ tokens, pct }`.
2. **Monitored spawn** (opt-in, in `lib/invoke-autodev.js` / `bin/mmd.js`): when `--monitor`, spawn with `--output-format stream-json --verbose`; consume stdout line-by-line through `parseStreamEvent`; track the running **max** contextTokens; write `status.json.context = { model, window, tokens, pct, estimated }` on update; re-render readable progress to the tee. The non-`--monitor` path is the current spawn, untouched.
3. **70% signal + notification**: when `pct ≥ MMD_HANDOFF_THRESHOLD` (default `0.70`), write a `READY_FOR_HANDOFF` marker to `status.json` AND fire a `context_70` notification via the v0.5.0 `lib/conductor/notify.js` (only if `MMD_NOTIFY_URL` set) — **once** per run (debounced), with a log line. This does NOT stop the run (no auto-handoff yet) — it's an observability + early-warning signal.
4. **Bootstrap safety**: `--monitor` is opt-in; default `mmd`/`mmd --here` behavior (text spawn + tee) is byte-for-byte unchanged.

**Not in this slice** (deferred): the actual auto-handoff / resume-in-fresh-context (needs MMD-orchestrated steps); making `--monitor` the default; per-sub-agent context (the top-level stream shows the orchestrator's context only); a serve-UI gauge (could follow from `status.json.context`).

**Mission validation**: `mmd --monitor "<dream>"` shows readable progress + `[monitor] context …%` lines, writes `status.json.context`, and (with `MMD_NOTIFY_URL` set) pushes a `context_70` ping when the orchestrator's context crosses 70%; `mmd`/`mmd --here` WITHOUT `--monitor` behave exactly as before.

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: `--monitor` flag
**Given** `lib/argv-parser.js`
**When** parsed
**Then**: `--monitor` is a recognized boolean (in `KNOWN_FLAGS`), default false, composes with engine/mode/sealed flags; `flags.monitor` exposed.
Tag: `@unit`.

### AC-2: Pure stream parsing + context math (on the real sample)
**Given** stream-json event lines (use a captured real sample as a fixture)
**When** `parseStreamEvent` / `contextWindowFor` / `contextTokens` / `contextPct` run
**Then**: `parseStreamEvent` extracts `type` + `model` (from `system`) + `usage` (from `assistant`/`result`), returns `null` on non-JSON/partial lines without throwing; `contextWindowFor("claude-opus-4-8[1m]")` = 1_000_000, a plain 200K model = 200_000, unknown → 200_000 + `estimated:true`; `contextTokens` sums input + cache_read + cache_creation (missing → 0); `contextPct` returns `{tokens, pct}` with `pct = tokens/window`.
Tag: `@unit`.

### AC-3: Monitored spawn writes `status.json.context`; default path untouched
**Given** `mmd --monitor` (greenfield AND `--here`)
**When** the run streams events
**Then**: MMD spawns with `--output-format stream-json --verbose`, parses usage live, tracks the running MAX contextTokens, and writes `status.json.context = {model, window, tokens, pct, estimated}` as it updates; the tee shows readable progress (assistant text + a `[monitor] context X% (a/b)` line), NOT raw JSON; WITHOUT `--monitor`, the spawn args + tee are byte-for-byte the current behavior (assert no `--output-format` in the default args).
Tag: `@integration` (fake claude emitting stream-json lines via `MMD_AUTODEV_CMD`).

### AC-4: 70% READY_FOR_HANDOFF signal + `context_70` notification (debounced)
**Given** a monitored run whose context crosses `MMD_HANDOFF_THRESHOLD` (default 0.70)
**When** the threshold is first reached
**Then**: MMD writes a `READY_FOR_HANDOFF` marker into `status.json` (with the pct/tokens), logs a line, and — if `MMD_NOTIFY_URL` is set — fires a `context_70` notification via `lib/conductor/notify.js` exactly ONCE (debounced; later events past 70% don't re-fire); the run is NOT stopped (no auto-handoff yet). A custom `MMD_HANDOFF_THRESHOLD=0.8` is honored.
Tag: `@integration`.

### AC-5: Readable tee in monitor mode
**Given** `--monitor`
**When** stream-json events arrive
**Then**: the terminal/log render the assistant's text content + periodic `[monitor] context X% (tokens/window)` lines (NOT the raw JSON stream); `MMD_QUIET=1` still silences the terminal tee while preserving the log (as today).
Tag: `@unit`/`@integration`.

### AC-6: Docs + ADR + lesson
**Given** v0.5.b ships
**When** docs are read
**Then**: ADR-030 documents the monitor — why **opt-in protects the bootstrap** (the default spawn builds MMD itself), the stream-json → context-% derivation + the window lookup + the `estimated` caveat (+ that it's the orchestrator's context, not per-sub-agent), the 70% signal + `context_70` notify reuse, and that auto-handoff stays future; `README.md`/`CLAUDE.md` document `--monitor` + `MMD_HANDOFF_THRESHOLD`; `docs/lessons-learned.md` adds **L-027** (`claude -p --output-format stream-json` exposes `usage` → live context % is observable; the model's `[1m]` suffix signals the window).
Tag: `@unit` anchors.

---

## 3. Architecture (incremental)

```
lib/conductor/stream-parse.js   NEW — parseStreamEvent + contextWindowFor + contextTokens + contextPct (pure)
lib/invoke-autodev.js           MODIFY — opt-in monitored spawn (stream-json + live parse + readable re-render); default path untouched
bin/mmd.js                      MODIFY — thread flags.monitor; write status.json.context; 70% signal + context_70 notify
lib/argv-parser.js              MODIFY — add 'monitor' boolean flag
lib/conductor/notify.js         reuse — context_70 event
lib/state.js                    reuse — status.json.context + READY_FOR_HANDOFF marker
test/fixtures/streamjson-sample.txt   NEW — a captured real stream-json transcript (deterministic parse fixture)
```

### Files modified / added
```
make-my-dreams/
├── lib/conductor/stream-parse.js                # NEW
├── lib/invoke-autodev.js                         # modified — opt-in monitored spawn
├── bin/mmd.js                                    # modified — flags.monitor wiring + 70% signal/notify
├── lib/argv-parser.js                            # modified — --monitor flag
├── test/fixtures/streamjson-sample.txt           # NEW — real sample
├── test/unit/conductor-stream-parse.test.js       # NEW — AC-2
├── test/unit/argv-parser.test.js                 # modified — --monitor
├── test/integration/monitor-run.test.js           # NEW — AC-3/AC-4/AC-5 (fake stream-json claude)
├── docs/adr/030-live-context-monitor.md           # NEW
├── docs/lessons-learned.md                       # modified — L-027
├── README.md / CLAUDE.md                         # modified — --monitor + MMD_HANDOFF_THRESHOLD
└── package.json                                  # modified — 0.5.1
```

---

## 4. Out of scope for v0.5.b
- ❌ Actual auto-handoff / resume-in-fresh-context (needs MMD-orchestrated steps; auto-dev is monolithic BMAD).
- ❌ Making `--monitor` the default (the default path must stay untouched — bootstrap safety).
- ❌ Per-sub-agent context accounting (the top-level stream shows the orchestrator's context only — documented).
- ❌ A serve-UI context gauge (could follow from `status.json.context`).
- ❌ **Scale assumption**: line-by-line parse of one run's stream — fine.

## 5. Implementation hints (for auto-dev)
1. Read SPEC_V05B.md (this) + the current spawn in `lib/invoke-autodev.js` (the `args = ['-p', …]` + `child.stdout.on('data', …)` tee). Add a SEPARATE monitored branch; do NOT alter the default branch (bootstrap-safe — the default path is what builds MMD).
2. Capture a real sample: `claude -p "say ok" --output-format stream-json --verbose` → save a representative transcript as `test/fixtures/streamjson-sample.txt`; unit-test `parseStreamEvent`/`contextPct` against it (deterministic). The `system` event has `model` (incl. an optional `[1m]` suffix); `assistant`/`result` have `usage` with `input_tokens`/`cache_read_input_tokens`/`cache_creation_input_tokens`/`output_tokens`.
3. Keep `stream-parse.js` PURE (line → struct; struct → numbers). The spawn/stream consumption + status writes live in invoke-autodev/bin; the 70% notify REUSES `lib/conductor/notify.js` (event `context_70`).
4. Debounce the 70% signal/notify to ONCE per run; honest: an unknown model → `estimated:true` + a documented default window, never a fabricated exact %.
5. Readable tee: extract the assistant text from the stream and print it + periodic `[monitor] context X%` lines; respect `MMD_QUIET=1`. Mirror the `MMD_AUTODEV_CMD` fake seam for tests (a fake that emits canned stream-json lines, including ones that cross 70%).
6. Constitution bindings: universal (§VI, §VII), ai-coding, commit-git, testing, error-handling, observability, documentation.

## 6. Definition of done
1. All 6 ACs met.
2. Full suite passes (current 1398 + new tests).
3. `mmd --monitor "<dream>"` writes `status.json.context` (model/window/tokens/pct), shows readable progress, and fires a single `context_70` notify (with `MMD_NOTIFY_URL` set) past 70%; `mmd`/`mmd --here` WITHOUT `--monitor` are byte-for-byte unchanged (default spawn args assert no `--output-format`).
4. README + CLAUDE.md + ADR-030 + L-027 in place.
5. Version bumped to `0.5.1`.
6. Slice merged (ff-only) + tag `v0.5.1`.
7. 25th reflexive use of `mmd --here` (12th with `--label`) — built via the DEFAULT (text) path, proving `--monitor` did not disturb the bootstrap. The Conductor can now SEE context filling; auto-handoff remains the future step.

---

*Spec v0.5.b — opt-in `mmd --monitor`: spawn auto-dev in stream-json, parse `usage` live → context % in `status.json`, a 70% `READY_FOR_HANDOFF` signal + `context_70` notification (reusing v0.5.0). Opt-in by design — the default spawn builds MMD itself and must stay untouched. Makes the Conductor SEE; the auto-handoff stays future.*
