// test/unit/parse-port.test.js — AC-1b port parsing (pure unit, < 100 ms per test).
// Constitution: testing.md §V — every test name carries an @unit tag.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseServePort } from '../../bin/serve.js';

/**
 * Save MMD_SERVE_ALLOW_RANDOM around each test that touches it. parseServePort
 * reads it via the `node:process` env binding, so we mutate process.env directly.
 */
function withAllowRandom(value, fn) {
  const prev = process.env.MMD_SERVE_ALLOW_RANDOM;
  if (value === undefined) delete process.env.MMD_SERVE_ALLOW_RANDOM;
  else process.env.MMD_SERVE_ALLOW_RANDOM = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.MMD_SERVE_ALLOW_RANDOM;
    else process.env.MMD_SERVE_ALLOW_RANDOM = prev;
  }
}

test('@unit parseServePort returns 3000 for empty string', () => {
  assert.equal(parseServePort(''), 3000);
});

test('@unit parseServePort returns 3000 for undefined', () => {
  assert.equal(parseServePort(undefined), 3000);
});

test('@unit parseServePort accepts "3000"', () => {
  assert.equal(parseServePort('3000'), 3000);
});

test('@unit parseServePort accepts "8080"', () => {
  assert.equal(parseServePort('8080'), 8080);
});

test('@unit parseServePort rejects "abc" with mmdExitCode=2', () => {
  assert.throws(
    () => parseServePort('abc'),
    (err) => err instanceof Error && err.mmdExitCode === 2 && /integer between 1 and 65535/.test(err.message),
  );
});

test('@unit parseServePort rejects "0" without MMD_SERVE_ALLOW_RANDOM=1', () => {
  withAllowRandom(undefined, () => {
    assert.throws(
      () => parseServePort('0'),
      (err) => err instanceof Error && err.mmdExitCode === 2 && /MMD_SERVE_ALLOW_RANDOM=1/.test(err.message),
    );
  });
});

test('@unit parseServePort accepts "0" with MMD_SERVE_ALLOW_RANDOM=1', () => {
  withAllowRandom('1', () => {
    assert.equal(parseServePort('0'), 0);
  });
});

test('@unit parseServePort rejects "-1" with mmdExitCode=2', () => {
  // The regex permits the leading minus, but Number.isInteger + range check rejects.
  assert.throws(
    () => parseServePort('-1'),
    (err) => err instanceof Error && err.mmdExitCode === 2,
  );
});

test('@unit parseServePort rejects "70000" (out of range)', () => {
  assert.throws(
    () => parseServePort('70000'),
    (err) => err instanceof Error && err.mmdExitCode === 2,
  );
});

test('@unit parseServePort rejects "3.14" (non-integer)', () => {
  assert.throws(
    () => parseServePort('3.14'),
    (err) => err instanceof Error && err.mmdExitCode === 2,
  );
});
