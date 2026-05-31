// @integration tests for lib/dream-catcher/elicit.js — SPEC_V03A1 AC-2.
// Exercises the REAL spawn path through a fake-claude fixture (MMD_AUTODEV_CMD).
// The real `claude` is never invoked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { runElicit } from '../../lib/dream-catcher/elicit.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const FAKE_CLAUDE = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-claude-elicit.sh');

test('@integration fake claude returns a synthesized scope (autonomous path)', async () => {
  const r = await runElicit({
    dream: 'une appli pour dessiner',
    profile: 'Curious',
    env: { MMD_AUTODEV_CMD: FAKE_CLAUDE, PATH: process.env.PATH },
    timeoutMs: 10_000,
  });
  assert.equal(r.ok, true);
  assert.equal(r.fallback, false);
  assert.match(r.scope, /drawing app/i);
});

test('@integration Kid profile threads safe-by-default framing into the prompt the fixture sees', async () => {
  const r = await runElicit({
    dream: 'une appli pour dessiner',
    profile: 'Enfant',
    env: { MMD_AUTODEV_CMD: FAKE_CLAUDE, PATH: process.env.PATH },
    timeoutMs: 10_000,
  });
  assert.equal(r.ok, true);
  // The fixture reflects the Kid scope when it detects the safe-by-default line.
  assert.match(r.scope, /Hors-ligne|sans compte|canvas/i);
});

test('@integration non-zero fixture exit → honest fallback to verbatim dream', async () => {
  const r = await runElicit({
    dream: 'mon rêve verbatim',
    profile: 'Curious',
    env: { MMD_AUTODEV_CMD: FAKE_CLAUDE, MMD_FAKE_ELICIT_EXIT: '5', PATH: process.env.PATH },
    timeoutMs: 10_000,
  });
  assert.equal(r.fallback, true);
  assert.equal(r.scope, 'mon rêve verbatim');
});

test('@integration empty fixture output → honest fallback to verbatim dream', async () => {
  const r = await runElicit({
    dream: 'mon rêve verbatim',
    profile: 'Curious',
    env: { MMD_AUTODEV_CMD: FAKE_CLAUDE, MMD_FAKE_ELICIT_EMPTY: '1', PATH: process.env.PATH },
    timeoutMs: 10_000,
  });
  assert.equal(r.fallback, true);
  assert.equal(r.scope, 'mon rêve verbatim');
});
