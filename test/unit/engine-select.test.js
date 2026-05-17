// @unit tests for lib/engine.js — engine record building + FAST budget check.
// Per testing.md §V: pure logic, < 100 ms.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildEngineRecord,
  withDuration,
  fastBudgetExceeded,
  DEFAULT_FAST_BUDGET_MIN,
} from '../../lib/engine.js';

test('@unit buildEngineRecord("fast"): shape is engine + engine_metrics, party_mode_rounds=1', () => {
  const r = buildEngineRecord('fast');
  assert.equal(r.engine, 'fast');
  assert.equal(r.engine_metrics.party_mode_rounds, 1);
  assert.equal(r.engine_metrics.duration_seconds, 0);
  assert.equal(r.engine_metrics.phase2_skipped, null);
  assert.equal(r.engine_metrics.phase2_skip_reason, null);
});

test('@unit buildEngineRecord("standard"): party_mode_rounds=3 (intended baseline)', () => {
  const r = buildEngineRecord('standard');
  assert.equal(r.engine, 'standard');
  assert.equal(r.engine_metrics.party_mode_rounds, 3);
});

test('@unit buildEngineRecord rejects unknown engine names', () => {
  assert.throws(() => buildEngineRecord('deep'), /unsupported engine/);
  assert.throws(() => buildEngineRecord('foo'), /unsupported engine/);
  assert.throws(() => buildEngineRecord(undefined), /unsupported engine/);
});

test('@unit withDuration: returns a new object with duration_seconds set', () => {
  const before = buildEngineRecord('fast');
  const after = withDuration(before, 42.7);
  assert.equal(after.engine_metrics.duration_seconds, 42.7);
  // Pure — original unchanged.
  assert.equal(before.engine_metrics.duration_seconds, 0);
});

test('@unit withDuration: rounds to 1 decimal place', () => {
  const after = withDuration(buildEngineRecord('fast'), 12.345678);
  assert.equal(after.engine_metrics.duration_seconds, 12.3);
});

test('@unit withDuration: rejects negative / NaN / Infinity', () => {
  const r = buildEngineRecord('fast');
  assert.throws(() => withDuration(r, -1), /non-negative/);
  assert.throws(() => withDuration(r, NaN), /non-negative/);
  assert.throws(() => withDuration(r, Infinity), /non-negative/);
});

test('@unit fastBudgetExceeded: default budget is 12 minutes (720 s)', () => {
  // Use an isolated env to avoid contamination from the harness.
  const env = {};
  assert.equal(fastBudgetExceeded(719, env), false);
  assert.equal(fastBudgetExceeded(720, env), false); // equality is NOT exceeded
  assert.equal(fastBudgetExceeded(721, env), true);
});

test('@unit fastBudgetExceeded: DEFAULT_FAST_BUDGET_MIN matches spec (12)', () => {
  // The spec literally states "MMD_FAST_MAX_MINUTES, default 12" — assert
  // that the published constant matches, so any future change is visible.
  assert.equal(DEFAULT_FAST_BUDGET_MIN, 12);
});

test('@unit fastBudgetExceeded: MMD_FAST_MAX_MINUTES env overrides default', () => {
  assert.equal(fastBudgetExceeded(60, { MMD_FAST_MAX_MINUTES: '1' }), false);
  assert.equal(fastBudgetExceeded(61, { MMD_FAST_MAX_MINUTES: '1' }), true);
});

test('@unit fastBudgetExceeded: invalid env values fall back to default (graceful degradation)', () => {
  assert.equal(fastBudgetExceeded(721, { MMD_FAST_MAX_MINUTES: 'abc' }), true);
  assert.equal(fastBudgetExceeded(721, { MMD_FAST_MAX_MINUTES: '-5' }), true);
  assert.equal(fastBudgetExceeded(721, { MMD_FAST_MAX_MINUTES: '0' }), true);
  assert.equal(fastBudgetExceeded(719, { MMD_FAST_MAX_MINUTES: '' }), false);
});
