// @unit tests for lib/dream-catcher/level.js — SPEC_V03A2 AC-1.
// Pure: the involvement dial is a plain normalize + turn-count mapping.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LEVELS,
  DEFAULT_LEVEL,
  MAX_TURNS,
  normalizeLevel,
  turnsForLevel,
} from '../../lib/dream-catcher/level.js';

test('@unit LEVELS is a frozen enum of the 3 canonical levels', () => {
  assert.deepEqual(LEVELS, { AUTONOME: 'Autonome', EQUILIBRE: 'Équilibré', GUIDE: 'Guidé' });
  assert.ok(Object.isFrozen(LEVELS));
  assert.throws(() => { LEVELS.AUTONOME = 'x'; });
});

test('@unit DEFAULT_LEVEL is Équilibré', () => {
  assert.equal(DEFAULT_LEVEL, LEVELS.EQUILIBRE);
});

test('@unit normalizeLevel accepts the canonical accented values', () => {
  assert.equal(normalizeLevel('Autonome'), LEVELS.AUTONOME);
  assert.equal(normalizeLevel('Équilibré'), LEVELS.EQUILIBRE);
  assert.equal(normalizeLevel('Guidé'), LEVELS.GUIDE);
});

test('@unit normalizeLevel accepts friendly + ASCII + English aliases', () => {
  for (const a of ['autonome', 'auto', 'autonomous', 'simple', '  AUTO  ']) {
    assert.equal(normalizeLevel(a), LEVELS.AUTONOME, a);
  }
  for (const a of ['equilibre', 'équilibré', 'balanced', 'default']) {
    assert.equal(normalizeLevel(a), LEVELS.EQUILIBRE, a);
  }
  for (const a of ['guide', 'guidé', 'guided', 'detailed']) {
    assert.equal(normalizeLevel(a), LEVELS.GUIDE, a);
  }
});

test('@unit normalizeLevel defaults to Équilibré on absent/unknown/non-string (never throws)', () => {
  assert.equal(normalizeLevel(undefined), DEFAULT_LEVEL);
  assert.equal(normalizeLevel(null), DEFAULT_LEVEL);
  assert.equal(normalizeLevel(42), DEFAULT_LEVEL);
  assert.equal(normalizeLevel({}), DEFAULT_LEVEL);
  assert.equal(normalizeLevel(''), DEFAULT_LEVEL);
  assert.equal(normalizeLevel('not-a-level'), DEFAULT_LEVEL);
});

test('@unit turnsForLevel maps 0 / 1 / 2 for Autonome / Équilibré / Guidé', () => {
  assert.equal(turnsForLevel('Autonome'), 0);
  assert.equal(turnsForLevel('Équilibré'), 1);
  assert.equal(turnsForLevel('Guidé'), 2);
});

test('@unit turnsForLevel defaults to 1 (Équilibré) on bad input, never throws', () => {
  assert.equal(turnsForLevel(undefined), 1);
  assert.equal(turnsForLevel('nope'), 1);
  assert.equal(turnsForLevel(99), 1);
});

test('@unit no level ever returns more than MAX_TURNS (cap)', () => {
  assert.equal(MAX_TURNS, 3);
  for (const lvl of [...Object.values(LEVELS), undefined, 'weird', 7]) {
    assert.ok(turnsForLevel(lvl) <= MAX_TURNS, String(lvl));
    assert.ok(turnsForLevel(lvl) >= 0, String(lvl));
  }
});
