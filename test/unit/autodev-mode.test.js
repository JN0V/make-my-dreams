// @unit tests for lib/invoke-autodev.js#resolveAutodevMode (B2).
// Pure-logic checks. Per testing.md §V — should be discovered by `npm test:unit`,
// which globs test/unit/*.test.js (so this file lives here rather than in
// test/integration/, even though the integration-test file also covers the
// behavior end-to-end).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveAutodevMode } from '../../lib/invoke-autodev.js';

test('@unit B2: resolveAutodevMode default is "cli" (production)', () => {
  assert.equal(resolveAutodevMode({}), 'cli');
});

test('@unit B2: resolveAutodevMode honors explicit MMD_AUTODEV_MODE=cli (even with MMD_AUTODEV_CMD set)', () => {
  assert.equal(resolveAutodevMode({ MMD_AUTODEV_MODE: 'cli' }), 'cli');
  assert.equal(
    resolveAutodevMode({ MMD_AUTODEV_MODE: 'cli', MMD_AUTODEV_CMD: '/path/to/claude-wrapper' }),
    'cli',
  );
});

test('@unit B2: resolveAutodevMode honors explicit MMD_AUTODEV_MODE=test', () => {
  assert.equal(resolveAutodevMode({ MMD_AUTODEV_MODE: 'test' }), 'test');
});

test('@unit B2: MMD_AUTODEV_CMD alone (backward compat) infers test mode', () => {
  assert.equal(resolveAutodevMode({ MMD_AUTODEV_CMD: '/path/to/fixture.sh' }), 'test');
});

test('@unit B2: invalid MMD_AUTODEV_MODE value falls through (no silent test-mode coercion)', () => {
  assert.equal(resolveAutodevMode({ MMD_AUTODEV_MODE: 'garbage' }), 'cli');
  assert.equal(
    resolveAutodevMode({ MMD_AUTODEV_MODE: 'garbage', MMD_AUTODEV_CMD: '/some/path' }),
    'test',
  );
});
