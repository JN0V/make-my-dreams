# Make My Dreams — v0.2.5 Spec: `mmd serve` (accessibility milestone)

> Specification for the version that unlocks usage by non-technical users (Sébastien's 13-year-old daughter being the primary motivation). Per scoping `MAKE_MY_DREAMS.md` v17 §9 v0.2.5. To be fed into Extend BMAD `auto-dev` (Standard engine). Keep this short and concrete: ~2-3 days of work, ~300 lines of code total.

---

## 1. Goal of v0.2.5

Deliver an `mmd serve` CLI subcommand that:
1. Starts a local HTTP server on `localhost:3000` (configurable port via `MMD_SERVE_PORT`).
2. Automatically opens the default browser to that URL (via `open` on macOS / `xdg-open` on Linux / `start` on Windows).
3. Serves a deliberately simple single-page web UI (~200 lines vanilla HTML/CSS/JS, no framework) that lets a non-technical user type a dream description and submit it.
4. Invokes `mmd "<dream>"` as a subprocess and streams progress events back to the browser via Server-Sent Events (SSE).
5. Displays a result link to the generated PWA when done.

**Why this version exists**: differentiator #1 (multi-audience accessibility) needs an experience for users who don't open a terminal. Without this, MMD's mission for users like Sébastien's daughter is purely theoretical (cf scoping v14 changelog).

**Mission validation**: after v0.2.5, Sébastien's daughter can type her dream in a webpage opened on the same machine that runs MMD, click a button, watch streamed progress messages, and get a link to her generated PWA — without ever touching a terminal, IDE, or CLI.

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: `mmd serve` subcommand exists

**Given** MMD v0.2.5 installed (`npm install -g .` from repo root or via `install.sh`)
**When** the user runs `mmd serve`
**Then** the CLI:
- Prints `Starting Make My Dreams server on http://localhost:3000`
- Starts an HTTP server on port 3000 (or `MMD_SERVE_PORT` if set)
- Opens the default browser to that URL (best-effort; if `open`/`xdg-open`/`start` is unavailable, prints the URL and continues without error)
- Stays running until interrupted (Ctrl+C → graceful shutdown with `Bye!` message)

### AC-2: Web UI is simple and accessible

**Given** the server is running and the browser has opened `http://localhost:3000/`
**When** the user looks at the page
**Then** the page contains:
- A title: "Make My Dreams" (heading)
- A large `<textarea>` with placeholder "Décris ton rêve" / "Describe your dream" (~3 rows visible)
- A large submit button: "Vas-y" / "Go" (CSS minimum 48 × 48 px per `safe-by-default.md` §V)
- An empty `<div id="progress">` area below the button (initially hidden)
- An empty `<div id="result">` area below progress (initially hidden)
- Total page weight under 30 KB (HTML+CSS+JS+any inline assets), no external font, no tracking pixel, no analytics SDK

The page MUST be served via `Content-Type: text/html; charset=utf-8` and validate as HTML5.

### AC-3: Submission triggers `mmd <dream>`

**Given** the page is open and the user types a dream in the textarea
**When** the user clicks "Go"
**Then** the page:
- Disables the textarea and the button (prevents double-submit)
- Shows the progress area
- Issues a `POST /api/dream` with JSON body `{"dream": "<text>"}` (Content-Type: application/json)
- Receives a stream of `text/event-stream` SSE events (NOT a JSON response) with progress updates

And the server:
- Spawns a subprocess equivalent to `node bin/mmd.js "<dream>"` (or the global `mmd` binary if available)
- Captures stdout/stderr line by line
- Forwards each significant line as an SSE event `data: {"type":"log","text":"...","ts":"..."}`
- When the subprocess exits, emits a final event `data: {"type":"done","exitCode":N,"demoPath":"...","resultUrl":"..."}` then closes the SSE stream

### AC-4: Progress streaming visible to user

**Given** the server is processing a submitted dream
**When** the subprocess produces output
**Then** the page:
- Appends each `log` event as a new line in `#progress` (with timestamp prefix `HH:MM:SS`)
- Auto-scrolls to the bottom as new lines arrive
- Shows the page-visible heartbeat: if no event arrives for > 60 s, display a yellow "Still working… (last update X min ago)" warning; if > 5 min without event, display a red "May have stalled — check the terminal" message

### AC-5: Result shown clearly

**Given** the subprocess has emitted `done` event with `exitCode=0`
**When** the SSE stream closes
**Then** the page:
- Shows `#result` with: "✅ Ton rêve est prêt !" / "✅ Your dream is ready!"
- A clickable button: "Open my app" that navigates to `resultUrl` (which is `http://localhost:3000/demo/<slug>/index.html` — see AC-7)
- A "Start a new dream" button that resets the page

If `exitCode != 0`:
- Shows `#result` with: "❌ Something went wrong (exit code N)"
- Shows the last 10 progress lines as a debug snippet
- A "Try again" button that resets the page

### AC-6: status.json read by UI

**Given** a dream is being processed
**When** the UI polls `GET /api/status/<slug>` every 5 seconds (or receives `status` SSE events)
**Then** the response is the **enriched status.json** schema from scoping §4.5.1 (or as much of it as v0.2 has produced — v0.2.5 must gracefully handle a minimal v0.1 status.json AND a fully enriched v0.2 one). The UI displays at minimum:
- `current_phase` if present
- `progress_percent` as a progress bar if present
- `last_log_lines` if present (in addition to live SSE log stream)
- A heartbeat staleness warning if `heartbeat_at` is older than `heartbeat_interval_seconds * 2`

The UI MUST work even if `status.json` does not contain the enriched fields (graceful fallback to "Working…" with elapsed time).

### AC-7: Static serving of generated PWAs

**Given** the server is running and a dream has produced `demo/<slug>/`
**When** the user navigates to `http://localhost:3000/demo/<slug>/index.html`
**Then** the server serves the file with correct MIME types (`text/html` for `.html`, `application/javascript` for `.js`, `text/css` for `.css`, `image/*` for images, etc.). Path traversal MUST be prevented: a request like `/demo/../../etc/passwd` returns 403 Forbidden.

This allows the kid to actually USE the PWA she just dreamed up — `getUserMedia` works because the page is served over `http://localhost` (a secure context, cf the `fix/camera-secure-context` lesson learned in v0.1).

---

## 3. Architecture (still minimal)

```
mmd serve
   │
   ▼
[1] Parse port from env (MMD_SERVE_PORT) or default 3000
   │
   ▼
[2] Start HTTP server (node:http, no framework):
       GET  /                    → serve bin/serve-ui/index.html
       GET  /style.css           → serve bin/serve-ui/style.css
       GET  /app.js              → serve bin/serve-ui/app.js
       POST /api/dream           → spawn mmd subprocess, stream SSE
       GET  /api/status/:slug    → return contents of .mmd/shared/status.json
       GET  /demo/<slug>/*       → static serve from ./demo/ with path-traversal protection
       GET  /api/health          → return {"ok": true, "version": "0.2.5"} for liveness
   │
   ▼
[3] Open browser (open/xdg-open/start, best-effort)
   │
   ▼
[4] Wait for SIGINT, then shut down gracefully
```

Total new components: `bin/serve.js` (CLI subcommand dispatcher) + `lib/server.js` (HTTP logic) + `bin/serve-ui/index.html` + `bin/serve-ui/style.css` + `bin/serve-ui/app.js`. **No new dependencies** — node:http, node:fs/promises, node:child_process, node:path are built-in.

The existing `bin/mmd.js` is modified to dispatch: if `argv[2] === 'serve'`, invoke `bin/serve.js`; else, current behavior unchanged.

---

## 4. Out of scope for v0.2.5

To keep this small and focused:

- ❌ No tunnel to expose the local server publicly (Cloudflare Tunnel, ngrok) — deferred to v0.6+.
- ❌ No remote access from another device on the same Wi-Fi (the server binds to `127.0.0.1` only) — deferred to v0.6.
- ❌ No authentication (single-user local tool).
- ❌ No persistence beyond the local filesystem (no DB, no signup).
- ❌ No conversational back-and-forth between submissions (single-shot per dream; multi-turn comes with v0.3 Dream Catcher conversational and v0.10 Full Dream Catcher Web UI).
- ❌ No voice input (comes with v0.11).
- ❌ No profile selection in the UI (v0.2.5 always uses the default profile; profile UI comes later).
- ❌ No multi-user, no sharing, no public hosting.
- ❌ No fancy CSS framework, no dark mode toggle, no localization beyond the bilingual placeholder/labels mentioned in AC-2.
- ❌ No internationalization library — just bilingual hardcoded strings for v0.2.5.

---

## 5. Implementation hints (for auto-dev)

### Project structure (additions only)

```
make-my-dreams/
├── bin/
│   ├── mmd.js                  # existing — modified to dispatch 'serve' subcommand
│   ├── serve.js                # NEW — CLI subcommand entrypoint
│   └── serve-ui/
│       ├── index.html          # NEW — the single-page UI
│       ├── style.css           # NEW — ~50 lines vanilla CSS
│       └── app.js              # NEW — ~100 lines vanilla JS (fetch + EventSource)
├── lib/
│   ├── (existing files unchanged)
│   └── server.js               # NEW — HTTP routing + SSE streaming + static serving
└── test/integration/
    ├── (existing test files unchanged)
    ├── server.test.js          # NEW — exercises GET /, POST /api/dream, GET /api/status, path-traversal protection
    └── serve-cli.test.js       # NEW — exercises 'mmd serve' starts a server on a random port and shuts down cleanly on SIGINT
```

### Key dependencies (still minimal)

- **No new runtime dependencies.** Node 20+ built-ins: `node:http`, `node:fs/promises`, `node:path`, `node:child_process`, `node:url`.
- For the browser-open: shell-out to `open` / `xdg-open` / `start` via `child_process.exec` — wrap in a `tryOpenBrowser(url)` helper that swallows errors gracefully (an absent command is not a failure).

### Tests (per `testing.md` §V stratification)

Tag every new test:
- `@unit` (< 100 ms each): path-traversal-prevention check on a string, MIME-type lookup, SSE event serialization, port-parsing from env.
- `@integration` (< 5 s each): boot server on ephemeral port, GET /, GET /api/health, POST /api/dream against a stubbed `mmd` (use `MMD_AUTODEV_CMD=bash test/fixtures/fake-autodev.sh` env from v0.1), assert SSE stream is well-formed.
- NO `@e2e` for v0.2.5 — real browser drive comes with v0.6 Reality Check extensions.

### Constitution compliance

Per the **modular constitution v2.0** and the bindings table:
- `universal.md`: applies (SOLID, KISS, etc.).
- `security.md`: applies — path-traversal protection on `/demo/<slug>/*` is non-negotiable (OWASP A01/A05). Bind localhost only (no `0.0.0.0`).
- `safe-by-default.md`: applies — no analytics, minimal a11y (contrast AA, tap target 48 px, keyboard nav, no surprise sound).
- `testing.md` §V test stratification: applies — every test tagged.
- `commit-git.md`: branch is `slice/v0.2.5-mmd-serve`, atomic commits, push after each, AI attribution allowed.
- `error-handling.md`: applies — graceful degradation if browser-open fails, if port is taken (try +1 up to +10 then error out clearly), if subprocess crashes.
- `observability.md`: emit structured log lines for `server_started`, `dream_submitted`, `subprocess_exit`.
- `ai-coding.md`: applies — verification before delivery (run the new tests, manually load the page, submit a fake dream).
- Active profile is implicitly Pro for v0.2.5 (Sébastien is developing); the Kid profile loading comes later.

### Bootstrap reflexive context (scoping §7)

This is the **first version developed by MMD itself** (via the Standard engine = auto-dev). v0.1 was developed by Sébastien giving Sébastien's auto-dev a fil-rouge dream. v0.2.5 is auto-dev being invoked with this spec, on a `slice/v0.2.5-mmd-serve` branch, modifying the MMD codebase itself.

This is the test of §7's first sub-step before dream-bench (v0.2b). If auto-dev cleanly produces v0.2.5 with all ACs met, the reflexive bootstrap mechanism is empirically validated.

---

## 6. Definition of done

v0.2.5 is done when:

1. All 7 acceptance criteria are met (run by Sébastien locally on the daughter dream).
2. New tests pass cleanly, full suite stays at 52+ tests passing.
3. `mmd serve` boots in under 2 seconds.
4. The page loads in under 500 ms (network localhost), under 30 KB transferred.
5. README updated with a `## mmd serve` section showing the command and a screenshot or text description of the UI.
6. ADR-003 written justifying: vanilla HTML/CSS/JS for the UI (consistent with ADR-002 for generated PWAs), no framework, no bundler. Plus the choice of SSE over WebSocket for one-way progress streaming (simpler, no upgrade handshake, native to `EventSource`).
7. Branch merged to main via fast-forward, tagged v0.2.5.

---

*Spec v0.2.5 — generated 2026-05-17 from MAKE_MY_DREAMS.md v18. To be fed to /bmad-adv-auto-dev on branch slice/v0.2.5-mmd-serve.*
