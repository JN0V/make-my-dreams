// @integration tests for AC-4 — verify the auto-dev prompt for --here mode
// contains the required strings and DOES NOT contain greenfield references
// (demo/<slug>/, vision/slice scaffold instructions).
//
// We exercise lib/here-mode.js#buildHerePrompt at the integration level (it
// flows through bin/mmd.js into invokeAutodev.buildPrompt) and assert on the
// final string that would be passed to `claude -p`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { platform } from 'node:os';

import { buildHerePrompt } from '../../lib/here-mode.js';
import { buildPrompt } from '../../lib/invoke-autodev.js';

const SKIP_ON_WINDOWS = platform() === 'win32';

test('@integration AC-4: buildHerePrompt string is forwarded verbatim through buildPrompt', { skip: SKIP_ON_WINDOWS }, () => {
  const dream = 'add a banner at top of README.md linking to BOOTSTRAP.md';
  const sliceBranch = 'slice/here-add-banner-readme-1779537600';
  const targetDir = '/tmp/some-repo';
  const herePrompt = buildHerePrompt({ dream, sliceBranch, targetDir });

  // buildPrompt with promptParts.prompt set must return herePrompt verbatim.
  const final = buildPrompt({
    dream,
    slug: 'add-banner-readme',
    demoDir: targetDir,
    prompt: herePrompt,
  });
  assert.equal(final, herePrompt);
});

test('@integration AC-4: final prompt contains all spec-required lines', { skip: SKIP_ON_WINDOWS }, () => {
  const dream = 'verbatim dream content';
  const sliceBranch = 'slice/here-verbatim-dream-content-1';
  const targetDir = '/tmp/some-repo';
  const final = buildPrompt({
    dream, slug: 's', demoDir: targetDir,
    prompt: buildHerePrompt({ dream, sliceBranch, targetDir }),
  });
  assert.match(final, /Mode: --here — modify the current repository in place/);
  assert.match(final, /Do NOT create a demo\/ directory\. Do NOT scaffold a new PWA\./);
  assert.match(final, new RegExp(`Slice branch: ${sliceBranch}\\.`));
  assert.match(final, /All commits MUST land on this branch\./);
  assert.match(final, new RegExp(`Target repo: ${targetDir}\\.`));
  assert.match(final, /Working directory is the repo root\./);
  assert.ok(final.includes(dream), 'prompt must contain the dream verbatim');
  // Context pointers.
  assert.match(final, /MAKE_MY_DREAMS\.md/);
  assert.match(final, /\.specify\/memory\/constitution\.md/);
  assert.match(final, /docs\/lessons-learned\.md/);
});

test('@integration AC-4: final prompt does NOT contain greenfield "Generate index.html" or demo/<slug> scaffolding', { skip: SKIP_ON_WINDOWS }, () => {
  const final = buildPrompt({
    dream: 'd', slug: 's', demoDir: '/tmp/r',
    prompt: buildHerePrompt({
      dream: 'd', sliceBranch: 'slice/here-d-1', targetDir: '/tmp/r',
    }),
  });
  assert.doesNotMatch(final, /Generate index\.html/);
  assert.doesNotMatch(final, /manifest\.json/);
  assert.doesNotMatch(final, /demo\/[a-z]/);
  assert.doesNotMatch(final, /Bundle B safe-default/);
});

test('@integration AC-4: buildPrompt WITHOUT prompt= falls back to greenfield assembly', { skip: SKIP_ON_WINDOWS }, () => {
  const greenfield = buildPrompt({ dream: 'd', slug: 's', demoDir: '/tmp/r' });
  // Greenfield assembly retains its v0.2 markers.
  assert.match(greenfield, /Generate index\.html, style\.css, app\.js, manifest\.json/);
  assert.match(greenfield, /Stack constraint: vanilla HTML\/CSS\/JS/);
});
