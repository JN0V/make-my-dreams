// @unit tests for lib/skills/qa/build-prompt.js — SPEC_V02G AC-2.
//
// Pure-function tests — no fs, no spawn. Asserts the prompt contains the
// branch/base/sha verbatim, references the gStack qa SKILL.md path, and
// declares the invocation is headless.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildQaPrompt,
  qaPromptAnchors,
  QA_SKILL_PATH,
} from '../../lib/skills/qa/build-prompt.js';

const VALID_OPTS = {
  branch: 'slice/test-qa-1779999999',
  baseBranch: 'main',
  sha: 'deadbeef1234567890abcdef',
  repoRoot: '/tmp/repo',
};

test('@unit buildQaPrompt: returns a non-empty string', () => {
  const p = buildQaPrompt(VALID_OPTS);
  assert.equal(typeof p, 'string');
  assert.ok(p.length > 0);
});

test('@unit buildQaPrompt: includes the slice branch verbatim', () => {
  const p = buildQaPrompt(VALID_OPTS);
  assert.ok(p.includes(VALID_OPTS.branch), `prompt must mention ${VALID_OPTS.branch}`);
});

test('@unit buildQaPrompt: includes the base branch', () => {
  const p = buildQaPrompt(VALID_OPTS);
  assert.ok(p.includes(VALID_OPTS.baseBranch));
});

test('@unit buildQaPrompt: includes the SHA', () => {
  const p = buildQaPrompt(VALID_OPTS);
  assert.ok(p.includes(VALID_OPTS.sha));
});

test('@unit buildQaPrompt: references the gStack qa skill path', () => {
  const p = buildQaPrompt(VALID_OPTS);
  assert.ok(p.includes(QA_SKILL_PATH), `prompt must reference ${QA_SKILL_PATH}`);
  // When MMD_GSTACK_SKILLS_DIR is unset, the canonical tilde-form is used.
  // L-007 (anti-fragility): assert against the SAME source the production
  // code uses (the exported constant), not a hardcoded literal.
  assert.match(QA_SKILL_PATH, /qa\/SKILL\.md$/);
});

test('@unit buildQaPrompt: declares the invocation is headless', () => {
  const p = buildQaPrompt(VALID_OPTS);
  assert.match(p, /headless|non-interactive/i);
});

test('@unit buildQaPrompt: includes the repo root', () => {
  const p = buildQaPrompt(VALID_OPTS);
  assert.ok(p.includes(VALID_OPTS.repoRoot));
});

test('@unit buildQaPrompt: mentions test stratification', () => {
  const p = buildQaPrompt(VALID_OPTS);
  assert.match(p, /@smoke|@unit|@integration|@e2e|stratif/i);
});

test('@unit buildQaPrompt: declares the read-only / advisory constraint', () => {
  const p = buildQaPrompt(VALID_OPTS);
  assert.match(p, /read-only|advisory|NEVER\s+modify|NEVER\s+push/i);
});

test('@unit buildQaPrompt: throws on missing branch', () => {
  assert.throws(() => buildQaPrompt({ ...VALID_OPTS, branch: '' }), TypeError);
});

test('@unit buildQaPrompt: throws on missing baseBranch', () => {
  assert.throws(() => buildQaPrompt({ ...VALID_OPTS, baseBranch: '' }), TypeError);
});

test('@unit buildQaPrompt: throws on missing sha', () => {
  assert.throws(() => buildQaPrompt({ ...VALID_OPTS, sha: '' }), TypeError);
});

test('@unit buildQaPrompt: throws on non-object opts', () => {
  assert.throws(() => buildQaPrompt(null), TypeError);
});

test('@unit qaPromptAnchors: every anchor is present in the prompt', () => {
  const prompt = buildQaPrompt(VALID_OPTS);
  for (const a of qaPromptAnchors(VALID_OPTS)) {
    assert.ok(prompt.includes(a), `prompt missing anchor: ${a}`);
  }
});

test('@unit buildQaPrompt: stable shape — same inputs produce identical output', () => {
  assert.equal(buildQaPrompt(VALID_OPTS), buildQaPrompt(VALID_OPTS));
});

test('@unit buildQaPrompt: respects MMD_GSTACK_SKILLS_DIR via module-load (smoke)', async () => {
  // Module-load read of MMD_GSTACK_SKILLS_DIR: simulate the env override by
  // dynamically re-importing with the env var set. The cache-bust URL is
  // required since the module is already cached from prior imports.
  process.env.MMD_GSTACK_SKILLS_DIR = '/tmp/fake-skills-root';
  try {
    const mod = await import(`../../lib/skills/qa/build-prompt.js?override=${Date.now()}`);
    assert.match(
      mod.QA_SKILL_PATH,
      /^\/tmp\/fake-skills-root\/qa\/SKILL\.md$/,
      `expected override to take effect; got: ${mod.QA_SKILL_PATH}`,
    );
  } finally {
    delete process.env.MMD_GSTACK_SKILLS_DIR;
  }
});
