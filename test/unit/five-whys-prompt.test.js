// @unit tests for lib/conductor/five-whys-prompt.js — SPEC_V02J AC-2.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildFiveWhysPrompt } from '../../lib/conductor/five-whys-prompt.js';
import { RECOMMENDED_ACTIONS } from '../../lib/conductor/five-whys-parser.js';

const ctx = (over = {}) => ({
  sliceBranch: 'slice/demo',
  signals: ['no-commit-since-N-min', 'state-failed-explicit'],
  evidence: { lastCommitAgeMin: 30, state: 'failed' },
  lastCommits: 'abc123 feat: x',
  logTail: 'subprocess timed out',
  dream: 'build the thing',
  ...over,
});

test('@unit throws on bad context', () => {
  assert.throws(() => buildFiveWhysPrompt(null), TypeError);
  assert.throws(() => buildFiveWhysPrompt({}), TypeError);
});

test('@unit prompt names all five BMAD personas', () => {
  const p = buildFiveWhysPrompt(ctx());
  for (const name of ['Mary', 'Winston', 'Quinn', 'Amelia', 'Christie']) {
    assert.match(p, new RegExp(name));
  }
  assert.match(p, /Party Mode/);
});

test('@unit prompt embeds the slice branch, signals, evidence, dream', () => {
  const p = buildFiveWhysPrompt(ctx());
  assert.match(p, /slice\/demo/);
  assert.match(p, /no-commit-since-N-min/);
  assert.match(p, /state-failed-explicit/);
  assert.match(p, /build the thing/);
  assert.match(p, /abc123/);
  assert.match(p, /subprocess timed out/);
});

test('@unit prompt lists every recommended_action enum value', () => {
  const p = buildFiveWhysPrompt(ctx());
  for (const a of RECOMMENDED_ACTIONS) assert.match(p, new RegExp(a));
});

test('@unit prompt restates the output schema at start AND end (P-02)', () => {
  const p = buildFiveWhysPrompt(ctx());
  const occurrences = (p.match(/```json/g) || []).length;
  // schemaBlock contains one ```json each, appears twice (start + end).
  assert.ok(occurrences >= 2, `expected schema repeated; got ${occurrences} json fences`);
  assert.match(p, /Output contract \(READ FIRST\)/);
  assert.match(p, /Output contract \(RESTATED/);
});

test('@unit prompt is byte-deterministic for a given context', () => {
  assert.equal(buildFiveWhysPrompt(ctx()), buildFiveWhysPrompt(ctx()));
});

test('@unit prompt clips very long untrusted logTail', () => {
  const huge = 'X'.repeat(20000);
  const p = buildFiveWhysPrompt(ctx({ logTail: huge }));
  assert.match(p, /truncated to last/);
});

test('@unit prompt tolerates missing optional fields', () => {
  const p = buildFiveWhysPrompt({ sliceBranch: 'slice/min' });
  assert.match(p, /slice\/min/);
  assert.match(p, /\(none reported\)/);
});
