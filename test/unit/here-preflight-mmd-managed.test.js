// @unit tests for the MMD-managed dirty-path predicate (SPEC_V06B AC-3).
//
// This is the pure core of the discover→--here friction fix: a tree dirtied
// ONLY by MMD scratch counts as clean; ANY non-MMD dirty path keeps the guard
// refusing (F7 — the post-setup `git add -A` can never sweep user work).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isMmdManagedPath,
  isTreeCleanIgnoringMmd,
  porcelainPath,
} from '../../lib/onboarding/mmd-managed.js';

test('@unit isMmdManagedPath: the three managed roots + .mmd/ subtree', () => {
  assert.ok(isMmdManagedPath('.mmd'));
  assert.ok(isMmdManagedPath('.mmd/shared/status.json'));
  assert.ok(isMmdManagedPath('mmd-discovery-report.md'));
  assert.ok(isMmdManagedPath('.gitignore'));
  assert.ok(isMmdManagedPath('./.gitignore'));
  assert.ok(isMmdManagedPath('.mmd/'));
});

test('@unit isMmdManagedPath: real user paths are NOT managed', () => {
  for (const p of ['src/main.js', 'README.md', 'package.json', '.specify/memory/constitution.md', 'mmd.js', '', null, undefined]) {
    assert.equal(isMmdManagedPath(p), false, `${p} must not be MMD-managed`);
  }
});

test('@unit porcelainPath: parses status codes, renames, quotes', () => {
  assert.equal(porcelainPath(' M .gitignore'), '.gitignore');
  assert.equal(porcelainPath('?? mmd-discovery-report.md'), 'mmd-discovery-report.md');
  assert.equal(porcelainPath('A  .mmd/shared/x'), '.mmd/shared/x');
  assert.equal(porcelainPath('R  old.js -> src/new.js'), 'src/new.js');
  assert.equal(porcelainPath('?? "weird name.md"'), 'weird name.md');
  assert.equal(porcelainPath(''), null);
  assert.equal(porcelainPath('   '), null);
});

test('@unit isTreeCleanIgnoringMmd: empty tree is clean', () => {
  assert.equal(isTreeCleanIgnoringMmd(''), true);
  assert.equal(isTreeCleanIgnoringMmd('\n\n'), true);
});

test('@unit isTreeCleanIgnoringMmd: MMD-only dirty → clean (the friction fix)', () => {
  const porcelain = [
    ' M .gitignore',
    '?? mmd-discovery-report.md',
    '?? .mmd/shared/project-onboarder/last.md',
  ].join('\n');
  assert.equal(isTreeCleanIgnoringMmd(porcelain), true);
});

test('@unit isTreeCleanIgnoringMmd: ANY non-MMD dirty path → not clean (F7 intact)', () => {
  const mixed = [
    ' M .gitignore',
    ' M src/app.js', // a real user change
    '?? mmd-discovery-report.md',
  ].join('\n');
  assert.equal(isTreeCleanIgnoringMmd(mixed), false);

  // A single user file alone also refuses.
  assert.equal(isTreeCleanIgnoringMmd('?? secret.env'), false);
});

test('@unit isTreeCleanIgnoringMmd: non-string degrades to clean (never throws)', () => {
  assert.doesNotThrow(() => isTreeCleanIgnoringMmd(undefined));
  assert.equal(isTreeCleanIgnoringMmd(undefined), true);
});
