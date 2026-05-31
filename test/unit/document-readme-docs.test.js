// test/unit/document-readme-docs.test.js — AC-6 documentation anchors for `mmd
// document-readme`: README mention + live markers, CLAUDE.md mention, ADR-025,
// and the live-README no-drift guarantee (AC-5 over the real repo). Tagged
// @unit (static file-presence + pure-compare assertions).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SUBCOMMANDS } from '../../lib/argv-parser.js';
import { detectDrift } from '../../lib/readme-sync/detect-drift.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

test('@unit README documents the mmd document-readme subcommand', () => {
  assert.match(read('README.md'), /mmd document-readme/);
});

test('@unit CLAUDE.md mentions mmd document-readme', () => {
  assert.match(read('CLAUDE.md'), /mmd document-readme/);
});

test('@unit ADR-025 documents the doc-sync design', () => {
  const adr = read('docs/adr/025-document-readme-doc-sync.md');
  assert.match(adr, /ADR-025/);
  assert.match(adr, /mmd document-readme/);
  assert.match(adr, /marker/i);
  assert.match(adr, /tag annotation/i);
});

test('@unit live README.md carries BOTH marker pairs (status + changelog)', () => {
  const readme = read('README.md');
  assert.match(readme, /<!-- mmd:readme:status:start -->/);
  assert.match(readme, /<!-- mmd:readme:status:end -->/);
  assert.match(readme, /<!-- mmd:readme:changelog:start -->/);
  assert.match(readme, /<!-- mmd:readme:changelog:end -->/);
});

test('@unit the live README documents every registered SUBCOMMAND (no drift today)', () => {
  const readme = read('README.md');
  const r = detectDrift({ subcommands: [...SUBCOMMANDS], flags: [], readmeText: readme });
  assert.deepEqual(r.subcommands, [], `undocumented subcommands: ${r.subcommands.join(', ')}`);
});
