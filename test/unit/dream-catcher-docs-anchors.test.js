// @unit anchor-presence tests for SPEC_V03A1 AC-6 documentation. Cheap guards
// that ADR-021, L-021, the README Dream Catcher paragraph, and the version bump
// are present, so a future edit that drops them fails loudly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

test('@unit AC-6: ADR-021 exists and covers the Dream Catcher rationale', () => {
  const p = 'docs/adr/021-dream-catcher.md';
  assert.ok(existsSync(path.join(REPO_ROOT, p)), `${p} must exist`);
  const md = read(p);
  assert.match(md, /# ADR-021/);
  assert.match(md, /SPEC_V03A\.md/);          // references the parent design
  assert.match(md, /no stdin/i);              // headless reality
  assert.match(md, /honest fallback/i);       // universal §VI
  assert.match(md, /v0\.3\.a-2/);             // deferred dial + editing
});

test('@unit AC-6: L-021 is a formal lesson with Category / Applies to / Keywords', () => {
  const md = read('docs/lessons-learned.md');
  assert.match(md, /## L-021 —/);
  assert.match(md, /no stdin/i);
  // The three machine-readable fields the composer relies on (L-018).
  const block = md.slice(md.indexOf('## L-021'));
  assert.match(block, /\*\*Category\*\*:.*subprocess-control/);
  assert.match(block, /\*\*Applies to\*\*:.*mmd serve/);
  assert.match(block, /\*\*Keywords for matching\*\*:.*dream catcher/i);
});

test('@unit AC-6: README documents Dream Catcher under mmd serve', () => {
  const md = read('README.md');
  assert.match(md, /Dream Catcher/);
  assert.match(md, /\/api\/catch\/start/);
  assert.match(md, /ADR-021/);
});

test('@unit AC-6: package.json is bumped to 0.3.0', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.version, '0.3.0');
});
