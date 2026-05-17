// @unit tests for lib/discover/classify.js — pure function, table-driven.
// Per testing.md §V: < 100ms total, no I/O.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classify, DISCOVERY_CASES } from '../../lib/discover/classify.js';

test('@unit classify: null / undefined → blank (defensive)', () => {
  assert.equal(classify(null), 'blank');
  assert.equal(classify(undefined), 'blank');
  assert.equal(classify('not an object'), 'blank');
  assert.equal(classify(42), 'blank');
});

test('@unit classify: already_onboarded=true wins regardless of other signals', () => {
  const data = {
    already_onboarded: true,
    methodologies: { spec_kit: true, bmad: true, stories_count: 99 },
  };
  assert.equal(classify(data), 'already-onboarded');
});

test('@unit classify: Spec Kit alone → rich', () => {
  const data = { methodologies: { spec_kit: true, bmad: false } };
  assert.equal(classify(data), 'rich');
});

test('@unit classify: BMAD alone (no stories sprawl) → rich (presence wins over count)', () => {
  const data = { methodologies: { spec_kit: false, bmad: true, stories_count: 3 } };
  assert.equal(classify(data), 'rich');
});

test('@unit classify: Spec Kit + BMAD → rich (Spec Kit takes precedence — same label)', () => {
  const data = { methodologies: { spec_kit: true, bmad: true } };
  assert.equal(classify(data), 'rich');
});

test('@unit classify: only docs/stories/ with 10+ files → bmad-alone', () => {
  const data = { methodologies: { stories_count: 10 } };
  assert.equal(classify(data), 'bmad-alone');
});

test('@unit classify: docs/stories/ with 15 files → bmad-alone', () => {
  const data = { methodologies: { stories_count: 15 } };
  assert.equal(classify(data), 'bmad-alone');
});

test('@unit classify: docs/stories/ with 9 files → blank (below threshold)', () => {
  const data = { methodologies: { stories_count: 9 } };
  assert.equal(classify(data), 'blank');
});

test('@unit classify: no methodologies, no stories → blank', () => {
  assert.equal(classify({ methodologies: {} }), 'blank');
});

test('@unit classify: malformed stories_count is treated as 0 (defensive)', () => {
  assert.equal(classify({ methodologies: { stories_count: 'lots' } }), 'blank');
  assert.equal(classify({ methodologies: { stories_count: NaN } }), 'blank');
});

test('@unit DISCOVERY_CASES is frozen and contains exactly the 4 known cases', () => {
  assert.ok(Object.isFrozen(DISCOVERY_CASES));
  assert.deepEqual(
    [...DISCOVERY_CASES].sort(),
    ['already-onboarded', 'blank', 'bmad-alone', 'rich'],
  );
});

test('@unit classify: every return value is in DISCOVERY_CASES', () => {
  const inputs = [
    { already_onboarded: true },
    { methodologies: { spec_kit: true } },
    { methodologies: { stories_count: 12 } },
    { methodologies: {} },
    null,
  ];
  for (const i of inputs) {
    const r = classify(i);
    assert.ok(DISCOVERY_CASES.includes(r), `${r} not in DISCOVERY_CASES`);
  }
});
