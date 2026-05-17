// @unit tests for lib/here-mode.js — v0.2a --here mode plumbing.
// Pure logic only:
//   - generateSliceBranchName (deterministic with injected now)
//   - parseProtectedBranches (env-var parsing, graceful degradation)
//   - buildHerePrompt (string assembly, no I/O)
//
// validateHereTarget + createSliceBranch are exercised by the integration
// tests under test/integration/here-mode.test.js (need real git repos).
//
// Per testing.md §V: pure logic, < 100 ms total. No I/O, no subprocess.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  generateSliceBranchName,
  parseProtectedBranches,
  buildHerePrompt,
  PROTECTED_BRANCHES_DEFAULT,
} from '../../lib/here-mode.js';

test('@unit generateSliceBranchName: returns slice/here-<slug>-<unix-ts>', () => {
  // Inject deterministic now: 2026-05-17T12:00:00.000Z → 1779537600000 ms → 1779537600 s
  const fixed = 1779537600000;
  const name = generateSliceBranchName('add-banner', () => fixed);
  assert.equal(name, 'slice/here-add-banner-1779537600');
});

test('@unit generateSliceBranchName: uses Date.now by default (numeric suffix)', () => {
  const name = generateSliceBranchName('any-slug');
  // Format guard — must match slice/here-<slug>-<digits>.
  assert.match(name, /^slice\/here-any-slug-\d+$/);
});

test('@unit generateSliceBranchName: empty slug throws TypeError', () => {
  assert.throws(() => generateSliceBranchName(''), /non-empty/);
  assert.throws(() => generateSliceBranchName(undefined), /non-empty/);
  assert.throws(() => generateSliceBranchName(123), /non-empty/);
});

test('@unit parseProtectedBranches: undefined env → default ["main","master"]', () => {
  assert.deepEqual(parseProtectedBranches(undefined), ['main', 'master']);
});

test('@unit parseProtectedBranches: empty string → default', () => {
  assert.deepEqual(parseProtectedBranches(''), ['main', 'master']);
});

test('@unit parseProtectedBranches: comma-separated value parsed and trimmed', () => {
  assert.deepEqual(parseProtectedBranches('main, master, develop'), ['main', 'master', 'develop']);
});

test('@unit parseProtectedBranches: malformed (only commas/whitespace) → default', () => {
  assert.deepEqual(parseProtectedBranches(' , , ,'), ['main', 'master']);
});

test('@unit parseProtectedBranches: single value parsed', () => {
  assert.deepEqual(parseProtectedBranches('release'), ['release']);
});

test('@unit PROTECTED_BRANCHES_DEFAULT is frozen and contains main+master', () => {
  assert.ok(Object.isFrozen(PROTECTED_BRANCHES_DEFAULT));
  assert.deepEqual([...PROTECTED_BRANCHES_DEFAULT], ['main', 'master']);
});

// AC-4 — buildHerePrompt assertions.

test('@unit buildHerePrompt (AC-4): contains the literal "--here" mode line', () => {
  const p = buildHerePrompt({
    dream: 'add a banner to README',
    sliceBranch: 'slice/here-add-banner-1779537600',
    targetDir: '/tmp/some-repo',
  });
  assert.match(
    p,
    /Mode: --here — modify the current repository in place\. Do NOT create a demo\/ directory\. Do NOT scaffold a new PWA\./,
  );
});

test('@unit buildHerePrompt (AC-4): contains the slice branch line', () => {
  const p = buildHerePrompt({
    dream: 'add a banner',
    sliceBranch: 'slice/here-add-banner-1779537600',
    targetDir: '/tmp/r',
  });
  assert.match(
    p,
    /Slice branch: slice\/here-add-banner-1779537600\. All commits MUST land on this branch\./,
  );
});

test('@unit buildHerePrompt (AC-4): contains the target repo line with absolute path', () => {
  const p = buildHerePrompt({
    dream: 'add a banner',
    sliceBranch: 'slice/here-add-banner-1779537600',
    targetDir: '/tmp/r',
  });
  assert.match(p, /Target repo: \/tmp\/r\. Working directory is the repo root\./);
});

test('@unit buildHerePrompt (AC-4): contains the dream verbatim', () => {
  const dream = 'add a banner with a link to BOOTSTRAP.md at the top of README.md';
  const p = buildHerePrompt({
    dream,
    sliceBranch: 'slice/here-add-banner-1779537600',
    targetDir: '/tmp/r',
  });
  assert.ok(p.includes(dream), 'prompt must contain the dream verbatim');
});

test('@unit buildHerePrompt (AC-4): references MAKE_MY_DREAMS.md, constitution, and lessons-learned', () => {
  const p = buildHerePrompt({
    dream: 'd',
    sliceBranch: 'slice/here-d-1',
    targetDir: '/tmp/r',
  });
  assert.match(p, /MAKE_MY_DREAMS\.md/);
  assert.match(p, /\.specify\/memory\/constitution\.md/);
  assert.match(p, /docs\/lessons-learned\.md/);
});

test('@unit buildHerePrompt (AC-4): does NOT prescribe demo/<slug>/ or new-product scaffolding', () => {
  const p = buildHerePrompt({
    dream: 'd',
    sliceBranch: 'slice/here-d-1',
    targetDir: '/tmp/r',
  });
  // Strict: no `demo/<slug>` path literal. The "Do NOT create a demo/ directory"
  // line is the AC-4 anti-instruction and is allowed (and required) — the
  // assertion targets the directive form `demo/<slug>` only.
  assert.doesNotMatch(p, /demo\/[a-z]/);
  // No instruction to generate the v0.2 PWA files (these are greenfield concepts).
  assert.doesNotMatch(p, /Generate index\.html/);
  assert.doesNotMatch(p, /manifest\.json/);
  // No instruction to write a new product vision/slice.
  assert.doesNotMatch(p, /scaffold a new product/i);
});

test('@unit buildHerePrompt: FAST engine adds quick-mode block', () => {
  const p = buildHerePrompt({
    dream: 'd',
    sliceBranch: 'slice/here-d-1',
    targetDir: '/tmp/r',
    engine: 'fast',
  });
  assert.match(p, /Engine: FAST/);
  assert.match(p, /MMD_AUTODEV_QUICK=1/);
});

test('@unit buildHerePrompt: STANDARD engine omits FAST block', () => {
  const p = buildHerePrompt({
    dream: 'd',
    sliceBranch: 'slice/here-d-1',
    targetDir: '/tmp/r',
    engine: 'standard',
  });
  assert.doesNotMatch(p, /Engine: FAST/);
});

test('@unit buildHerePrompt: empty inputs throw TypeError (failure honesty)', () => {
  assert.throws(
    () => buildHerePrompt({ dream: '', sliceBranch: 'x', targetDir: '/tmp' }),
    /dream/,
  );
  assert.throws(
    () => buildHerePrompt({ dream: 'd', sliceBranch: '', targetDir: '/tmp' }),
    /sliceBranch/,
  );
  assert.throws(
    () => buildHerePrompt({ dream: 'd', sliceBranch: 's', targetDir: '' }),
    /targetDir/,
  );
});
