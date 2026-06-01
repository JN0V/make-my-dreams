# Make My Dreams — v0.2.5 Spec: `mmd serve` (accessibility milestone)

> Specification for the version that unlocks usage by non-technical users (Sébastien's 13-year-old daughter being the primary motivation). Per scoping `MAKE_MY_DREAMS.md` v17 §9 v0.2.5. To be fed into Extend BMAD `auto-dev` (Standard engine). Keep this focused — ~2-3 days of work, ~800 LOC across CLI + lib + UI, structured into the modules listed in §5.

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

> Renumbered after adversarial review #1 (7 → 13 ACs) and expanded after review #2 to **16 ACs total**. Each is testable with the stratum tag indicated. The 16 AC IDs are: AC-1, AC-1b, AC-1c, AC-2, AC-2b, AC-2c, AC-3, AC-3b, AC-3c, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10.

### AC-1: `mmd serve` subcommand exists

**Given** MMD v0.2.5 installed (`npm install -g .` from repo root or via `install.sh`)
**When** the user runs `mmd serve`
**Then** the CLI:
- Prints `Starting Make My Dreams server on http://localhost:3000`
- Starts an HTTP server on port 3000 (or `MMD_SERVE_PORT` if set, see AC-1b)
- Once the underlying socket emits `listening`, prints a single machine-parseable line to stdout: `MMD_SERVE_LISTENING port=<NNNN> host=127.0.0.1` (used by tests to avoid race conditions — F27).
- Opens the default browser to that URL via `child_process.spawn(opener, [url], {detached: true, stdio: 'ignore'}).unref()` AFTER the `listening` event fires; if the opener command is unavailable, prints the URL and continues without error. The env var `MMD_SERVE_NO_OPEN=1` disables browser opening (used by tests — F17).
- Stays running until interrupted (see AC-1c for shutdown semantics).

Tag: `@smoke` (boot + exit). Verified by `serve-cli.test.js`.

### AC-1b: Port parsing & EADDRINUSE handling

**Given** `MMD_SERVE_PORT` is set
**When** the value is non-numeric, < 1, or > 65535
**Then** the CLI exits with code 2 and a friendly message: `MMD_SERVE_PORT must be an integer between 1 and 65535 (got: "<value>")`.

**Given** the default port (3000) is in use
**When** the server starts
**Then** the CLI retries port +1 up to 10 attempts (3001 … 3010); if all fail, exits code 3 with: `No free port available in range 3000-3010. Set MMD_SERVE_PORT to a known-free port.`

**Given** `MMD_SERVE_PORT` is explicitly set and that port is in use
**When** the server starts
**Then** the CLI does NOT retry. Exits code 3 with: `Port <N> is in use. Pick a different port via MMD_SERVE_PORT.` (env-error classification per `error-handling.md` §II).

**Given** `MMD_SERVE_PORT=0` is requested
**When** the server starts
**Then** the CLI accepts it ONLY if `MMD_SERVE_ALLOW_RANDOM=1` is also set (used by integration tests for ephemeral ports); otherwise exits code 2 with: `Port 0 (random) requires MMD_SERVE_ALLOW_RANDOM=1.`

Tag: `@unit` for parsing, `@integration` for EADDRINUSE retry.

### AC-1c: Graceful shutdown semantics

**Given** the server is running with an open SSE stream and a live subprocess
**When** the process receives SIGINT or SIGTERM
**Then** the CLI:
1. Stops accepting new connections (closes the listening socket).
2. Sends `event: server_shutdown\ndata: {"type":"server_shutdown"}\n\n` to every open SSE client.
3. Waits up to 5 s for the active subprocess to finish naturally.
4. After 5 s, sends `SIGKILL` to any still-running subprocess.
5. Prints `À bientôt ! / Bye!` (F28 — bilingual to match UI strings).
6. Exits 0.

Tag: `@integration`.

### AC-2: Web UI is simple and accessible

**Given** the server is running and the browser has opened `http://localhost:3000/`
**When** the user looks at the page
**Then** the page contains:
- A title: "Make My Dreams" (heading `<h1>`).
- A large `<textarea>` with placeholder "Décris ton rêve / Describe your dream" (~3 rows visible), `maxlength="500"`.
- A large submit button: "Vas-y / Go" with `min-width: 48px; min-height: 48px` (per `safe-by-default.md` §V).
- An empty `<div id="progress" role="log" aria-live="polite" aria-atomic="false">` area below the button (initially hidden).
- An empty `<div id="result" role="status" aria-live="polite">` area below progress (initially hidden — F29).
- A `<link rel="icon" href="data:image/svg+xml,…">` 1×1 inline SVG favicon to silence the 404 (F20).
- Total wire size (uncompressed) of `GET /` + `GET /style.css` + `GET /app.js` MUST be < 30 720 bytes (sum of `Content-Length`). Verified via AC-2c `@unit` test.
- No external font, no tracking pixel, no analytics SDK, no inline `<script>` or `<style>` blocks in `index.html` — all JS in `app.js`, all CSS in `style.css` (F37; keeps the CSP `script-src 'self'` clean — see AC-9).

The page MUST be served via `Content-Type: text/html; charset=utf-8` and validate as HTML5.

Tag: `@integration` for serve + structure; `@unit` for weight + a11y assertions (see AC-2b, AC-2c).

### AC-2b: Keyboard navigation & focus

**Given** the page is loaded
**When** the user presses `Tab`
**Then** focus moves: textarea → button → (skip if hidden) "Open my app" / "Start a new dream" / "Try again" buttons in result area.

**Given** the textarea has focus and contains text
**When** the user presses `Ctrl+Enter` (or `Cmd+Enter` on macOS)
**Then** the form is submitted (same effect as clicking the button).

**Given** the form has been submitted and a subprocess is running
**When** the user presses `Esc`
**Then** the SSE connection is closed client-side (subprocess CONTINUES per AC-3b — user can re-subscribe via reload).

All interactive elements (textarea, buttons) MUST have a visible focus ring (`:focus-visible` with outline ≥ 2 px, contrast ≥ 3:1 against background).

Tag: `@integration` (DOM check) + `@unit` (CSS rule parse).

### AC-2c: Contrast & tap-target a11y unit test

**Given** the parsed `style.css`
**When** a `@unit` test computes WCAG 2.2 luminance for every (color, background-color) pair
**Then** every pair's contrast ratio MUST be ≥ 4.5:1 (AA for normal text). A vendored ~30-line luminance calculator (no external dependency) MUST live in `test/util/contrast.js`.

**Given** the parsed `style.css`
**When** the test checks every button selector
**Then** computed `min-width` ≥ 48 px AND `min-height` ≥ 48 px (F38).

Tag: `@unit`.

### AC-3: Submission triggers `mmd <dream>` (two-step protocol)

EventSource is GET-only; therefore the protocol is two-step (F21):

**Given** the page is open and the user types a non-empty dream in the textarea
**When** the user clicks "Go"
**Then** the page:
- Disables the textarea and the button (prevents double-submit).
- Shows the progress area.
- Issues `POST /api/dream` with `Content-Type: application/json` and JSON body `{"dream": "<text>"}`.

And the server:
- Validates `Content-Type: application/json` → else 415 `{"error":"unsupported_media_type"}` (F36).
- Validates body size ≤ 4096 bytes (request `Content-Length`, fail-fast); larger → 413 `{"error":"body_too_large","max_bytes":4096}` (F3).
- Validates `Origin` header is `http://localhost:<port>` OR `http://127.0.0.1:<port>` — else 403 `{"error":"forbidden_origin"}` (F4).
- Validates `Host` header is `localhost:<port>` OR `127.0.0.1:<port>` — else 403 `{"error":"forbidden_host"}` (DNS rebinding defense — F4).
- Parses JSON; on parse error → 400 `{"error":"invalid_json"}`.
- Validates `dream` key present → else 400 `{"error":"dream_missing"}` (F36).
- Validates `dream.trim().length > 0` → else 400 `{"error":"dream_empty"}` (F36).
- Validates `dream.length <= 500` (post JSON-parse, defense in depth, matches UI `<textarea maxlength="500">`) → else 400 `{"error":"dream_too_long","max_chars":500}` (G5).
- Enforces serial execution: if another dream is in progress → 409 `{"error":"another_dream_in_progress"}` (F6). This is a state-conflict response, distinct from rate limiting (429, AC-3c).
- Enforces rate limit (AC-3c): rolling window of 10 successful runs per hour per server. Excess → 429 with `Retry-After: <seconds>` header and `{"error":"rate_limited","retry_after_s":N}` (F23, G15).
- Computes `slug` by importing `slugify` from `lib/parse-dream.js`. **`slugify` contract** (restated inline so the server defense doesn't rely on an undocumented helper): lowercase the input → replace every non-alphanumeric character with `-` → collapse runs of `-` into a single `-` → trim leading/trailing `-` → truncate to 40 chars. **If the result is empty** (e.g. dream was only punctuation/whitespace) → 400 `{"error":"unsluggable_dream"}` (G10).
- **Slug defense in depth** (G10): before using the slug as a directory name, the server MUST assert `path.basename(slug) === slug && !slug.startsWith('.') && slug.length > 0`. Failure → 400 `{"error":"unsluggable_dream"}` and log a `path_traversal_blocked` event with `attack_vector: "slug_escape"` (this should be unreachable if `slugify` is correct, but the assert exists so a future regression in `slugify` cannot reopen path traversal via slug).
- If `demo/<slug>/` already exists → 409 `{"error":"duplicate_dream","message":"a dream with similar wording exists; try different words"}` (F26 — collision-resolution deferred to v0.6).
- Generates a `jobId` (UUID v4) and registers `{jobId, slug, dream, startedAt, status: "pending"}` in an in-memory `jobs` map.
- Spawns the subprocess via `child_process.spawn('node', ['bin/mmd.js', dream], {shell: false, cwd: process.cwd(), env: process.env})` — arg-array form, `shell: false` mandatory (F5). On non-default `mmd` binary, see §3 mapping.
- Returns `202 Accepted` with JSON `{"jobId": "<uuid>", "streamUrl": "/api/dream/stream/<uuid>"}`.

**Given** the client has received `streamUrl`
**When** the client opens `new EventSource(streamUrl)` (GET request)
**Then** the server streams `text/event-stream` events per §3.bis contract until completion.

`@unit` test: feed dreams containing `;`, `$()`, backticks, newlines, null bytes; assert they appear verbatim as `argv[2]` in the spawned process (mirror `test/fixtures/echo-env.sh` pattern — F5).

### AC-3b: Client disconnect during SSE

**Given** the subprocess is running and an SSE client is subscribed
**When** the client disconnects (tab closed, network drop, `EventSource.close()` from `Esc` key)
**Then**:
- The server detects the disconnect (`req.on('close')` on the SSE response).
- The subprocess CONTINUES to completion. It still writes `status.json` and `demo/<slug>/` as normal.
- The job remains in the `jobs` map with `status: "running"` then transitions to `"done"`/`"failed"` on subprocess exit.
- The user can navigate back to the UI, see the in-progress job via `GET /api/status/<slug>` polling, and re-subscribe by opening `GET /api/dream/stream/<jobIdOrSlug>` (the server replays the catch-up tail — last 100 lines out of the per-stream 1000-line ring buffer — F7, G7).

**Slug-as-key recovery** (G16): the SSE endpoint accepts EITHER a `jobId` OR a `slug` as path parameter: `GET /api/dream/stream/<jobIdOrSlug>`. The server looks up the job by UUID-shape first, then falls back to slug lookup against the `jobs` map. The `GET /api/status/<slug>` response includes the `jobId` field. Concretely: after a reload of `/demo/<slug>/` the UI calls `GET /api/status/<slug>`, reads `jobId` from the response, and opens an `EventSource` on either `/api/dream/stream/<jobId>` or `/api/dream/stream/<slug>` (both supported — the slug form lets a kid bookmark `/demo/<slug>/` and still get streaming after a reload).

**Unknown-job behavior** (G18): if `jobIdOrSlug` does not match any entry in the in-memory `jobs` map (server restart erases history), the SSE endpoint returns `404 {"error":"unknown_job"}`. The UI surfaces a friendly bilingual message: "Connexion perdue ; vérifie le dossier `demo/` pour le résultat. / Connection lost; check the `demo/` folder for the result."

Tag: `@integration`.

### AC-3c: Rate limiting (in-memory)

**Given** the server has been started
**When** more than 10 dream runs that completed with `exitCode == 0` (counted at `subprocess_exit`, not at POST time) have occurred within a rolling 1-hour window per server lifetime
**Then** the next `POST /api/dream` returns 429 with `Retry-After: <seconds>` header (seconds until the oldest of the 10 falls out of the window) and body `{"error":"rate_limited","retry_after_s":N}`.

**Counting rule** (G15): only `exitCode == 0` runs consume capacity. Failed runs (`exitCode != 0`, subprocess crash, validation error before spawn) are FREE retries — fairer to a kid iterating on a dream that keeps failing. This is an explicit usability choice, not a security boundary.

**Override** (G15): the cap is configurable via `MMD_SERVE_RATE_LIMIT_PER_HOUR=<N>` (default 10, minimum 1). Documented in §4 / README. This is a local-only tool; the rate limit exists to bound resource use, not to thwart attackers.

**Bucket key** (G6): for v0.2.5 the bucket is a **single global counter** (one shared rolling window across all callers). This is acceptable because the server only accepts loopback connections (AC-8) and the use case is single-user. **v0.6 MUST switch to per-source keying** (per-client-IP or per-tunnel-token) when remote exposure ships. The `dream_rejected` log event (rate-limit reason) includes `bucket_used` and `bucket_capacity` integers in its context so operators can see headroom.

Implementation: in-memory rolling-timestamp list; NO persistence (per scope discipline §4 — persistent rate limiting deferred to v0.6+ when remote exposure ships).

Tag: `@unit` for bucket logic (incl. "failed runs don't consume capacity" and env-var override); `@integration` for 429 response.

### AC-4: Progress streaming visible to user

**Given** the server is processing a submitted dream
**When** the subprocess produces stdout/stderr
**Then** the page:
- Appends each `log` event as a new line in `#progress` (with timestamp prefix `HH:MM:SS`). Lines from `stderr` get distinct rendering (e.g. `color: #c62828`) via the event's `stream` field (`"stdout"` | `"stderr"`).
- Auto-scrolls to the bottom as new lines arrive UNLESS the user has scrolled up (preserve user scroll position).
- Shows the page-visible heartbeat: if no event arrives for > 60 s, displays a yellow "Toujours en train de bosser… (dernière nouvelle il y a X min) / Still working… (last update X min ago)" warning; if > 5 min without event, displays a red "Ça a peut-être planté — regarde le terminal / May have stalled — check the terminal" message.

Tag: `@integration`.

### AC-5: Result shown clearly

**Given** the subprocess has emitted `done` event with `exitCode=0`
**When** the SSE stream closes
**Then** the page:
- Shows `#result` with: "Ton rêve est prêt ! / Your dream is ready!" (emoji `✅` paired with the semantic text — F29; the `role="status"` + `aria-live="polite"` on `#result` ensures screen-reader announcement).
- A clickable button: "Ouvrir mon app / Open my app" that navigates to `resultUrl` (which is `http://localhost:<port>/demo/<slug>/index.html`).
- A "Nouveau rêve / Start a new dream" button that resets the page.

If `exitCode != 0`:
- Shows `#result` with user-facing string: "Ça n'a pas marché. Essaie encore. / Something didn't work. Try again." (F13 — strip jargon; the exit code stays in internal logs only).
- Shows the last 10 progress lines as a debug snippet, source = the SSE `log` events the client has collected in a bounded ring buffer. `stderr`-stream lines styled distinctly.
- If no log events were received (subprocess died before producing output): show "Aucune information disponible. Vérifie le terminal où tu as lancé `mmd serve`. / No information available. Check the terminal where you started `mmd serve`." (F25).
- A "Réessayer / Try again" button that resets the page.

Tag: `@integration`.

### AC-6: status.json read by UI (with both schemas)

**Given** a dream is being processed
**When** the UI calls `GET /api/status/<slug>` every 5 seconds (or receives `status` SSE events)
**Then** the response is the JSON contents of `.mmd/shared/status.json` MERGED with `{"jobId": "<uuid>"}` (G16 — so a reloaded UI that only knows the slug can recover the jobId and open the SSE stream). If no job for `<slug>` exists in the in-memory `jobs` map (server restart), `jobId` is omitted and the response is the raw status.json only; the UI then surfaces the "Connexion perdue…" message per AC-3b.

The UI MUST gracefully handle BOTH:
- The **minimal v0.1 schema** (basic `{state, slug, started_at}`) — fallback to "Working…" + elapsed time.
- The **enriched v0.2 schema** from scoping §4.5.1 (`current_phase`, `progress_percent`, `last_log_lines`, `heartbeat_at`, `heartbeat_interval_seconds`).

**Both branches MUST be implemented AND unit-tested with hand-crafted fixtures** even though v0.2 enrichment is not yet shipped (F15 — until v0.2 lands the enriched branch is dead code, but pre-implementing it lets v0.2 drop in cleanly). Fixtures live at `test/fixtures/status-minimal.json` and `test/fixtures/status-enriched.json`.

The UI displays at minimum (when enriched schema present):
- `current_phase` if present.
- `progress_percent` as a `<progress>` bar if present. Missing or invalid `progress_percent` → render `<progress>` with no `value` attribute (indeterminate animation). UI MUST clamp monotonically — once the bar reaches X%, it never decreases (F24).
- `last_log_lines` if present (in addition to live SSE log stream — used to backfill when re-subscribing).
- A heartbeat staleness warning if `heartbeat_at` is older than `heartbeat_interval_seconds * 2`.

**Error handling** (F19): if `status.json` exists but fails to JSON-parse (mid-write), retry up to 3 times with 100 ms backoff. After 3 failures, return 503 `{"error":"status_unavailable","retry_after_ms":1000}` with `Retry-After: 1` header — NEVER 500. Atomic writer-side `rename()` is a v0.2 enrichment concern (out of scope here).

**Unit-mismatch clarification** (G14): the response header `Retry-After: 1` is HTTP-spec compliant (RFC 9110: integer seconds). The body field `retry_after_ms: 1000` is for client convenience (JS `setTimeout` takes milliseconds). The two values are equivalent (1 s = 1000 ms); the redundancy is intentional.

Tag: `@unit` for both schema branches against fixtures; `@integration` for 503 retry on corrupted file.

### AC-7: Static serving with path-traversal protection

**Given** the server is running and a dream has produced `demo/<slug>/`
**When** the user navigates to `http://localhost:<port>/demo/<slug>/index.html`
**Then** the server serves the file with correct MIME types (per allowlist below) and security headers (AC-9).

**MIME allowlist** (return 415 for anything else — never default to `application/octet-stream` for unknown types per F2):
- `.html` → `text/html; charset=utf-8`
- `.js` → `application/javascript; charset=utf-8`
- `.css` → `text/css; charset=utf-8`
- `.json` → `application/json; charset=utf-8`
- `.svg` → `image/svg+xml`
- `.png` → `image/png`
- `.jpg`, `.jpeg` → `image/jpeg`
- `.webp` → `image/webp`
- `.gif` → `image/gif`
- `.ico` → `image/x-icon`
- `.woff2` → `font/woff2`
- `.txt` → `text/plain; charset=utf-8`

**Path-traversal defense** (F2, G4 — simple decode-once + canonicalize algorithm; explicit G/W/T per attack vector):

```
DEMO_ROOT = path.resolve(process.cwd(), 'demo')
```

Algorithm (in order; first failure → 403 with `{"error":"forbidden_path"}` and logged event `path_traversal_blocked` with `attack_vector` set to the rule that fired; MIME-mismatch is the only step that returns 415; malformed `%XX` returns 400):

1. **Reject null bytes**: if `req.url` contains ` ` → 403.
2. **Reject backslashes** in URL path (Windows traversal vector): if path contains `\` → 403.
3. **Decode exactly once** (G4): strip the query string (`rawPath = req.url.split('?')[0]`), then call `decoded = decodeURIComponent(rawPath)`. If `decodeURIComponent` THROWS (malformed `%XX` such as `%ZZ` or stray `%`) → 400 `{"error":"invalid_path_encoding"}` (this is a malformed request, not an attack). **Post-decode null-byte check**: if `decoded` contains a NUL byte (` `) — e.g. `%00` in the raw URL — → 403 (this catches encoded NUL that slipped past step 1). The defense against double-encoding is implicit: we decode ONCE and never call `decodeURIComponent` on the result. Inputs like `/demo/%252e%252e/etc/passwd` decode once to `/demo/%2e%2e/etc/passwd`, which still contains a literal `%2e` filename segment — the subsequent normalization treats it as a literal filename (no `..` segment after one decode), it then fails step 7 (no matching MIME extension on `%2e%2e`) → 415. **Documented v0.2.5 limitation**: filenames containing a literal `%` character are unservable (will fail at step 7 with 415 even if the on-disk file exists, because we do not re-decode). Deferred to v0.6.
4. **Normalize and reject parent segments**: `normalized = path.posix.normalize(decoded)`. If `normalized` contains any `..` segment after normalization OR starts with `/..` → 403.
5. **Resolve** the final filesystem path: `resolved = path.resolve(DEMO_ROOT, '.' + normalized)`.
6. **Prefix check (canonical containment)**: `resolved.startsWith(DEMO_ROOT + path.sep)` MUST hold — else 403. Listing `DEMO_ROOT` itself (equality with `DEMO_ROOT`) is also 403 (no directory listings).
7. **MIME lookup**: extension must be in the allowlist above — else 415 `{"error":"unsupported_file_type"}` and log `static_unsupported_mime`.
8. **Symlink check (per-component lstat-resolve)**: for each path component from `DEMO_ROOT` down to `resolved`, run `lstat()`; if ANY component `isSymbolicLink()`, 403 (mirrors the `bin/mmd.js:142-156` lstat pattern, extended to defeat mid-path symlinks).
9. **Top-level symlink defense**: at boot, run `realpath(DEMO_ROOT)`; if it differs from `DEMO_ROOT` (someone replaced `./demo` with a symlink), log a warning and use the realpath as the effective root for the rest of the process lifetime.

`@unit` tests (per attack vector — Expected column shows the documented response under the decode-once algorithm):
| Attack | Input | Expected |
|---|---|---|
| Parent traversal | `/demo/../etc/passwd` | 403 (step 4 `..` segment) |
| URL-encoded | `/demo/%2e%2e/etc/passwd` | 403 (step 4 — decodes to `/demo/../etc/passwd`) |
| Double-encoded | `/demo/%252e%252e/etc/passwd` | 415 (step 7 — decodes ONCE to `/demo/%2e%2e/etc/passwd`, treated as literal filename `%2e%2e`, no MIME match) |
| Malformed encoding | `/demo/%ZZ` | 400 `invalid_path_encoding` (step 3 throw) |
| Backslash (Win) | `/demo/..\..\etc\passwd` | 403 (step 2) |
| Absolute slip | `/demo//etc/passwd` | 403 (step 4 normalization) |
| Null byte | `/demo/foo%00.png` | 403 (step 3 decodes to literal NUL; step 1 re-applied post-decode rejects) |
| Symlink escape | `/demo/<slug>/link-to-etc` (where `link-to-etc → /etc`) | 403 (step 8 per-component lstat) |
| Literal `%` in filename (G4 limitation) | `/demo/<slug>/file%20name.png` | 415 (step 7 — no MIME match on decoded literal; documented v0.2.5 limitation, deferred to v0.6) |
| Unknown MIME | `/demo/<slug>/payload.exe` | 415 (step 7) |
| Happy path | `/demo/<slug>/index.html` | 200 + correct MIME |

This allows the kid to actually USE the PWA she just dreamed up — `getUserMedia` works because the page is served over `http://localhost` (a secure context, cf the `fix/camera-secure-context` lesson learned in v0.1).

Tag: `@unit` per attack vector + `@integration` for end-to-end.

### AC-8: Localhost-only binding (NON-NEGOTIABLE — F1)

**Given** the server is starting
**When** `server.listen()` is called
**Then** the listen call MUST pass host `'127.0.0.1'` explicitly: `server.listen(port, '127.0.0.1', cb)`.

**Given** the server has emitted `listening`
**When** an `@integration` test calls `server.address()`
**Then** `address().address === '127.0.0.1'` AND `address().family === 'IPv4'`. Binding to `0.0.0.0`, `::`, or any non-loopback address MUST fail this test.

Tag: `@integration`.

### AC-9: Security response headers (F16)

**Given** any request to the server
**When** the response is sent
**Then** the following headers MUST be present on EVERY response (including errors, SSE, static):

| Header | Value |
|---|---|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `no-referrer` |
| `Content-Security-Policy` | `default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'` |

CORS: `Access-Control-Allow-Origin` returned ONLY for the exact local origin (`http://localhost:<port>` or `http://127.0.0.1:<port>` matching the request's `Origin`); NEVER `*` (F4).

**Exception for `/demo/*` responses**: served PWAs may use inline JS (generated by `mmd` is currently inline-script-friendly), so for those routes only the CSP is relaxed to: `default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; media-src 'self' blob:; connect-src 'self'`. **This relaxation is flagged as a v0.6 hardening concern** (generated PWAs should migrate to external scripts + nonces).

Tag: `@integration` (assert headers on representative responses).

### AC-10: Request timeouts (F40)

**Given** the server has been instantiated
**When** the HTTP server is configured
**Then**:
- `server.requestTimeout = 30_000` (30 s for a full request including body).
- `server.headersTimeout = 10_000` (10 s for the request headers).
- For SSE responses, `res.setTimeout(0)` is applied AFTER headers are written to disable the request-level timeout for the long-lived stream (otherwise the stream would die at 30 s).

Tag: `@integration` (slow-write request → 408/closed).

---

## 3. Architecture (still minimal)

```
mmd serve
   │
   ▼
[1] Parse port from env (MMD_SERVE_PORT) or default 3000; validate per AC-1b
   │
   ▼
[2] Resolve DEMO_ROOT = path.resolve(process.cwd(), 'demo'); realpath check (AC-7 step 8)
   │
   ▼
[3] Start HTTP server (node:http, no framework) bound to 127.0.0.1 (AC-8):
       GET  /                            → serve bin/serve-ui/index.html
       GET  /style.css                   → serve bin/serve-ui/style.css
       GET  /app.js                      → serve bin/serve-ui/app.js
       GET  /favicon.svg                 → inline SVG (or 204)
       POST /api/dream                          → validate, spawn, return 202 {jobId, streamUrl}
       GET  /api/dream/stream/<jobIdOrSlug>     → SSE stream (text/event-stream); accepts UUID OR slug (G16, AC-3b)
       GET  /api/status/<slug>                  → return contents of .mmd/shared/status.json + {jobId} (G16, AC-6)
       GET  /demo/<slug>/*                      → static serve from DEMO_ROOT with path-traversal protection
       GET  /api/health                         → return {"ok": true, "version": "<from package.json>"}
   │
   ▼
[4] requestTimeout=30s, headersTimeout=10s; apply security headers middleware (AC-9, AC-10)
   │
   ▼
[5] On `listening`: print MMD_SERVE_LISTENING line, then conditionally open browser (AC-1)
   │
   ▼
[6] Wait for SIGINT/SIGTERM → graceful shutdown (AC-1c)
```

**Routing notation** (G8): paths above use `<jobIdOrSlug>` / `<slug>` placeholders, NOT Express-style `:jobId` / `:slug`. The router matches paths by string prefix + manual extraction (`req.url.startsWith('/api/dream/stream/')` then `slice` the rest); there is no Express-style path-param framework — consistent with the "no new dependencies" rule.

**Subprocess working directory** (F22): the server spawns subprocesses with `cwd = process.cwd()`. The static-serve root for `/demo/*` is `path.join(process.cwd(), 'demo')`. **`mmd serve` MUST be run from the directory where `demo/` should live** (typically the project root). Documented in README under `## mmd serve`.

**Subprocess command mapping** (F5 / §3 of spec):
- Default: `child_process.spawn('node', ['bin/mmd.js', dream], {shell: false, cwd: process.cwd(), env: process.env})`.
- If `MMD_AUTODEV_CMD` is set (used by tests with `fake-autodev-streaming.sh`), the server respects the same convention as v0.1's `lib/invoke-autodev.js`: `spawn('bash', [scriptPath, dream], {shell: false, cwd: process.cwd(), env: process.env})`.

Total new components: `bin/serve.js` (CLI subcommand dispatcher) + `lib/server.js` (HTTP logic) + `lib/sse.js` (SSE helper + ring buffer) + `lib/security-headers.js` (header middleware) + `lib/rate-limit.js` (in-memory bucket) + `bin/serve-ui/index.html` + `bin/serve-ui/style.css` + `bin/serve-ui/app.js`. **No new dependencies** — `node:http`, `node:fs/promises`, `node:child_process`, `node:path`, `node:url`, `node:crypto` are all built-in.

The existing `bin/mmd.js` is modified to dispatch: if `argv[2] === 'serve'`, invoke `bin/serve.js`; else, current behavior unchanged. The version string used by `GET /api/health` is read once from `package.json` via `require('../package.json').version` (or `JSON.parse(fs.readFileSync(...))`), and the existing hardcoded `'0.2.5'` in `bin/mmd.js` is refactored the same way (F30).

### §3.bis SSE event contract

`Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`.

**Keepalive**: server sends `: heartbeat\n\n` (SSE comment) every 15 s while the stream is open. This prevents intermediaries from buffering.

**Event types** (closed enum — F8):

```ts
// All events are sent as `data: <json>\n\n` (no `event:` line unless specified).
type ServerSentEvent =
  | { type: "log",  text: string, stream: "stdout" | "stderr", ts: string /* ISO 8601 */ }
  | { type: "status", phase?: string, progress_percent?: number, ts: string }
  | { type: "warn", text: string, ts: string }                            // backpressure, see below
  | { type: "done", exitCode: number, demoPath: string, resultUrl: string, ts: string }
  | { type: "error", code: string, message: string, ts: string }          // server-side abort
  | { type: "server_shutdown", ts: string };                              // AC-1c
```

**Backpressure / buffering & catch-up** (F8, G7): each per-stream in-memory ring buffer holds the last **1000 lines**. On reconnect to `/api/dream/stream/<jobIdOrSlug>` (per AC-3b) the server replays the **most recent 100 of those 1000 lines** as catch-up before resuming the live stream — the two numbers play distinct roles (1000 = buffer capacity, 100 = catch-up replay window). If the subprocess produces faster than the client can consume and the buffer fills:
- The oldest lines are dropped from the 1000-line buffer.
- Exactly one `{type: "warn", text: "output truncated"}` event is emitted (deduplicated).
- The `done` event is still sent at the end. The 100-line catch-up window is taken from the tail of whatever remains in the 1000-line buffer at reconnect time.

**Both stdout and stderr** are forwarded as `log` events with `stream: "stdout"` or `stream: "stderr"` (per F8 + AC-5).

### §3.ter Structured logging schema (F12)

Per `observability.md` §I, every server-side log line is structured JSON written to stdout. Required fields: `timestamp` (ISO 8601 UTC), `level`, `message`, `context`, `request_id` (UUID v4 propagated per `observability.md` §IV).

**Privacy rule** (F12): the verbatim dream string MUST NEVER be logged. Instead, log `dream_length` (integer). The slug (derived, deterministic) MAY be logged.

| Event | Level | Required `context` fields | Triggered by |
|---|---|---|---|
| `server_started` | info | `port`, `host`, `version` | listen callback |
| `server_shutdown` | info | `reason` (`"SIGINT"`/`"SIGTERM"`/`"crash"`), `uptime_ms` | shutdown handler |
| `dream_submitted` | info | `request_id`, `job_id`, `slug`, `dream_length` | POST /api/dream success |
| `dream_rejected` | warn | `request_id`, `reason` (`"empty"`/`"too_long"`/`"too_large"`/`"rate_limit"`/`"duplicate"`/`"forbidden_origin"`/`"unsluggable"`/etc.), `status_code`; AND when `reason == "rate_limit"` (G6): `bucket_used` (int), `bucket_capacity` (int) | POST /api/dream failure |
| `subprocess_spawned` | info | `request_id`, `job_id`, `slug`, `pid` | after spawn |
| `subprocess_exit` | info | `request_id`, `job_id`, `slug`, `exit_code`, `duration_ms`, `signal` | on `exit` event |
| `sse_client_connected` | debug | `request_id`, `job_id` | EventSource opened |
| `sse_client_disconnected` | debug | `request_id`, `job_id`, `duration_ms` | `req.on('close')` |
| `sse_buffer_truncated` | warn | `request_id`, `job_id`, `dropped_count` | ring buffer overflow |
| `path_traversal_blocked` | warn | `request_id`, `url`, `attack_vector` (the rule that fired) | static handler |
| `static_unsupported_mime` | warn | `request_id`, `url`, `extension` | static handler |
| `port_retry` | warn | `attempted_port`, `next_port`, `errno` | EADDRINUSE on default port |
| `status_unavailable` | warn | `request_id`, `slug`, `parse_attempts` | status.json corruption (AC-6) |

`request_id` is generated for every incoming HTTP request and attached to the request context for the lifetime of all downstream work (subprocess spawn, SSE stream).

**Audit-log persistence** (G17 — satisfies `observability.md` §III NON-NEGOTIABLE append-only audit requirement; stdout alone is not append-only because it can be redirected, truncated, or lost on crash): the four security/lifecycle events `dream_submitted`, `dream_rejected`, `subprocess_exit`, `path_traversal_blocked` MUST ALSO be persisted (in addition to stdout) as one JSON object per line (JSONL) to `.mmd/audit.log`, opened in `O_APPEND` mode at server start and never truncated by `mmd serve` itself (rotation is an operator concern). Per the single-user local context, no user-identity field is logged; events carry the constant marker `"actor":"local-user"` to make the schema future-compatible with multi-user (v0.6+) without later breaking consumers. Failure to write the audit log (disk full, permission denied) is logged at `error` level on stdout but MUST NOT block request processing.

### §3.ter.1 `MMD_SERVE_LISTENING` vs `server_started` (G9)

`MMD_SERVE_LISTENING port=<NNNN> host=127.0.0.1` is the ONLY non-JSON stdout line emitted by `mmd serve` (AC-1). It is emitted IN ADDITION TO the structured `server_started` JSON log event (which is also written to stdout per §3.ter). Both lines are emitted on the `listening` callback in this order: structured `server_started` JSON first, then the `MMD_SERVE_LISTENING …` plain line. Tests that parse stdout MUST tolerate interleaved JSON lines and key on the literal `MMD_SERVE_LISTENING ` prefix to find the port.

---

## 4. Out of scope for v0.2.5

To keep this small and focused:

- ❌ No tunnel to expose the local server publicly (Cloudflare Tunnel, ngrok) — deferred to v0.6+.
- ❌ No remote access from another device on the same Wi-Fi (the server binds to `127.0.0.1` only per AC-8) — deferred to v0.6.
- ❌ No authentication (single-user local tool).
- ❌ No persistence beyond the local filesystem (no DB, no signup). Rate-limiting state is in-memory only — persistent rate limiting deferred to v0.6+ (scope-discipline tension noted). Rate-limit cap is overridable via `MMD_SERVE_RATE_LIMIT_PER_HOUR` (default 10, G15); local-only, not a security boundary.
- ❌ No persistence of in-memory job state (G18): the `jobs` map is lost on `mmd serve` restart. A reload after restart that hits `GET /api/dream/stream/<jobIdOrSlug>` for an unknown job returns 404 `unknown_job`; the UI then shows the "Connexion perdue ; vérifie le dossier `demo/` pour le résultat." message (AC-3b). The on-disk `demo/<slug>/` artifact survives, so the kid's PWA is still reachable.
- ❌ No conversational back-and-forth between submissions (single-shot per dream; multi-turn comes with v0.3 Dream Catcher conversational and v0.10 Full Dream Catcher Web UI).
- ❌ No voice input (comes with v0.11).
- ❌ No profile selection in the UI (v0.2.5 always uses the default profile; profile UI comes later).
- ❌ No multi-user, no sharing, no public hosting.
- ❌ No fancy CSS framework, no dark mode toggle, no localization beyond the bilingual placeholder/labels mentioned in AC-2.
- ❌ No internationalization library — just bilingual hardcoded strings for v0.2.5.
- ❌ No atomic `status.json` write on the writer side (consumer-side retry handled in AC-6; atomic write is a v0.2 concern).
- ❌ No slug-collision resolution (409 returned per AC-3 / F26; suffix-disambiguation deferred to v0.6).
- ❌ No `@e2e` Reality Check coverage for the serve UI (deferred to v0.6; manual verification by Sébastien is the substitute — see §5 "Reality Check substitution").
- ❌ No CSP nonces for generated PWAs (relaxed CSP on `/demo/*` per AC-9, flagged as v0.6 hardening).

---

## 5. Implementation hints (for auto-dev)

### Project structure (additions only)

```
make-my-dreams/
├── bin/
│   ├── mmd.js                       # existing — modified to dispatch 'serve' subcommand
│   ├── serve.js                     # NEW — CLI subcommand entrypoint
│   └── serve-ui/
│       ├── index.html               # NEW — single-page UI, NO inline <script>/<style>
│       ├── style.css                # NEW — ~80 lines vanilla CSS
│       └── app.js                   # NEW — ~150 lines vanilla JS (fetch + EventSource)
├── lib/
│   ├── (existing files unchanged)
│   ├── server.js                    # NEW — HTTP routing + dispatch
│   ├── sse.js                       # NEW — SSE helpers + ring buffer
│   ├── security-headers.js          # NEW — apply AC-9 headers
│   └── rate-limit.js                # NEW — in-memory bucket
├── test/
│   ├── fixtures/
│   │   ├── fake-autodev.sh                  # existing — kept for non-streaming tests
│   │   ├── fake-autodev-streaming.sh        # NEW — emits N stdout lines with sleep 0.1, writes demo/<slug>/index.html (F10)
│   │   ├── status-minimal.json              # NEW — v0.1 schema fixture (F15, AC-6)
│   │   └── status-enriched.json             # NEW — v0.2 schema fixture (F15, AC-6)
│   ├── util/
│   │   └── contrast.js                      # NEW — ~30-line WCAG luminance calc (AC-2c, F38)
│   └── integration/
│       ├── (existing files unchanged)
│       ├── server.test.js                   # NEW — GET /, POST /api/dream, AC-8 bind check, AC-9 headers, path-traversal
│       └── serve-cli.test.js                # NEW — boot+exit @smoke, SIGINT, MMD_SERVE_LISTENING line
```

### `fake-autodev-streaming.sh` skeleton (F10)

```bash
#!/usr/bin/env bash
# Usage: fake-autodev-streaming.sh "<dream>"
# Env: MMD_FAKE_LINES (default 5), MMD_FAKE_SLUG (default derived from dream)
set -euo pipefail
DREAM="${1:?missing dream}"
SLUG="${MMD_FAKE_SLUG:-$(echo "$DREAM" | tr ' ' '-' | tr '[:upper:]' '[:lower:]' | head -c 40)}"
LINES="${MMD_FAKE_LINES:-5}"
for i in $(seq 1 "$LINES"); do
  echo "fake-autodev: step $i/$LINES"
  sleep 0.1
done
mkdir -p "demo/$SLUG"
echo "<!doctype html><title>fake</title><h1>$DREAM</h1>" > "demo/$SLUG/index.html"
echo "demo/$SLUG/index.html written"
```

The existing `fake-autodev.sh` is kept untouched for any test that needs non-streaming behavior.

### Key dependencies (still minimal)

- **No new runtime dependencies.** Node 20+ built-ins: `node:http`, `node:fs/promises`, `node:path`, `node:child_process`, `node:url`, `node:crypto`.
- `node:url` is used for safe `req.url` parsing via the `URL` constructor (handles encoded characters consistently — F33).
- For browser-open: `child_process.spawn(opener, [url], {detached: true, stdio: 'ignore'}).unref()` where `opener` is `open` (macOS), `xdg-open` (Linux), or `start` (Windows). Wrap in a `tryOpenBrowser(url)` helper that swallows ENOENT (an absent command is not a failure).

### Tests (per `testing.md` §V stratification — F9)

Budgets MUST match `testing.md` §V exactly:
- Per-test target < 1 s with hard ceiling 5 s. Anything heavier → re-tag `@slow` or split.
- Whole-suite sum < 5 min.
- One `@smoke` boot+exit test (in `serve-cli.test.js`) — must run in < 1 s.

Tag every new test:
- `@smoke`: boot server on ephemeral port (MMD_SERVE_PORT=0, MMD_SERVE_ALLOW_RANDOM=1, MMD_SERVE_NO_OPEN=1), assert listening line on stdout, SIGINT, exit 0.
- `@unit` (< 100 ms each): path-traversal-prevention per attack vector (AC-7 table, incl. literal-`%`-in-filename → 415 per G4), MIME-type lookup, SSE event serialization, port-parsing from env (AC-1b), rate-limit bucket logic (AC-3c — including "failed runs don't consume capacity" per G15 and `MMD_SERVE_RATE_LIMIT_PER_HOUR` override), `progress_percent` clamping (AC-6, F24), contrast + tap-target checks (AC-2c, F38), CSP header presence (AC-9), subprocess arg-array escape test with `;`/`$()`/backticks (F5), body-size cap (F3), `dream.length <= 500` server-side cap per G5, origin/host validation (F4), status.json schema fixtures (AC-6, F15), slug-defense assertion (`path.basename(slug) === slug`, G10), `unsluggable_dream` 400 on empty slug, AC-3b slug-as-SSE-key resolution (G16), AC-3b 404 `unknown_job` after restart (G18).
- **G12 — Ctrl+Enter / Cmd+Enter `@unit` test**: synthetic `KeyboardEvent('keydown', {key: 'Enter', ctrlKey: true})` AND `{key: 'Enter', metaKey: true}` dispatched on the textarea triggers form submit (same effect as clicking the button per AC-2b). If no jsdom is available in the test stack, downgrade to an `@integration` smoke test using a minimal headless check (e.g. via `node --experimental-vm-modules` + a tiny DOM shim) OR document the assertion as "verified at code-review time" — this fallback MUST be called out explicitly in the test file's header comment so the gap is visible.
- `@integration` (< 5 s each): boot server on ephemeral port, GET /, GET /api/health, POST /api/dream against `MMD_AUTODEV_CMD=bash test/fixtures/fake-autodev-streaming.sh`, assert SSE stream is well-formed (event types, keepalive, terminal `done`), assert `address().address === '127.0.0.1'` (AC-8), EADDRINUSE retry (AC-1b), graceful shutdown w/ open SSE (AC-1c), client-disconnect-during-SSE (AC-3b), reconnect-by-slug (AC-3b / G16), all AC-9 headers on representative responses, audit-log append to `.mmd/audit.log` for the four security/lifecycle events (G17).
- **G13 — POST validation performance**: an `@integration` test MUST assert the `202 Accepted` response for `POST /api/dream` is returned within **1 s** on a warm system (validation + spawn handoff is fast; the 30 s `requestTimeout` is a safety net, not a target — AC-10).
- **No `@e2e` for v0.2.5** — Reality Check extensions for the serve UI come in v0.6.

### Reality Check substitution (F34)

Manual verification by Sébastien is the substitute for `@e2e` in v0.2.5: load the page in a real browser, submit a fake dream, observe SSE updates, click the result link, verify the generated PWA loads. This manual pass is part of the Definition of Done (§6.1) but is NOT automated. Reality Check for the serve UI is a v0.6 deliverable.

### Constitution compliance

Per the **modular constitution v2.0** and the bindings table:
- `universal.md`: applies (SOLID, KISS, DRY, separation of concerns).
- `security.md`: applies — path-traversal protection (AC-7), CSRF/origin defense (AC-3 / F4), CSP and other headers (AC-9), localhost binding (AC-8), no-shell subprocess (AC-3 / F5), rate limiting (AC-3c).
- **Profile clarification** (F13): the CODE constitution profile is **Pro** (developer-facing). The UI constitution is **Kid** (consumer-facing, since the primary user is Sébastien's 13-year-old). Therefore `safe-by-default.md` AND the spirit of `kid.md` apply to the UI: no analytics, accessibility floor, plain-language error strings, keyboard nav (AC-2b), contrast ≥ 4.5:1 (AC-2c), no surprise sound, no autoplaying audio.
- `testing.md` §V test stratification: applies — every test tagged, budgets per §V (F9).
- `commit-git.md`: branch is `slice/v0.2.5-mmd-serve` (already exists and tracks origin per F35), atomic commits, `git push` follows EVERY commit per §III, AI attribution allowed. Expected commit prefixes (F32): `feat(serve):`, `test(serve):`, `docs(serve):`, `chore(serve):`. ADR-003 lands as `docs(adr): ADR-003 vanilla UI + SSE choice`.
- `error-handling.md`: applies — graceful degradation if browser-open fails (AC-1), port-taken retry then explicit env-error (AC-1b), subprocess crash → user-facing friendly message + last 10 log lines (AC-5).
- `observability.md`: structured log events per §3.ter table; `request_id` propagation per `observability.md` §IV.
- `ai-coding.md`: applies — verification before delivery (run new tests, manually load the page, submit a fake dream, observe SSE behavior).

### Bootstrap reflexive context (scoping §7)

This is the **first version developed by MMD itself** (via the Standard engine = auto-dev). v0.1 was developed by Sébastien giving Sébastien's auto-dev a fil-rouge dream. v0.2.5 is auto-dev being invoked with this spec, on a `slice/v0.2.5-mmd-serve` branch, modifying the MMD codebase itself.

**Reflexive evidence requirement** (F39): auto-dev's final commit MUST include trailer `Generated-By: mmd-auto-dev/standard v0.2`. A bootstrap evidence file `_bmad-output/v0.2.5-bootstrap-evidence.json` capturing engine name, total wall-clock duration, and retry count is OPTIONAL for v0.2.5 (deferred to dream-bench v0.2b).

If auto-dev cleanly produces v0.2.5 with all ACs met, the reflexive bootstrap mechanism is empirically validated.

---

## 6. Definition of done

v0.2.5 is done when:

1. All **16 acceptance criteria** (AC-1, AC-1b, AC-1c, AC-2, AC-2b, AC-2c, AC-3, AC-3b, AC-3c, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10) are met. Manual verification by Sébastien locally on the daughter-dream scenario (Reality Check substitute per F34).
2. New tests pass cleanly with their declared tags; full suite stays at 52+ tests passing; `npm test:integration` completes in < 5 min and `npm test:smoke` in < 10 s (per `testing.md` §V — F9).
3. `mmd serve` boots in under 2 seconds (listening line printed within 2 s of process start).
4. The page loads in under 500 ms (network localhost); total wire size of GET / + GET /style.css + GET /app.js < 30 720 bytes (asserted by `@unit` test per AC-2 / F20).
5. README updated with a `## mmd serve` section showing the command and a **text description of the UI flow** (no binary screenshot asset in the repo for v0.2.5 — F31). Documents the `cwd = process.cwd()` requirement (F22) and the `MMD_SERVE_NO_OPEN` / `MMD_SERVE_ALLOW_RANDOM` env vars.
6. **ADR-003** written justifying: vanilla HTML/CSS/JS for the UI (consistent with ADR-002 for generated PWAs), no framework, no bundler. Plus the choice of SSE over WebSocket for one-way progress streaming (simpler, no upgrade handshake, native to `EventSource`). ADR-003 lands as `docs(adr): ADR-003 vanilla UI + SSE choice`.
7. **Merge to main is NOT in scope of the auto-dev run** (per `commit-git.md` §I — no commit/merge without explicit human approval — F14). The auto-dev run is done when: branch `slice/v0.2.5-mmd-serve` is pushed, all CI checks green, and tag `v0.2.5` is applied. Sébastien performs the merge-to-main as a separate human-gated step.

---

## Changelog — Adversarial Review #1

| ID | Resolution (1 line) |
|---|---|
| F1 | Promoted localhost-only binding to AC-8 with `@integration` test asserting `address().address === '127.0.0.1'`. |
| F2 | Rewrote AC-7 with explicit per-vector defense (URL-encoded, double-encoded, backslash, symlink, absolute, null-byte, MIME allowlist, lstat + realpath of DEMO_ROOT) and a vector→expected table. |
| F3 | Added 4 KB body cap with 413 response and `Content-Type` enforcement to AC-3; `@unit` test required. |
| F4 | Added Origin + Host validation (403 on mismatch) and exact-match CORS in AC-3 + AC-9. |
| F5 | Mandated `spawn('node', ['bin/mmd.js', dream], {shell: false})` arg-array form in AC-3 with explicit `@unit` injection-vector test. |
| F6 | AC-3 codifies serial execution: second concurrent dream → 409. |
| F7 | Added AC-3b: subprocess continues on client disconnect; ring-buffer replay on re-subscribe. |
| F8 | Added §3.bis SSE contract: closed event-type enum, payload schemas, 15 s keepalive, 1000-line ring-buffer with single `warn` on truncation, stream field. |
| F9 | Restated test budgets per `testing.md` §V: per-test < 1 s target / 5 s ceiling, suite < 5 min; one `@smoke` boot+exit. |
| F10 | Specified new `test/fixtures/fake-autodev-streaming.sh` (skeleton in §5) that emits N stdout lines + writes `demo/<slug>/index.html`; existing fixture preserved. |
| F11 | Added AC-1b: non-numeric → exit 2; EADDRINUSE on default → +1 retry x10 → exit 3; explicit port no retry → exit 3; port 0 gated by `MMD_SERVE_ALLOW_RANDOM`. |
| F12 | Added §3.ter structured-log table; privacy rule logs `dream_length` not the verbatim dream; `request_id` propagation. |
| F13 | Profile clarification added in §5 (UI = Kid, code = Pro); AC-2b (keyboard nav, focus rings); AC-2c (contrast + tap-target); AC-5 user-facing messages stripped of jargon. |
| F14 | Rewrote §6.7: branch push + tag is in scope; merge-to-main is human-gated and out of scope. |
| F15 | AC-6 mandates BOTH schema branches implemented + `@unit`-tested with fixtures `status-minimal.json` and `status-enriched.json` (even though enriched is dead code until v0.2). |
| F16 | Added AC-9 with full security-header set + per-route CSP (strict for app, relaxed for `/demo/*` with v0.6 hardening note). |
| F17 | AC-1 specifies open after `listening`, `spawn(..., {detached: true, stdio: 'ignore'}).unref()`, and `MMD_SERVE_NO_OPEN=1` env opt-out. |
| F18 | Added AC-1c: SIGINT/SIGTERM → stop accepting → SSE shutdown event → 5 s grace → SIGKILL → exit 0. |
| F19 | AC-6: 3 retries × 100 ms on parse failure, then 503 + `Retry-After: 1`, never 500. |
| F20 | AC-2 specifies sum-of-Content-Length < 30 720 bytes with `@unit` test on `fs.statSync`; inline SVG favicon to silence 404. |
| F21 | AC-3 reworked as two-step: POST → 202 `{jobId, streamUrl}`, client opens `EventSource(streamUrl)` via GET. |
| F22 | §3 + DoD §6.5 document `cwd = process.cwd()` requirement and `demo/` location. |
| F23 | Added AC-3c: in-memory token bucket = 1 in-flight + 5/hour, 429 with `Retry-After`; persistence deferred to v0.6 (scope tension noted in §4). |
| F24 | AC-6: missing/invalid `progress_percent` → indeterminate `<progress>`, monotonic clamp (never decreases). |
| F25 | AC-5: empty-log case shows "Aucune information disponible…" message; stderr lines styled distinctly via `stream` field. |
| F26 | AC-3: server computes slug via `slugify` from `lib/parse-dream.js`; collision → 409 `duplicate_dream` (resolution deferred to v0.6). |
| F27 | AC-1: server prints `MMD_SERVE_LISTENING port=<NNNN> host=127.0.0.1` line on `listening`; `MMD_SERVE_NO_OPEN` documented. |
| F28 | AC-1c: shutdown message is bilingual "À bientôt ! / Bye!". |
| F29 | AC-2 adds `role="log" aria-live="polite"` on `#progress`, `role="status" aria-live="polite"` on `#result`; emoji paired with semantic text (AC-5). |
| F30 | `GET /api/health` reads version from `package.json`; `bin/mmd.js` refactored to share the same source. |
| F31 | DoD §6.5: text description of UI flow, no binary screenshot in v0.2.5. |
| F32 | §5 lists expected commit prefixes (`feat(serve):` etc.) and ADR-003 commit message. |
| F33 | §5 justifies `node:url` usage (safe `URL` constructor, consistent decoding). |
| F34 | §5 "Reality Check substitution" documents manual verification as `@e2e` substitute for v0.2.5. |
| F35 | §5 notes `commit-git.md` §III push-after-commit; branch already exists tracking origin. |
| F36 | AC-3: explicit 400 for empty/whitespace `dream`, 400 for missing `dream` key, 413 for >4 KB, 415 for wrong Content-Type. |
| F37 | §5 + AC-2 prohibit inline `<script>`/`<style>` in `index.html`; keeps `script-src 'self'` CSP clean. |
| F38 | AC-2c `@unit` test parses `style.css` with vendored ~30-line luminance calculator; asserts contrast ≥ 4.5:1 and button min-width/height ≥ 48 px (helper at `test/util/contrast.js`). |
| F39 | §5 Bootstrap: final commit MUST include `Generated-By: mmd-auto-dev/standard v0.2` trailer; evidence JSON file is OPTIONAL (deferred to dream-bench v0.2b). |
| F40 | AC-10: `server.requestTimeout=30_000`, `server.headersTimeout=10_000`; SSE responses set `res.setTimeout(0)` after headers. |

---

## Changelog — Adversarial Review #2

| ID | Resolution (1 line) |
|---|---|
| G1 | §2 intro + §6.1 DoD updated from "13" to **16** ACs; full ID list enumerated in §2. |
| G2 | DoD §6.1 numbering aligned with G1; AC list now exact. |
| G3 | AC-3: removed "in-flight cap = 1" from the rate-limit sentence; 409 = in-flight collision (state conflict), 429 = AC-3c rolling-window only. |
| G4 | AC-7 step 3 rewritten as decode-once with explicit throw → 400, post-decode NUL check; double-encoded inputs now fall through to 415 (literal filename); literal-`%` filenames documented as v0.2.5 limitation (deferred to v0.6) with a `@unit` test. |
| G5 | AC-3 server validation now enforces `dream.length <= 500` → 400 `dream_too_long` (defense in depth vs UI maxlength). |
| G6 | AC-3c documents bucket as single GLOBAL counter for v0.2.5 (acceptable because of AC-8 loopback); v0.6 MUST switch to per-source keying. `bucket_used` / `bucket_capacity` added to `dream_rejected` context. |
| G7 | §3.bis + AC-3b clarified: per-stream ring buffer = 1000 lines, catch-up replay window = 100 lines. Distinct roles. |
| G8 | §3 architecture block uses `<jobId>` / `<slug>` (not Express `:jobId`); added "string-prefix routing, no framework" note. |
| G9 | §3.ter.1 added: documents `MMD_SERVE_LISTENING` plain line as the ONLY non-JSON stdout, emitted alongside structured `server_started` JSON; tests must tolerate interleaved JSON. |
| G10 | AC-3 restates `slugify` contract inline + adds `path.basename(slug) === slug` defense-in-depth assertion; empty slug → 400 `unsluggable_dream`. |
| G11 | §1 LOC estimate updated from "~300" to "~800" to match the expanded modular structure in §5. |
| G12 | §5 adds explicit `@unit` test bullet for Ctrl+Enter / Cmd+Enter submission (AC-2b) with documented fallback path if no jsdom. |
| G13 | §5 adds `@integration` perf assertion: POST `/api/dream` MUST return 202 within 1 s on a warm system (the 30 s `requestTimeout` is a safety net). |
| G14 | AC-6 503 response: one-line clarification that `Retry-After: 1` is HTTP-spec seconds and `retry_after_ms: 1000` is client-convenience milliseconds; equivalent values. |
| G15 | AC-3c rate limit raised to 10/hour; only `exitCode == 0` runs consume capacity; `MMD_SERVE_RATE_LIMIT_PER_HOUR` env var override documented; §4 notes "local-only, not a security boundary". |
| G16 | AC-3b: SSE endpoint accepts slug OR jobId; `GET /api/status/<slug>` response now includes `jobId`; reload flow documented. AC-6 updated; §3 architecture block updated. |
| G17 | §3.ter: audit-log persistence (`observability.md` §III) satisfied by appending `dream_submitted`, `dream_rejected`, `subprocess_exit`, `path_traversal_blocked` to `.mmd/audit.log` JSONL in addition to stdout; anonymous `actor: "local-user"` marker. |
| G18 | §4 + AC-3b document in-memory `jobs` volatility on restart; SSE 404 `unknown_job` + UI bilingual "Connexion perdue ; vérifie le dossier `demo/`…" message. |

---

*Spec v0.2.5 — generated 2026-05-17 from MAKE_MY_DREAMS.md v18. Adversarial Review #1 applied 2026-05-17. Adversarial Review #2 applied 2026-05-17 (0 Critical / 2 High / 7 Medium / 9 Low, all addressed). To be fed to /bmad-adv-auto-dev on branch slice/v0.2.5-mmd-serve.*
