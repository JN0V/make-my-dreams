// @unit tests for lib/discover/test-runner-detector.js — SPEC_V02K AC-1, L-017.
// 10+ script fixtures covering every runner the spec mandates, plus the
// false-positive guards (word boundaries, non-object input).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { detectTestRunnerFromScripts } from '../../lib/discover/test-runner-detector.js';

const CASES = [
  ['node --test', { test: 'node --test test/unit/*.test.js' }, 'node --test'],
  ['jest', { test: 'jest --coverage' }, 'jest'],
  ['vitest', { test: 'vitest run' }, 'vitest'],
  ['mocha', { test: 'mocha "test/**/*.spec.js"' }, 'mocha'],
  ['playwright', { e2e: 'playwright test' }, 'playwright'],
  ['cypress', { e2e: 'cypress run' }, 'cypress'],
  ['pytest', { test: 'pytest -q' }, 'pytest'],
  ['ava', { test: 'ava' }, 'ava'],
  ['tape', { test: 'tape test/*.js' }, 'tape'],
  ['tap', { test: 'tap test/' }, 'tap'],
];

for (const [label, scripts, expected] of CASES) {
  test(`@unit detects ${label} from a scripts value`, () => {
    assert.equal(detectTestRunnerFromScripts(scripts), expected);
  });
}

test('@unit node --test wins regardless of script key', () => {
  assert.equal(
    detectTestRunnerFromScripts({ ci: 'node --test', lint: 'eslint .' }),
    'node --test',
  );
});

test('@unit returns null when no runner is present', () => {
  assert.equal(detectTestRunnerFromScripts({ build: 'tsc', start: 'node .' }), null);
});

test('@unit returns null for missing / non-object scripts', () => {
  assert.equal(detectTestRunnerFromScripts(undefined), null);
  assert.equal(detectTestRunnerFromScripts(null), null);
  assert.equal(detectTestRunnerFromScripts('node --test'), null);
  assert.equal(detectTestRunnerFromScripts(['node --test']), null);
});

test('@unit does not false-match substrings inside other words', () => {
  // "java" contains "ava" — the \b boundary must prevent a false ava match.
  assert.equal(detectTestRunnerFromScripts({ run: 'java -jar app.jar' }), null);
});
