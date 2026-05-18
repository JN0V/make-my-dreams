// @unit tests for lib/composer/format.js — SPEC_V02E AC-3.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatComposedPrompt, COMPOSER_VERSION } from '../../lib/composer/format.js';

test('@unit formatComposedPrompt: throws on empty matched array (caller must short-circuit)', () => {
  assert.throws(() => formatComposedPrompt('hi', []), /non-empty/i);
});

test('@unit formatComposedPrompt: throws on non-string prompt', () => {
  assert.throws(() => formatComposedPrompt(null, [{ id: 'L-1', title: 't', rule: 'r' }]), TypeError);
});

test('@unit formatComposedPrompt: emits expected header structure', () => {
  const out = formatComposedPrompt('ORIGINAL', [
    { id: 'L-003', title: 'concurrent git', rule: 'do not run git in parallel' },
  ]);
  assert.match(out, /^## Active lessons \(auto-injected by composer v0\.2e\)/);
  assert.match(out, /### L-003 — concurrent git/);
  assert.match(out, /\*\*Rule\*\*: do not run git in parallel/);
  assert.match(out, /---/);
  assert.ok(out.endsWith('ORIGINAL'), 'original prompt body must be at the very end');
});

test('@unit formatComposedPrompt: deterministic — same input yields byte-identical output', () => {
  const matched = [
    { id: 'L-003', title: 't3', rule: 'r3' },
    { id: 'L-008', title: 't8', rule: 'r8' },
  ];
  const a = formatComposedPrompt('ORIG', matched);
  const b = formatComposedPrompt('ORIG', matched);
  assert.equal(a, b);
});

test('@unit formatComposedPrompt: gracefully handles missing rule', () => {
  const out = formatComposedPrompt('o', [
    { id: 'L-X', title: 'tx', rule: '' },
  ]);
  assert.match(out, /\(no rule recorded\)/);
});

test('@unit formatComposedPrompt: snapshot — 3 lessons output is stable', () => {
  // Snapshot test per AC-3 ("snapshot test against 3 known matched sets").
  // We embed the expected output here; if the format intentionally evolves,
  // bump this snapshot AND the COMPOSER_VERSION constant.
  const matched = [
    { id: 'L-003', title: 'Title3', rule: 'Rule three.' },
    { id: 'L-006', title: 'Title6', rule: 'Rule six.' },
    { id: 'L-008', title: 'Title8', rule: 'Rule eight.' },
  ];
  const out = formatComposedPrompt('body', matched);
  const expected =
    `## Active lessons (auto-injected by composer v0.2e)\n\n` +
    `The following lessons from docs/lessons-learned.md match keywords in this prompt. ` +
    `They are NOT optional — they encode validated rules from past failures. ` +
    `Apply each rule as you work.\n\n` +
    `### L-003 — Title3\n**Rule**: Rule three.\n\n` +
    `### L-006 — Title6\n**Rule**: Rule six.\n\n` +
    `### L-008 — Title8\n**Rule**: Rule eight.\n\n` +
    `---\n\n` +
    `body`;
  assert.equal(out, expected);
});

test('@unit COMPOSER_VERSION is v0.2e', () => {
  assert.equal(COMPOSER_VERSION, 'v0.2e');
});
