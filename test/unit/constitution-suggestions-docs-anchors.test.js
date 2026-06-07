// @unit anchor-presence tests for SPEC_V06B AC-4 documentation. Cheap guards
// that the ADR / README / CLAUDE.md paragraphs are present so a future edit that
// drops them fails loudly (same pattern as onboarding-docs-anchors.test.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');
import { readReadmeSurface } from "../helpers/readme-surface.js";

test('@unit AC-4: ADR-033 exists and covers suggestions + friction + composer-drop', () => {
  const p = 'docs/adr/033-constitution-suggestions-and-discover-friction.md';
  assert.ok(existsSync(path.join(REPO_ROOT, p)), `${p} must exist`);
  const md = read(p);
  assert.match(md, /# ADR-033/);
  assert.match(md, /heuristic/i);               // deterministic checklist, honestly labeled
  assert.match(md, /elle reste/);               // non-destructive guarantee
  assert.match(md, /Layer.?B/);                 // why the composer rework is moot
  assert.match(md, /retired|dropped/i);         // composer rework not built
  assert.match(md, /exit 4/);                   // F7 intact
  assert.match(md, /F7/);
});

test('@unit AC-4: README documents constitution suggestions + the friction fix', () => {
  const md = readReadmeSurface(REPO_ROOT);
  assert.match(md, /Constitution suggestions/);
  assert.match(md, /heuristic, not an audit/i);
  assert.match(md, /elle reste/);
  assert.match(md, /without a manual stash/);
  assert.match(md, /ADR-033/);
});

test('@unit AC-4: CLAUDE.md gains the considerate-guest working agreement', () => {
  const md = read('CLAUDE.md');
  assert.match(md, /Considerate guest of a third-party constitution \(v0\.6\.b\)/);
  assert.match(md, /constitution-suggest\.js/);
  assert.match(md, /mmd-managed\.js/);
  assert.match(md, /Layer-C composer rework was retired/);
  assert.match(md, /exit 4/);
});
