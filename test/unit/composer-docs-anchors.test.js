// @unit anchor-presence tests for SPEC_V02L AC-6 documentation. Cheap guards
// that the README / ADR-012 / MAKE_MY_DREAMS paragraphs are present so a
// future edit that drops them fails loudly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

test('@unit AC-6: README documents Category / Applies to + --context flag', () => {
  const md = read('README.md');
  assert.match(md, /\*\*Category\*\*:/);
  assert.match(md, /\*\*Applies to\*\*:/);
  assert.match(md, /--context mmd-qa/);
  assert.match(md, /ADR-012/);
});

test('@unit AC-6: ADR-012 exists and covers the key rationale points', () => {
  const p = 'docs/adr/012-composer-categorization.md';
  assert.ok(existsSync(path.join(REPO_ROOT, p)), `${p} must exist`);
  const md = read(p);
  assert.match(md, /# ADR-012:/);
  assert.match(md, /constitution-bindings\.yaml/); // proven per-context model
  assert.match(md, /annotation-on-lesson/i); // why on-lesson not separate file
  assert.match(md, /backward-compat/i); // legacy rationale
  assert.match(md, /folksonomy/i); // taxonomy + how to extend
});

test('@unit AC-6: MAKE_MY_DREAMS §6.5 notes v0.2.l scale-resilience', () => {
  const md = read('MAKE_MY_DREAMS.md');
  assert.match(md, /v0\.2\.l added scale-resilience/);
  assert.match(md, /context-aware filter that runs BEFORE keyword matching/);
  assert.match(md, /ADR-012/);
});
