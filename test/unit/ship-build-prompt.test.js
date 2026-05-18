// @unit tests for lib/ship/build-prompt.js — SPEC_V02F AC-4 anchors.
//
// Pure function tests — no fs, no spawn, no subprocess. Each case <1ms.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildShipPrompt,
  shipPromptAnchors,
  SHIP_SKILL_PATH,
} from '../../lib/skills/ship/build-prompt.js';

const VALID_OPTS = {
  branch: 'slice/here-add-banner-1779537600',
  baseBranch: 'main',
  sha: 'deadbeef1234567890abcdef0987654321aabbcc',
  repoRoot: '/home/u/repo',
};

test('@unit buildShipPrompt: returns a non-empty string', () => {
  const p = buildShipPrompt(VALID_OPTS);
  assert.equal(typeof p, 'string');
  assert.ok(p.length > 0);
});

test('@unit buildShipPrompt: includes the slice branch verbatim', () => {
  const p = buildShipPrompt(VALID_OPTS);
  assert.ok(p.includes(VALID_OPTS.branch), `prompt must mention branch ${VALID_OPTS.branch}`);
});

test('@unit buildShipPrompt: includes the base branch verbatim', () => {
  const p = buildShipPrompt(VALID_OPTS);
  assert.ok(p.includes(VALID_OPTS.baseBranch), 'prompt must mention baseBranch');
});

test('@unit buildShipPrompt: includes the SHA verbatim', () => {
  const p = buildShipPrompt(VALID_OPTS);
  assert.ok(p.includes(VALID_OPTS.sha), 'prompt must mention the branch tip SHA');
});

test('@unit buildShipPrompt: references the gStack ship skill path', () => {
  const p = buildShipPrompt(VALID_OPTS);
  assert.ok(p.includes(SHIP_SKILL_PATH), `prompt must reference ${SHIP_SKILL_PATH}`);
  // Sanity-check the path matches the canonical install location.
  assert.equal(SHIP_SKILL_PATH, '~/.claude/skills/gstack/ship/SKILL.md');
});

test('@unit buildShipPrompt: declares the invocation is headless (claude -p)', () => {
  const p = buildShipPrompt(VALID_OPTS);
  assert.match(p, /headless|non-interactive|no.*user.*input/i);
});

test('@unit buildShipPrompt: mentions audit-pillars (AC-7 user awareness)', () => {
  const p = buildShipPrompt(VALID_OPTS);
  assert.match(p, /audit-pillars/i);
});

test('@unit buildShipPrompt: includes the repo root', () => {
  const p = buildShipPrompt(VALID_OPTS);
  assert.ok(p.includes(VALID_OPTS.repoRoot), 'prompt must mention repoRoot');
});

test('@unit buildShipPrompt: throws on missing branch', () => {
  assert.throws(() => buildShipPrompt({ ...VALID_OPTS, branch: '' }), TypeError);
  assert.throws(() => buildShipPrompt({ ...VALID_OPTS, branch: undefined }), TypeError);
});

test('@unit buildShipPrompt: throws on missing baseBranch', () => {
  assert.throws(() => buildShipPrompt({ ...VALID_OPTS, baseBranch: '' }), TypeError);
});

test('@unit buildShipPrompt: throws on missing sha', () => {
  assert.throws(() => buildShipPrompt({ ...VALID_OPTS, sha: '' }), TypeError);
});

test('@unit buildShipPrompt: throws on missing repoRoot', () => {
  assert.throws(() => buildShipPrompt({ ...VALID_OPTS, repoRoot: '' }), TypeError);
});

test('@unit buildShipPrompt: throws on non-object opts', () => {
  assert.throws(() => buildShipPrompt(null), TypeError);
  assert.throws(() => buildShipPrompt('string'), TypeError);
});

test('@unit shipPromptAnchors: returns the expected anchor set', () => {
  const anchors = shipPromptAnchors(VALID_OPTS);
  assert.ok(anchors.includes(VALID_OPTS.branch));
  assert.ok(anchors.includes(VALID_OPTS.baseBranch));
  assert.ok(anchors.includes(VALID_OPTS.sha));
  assert.ok(anchors.includes(SHIP_SKILL_PATH));
  assert.ok(anchors.some((a) => /audit-pillars/.test(a)));
});

test('@unit shipPromptAnchors: every anchor is present in the prompt output', () => {
  const prompt = buildShipPrompt(VALID_OPTS);
  const anchors = shipPromptAnchors(VALID_OPTS);
  for (const a of anchors) {
    assert.ok(prompt.includes(a), `prompt missing anchor: ${a}`);
  }
});

test('@unit buildShipPrompt: default tagPrefix is "v"', () => {
  const p = buildShipPrompt(VALID_OPTS);
  // "Tag prefix     : v" should appear.
  assert.match(p, /Tag prefix\s*:\s*v/);
});

test('@unit buildShipPrompt: custom tagPrefix is honored', () => {
  const p = buildShipPrompt({ ...VALID_OPTS, tagPrefix: 'mmd-' });
  assert.match(p, /Tag prefix\s*:\s*mmd-/);
});

test('@unit buildShipPrompt: stable shape — same inputs produce identical output', () => {
  const a = buildShipPrompt(VALID_OPTS);
  const b = buildShipPrompt(VALID_OPTS);
  assert.equal(a, b);
});
