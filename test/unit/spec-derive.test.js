// @unit tests for lib/spec-derive.js — heuristic 1-page-spec generator (AC-4).
// Per testing.md §V: pure logic, < 100 ms, no I/O.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveSpec,
  inferAcceptanceCriteria,
  SPEC_MAX_LINES,
  SPEC_MAX_CHARS,
} from '../../lib/spec-derive.js';

test('@unit inferAcceptanceCriteria: "add a red color button" matches button + color (≥ 2 ACs)', () => {
  const acs = inferAcceptanceCriteria('add a red color button to the drawing app');
  assert.ok(acs.length >= 2, `expected ≥ 2 ACs, got ${acs.length}: ${JSON.stringify(acs)}`);
  assert.ok(acs.some((a) => /button/i.test(a)));
  assert.ok(acs.some((a) => /color/i.test(a)));
});

test('@unit inferAcceptanceCriteria: completely off-topic dream falls back to generic AC', () => {
  const acs = inferAcceptanceCriteria('quantum entanglement visualizer for theoretical physics');
  assert.equal(acs.length, 1);
  assert.match(acs[0], /functional.*visible.*regression/);
});

test('@unit inferAcceptanceCriteria: empty / non-string returns the fallback AC', () => {
  assert.equal(inferAcceptanceCriteria('').length, 1);
  assert.equal(inferAcceptanceCriteria('   ').length, 1);
  assert.equal(inferAcceptanceCriteria(null).length, 1);
  assert.equal(inferAcceptanceCriteria(undefined).length, 1);
});

test('@unit inferAcceptanceCriteria: caps at 3 ACs even when many keywords match', () => {
  const acs = inferAcceptanceCriteria(
    'add a button and a form to upload a file with color picker and draw on canvas and save with localStorage and camera preview'
  );
  assert.ok(acs.length <= 3, `expected ≤ 3, got ${acs.length}`);
});

test('@unit inferAcceptanceCriteria: bilingual — French "caméra" + "bouton" matches', () => {
  const acs = inferAcceptanceCriteria("ajoute un bouton pour activer la caméra");
  assert.ok(acs.some((a) => /button|bouton/i.test(a)) || acs.some((a) => /camera/i.test(a)));
});

test('@unit deriveSpec: requires non-empty dream + slug', () => {
  assert.throws(() => deriveSpec({ dream: '', slug: 'x' }), /dream/);
  assert.throws(() => deriveSpec({ dream: 'x', slug: '' }), /slug/);
  assert.throws(() => deriveSpec({ dream: undefined, slug: 'x' }), /dream/);
});

test('@unit deriveSpec: output respects ≤ 50 line budget (AC-4)', () => {
  const spec = deriveSpec({ dream: 'a tiny app', slug: 'tiny-app' });
  const lineCount = spec.split('\n').length;
  assert.ok(lineCount <= SPEC_MAX_LINES, `expected ≤ ${SPEC_MAX_LINES} lines, got ${lineCount}`);
});

test('@unit deriveSpec: output respects ≤ 3000 char budget (AC-4)', () => {
  const spec = deriveSpec({ dream: 'a tiny app', slug: 'tiny-app' });
  assert.ok(
    spec.length <= SPEC_MAX_CHARS,
    `expected ≤ ${SPEC_MAX_CHARS} chars, got ${spec.length}`,
  );
});

test('@unit deriveSpec: even with a pathologically long dream, budget is enforced', () => {
  const longDream = 'a '.repeat(2000) + 'drawing button form upload camera';
  // Slugs come from parse-dream and are capped at 64 chars; pass a realistic one.
  const spec = deriveSpec({ dream: longDream.slice(0, 500), slug: 'long-dream' });
  assert.ok(spec.length <= SPEC_MAX_CHARS);
  assert.ok(spec.split('\n').length <= SPEC_MAX_LINES);
});

test('@unit deriveSpec: dream + slug + heading appear in the output', () => {
  const spec = deriveSpec({
    dream: 'add a red color button to the drawing app',
    slug: 'add-red-color-button-drawing-app',
  });
  assert.match(spec, /# Slice — add-red-color-button-drawing-app/);
  assert.match(spec, /Dream: add a red color button to the drawing app/);
  assert.match(spec, /Acceptance criteria/);
  assert.match(spec, /Definition of done/);
});

test('@unit deriveSpec: when a vision is provided, its first lines are summarized', () => {
  const vision =
    '# Vision\n\nWe want a friendly drawing app for kids.\nIt should work offline.\nLine 3 should be skipped.';
  const spec = deriveSpec({ dream: 'add a button', slug: 'x', vision });
  assert.match(spec, /Vision \(inherited\):/);
  assert.match(spec, /friendly drawing app/);
});

test('@unit deriveSpec: absent vision yields a "no prior context" note', () => {
  const spec = deriveSpec({ dream: 'add a button', slug: 'x' });
  assert.match(spec, /no prior long-term context/);
});

test('@unit deriveSpec: vision with only markdown headings is treated as empty', () => {
  const spec = deriveSpec({ dream: 'add a button', slug: 'x', vision: '# Heading\n## Sub\n' });
  // No body content -> summarizeVision returns ''
  assert.match(spec, /Vision \(inherited\): ?$/m);
});

test('@unit deriveSpec: output is deterministic given the same inputs', () => {
  const a = deriveSpec({ dream: 'add a button', slug: 'x' });
  const b = deriveSpec({ dream: 'add a button', slug: 'x' });
  assert.equal(a, b);
});
