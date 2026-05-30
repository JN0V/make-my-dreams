// @unit anchor-presence tests for SPEC_V02M AC-5 documentation. Cheap guards
// that the README note, ADR-017, and the BOOTSTRAP trust-assumption lines for
// the three new pillars are present, so a future edit that drops them fails
// loudly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

test('@unit AC-5: README documents the v0.2.m all-five-pillars install', () => {
  const md = read('README.md');
  assert.match(md, /v0\.2\.m/);
  assert.match(md, /Phase 5 — Spec Kit/);
  assert.match(md, /Phase 6 — OpenSpec/);
  assert.match(md, /Phase 7 — Ralph Loop/);
  assert.match(md, /Install summary/);
  assert.match(md, /ADR-017/);
});

test('@unit AC-5: ADR-017 exists and covers the four rationale points', () => {
  const p = 'docs/adr/017-three-pillars-install-hardening.md';
  assert.ok(existsSync(path.join(REPO_ROOT, p)), `${p} must exist`);
  const md = read(p);
  assert.match(md, /# ADR-017:/);
  assert.match(md, /native install method/i);      // why native, not custom installer
  assert.match(md, /functional verify over file-presence/i); // consistency with v0.2.f
  assert.match(md, /per-pillar env vars/i);          // why not MMD_AUTO_INSTALL_ALL
  assert.match(md, /MMD_AUTO_INSTALL_ALL/);          // the rejected alternative is named
  assert.match(md, /final summary banner/i);         // why the banner
});

test('@unit AC-5: BOOTSTRAP trust assumptions name each new pillar install URL', () => {
  const md = read('BOOTSTRAP.md');
  assert.match(md, /github\.com\/github\/spec-kit/);
  assert.match(md, /specify-cli/);
  assert.match(md, /github\.com\/Fission-AI\/OpenSpec/);
  assert.match(md, /npm install -g openspec/);
  assert.match(md, /claude plugin install ralph-loop/);
  // The per-pillar opt-in toggles are documented.
  assert.match(md, /MMD_AUTO_INSTALL_SPEC_KIT/);
  assert.match(md, /MMD_AUTO_INSTALL_OPENSPEC/);
  assert.match(md, /MMD_AUTO_INSTALL_RALPH_LOOP/);
});
