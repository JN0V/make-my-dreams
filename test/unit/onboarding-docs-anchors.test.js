// @unit anchor-presence tests for SPEC_V06A AC-5 documentation. Cheap guards
// that the ADR / README / CLAUDE.md paragraphs are present so a future edit that
// drops them fails loudly (same pattern as composer-docs-anchors.test.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');
import { readReadmeSurface } from "../helpers/readme-surface.js";

test('@unit AC-5: ADR-032 exists and covers the first-run-setup rationale', () => {
  const p = 'docs/adr/032-transparent-first-run-setup.md';
  assert.ok(existsSync(path.join(REPO_ROOT, p)), `${p} must exist`);
  const md = read(p);
  assert.match(md, /# ADR-032/);
  assert.match(md, /brownfield-app/);          // the new case
  assert.match(md, /no `mmd init`/i);          // why no init command
  assert.match(md, /exit 8/);                  // decline/failure ladder rung
  assert.match(md, /elle reste|never overwrite/i); // existing constitution kept
  assert.match(md, /v0\.6\.b/);                // the deferred Layer-C work
});

test('@unit AC-5: README documents "Using MMD on your own repo"', () => {
  const md = readReadmeSurface(REPO_ROOT);
  assert.match(md, /Using MMD on your own repo/);
  assert.match(md, /brownfield-app/);
  assert.match(md, /Run setup now\?/);
  assert.match(md, /MMD_SKIP_SETUP=1/);
  assert.match(md, /ADR-032/);
});

test('@unit AC-5: CLAUDE.md gains the third-party-readiness working agreement', () => {
  const md = read('CLAUDE.md');
  assert.match(md, /third-party readiness, v0\.6\.a/i);
  assert.match(md, /brownfield-app/);
  assert.match(md, /first-run setup guard/i);
  assert.match(md, /exit 8/);
  assert.match(md, /MMD_SKIP_SETUP=1/);
});
