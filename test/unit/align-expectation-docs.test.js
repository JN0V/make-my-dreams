// @unit tests for SPEC_V017A AC-5 (the cheap, pure file/version checks): ADR-056
// exists; the package version is exactly 0.17.0.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

test('@unit AC-5: ADR-056 file exists at docs/adr/056-align-to-original-expectation.md', () => {
  assert.ok(existsSync(path.join(REPO_ROOT, 'docs', 'adr', '056-align-to-original-expectation.md')));
});

test('@unit AC-5: package.json version is at or past 0.17.0 (the slice that bumped it)', () => {
  // A later slice legitimately bumps the version; assert >= the slice's version
  // rather than an exact pin that every future bump would break.
  const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const [maj, min] = pkg.version.split('.').map(Number);
  assert.ok(maj > 0 || (maj === 0 && min >= 17), `expected >= 0.17.0, got ${pkg.version}`);
});
