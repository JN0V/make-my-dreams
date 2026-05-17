// test/unit/bench-exit-codes.test.js
// @unit — pure function: metrics[] -> exit code (SPEC_V02B AC-6).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyBenchExit,
  failingDreamIds,
  EXIT_OK,
  EXIT_REALITY_CHECK_FAIL,
  EXIT_AUTODEV_CRASH,
} from '../../lib/bench/exit-codes.js';

const ok = (id) => ({
  dream_id: id,
  exit_code: 0,
  reality_check: { passed: true },
});
const realityFail = (id) => ({
  dream_id: id,
  exit_code: 0,
  reality_check: { passed: false },
});
const crash = (id) => ({
  dream_id: id,
  exit_code: 1,
  reality_check: { passed: false },
});

test('@unit classifyBenchExit: empty array exits 0', () => {
  assert.equal(classifyBenchExit([]), EXIT_OK);
});

test('@unit classifyBenchExit: all dreams green -> exit 0', () => {
  assert.equal(classifyBenchExit([ok('a'), ok('b'), ok('c')]), EXIT_OK);
});

test('@unit classifyBenchExit: any reality-check fail (no crash) -> exit 6', () => {
  assert.equal(
    classifyBenchExit([ok('a'), realityFail('b'), ok('c')]),
    EXIT_REALITY_CHECK_FAIL,
  );
});

test('@unit classifyBenchExit: any crash dominates reality-check fail -> exit 7', () => {
  assert.equal(
    classifyBenchExit([ok('a'), realityFail('b'), crash('c')]),
    EXIT_AUTODEV_CRASH,
  );
});

test('@unit classifyBenchExit: crash alone -> exit 7', () => {
  assert.equal(classifyBenchExit([ok('a'), crash('b')]), EXIT_AUTODEV_CRASH);
});

test('@unit classifyBenchExit: rejects non-array', () => {
  assert.throws(() => classifyBenchExit(null), TypeError);
  assert.throws(() => classifyBenchExit('nope'), TypeError);
});

test('@unit classifyBenchExit: rejects malformed metric (missing exit_code)', () => {
  assert.throws(
    () => classifyBenchExit([{ reality_check: { passed: true } }]),
    TypeError,
  );
});

test('@unit classifyBenchExit: rejects malformed metric (missing reality_check)', () => {
  assert.throws(() => classifyBenchExit([{ exit_code: 0 }]), TypeError);
});

test('@unit failingDreamIds: returns the union of crashed + reality-fail ids, input order preserved', () => {
  assert.deepEqual(
    failingDreamIds([ok('a'), crash('b'), ok('c'), realityFail('d')]),
    ['b', 'd'],
  );
});

test('@unit failingDreamIds: empty when all green', () => {
  assert.deepEqual(failingDreamIds([ok('a'), ok('b')]), []);
});

test('@unit EXIT_* constants are stable numeric codes', () => {
  // L-005 / L-007 lesson: constants live in the library, tests read from
  // there — never hardcode magic numbers in the test body.
  assert.equal(EXIT_OK, 0);
  assert.equal(EXIT_REALITY_CHECK_FAIL, 6);
  assert.equal(EXIT_AUTODEV_CRASH, 7);
});
