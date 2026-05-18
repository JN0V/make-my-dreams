// @unit tests for lib/skills/cso/build-prompt.js — SPEC_V02G AC-3.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCsoPrompt,
  csoPromptAnchors,
  CSO_SKILL_PATH,
} from '../../lib/skills/cso/build-prompt.js';

const VALID_OPTS = {
  branch: 'slice/test-cso-1779999999',
  baseBranch: 'main',
  sha: 'cafebabe1234567890abcdef',
  repoRoot: '/tmp/repo',
};

test('@unit buildCsoPrompt: includes the slice branch verbatim', () => {
  const p = buildCsoPrompt(VALID_OPTS);
  assert.ok(p.includes(VALID_OPTS.branch));
});

test('@unit buildCsoPrompt: references the gStack cso skill path', () => {
  const p = buildCsoPrompt(VALID_OPTS);
  assert.ok(p.includes(CSO_SKILL_PATH));
  assert.match(CSO_SKILL_PATH, /cso\/SKILL\.md$/);
});

test('@unit buildCsoPrompt: mentions Bundle A security audit categories', () => {
  const p = buildCsoPrompt(VALID_OPTS);
  // The skill performs: secret scan, dep audit, lethal trifecta, sandbox.
  assert.match(p, /secret/i, 'prompt must mention secret scanning');
  assert.match(p, /dependency|dep audit/i, 'prompt must mention dependency audit');
  assert.match(p, /lethal\s+trifecta/i, 'prompt must mention lethal trifecta');
  assert.match(p, /sandbox|settings\.json/i, 'prompt must mention sandbox config');
});

test('@unit buildCsoPrompt: declares headless invocation', () => {
  const p = buildCsoPrompt(VALID_OPTS);
  assert.match(p, /headless|non-interactive/i);
});

test('@unit buildCsoPrompt: declares read-only / advisory constraint', () => {
  const p = buildCsoPrompt(VALID_OPTS);
  assert.match(p, /read-only|advisory|NEVER\s+modify/i);
});

test('@unit buildCsoPrompt: throws on missing required fields', () => {
  assert.throws(() => buildCsoPrompt({ ...VALID_OPTS, branch: '' }), TypeError);
  assert.throws(() => buildCsoPrompt({ ...VALID_OPTS, sha: '' }), TypeError);
  assert.throws(() => buildCsoPrompt(null), TypeError);
});

test('@unit csoPromptAnchors: every anchor present in the prompt', () => {
  const prompt = buildCsoPrompt(VALID_OPTS);
  for (const a of csoPromptAnchors(VALID_OPTS)) {
    assert.ok(prompt.includes(a), `prompt missing anchor: ${a}`);
  }
});

test('@unit buildCsoPrompt: stable shape', () => {
  assert.equal(buildCsoPrompt(VALID_OPTS), buildCsoPrompt(VALID_OPTS));
});
