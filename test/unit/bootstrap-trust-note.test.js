// @unit — SPEC_V02K AC-4 (cso LOW-2): BOOTSTRAP.md must document the curl|bash
// trust assumptions so the supply-chain expectation is explicit, not implicit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const BOOTSTRAP = readFileSync(path.join(REPO_ROOT, 'BOOTSTRAP.md'), 'utf8');

test('@unit BOOTSTRAP.md has a "Trust assumptions" section', () => {
  assert.match(BOOTSTRAP, /##\s+Trust assumptions/);
});

test('@unit Trust assumptions documents both curl|bash sources + the opt-out', () => {
  assert.match(BOOTSTRAP, /bun\.sh\/install/);
  assert.match(BOOTSTRAP, /gstack\.dev\/install\.sh/);
  assert.match(BOOTSTRAP, /MMD_AUTO_INSTALL_/);
  assert.match(BOOTSTRAP, /pre-install/i);
});
