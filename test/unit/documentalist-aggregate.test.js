// test/unit/documentalist-aggregate.test.js — @unit
// SPEC_V02I AC-2.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { aggregateInjections } from '../../lib/documentalist/aggregate-injections.js';

const audit = (matchedIds, extra = {}) => ({
  composer_version: 'v0.2e',
  matched: matchedIds.map((id) => ({ id, score: 1 })),
  ...extra,
});

test('@unit aggregateInjections tallies distinct runs per lesson', () => {
  const { totalRuns, byLesson } = aggregateInjections([
    { path: '/a.composer.json', json: audit(['L-001', 'L-002']) },
    { path: '/b.composer.json', json: audit(['L-001']) },
  ]);
  assert.equal(totalRuns, 2);
  assert.equal(byLesson.get('L-001').count, 2);
  assert.equal(byLesson.get('L-002').count, 1);
});

test('@unit aggregateInjections dedups a lesson within a single run', () => {
  const { byLesson } = aggregateInjections([
    { path: '/a.composer.json', json: audit(['L-001', 'L-001']) },
  ]);
  assert.equal(byLesson.get('L-001').count, 1);
});

test('@unit aggregateInjections dedups across files sharing a run_id', () => {
  const { totalRuns, byLesson } = aggregateInjections([
    { path: '/a.composer.json', json: audit(['L-001'], { run_id: 'R1' }) },
    { path: '/b.composer.json', json: audit(['L-001'], { run_id: 'R1' }) },
  ]);
  assert.equal(totalRuns, 1);
  assert.equal(byLesson.get('L-001').count, 1);
});

test('@unit aggregateInjections skips malformed audits and warns', () => {
  const warnings = [];
  const { totalRuns, byLesson } = aggregateInjections(
    [
      { path: '/bad.composer.json', json: null },
      { path: '/ok.composer.json', json: audit(['L-003']) },
      { path: '/weird.composer.json', json: { no: 'matched' } },
    ],
    { onWarn: (m) => warnings.push(m) },
  );
  assert.equal(totalRuns, 1);
  assert.equal(byLesson.get('L-003').count, 1);
  assert.equal(warnings.length, 2);
});

test('@unit aggregateInjections accepts bare composer objects (no wrapper)', () => {
  const { totalRuns, byLesson } = aggregateInjections([audit(['L-005']), audit(['L-005'])]);
  assert.equal(totalRuns, 2);
  assert.equal(byLesson.get('L-005').count, 2);
});

test('@unit aggregateInjections throws on non-array input', () => {
  assert.throws(() => aggregateInjections(null), TypeError);
});
