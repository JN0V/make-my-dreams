// test/unit/contrast-tap-target.test.js — AC-2c WCAG contrast + 48 px tap targets.
// Constitution: testing.md §V — every test name carries an @unit tag.
//
// Reads bin/serve-ui/style.css once (sync) and asserts:
//   1. Every text/background pair used in the CSS has contrast ratio >= 4.5:1.
//   2. button, .button selectors have min-width >= 48 px and min-height >= 48 px.
//
// Future-proofs the UI: any CSS regression that would drop a pair below 4.5:1 or
// shrink a tap target trips this test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { contrastRatio, parseColor } from '../../test/util/contrast.js';

const CSS_PATH = path.resolve(
  fileURLToPath(new URL('../../bin/serve-ui/style.css', import.meta.url)),
);
const CSS = readFileSync(CSS_PATH, 'utf8');

/** Parse the `:root { --x: <value>; ... }` custom-property block. */
function parseRootVars(css) {
  const block = css.match(/:root\s*{([\s\S]*?)}/);
  if (!block) throw new Error(':root block not found in style.css');
  const out = {};
  const re = /--([a-z0-9-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(block[1])) !== null) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

const VARS = parseRootVars(CSS);

/* ── Sanity: vendored luminance calc matches reference values ──────────────── */

test('@unit contrast: black on white ≈ 21:1 (WCAG reference)', () => {
  const ratio = contrastRatio('#000000', '#ffffff');
  assert.ok(ratio > 20.9 && ratio < 21.1, `expected ≈21, got ${ratio}`);
});

test('@unit contrast: #777777 on white is below 4.5:1 (sanity)', () => {
  const ratio = contrastRatio('#777777', '#ffffff');
  assert.ok(ratio < 4.5, `expected < 4.5, got ${ratio}`);
});

/* ── Real pairs from style.css ─────────────────────────────────────────────── */

const REAL_PAIRS = [
  // [label, fgKey-or-literal, bgKey-or-literal]
  ['--fg on --bg',           VARS.fg,       VARS.bg],
  ['--muted on --bg',        VARS.muted,    VARS.bg],
  ['--accent-fg on --accent', VARS['accent-fg'], VARS.accent],
  // .heartbeat: var(--warn) on #fff4d6.
  ['--warn on #fff4d6',      VARS.warn,     '#fff4d6'],
  // .heartbeat.stale: var(--error) on #ffd6d6.
  ['--error on #ffd6d6',     VARS.error,    '#ffd6d6'],
  // .log .stderr: var(--error) on .log's #f5f5f5 background.
  ['--error on #f5f5f5',     VARS.error,    '#f5f5f5'],
];

for (const [label, fg, bg] of REAL_PAIRS) {
  test(`@unit contrast: ${label} >= 4.5:1`, () => {
    // parseColor throws on unknown formats — guard so a missing var produces a clear failure.
    assert.ok(fg, `missing fg color for ${label}`);
    assert.ok(bg, `missing bg color for ${label}`);
    // Validate that parseColor accepts both endpoints (canary).
    parseColor(fg);
    parseColor(bg);
    const ratio = contrastRatio(fg, bg);
    assert.ok(
      ratio >= 4.5,
      `${label}: contrast ${ratio.toFixed(2)} < 4.5:1 — fails AC-2c (WCAG AA)`,
    );
  });
}

/* ── Tap targets ───────────────────────────────────────────────────────────── */

test('@unit tap-target: button selector min-width >= 48 px and min-height >= 48 px', () => {
  // Extract the rule block for `button, .button { ... }`.
  const ruleMatch = CSS.match(/button\s*,\s*\.button\s*{([\s\S]*?)}/);
  assert.ok(ruleMatch, 'expected a `button, .button { ... }` rule block in style.css');
  const block = ruleMatch[1];
  const minWidthMatch = block.match(/min-width\s*:\s*(\d+)\s*px/);
  const minHeightMatch = block.match(/min-height\s*:\s*(\d+)\s*px/);
  assert.ok(minWidthMatch, 'button rule missing min-width');
  assert.ok(minHeightMatch, 'button rule missing min-height');
  const w = Number(minWidthMatch[1]);
  const h = Number(minHeightMatch[1]);
  assert.ok(w >= 48, `button min-width ${w}px < 48px (AC-2c / safe-by-default §V)`);
  assert.ok(h >= 48, `button min-height ${h}px < 48px (AC-2c / safe-by-default §V)`);
});
