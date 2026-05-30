// @integration test for SPEC_V02J AC-4 — the 5-Whys session prompt benefits
// from the composer: a timeout-themed stall context auto-injects L-016's rule
// (keywords "MMD_TIMEOUT_MS", "timeout", "30 min") from the LIVE lessons file.
//
// We exercise lib/conductor/five-whys.js directly (no CLI) so we can inspect
// the composer result it returns. The fake-claude fixture stands in for claude.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';

import { runFiveWhys } from '../../lib/conductor/five-whys.js';
import { composeLessons } from '../../lib/composer/match.js';
import { composerJsonPathFor } from '../../lib/composer/audit.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const FAKE = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-claude-five-whys.sh');
const LIVE_LESSONS = path.join(REPO_ROOT, 'docs', 'lessons-learned.md');

// A stall context heavy with L-016 keywords.
const TIMEOUT_CONTEXT = {
  sliceBranch: 'slice/timeout-victim',
  signals: ['duration-exceeded-budget', 'state-failed-explicit'],
  evidence: {
    durationSeconds: 1800.6,
    state: 'failed',
    note: 'MMD_TIMEOUT_MS default of 30 min killed the run; subprocess timed out',
  },
  lastCommits: 'a08ed04 docs(spec): adversarial review pass 2',
  logTail: '[mmd] subprocess timed out',
  dream: 'implement the slice; the claude -p subprocess timed out at 30 min (MMD_TIMEOUT_MS)',
};

test('@integration composeLessons matches L-016 on a timeout-themed prompt', async () => {
  // Sanity-check the live lessons file carries L-016 (skip gracefully if not).
  if (!existsSync(LIVE_LESSONS)) {
    assert.ok(true, 'lessons file absent — brownfield no-op, nothing to assert');
    return;
  }
  const prompt =
    'diagnose: MMD_TIMEOUT_MS default 30 min, subprocess timed out, status.json failed state';
  const result = await composeLessons(prompt, LIVE_LESSONS, { env: {} });
  const ids = result.injectedLessons.map((l) => l.id);
  assert.ok(ids.includes('L-016'), `expected L-016 injected; got ${ids.join(',')}`);
});

test('@integration runFiveWhys injects L-016 into the session prompt (AC-4)', async () => {
  if (!existsSync(LIVE_LESSONS)) {
    assert.ok(true, 'lessons file absent — brownfield no-op');
    return;
  }
  const result = await runFiveWhys({
    context: TIMEOUT_CONTEXT,
    repoRoot: REPO_ROOT,
    claudePath: FAKE,
    env: {
      ...process.env,
      MMD_FAKE_5WHYS_ACTION: 'continue-with-hint',
      // composer NOT disabled here — that's the whole point of the test.
      MMD_COMPOSER_DISABLED: '',
    },
  });
  assert.ok(result.composer, 'composer result should be present');
  const ids = result.composer.injectedLessons.map((l) => l.id);
  assert.ok(ids.includes('L-016'), `expected L-016 injected into session; got ${ids.join(',')}`);
  // The session still parsed the fake-claude action.
  assert.equal(result.parsed.recommended_action, 'continue-with-hint');
  // F7 (Phase-4 review): AC-4 wants the matched lessons recorded in a
  // composer.json sibling file — the canonical audit format, co-located with
  // the run log so audit-pillars --with-composer can glob it.
  const sidecar = composerJsonPathFor(result.logPath);
  assert.ok(existsSync(sidecar), `expected composer.json sidecar at ${sidecar}`);
});

test('@integration MMD_COMPOSER_DISABLED=1 yields no injected lessons (escape hatch)', async () => {
  const result = await runFiveWhys({
    context: TIMEOUT_CONTEXT,
    repoRoot: REPO_ROOT,
    claudePath: FAKE,
    env: {
      ...process.env,
      MMD_FAKE_5WHYS_ACTION: 'continue-with-hint',
      MMD_COMPOSER_DISABLED: '1',
    },
  });
  assert.ok(result.composer, 'composer result present even when disabled');
  assert.equal(result.composer.disabled, true);
  assert.deepEqual(result.composer.injectedLessons, []);
});
