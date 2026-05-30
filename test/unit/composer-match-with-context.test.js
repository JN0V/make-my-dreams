// @unit tests for context-aware composeLessons — SPEC_V02L AC-2 + AC-7.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { composeLessons } from '../../lib/composer/match.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const FIX = path.join(REPO_ROOT, 'test', 'fixtures', 'composer-lessons', 'with-context.md');

test('@unit context: no context → full keyword set (back-compat)', async () => {
  const r = await composeLessons('alpha', FIX);
  // L-001 (here), L-002 (qa), L-003 (*) all carry "alpha".
  assert.deepEqual(r.injectedLessons.map((l) => l.id).sort(), ['L-001', 'L-002', 'L-003']);
  assert.equal(r.context, null);
  assert.equal(r.filteredOutByContext, 0);
  assert.equal(r.matchedByKeyword, 3);
  assert.equal(r.injected, 3);
});

test('@unit context: mmd qa → strict subset (qa + universal only)', async () => {
  const r = await composeLessons('alpha', FIX, { context: { subcommand: 'mmd qa' } });
  assert.deepEqual(r.injectedLessons.map((l) => l.id).sort(), ['L-002', 'L-003']);
  assert.deepEqual(r.context, { subcommand: 'mmd qa' });
  // active = 4; candidates after filter = L-002, L-003 → filtered out L-001, L-004 = 2.
  assert.equal(r.filteredOutByContext, 2);
  assert.equal(r.matchedByKeyword, 2);
  assert.equal(r.injected, 2);
});

test('@unit context: mmd --here → here + universal', async () => {
  const r = await composeLessons('alpha', FIX, { context: { subcommand: 'mmd --here' } });
  assert.deepEqual(r.injectedLessons.map((l) => l.id).sort(), ['L-001', 'L-003']);
  assert.equal(r.filteredOutByContext, 2);
});

test('@unit context: filtered result is a strict subset of unfiltered', async () => {
  const full = await composeLessons('alpha', FIX);
  const ctx = await composeLessons('alpha', FIX, { context: { subcommand: 'mmd qa' } });
  const fullIds = new Set(full.injectedLessons.map((l) => l.id));
  for (const l of ctx.injectedLessons) {
    assert.ok(fullIds.has(l.id), `${l.id} must be in the unfiltered set`);
  }
  assert.ok(ctx.injectedLessons.length <= full.injectedLessons.length);
});

test('@unit context: invariant injected ≤ matched_by_keyword ≤ active − filtered', async () => {
  const r = await composeLessons('alpha', FIX, { context: { subcommand: 'mmd qa' } });
  assert.ok(r.injected <= r.matchedByKeyword);
  assert.ok(r.matchedByKeyword <= r.totalActiveLessons - r.filteredOutByContext);
});

test('@unit context: topN cap still applies on the matched subset', async () => {
  const r = await composeLessons('alpha', FIX, { topN: 1, context: { subcommand: 'mmd qa' } });
  assert.equal(r.injected, 1);
  assert.equal(r.matchedByKeyword, 2, 'matched_by_keyword is pre-topN');
});

test('@unit context: subcommand matching nothing but universal → only universal', async () => {
  const r = await composeLessons('alpha', FIX, { context: { subcommand: 'mmd cso' } });
  assert.deepEqual(r.injectedLessons.map((l) => l.id), ['L-003']);
});
