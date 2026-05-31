// test/unit/handover-rewrite-markers.test.js — pure rewriter unit tests
// (SPEC_V02P AC-3): outside-marker preservation, idempotency, missing markers.
// Pure string transform, no I/O. Tagged @unit.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  rewriteMarkers,
  MARKER_START,
  MARKER_END,
} from '../../lib/handover/rewrite-markers.js';

const INTENT_BEFORE = '# HANDOVER\n\n> human prose\n\n## State\n\n';
const INTENT_AFTER = '\n\n## What just shipped\n\nmore human prose\n';

function withMarkers(inner) {
  return `${INTENT_BEFORE}${MARKER_START}${inner}${MARKER_END}${INTENT_AFTER}`;
}

test('@unit rewriteMarkers: replaces only the inner region, preserves outside bytes', () => {
  const file = withMarkers('\nOLD STALE BLOCK\n');
  const r = rewriteMarkers(file, '- **Tests**: 42 passing');
  assert.ok(r.ok);
  // outside-marker bytes are identical
  assert.ok(r.text.startsWith(INTENT_BEFORE + MARKER_START));
  assert.ok(r.text.endsWith(MARKER_END + INTENT_AFTER));
  assert.match(r.text, /- \*\*Tests\*\*: 42 passing/);
  assert.ok(!r.text.includes('OLD STALE BLOCK'));
});

test('@unit rewriteMarkers: idempotent — same block twice yields byte-identical output', () => {
  const block = '- **Latest tag**: `v0.2.16`\n- **Tests**: 7 passing';
  const file = withMarkers('\nanything\n');
  const once = rewriteMarkers(file, block);
  assert.ok(once.ok);
  const twice = rewriteMarkers(once.text, block);
  assert.ok(twice.ok);
  assert.equal(twice.text, once.text);
});

test('@unit rewriteMarkers: canonical inner form is newline+block+newline', () => {
  const file = withMarkers('\nx\n');
  const r = rewriteMarkers(file, 'BLOCK');
  assert.ok(r.text.includes(`${MARKER_START}\nBLOCK\n${MARKER_END}`));
});

test('@unit rewriteMarkers: missing start marker → ok:false, names the missing marker', () => {
  const file = `${INTENT_BEFORE}${MARKER_END}${INTENT_AFTER}`;
  const r = rewriteMarkers(file, 'BLOCK');
  assert.equal(r.ok, false);
  assert.ok(r.missing.includes(MARKER_START));
});

test('@unit rewriteMarkers: missing end marker → ok:false', () => {
  const file = `${INTENT_BEFORE}${MARKER_START}${INTENT_AFTER}`;
  const r = rewriteMarkers(file, 'BLOCK');
  assert.equal(r.ok, false);
  assert.ok(r.missing.includes(MARKER_END));
});

test('@unit rewriteMarkers: both markers missing → ok:false lists both', () => {
  const r = rewriteMarkers('no markers here', 'BLOCK');
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing.sort(), [MARKER_START, MARKER_END].sort());
});

test('@unit rewriteMarkers: out-of-order markers → ok:false (refuses to scramble)', () => {
  const file = `${INTENT_BEFORE}${MARKER_END}inner${MARKER_START}${INTENT_AFTER}`;
  const r = rewriteMarkers(file, 'BLOCK');
  assert.equal(r.ok, false);
});
