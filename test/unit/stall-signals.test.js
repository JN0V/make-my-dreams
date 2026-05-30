// @unit tests for lib/conductor/stall-signals.js — SPEC_V02J AC-1 (closed enum).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  STALL_SIGNALS,
  isStallSignal,
  unknownSignals,
} from '../../lib/conductor/stall-signals.js';

test('@unit STALL_SIGNALS is the exact closed enum from AC-1', () => {
  assert.deepEqual([...STALL_SIGNALS], [
    'no-commit-since-N-min',
    'retry-count-exceeded',
    'error-pattern-matched',
    'duration-exceeded-budget',
    'state-failed-explicit',
    'heartbeat-stale',
  ]);
});

test('@unit STALL_SIGNALS is frozen', () => {
  assert.ok(Object.isFrozen(STALL_SIGNALS));
});

test('@unit isStallSignal recognizes enum members', () => {
  for (const s of STALL_SIGNALS) assert.equal(isStallSignal(s), true);
});

test('@unit isStallSignal rejects non-members and non-strings', () => {
  assert.equal(isStallSignal('made-up-signal'), false);
  assert.equal(isStallSignal(''), false);
  assert.equal(isStallSignal(null), false);
  assert.equal(isStallSignal(42), false);
});

test('@unit unknownSignals returns the invalid subset', () => {
  assert.deepEqual(unknownSignals(['no-commit-since-N-min', 'bogus']), ['bogus']);
  assert.deepEqual(unknownSignals([...STALL_SIGNALS]), []);
  assert.deepEqual(unknownSignals('not-an-array'), []);
});
