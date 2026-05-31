// @unit tests for deriveBranchSlug (lib/parse-dream.js) — human-readable branch
// names per constitution universal.md §VII. Pure logic, no I/O.
//
// The motivating bug: `mmd --here "implement v0.2.n per SPEC_V02N.md. SPEC IS
// FROZEN, ..."` produced the branch
// `slice/here-implement-v0-2-n-per-spec-v02n-md-spec-is-frozen-do-not-edit-it-...`
// — the slug captured the launch BOILERPLATE, not the work. §VII requires the
// name to read like what the slice does, to a human, first.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveBranchSlug } from '../../lib/parse-dream.js';
import { generateSliceBranchName } from '../../lib/here-mode.js';

test('@unit deriveBranchSlug: explicit label wins and is slugified', () => {
  const slug = deriveBranchSlug('implement v0.2.n per SPEC_V02N.md, spec is frozen', 'wip salvage stall signal');
  assert.equal(slug, 'wip-salvage-stall-signal');
});

test('@unit deriveBranchSlug: empty/whitespace label falls back to the dream', () => {
  const fromEmpty = deriveBranchSlug('add a blue export button', '');
  const fromSpaces = deriveBranchSlug('add a blue export button', '   ');
  assert.equal(fromEmpty, fromSpaces);
  assert.match(fromEmpty, /export-button/);
});

test('@unit deriveBranchSlug: strips MMD launch boilerplate so the subject survives', () => {
  const dream =
    'implement v0.2.n per SPEC_V02N.md. SPEC IS FROZEN, do NOT edit it. Skip Party Mode, ' +
    'go DIRECTLY to implementation. Deliver: a WIP-uncommitted stall signal in the detector.';
  const slug = deriveBranchSlug(dream);
  // Boilerplate tokens must NOT dominate the slug.
  assert.ok(!slug.includes('frozen'), `slug still contains boilerplate "frozen": ${slug}`);
  assert.ok(!slug.includes('skip-party'), `slug still contains boilerplate "skip-party": ${slug}`);
  assert.ok(!slug.includes('do-not-edit'), `slug still contains boilerplate "do-not-edit": ${slug}`);
  // The actual subject must surface.
  assert.match(slug, /wip-uncommitted|stall-signal/, `slug lost the subject: ${slug}`);
});

test('@unit deriveBranchSlug: boilerplate-only dream falls back to raw slugify (never empty)', () => {
  // A dream that is ENTIRELY boilerplate must still yield a non-empty slug
  // rather than throwing — fall back to the legacy behavior.
  const slug = deriveBranchSlug('implement, spec is frozen, do not edit it');
  assert.ok(typeof slug === 'string' && slug.length > 0, `expected non-empty fallback slug, got: ${JSON.stringify(slug)}`);
});

test('@unit deriveBranchSlug: composes into a readable slice branch name', () => {
  const fixed = 1780216461000;
  const dream =
    'implement v0.2.n per SPEC_V02N.md. SPEC IS FROZEN. Deliver: a WIP-salvage stall signal.';
  const branch = generateSliceBranchName(deriveBranchSlug(dream), () => fixed);
  assert.ok(branch.startsWith('slice/here-'), branch);
  assert.ok(!branch.includes('spec-is-frozen'), `branch leaked boilerplate: ${branch}`);
  assert.ok(branch.endsWith('-1780216461'), branch);
});

test('@unit deriveBranchSlug: non-string dream throws (with no usable label)', () => {
  assert.throws(() => deriveBranchSlug(42), /must be a string/);
  assert.throws(() => deriveBranchSlug(undefined), /must be a string/);
});
