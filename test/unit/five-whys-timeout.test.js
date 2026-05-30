// @unit tests for resolveTimeoutMs (lib/conductor/five-whys.js) — F1 Phase-4
// review regression. A garbage MMD_FIVEWHYS_TIMEOUT_MS must NOT silently
// disable the load-bearing hang-protection timeout (L-006); it must fall back
// to the 30-min default. A literal 0 IS honored as an explicit "no timeout".

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveTimeoutMs } from '../../lib/conductor/five-whys.js';

const DEFAULT = 1_800_000;

test('@unit garbage string → falls back to the default (timer stays armed, L-006)', () => {
  // The bug: Number("abc")=NaN, and `NaN > 0` is false → no timer armed.
  assert.equal(resolveTimeoutMs('abc'), DEFAULT);
  assert.equal(resolveTimeoutMs('30min'), DEFAULT);
  assert.equal(resolveTimeoutMs(NaN), DEFAULT);
});

test('@unit undefined / null / empty → default', () => {
  assert.equal(resolveTimeoutMs(undefined), DEFAULT);
  assert.equal(resolveTimeoutMs(null), DEFAULT);
  assert.equal(resolveTimeoutMs(''), DEFAULT);
});

test('@unit negative → default (never a negative timer)', () => {
  assert.equal(resolveTimeoutMs('-5'), DEFAULT);
  assert.equal(resolveTimeoutMs(-1), DEFAULT);
});

test('@unit literal 0 is honored as explicit "no timeout" (MMD_TIMEOUT_MS convention)', () => {
  assert.equal(resolveTimeoutMs('0'), 0);
  assert.equal(resolveTimeoutMs(0), 0);
});

test('@unit valid finite values pass through', () => {
  assert.equal(resolveTimeoutMs('60000'), 60_000);
  assert.equal(resolveTimeoutMs(120_000), 120_000);
});

test('@unit a custom fallback is respected', () => {
  assert.equal(resolveTimeoutMs('garbage', 5000), 5000);
});
