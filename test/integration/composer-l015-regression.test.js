// @integration regression-lock for L-015's composer match — SPEC_V02N AC-5.
//
// FORENSIC CONTEXT (candidate a, "already-resolved"): the v0.2.h launch miss —
// where the Conductor would NOT have flagged a dangling SPEC_*.md reference —
// looked like a composer bug (L-015 not injected). Reproduction on 2026-05-31
// showed it was a *temporal* gap: at v0.2.h the composer passed no invocation
// context AND L-015 had no `Applies to` field. Both shipped later in v0.2.l
// (commits 451e6e1 + fda5665), closing it incidentally. There is no live bug.
//
// This test is therefore a PURE REGRESSION-LOCK, not a fix. It reads the REAL
// docs/lessons-learned.md and the production composer so it guards the v0.2.l
// behavior end-to-end against:
//   - a future inaccurate `Applies to` migration that drops `mmd --here` from
//     L-015 (which would silently stop injecting it under the conductor context)
//   - a matching-logic change that no longer scores L-015's keywords
// There is NO production change for candidate (a) — this AC is the test alone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { composeLessons } from '../../lib/composer/match.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const LESSONS = path.join(REPO_ROOT, 'docs', 'lessons-learned.md');

// A prompt that hits L-015's keywords ("prompt-grounding", "conductor") — the
// exact shape an `mmd --here` Conductor pre-condition check produces.
const PROMPT = [
  'Run the Conductor pre-conditions before spawning auto-dev.',
  'Verify prompt-grounding: every SPEC_*.md path cited in the dream exists on base.',
].join('\n');

test('@integration composeLessons injects L-015 under the mmd --here context (regression-lock)', async () => {
  const result = await composeLessons(PROMPT, LESSONS, {
    context: { subcommand: 'mmd --here' },
  });
  const ids = result.injectedLessons.map((l) => l.id);
  assert.ok(
    ids.includes('L-015'),
    `expected L-015 in injected lessons, got [${ids.join(', ')}]. ` +
      'If this fails, an Applies-to migration or matching-logic change regressed ' +
      'the v0.2.l fix (451e6e1 + fda5665).',
  );
  // It must survive the context filter, not just keyword matching.
  assert.equal(result.filteredOutByContext >= 0, true);
  assert.match(result.composedPrompt, /L-015/);
});

test('@integration L-015 is NOT filtered out by the mmd --here context (Applies-to guard)', async () => {
  // The context filter runs BEFORE keyword matching. If L-015's `Applies to`
  // ever drops `mmd --here`, it would be filtered out and never injected — this
  // asserts the filtered candidate set still contains it via the match result.
  const result = await composeLessons(PROMPT, LESSONS, {
    context: { subcommand: 'mmd --here' },
  });
  assert.ok(
    result.injectedLessons.some((l) => l.id === 'L-015'),
    'L-015 must pass the mmd --here context filter (its Applies to includes mmd --here)',
  );
});
