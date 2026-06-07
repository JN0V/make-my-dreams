// test/unit/handover-docs.test.js — AC-6 documentation anchors for `mmd
// handover`: README mention, ADR-020, the L-020 lesson, and the live
// HANDOVER.md markers. Tagged @unit (static file-presence assertions).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseLessons } from '../../lib/composer/parse-lessons.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

test('@unit README lists the current mmdream document command (handover is now a deprecated alias)', () => {
  // `mmdream handover` was deprecated in favor of the one-agent `mmdream document`
  // (v0.19+); the README now teaches the current command, not the deprecated alias.
  assert.match(read('README.md'), /mmdream document/);
});

test('@unit ADR-020 documents the handover subcommand', () => {
  const adr = read('docs/adr/020-mmd-handover-subcommand.md');
  assert.match(adr, /ADR-020/);
  assert.match(adr, /mmd handover/);
  assert.match(adr, /marker/i);
});

test('@unit lessons-learned.md has an active L-020 with the required fields', () => {
  const lessons = parseLessons(read('docs/lessons-learned.md'));
  const l20 = lessons.find((l) => l.id === 'L-020');
  assert.ok(l20, 'L-020 must exist');
  assert.equal(l20.status, 'active');
  assert.ok(l20.keywords.length > 0, 'L-020 needs Keywords for matching');
  assert.ok(l20.category.length > 0 && l20.category[0] !== 'uncategorized', 'L-020 needs a Category');
  assert.ok(l20.appliesTo.includes('mmd handover'), 'L-020 Applies to should include mmd handover');
});

test('@unit live HANDOVER.md carries both state markers', () => {
  const handover = read('HANDOVER.md');
  assert.match(handover, /<!-- mmd:handover:state:start -->/);
  assert.match(handover, /<!-- mmd:handover:state:end -->/);
});
