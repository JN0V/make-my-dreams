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
import { readReadmeSurface } from '../helpers/readme-surface.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

test('@unit README documents the mmdream document-readme subcommand', () => {
  assert.match(read('README.md'), /mmdream document-readme/);
});

test('@unit CLAUDE.md mentions mmdream document-readme', () => {
  assert.match(read('CLAUDE.md'), /mmdream document-readme/);
});

test('@unit ADR-025 documents the doc-sync design', () => {
  const adr = read('docs/adr/025-document-readme-doc-sync.md');
  assert.match(adr, /ADR-025/);
  // ADR-025 is a HISTORICAL record (written when the command was `mmd`); it is
  // intentionally NOT renamed, so it still says `mmd document-readme`.
  assert.match(adr, /mmd document-readme/);
  assert.match(adr, /marker/i);
  assert.match(adr, /tag annotation/i);
});

test('@unit live README surface carries BOTH marker pairs (status in README, changelog wherever it lives)', () => {
  // v0.21.a condensation moves the changelog markers to CHANGELOG.md (the refresh
  // follows the marker, ADR-060), so the changelog pair may live in either file —
  // the status pair stays in README. We assert BOTH pairs exist across the surface.
  const readme = read('README.md');
  assert.match(readme, /<!-- mmd:readme:status:start -->/);
  assert.match(readme, /<!-- mmd:readme:status:end -->/);
  const surface = readReadmeSurface();
  assert.match(surface, /<!-- mmd:readme:changelog:start -->/);
  assert.match(surface, /<!-- mmd:readme:changelog:end -->/);
});

test('@unit the live README surface documents every registered SUBCOMMAND (no drift today)', () => {
  // The command docs live across the README + its extracted docs/readme-usage.md
  // sibling since v0.21.a — the surface a reader reaches via the README's links.
  const surface = readReadmeSurface();
  const r = detectDrift({ subcommands: [...SUBCOMMANDS], flags: [], readmeText: surface });
  assert.deepEqual(r.subcommands, [], `undocumented subcommands: ${r.subcommands.join(', ')}`);
});
