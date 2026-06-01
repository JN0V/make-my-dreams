// lib/conductor/notify.js — Conductor Layer-6 notification fan-out (v0.5.a, SPEC_V05A).
//
// SRP (universal.md §I.S): this module owns ONLY the notification contract —
// decide whether to notify, build the wire payload (pure), and POST it
// best-effort. No status.json writes, no run-flow decisions; the caller
// (bin/mmd.js) owns those and is never affected by what happens here.
//
// The Conductor's first brick: MMD runs auto-dev detached, so a user who walks
// away has no signal when a 30–90-min run ends. When MMD_NOTIFY_URL is set,
// MMD POSTs a small JSON payload to the user's own sink (ntfy / Slack / Discord
// / custom) on run done/failed. The contract is OPT-IN (no-op when unset) and
// BEST-EFFORT (a notification failure NEVER changes the run's outcome or exit
// code — error-handling.md: a non-essential side channel must degrade, never
// propagate). The payload carries run METADATA ONLY (slice, state, summary, ts)
// — no secrets, env, or file contents (security.md §least-disclosure on egress).
//
// See ADR-029 and SPEC_V05A.md. Deferred to v0.5.b: the stream-json context
// monitor + the 70% READY_FOR_HANDOFF signal (those change the auto-dev spawn).

/** Default best-effort timeout for the POST (ms). Short by design — a slow or
 *  dead sink must never stall the run's exit. */
const DEFAULT_TIMEOUT_MS = 5000;

/** The neutral phrase used when no summary was given. We NEVER invent details
 *  (universal.md §VI honesty) — an absent summary becomes this fixed phrase,
 *  not a fabricated description of the run. */
const NEUTRAL_SUMMARY = 'no details available';

/** The closed set of lifecycle events MMD notifies on. v0.5.b adds `context_70`
 *  — the early-warning ping fired ONCE when the monitored run's orchestrator
 *  context first crosses the handoff threshold (default 70%). It is NOT a run
 *  outcome (the run keeps going); it reuses this same opt-in/best-effort
 *  fan-out so the user gets the signal on their own sink. See ADR-030. */
const EVENTS = Object.freeze(['run_done', 'run_failed', 'context_70']);

/** Per-event presentation (icon + verb) for the human-readable `message`. */
const PRESENTATION = Object.freeze({
  run_done: { icon: '✅', verb: 'finished' },
  run_failed: { icon: '❌', verb: 'failed' },
  context_70: { icon: '⚠️', verb: 'reached the context handoff threshold (READY_FOR_HANDOFF)' },
});

/**
 * AC-1 — opt-in gate. True iff MMD_NOTIFY_URL is a non-empty string. When this
 * is false the caller constructs NO payload and makes NO network call (zero
 * overhead, the safe default).
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {boolean}
 */
export function shouldNotify(env = {}) {
  const url = env ? env.MMD_NOTIFY_URL : undefined;
  return typeof url === 'string' && url.trim().length > 0;
}

/**
 * AC-1 / AC-4 — build the wire payload. PURE: no I/O, no network, no mutation of
 * its arguments, NEVER throws. Returns the request descriptor a sender consumes.
 *
 * The JSON body suits generic webhooks (Slack/Discord/custom) AND carries a
 * plain `message` one-liner so ntfy-style sinks — which render the request body
 * as the notification text — read nicely. Honest: it never fabricates a summary
 * (uses what it is given, else NEUTRAL_SUMMARY).
 *
 * Body shape: { event, slice, state, summary, ts, message } — run metadata only.
 *
 * @param {{ event: string, slice?: string, state?: string, summary?: string,
 *           env?: Record<string, string|undefined> }} args
 * @returns {{ url: string, method: 'POST', headers: Record<string,string>, body: string }}
 */
export function buildNotification({ event, slice, state, summary, env = {} } = {}) {
  const url = env && typeof env.MMD_NOTIFY_URL === 'string' ? env.MMD_NOTIFY_URL : '';
  // Guard the icon/verb on a known event; preserve the caller's event value when
  // valid, else fall back to run_done (a notification with an unknown event is
  // still better than a thrown error — best-effort, never throws).
  const evt = EVENTS.includes(event) ? event : 'run_done';

  const sliceLabel = typeof slice === 'string' && slice.length > 0 ? slice : '(unknown slice)';
  const hasSummary = typeof summary === 'string' && summary.trim().length > 0;
  const summaryText = hasSummary ? summary.trim() : NEUTRAL_SUMMARY;
  const stateText = typeof state === 'string' && state.length > 0 ? state : evt;

  const { icon, verb } = PRESENTATION[evt];
  const message = `${icon} ${sliceLabel} ${verb} (${summaryText})`;

  // ts is the moment the notification is built. This is the one clock read in an
  // otherwise pure transform — it carries no run state and keeps the signature
  // the spec fixed ({ event, slice, state, summary, env }); tests assert it is a
  // valid ISO string, not a specific value.
  const ts = new Date().toISOString();

  const body = JSON.stringify({ event: evt, slice: sliceLabel, state: stateText, summary: summaryText, ts, message });

  return {
    url,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  };
}

/**
 * AC-2 — best-effort sender. Resolves a verdict object, NEVER throws, NEVER
 * blocks beyond `timeoutMs`:
 *   - 2xx                              → { ok: true,  status }
 *   - non-2xx                          → { ok: false, status }
 *   - thrown/rejected fetch (net down) → { ok: false, error }
 *   - exceeds timeoutMs                → { ok: false, error: 'timeout' }
 *
 * The timeout is enforced with an AbortController (so the in-flight request is
 * actually cancelled) raced against a timer, so the returned promise settles at
 * or before `timeoutMs` regardless of how the sink behaves. `fetchFn` defaults
 * to the global fetch; tests inject a fake so no real network is ever hit.
 *
 * @param {{ url: string, method?: string, headers?: Record<string,string>, body?: string }} payload
 * @param {{ fetchFn?: Function, timeoutMs?: number }} [opts]
 * @returns {Promise<{ ok: boolean, status?: number, error?: string }>}
 */
export async function sendNotification(payload, { fetchFn, timeoutMs } = {}) {
  const doFetch =
    typeof fetchFn === 'function'
      ? fetchFn
      : typeof globalThis.fetch === 'function'
        ? globalThis.fetch
        : null;
  if (!doFetch) {
    return { ok: false, error: 'no fetch implementation available' };
  }

  const limit = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  const { url, method, headers, body } = payload || {};
  const controller = typeof AbortController === 'function' ? new AbortController() : null;

  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      // Cancel the in-flight request so we never leak a hanging socket.
      if (controller) {
        try {
          controller.abort();
        } catch {
          /* abort is best-effort */
        }
      }
      resolve({ ok: false, error: 'timeout' });
    }, limit);
  });

  const attempt = (async () => {
    try {
      const res = await doFetch(url, {
        method: method || 'POST',
        headers: headers || {},
        body,
        signal: controller ? controller.signal : undefined,
      });
      const status = res && typeof res.status === 'number' ? res.status : 0;
      if (status >= 200 && status < 300) return { ok: true, status };
      return { ok: false, status };
    } catch (err) {
      // Network down, DNS failure, abort, malformed fetchFn — all best-effort.
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  })();

  const result = await Promise.race([attempt, timeout]);
  clearTimeout(timer);
  return result;
}
