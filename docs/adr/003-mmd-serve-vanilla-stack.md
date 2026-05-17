# ADR-003: `mmd serve` — vanilla HTML/CSS/JS UI + SSE over WebSocket

**Date**: 2026-05-17
**Status**: Accepted
**Authors**: Sébastien (project owner), auto-dev (Standard engine)

## Context

v0.2.5 introduces `mmd serve`: a local HTTP server with a web page that lets a non-technical user (Sébastien's 13-year-old daughter being the primary motivation) submit a dream and watch its progress stream. This is the **accessibility milestone** that unlocks differentiator #1 of MMD (multi-audience accessibility), per scoping `MAKE_MY_DREAMS.md` v17+ §9 v0.2.5.

Two stack questions had to be decided:

1. **Frontend stack**: vanilla HTML/CSS/JS, or a framework (React, Vue, Svelte, …) with a bundler?
2. **Progress streaming transport**: Server-Sent Events (SSE), WebSocket, or polling?

## Decision

### 1. Frontend: **vanilla HTML/CSS/JS, no framework, no bundler**

- `bin/serve-ui/index.html` (~50 lines)
- `bin/serve-ui/style.css` (~200 lines, hand-written, no preprocessor)
- `bin/serve-ui/app.js` (~300 lines, vanilla ES2022, no transpilation)
- Total wire weight uncompressed: < 30 KB (per SPEC_V025.md AC-2, verified by `@unit` test).
- No external font, no analytics SDK, no CDN dependency.

### 2. Transport: **Server-Sent Events (SSE), one-way, GET-only**

- The page issues a `POST /api/dream` to submit a dream and receives a `session_id`.
- It then opens an `EventSource('/api/dream/:session_id/events')` (GET, per EventSource spec) to receive the progress stream.
- Server emits framed events: `data: {"type":"log","text":"...","ts":"..."}\n\n`.
- Final event: `data: {"type":"done","exitCode":N,"resultUrl":"..."}\n\n`.

## Consequences

### Why vanilla HTML/CSS/JS

**Pros**:
- **Consistency with ADR-002**: generated PWAs are vanilla; the MMD-serve UI being vanilla too reinforces "no framework needed for small focused UIs."
- **Zero build step**: no `npm run build`, no bundler config, no source maps, no transpilation cache. `mmd serve` boots in < 1 s.
- **Easier audit**: 550 lines of plain code that anyone can read end-to-end. Critical for a tool meant to be safe for kids — no surprise dependency tree.
- **Zero runtime dependency**: aligns with SPEC_V025.md §5 "No new runtime dependencies." No supply-chain risk (cf P-03 slopsquatting in `security.md`).
- **Page weight target < 30 KB**: achievable trivially with vanilla; nearly impossible with React + bundler overhead.
- **CSP `script-src 'self'` works trivially**: no inline scripts needed (per SPEC_V025.md AC-2 F37).

**Cons / trade-offs accepted**:
- No reactive state library → app.js manages DOM imperatively. Justified by the UI's simplicity (one form, one progress area, one result area).
- No CSS framework → manual a11y discipline (contrast ratio, tap target sizes) verified by `test/util/contrast.js` `@unit` test.
- Future feature growth may push us to reconsider, but Diataxis says: "every doc has a quadrant" → every UI has its complexity ceiling. We're well below ours.

### Why SSE over WebSocket

**Pros**:
- **Progress streaming is one-way** (server → client): EventSource is the perfect match.
- **No handshake protocol upgrade** required (no `Upgrade: websocket` dance).
- **Native browser API** (`EventSource`): zero JS overhead, automatic reconnect on transient drops.
- **Plays nicely with HTTP semantics**: stays a normal `Content-Type: text/event-stream` response. Behind a proxy / dev tool, easy to inspect with `curl`.
- **Single-direction matches our trust model**: the client cannot push arbitrary commands mid-stream; everything goes through `POST /api/dream` as a first-class request with rate-limiting (`lib/rate-limit.js`).

**Cons / trade-offs accepted**:
- EventSource is **GET-only** → the protocol is two-step (POST dream → GET event stream by session_id). Slightly more endpoints than a WebSocket would need. Documented in SPEC_V025.md F21.
- No client → server messaging on the open stream. Acceptable because v0.2.5 doesn't need it (cancel-from-page is deferred to v0.3 Dream Catcher conversational).

**Alternatives rejected**:
- **WebSocket**: bidirectional we don't need; harder to debug from `curl`; requires Upgrade-aware proxies in any future deployment.
- **Long-polling**: works but is awkward (chunked or repeated requests), and EventSource handles reconnect more elegantly.
- **Streaming a single HTTP response (chunked)**: technically possible but EventSource exists precisely for this use case with built-in browser-side parsing.

### Future revisitation

If v0.10 (Full Dream Catcher Web UI) requires:
- Multi-turn conversational state on the page → may justify a small framework (Preact, Svelte) and reconsider SSE vs WebSocket.
- Live collaborative editing → WebSocket becomes mandatory.

Until then, this stack is the right answer.

## References

- [SPEC_V025.md](../../SPEC_V025.md) — full v0.2.5 spec (16 ACs after 3 adversarial-review iterations)
- [ADR-002: Vanilla HTML/CSS/JS for generated PWAs](./002-vanilla-pwa-for-v01.md) — consistent precedent
- [MAKE_MY_DREAMS.md §3.2](../../MAKE_MY_DREAMS.md) — strategic positioning (MMD = orchestration layer, minimal own surface)
- [.specify/memory/constitution/security.md](../../.specify/memory/constitution/security.md) — Bundle A safety items (binding `127.0.0.1` only, CSP, path-traversal protection)
- [WHATWG EventSource spec](https://html.spec.whatwg.org/multipage/server-sent-events.html)
- [MDN — Server-Sent Events overview](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
