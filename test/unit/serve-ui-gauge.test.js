// @unit tests for bin/serve-ui/gauge.js — the PURE context-gauge render helper
// (SPEC_V05C AC-3). No DOM, no fetch: renderGauge is a pure function of the
// status `context` object. Per testing.md §V: fast, no I/O, no subprocess.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderGauge, humanizeTokens } from '../../bin/serve-ui/gauge.js';

/* ── humanizeTokens ─────────────────────────────────────────────────────── */

test('@unit humanizeTokens: 337000 → 337k', () => {
  assert.equal(humanizeTokens(337000), '337k');
});

test('@unit humanizeTokens: 1000000 → 1.0M', () => {
  assert.equal(humanizeTokens(1000000), '1.0M');
});

test('@unit humanizeTokens: 1500000 → 1.5M', () => {
  assert.equal(humanizeTokens(1500000), '1.5M');
});

test('@unit humanizeTokens: sub-1k stays as-is', () => {
  assert.equal(humanizeTokens(950), '950');
  assert.equal(humanizeTokens(0), '0');
});

test('@unit humanizeTokens: non-finite/negative → "?" (no fabricated number)', () => {
  assert.equal(humanizeTokens(NaN), '?');
  assert.equal(humanizeTokens(-5), '?');
  assert.equal(humanizeTokens(undefined), '?');
  assert.equal(humanizeTokens('200k'), '?');
});

/* ── renderGauge: no context → hidden/neutral ───────────────────────────── */

test('@unit renderGauge: null/undefined/non-object context → empty string', () => {
  assert.equal(renderGauge(null), '');
  assert.equal(renderGauge(undefined), '');
  assert.equal(renderGauge('nope'), '');
  assert.equal(renderGauge(42), '');
});

/* ── renderGauge: pct clamp ─────────────────────────────────────────────── */

test('@unit renderGauge: pct fraction rendered as percentage + progress value', () => {
  const html = renderGauge({ model: 'claude-opus-4-8', window: 1000000, tokens: 340000, pct: 0.34 });
  assert.match(html, /34%/);
  assert.match(html, /data-pct="34\.0"/);
  assert.match(html, /<progress[^>]*value="34"/);
});

test('@unit renderGauge: pct > 1 clamps to 100%', () => {
  const html = renderGauge({ model: 'm', window: 100, tokens: 200, pct: 2 });
  assert.match(html, /100%/);
  assert.match(html, /data-pct="100\.0"/);
  assert.match(html, /value="100"/);
  assert.doesNotMatch(html, /value="200"/);
});

test('@unit renderGauge: negative/NaN pct clamps to 0%', () => {
  const neg = renderGauge({ model: 'm', window: 100, tokens: 0, pct: -0.5 });
  assert.match(neg, /0%/);
  assert.match(neg, /data-pct="0\.0"/);
  const nan = renderGauge({ model: 'm', window: 100, tokens: 0, pct: NaN });
  assert.match(nan, /data-pct="0\.0"/);
});

/* ── renderGauge: humanized tokens/window + model ───────────────────────── */

test('@unit renderGauge: shows humanized tokens / window and the model', () => {
  const html = renderGauge({ model: 'claude-opus-4-8[1m]', window: 1000000, tokens: 337000, pct: 0.337 });
  assert.match(html, /337k \/ 1\.0M tokens/);
  assert.match(html, /claude-opus-4-8\[1m\]/);
});

test('@unit renderGauge: estimated window flagged "(est.)"', () => {
  const html = renderGauge({ model: 'mystery', window: 200000, tokens: 50000, pct: 0.25, estimated: true });
  assert.match(html, /200k \(est\.\)/);
});

/* ── renderGauge: 70% threshold marker ──────────────────────────────────── */

test('@unit renderGauge: always renders the 70% threshold marker', () => {
  const html = renderGauge({ model: 'm', window: 1000, tokens: 100, pct: 0.1 });
  assert.match(html, /gauge-threshold/);
  assert.match(html, /data-threshold="70"/);
});

test('@unit renderGauge: CSP-safe — no inline style attributes', () => {
  const html = renderGauge({ model: 'm', window: 1000, tokens: 100, pct: 0.5, ready_for_handoff: true });
  assert.doesNotMatch(html, /style=/);
});

/* ── renderGauge: ready-for-handoff badge ───────────────────────────────── */

test('@unit renderGauge: badge appears iff ready_for_handoff', () => {
  const without = renderGauge({ model: 'm', window: 1000, tokens: 100, pct: 0.1 });
  assert.doesNotMatch(without, /ready for handoff/);

  const withBadge = renderGauge({
    model: 'm', window: 1000, tokens: 750, pct: 0.75, ready_for_handoff: true,
  });
  assert.match(withBadge, /ready for handoff/);
});

/* ── renderGauge: model string is HTML-escaped (no markup injection) ─────── */

test('@unit renderGauge: model id is HTML-escaped', () => {
  const html = renderGauge({ model: '<img src=x onerror=1>', window: 1000, tokens: 100, pct: 0.1 });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

/* ── renderGauge: missing numeric fields degrade gracefully ─────────────── */

test('@unit renderGauge: missing tokens/window → "?" not a crash', () => {
  const html = renderGauge({ model: 'm', pct: 0.5 });
  assert.match(html, /\? \/ \? tokens/);
  assert.match(html, /50%/);
});
