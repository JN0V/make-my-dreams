// bin/serve-ui/gauge.js — v0.5.c context gauge render helper.
//
// PURE functions (no DOM, no fetch, no globals) so they are unit-testable in
// node (test/unit/serve-ui-gauge.test.js) AND usable in the browser. The browser
// loads this as an ES module (index.html: <script type="module" src="/gauge.js">)
// and app.js calls window.MMDGauge.renderGauge from its status poll.
//
// renderGauge(context) turns the status.json `context` block —
// {model, window, tokens, pct, estimated, ready_for_handoff} — into a small HTML
// string: a bar (% of the model's context window), humanized `tokens / window`,
// the model id, a fixed 70% threshold marker, and a "ready for handoff" badge
// iff context.ready_for_handoff. No / empty context → '' (the caller hides it).
//
// NOTE (honesty, universal.md §VI + L-027 §3): this is the ORCHESTRATOR's
// context %, not a per-sub-agent figure — the label says so. `pct` in status.json
// is a 0..1 fraction; we render it as a percentage.

const HANDOFF_MARKER_PCT = 70; // matches the default MMD_HANDOFF_THRESHOLD (0.70).

/** Clamp a number to [min, max]; non-finite → min. */
function clamp(n, min, max) {
  if (typeof n !== 'number' || !isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

/**
 * Humanize a token count: 337000 → "337k", 1000000 → "1.0M", 950 → "950".
 * Non-finite/negative → "?" (never a fabricated number, universal.md §VI).
 * @param {number} n
 * @returns {string}
 */
export function humanizeTokens(n) {
  if (typeof n !== 'number' || !isFinite(n) || n < 0) return '?';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1000) return Math.round(n / 1000) + 'k';
  return String(Math.round(n));
}

/** Escape the five HTML-significant chars so a model id can't inject markup. */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Render the context gauge as an HTML string from a status `context` object.
 * Pure: same input → same output, no side effects.
 *
 * @param {object|null|undefined} context  {model, window, tokens, pct, estimated, ready_for_handoff}
 * @returns {string}  HTML for the gauge, or '' when there is no context to show.
 */
export function renderGauge(context) {
  if (!context || typeof context !== 'object') return '';

  // pct is a 0..1 fraction in status.json; render as a clamped 0..100 percentage.
  const pctNum = clamp(Number(context.pct) * 100, 0, 100);
  const pctLabel = Math.round(pctNum) + '%';

  const tokens = humanizeTokens(Number(context.tokens));
  const windowH = humanizeTokens(Number(context.window));
  const windowLabel = context.estimated ? windowH + ' (est.)' : windowH;
  const model = context.model ? escapeHtml(context.model) : 'unknown model';

  const badge = context.ready_for_handoff
    ? '<div class="gauge-badge" role="status">⚠️ ready for handoff</div>'
    : '';

  // CSP-safe markup (the default page runs under style-src 'self' — NO inline
  // styles): the bar is a native <progress value=pct> (an ATTRIBUTE, not a style),
  // and the fixed 70% threshold tick is positioned by an external CSS class
  // (.gauge-threshold in style.css), so no inline `style=` is needed. data-pct
  // carries the precise value for tests / debugging.
  const valueNow = Math.round(pctNum);
  return (
    '<div class="gauge" data-pct="' + pctNum.toFixed(1) + '" data-threshold="' + HANDOFF_MARKER_PCT + '">' +
      '<div class="gauge-meta">' +
        '<span class="gauge-model">' + model + '</span> · ' +
        '<span class="gauge-tokens">' + tokens + ' / ' + windowLabel + ' tokens</span> · ' +
        '<span class="gauge-pct">' + pctLabel + '</span>' +
      '</div>' +
      '<div class="gauge-track">' +
        '<progress class="gauge-bar" max="100" value="' + valueNow + '" ' +
             'aria-label="context du chef d\'orchestre / orchestrator context">' +
             pctLabel + '</progress>' +
        '<span class="gauge-threshold" title="70% — seuil de relais / handoff threshold"></span>' +
      '</div>' +
      badge +
    '</div>'
  );
}

// Browser convenience: expose on window so the classic app.js IIFE can call
// window.MMDGauge.renderGauge at poll time without itself being a module. Skipped
// under node (typeof window === 'undefined'), so the node import stays clean.
if (typeof window !== 'undefined') {
  window.MMDGauge = { renderGauge, humanizeTokens };
}
