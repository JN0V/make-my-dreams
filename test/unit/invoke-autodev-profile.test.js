// @unit tests for the v0.3.b profile threading in lib/invoke-autodev.js —
// SPEC_V03B AC-4 (MMD_PROFILE survives the env allowlist) and AC-5 (buildPrompt
// consumes MMD_PROFILE: states the profile, injects Kid safe-by-default, and
// leaves the prompt unchanged when unset). Pure: no spawn, no real claude.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildPrompt, buildSubprocessEnv } from '../../lib/invoke-autodev.js';

// ── AC-4: MMD_PROFILE reaches the subprocess via the MMD_ prefix allowlist ──

test('@unit AC-4: buildSubprocessEnv keeps MMD_PROFILE (MMD_ prefix allowlist)', () => {
  const out = buildSubprocessEnv({ MMD_PROFILE: 'Kid', PATH: '/usr/bin' });
  assert.equal(out.MMD_PROFILE, 'Kid');
});

test('@unit AC-4: MMD_PROFILE survives alongside stripped secrets', () => {
  const out = buildSubprocessEnv({
    MMD_PROFILE: 'Pro',
    AWS_SECRET_ACCESS_KEY: 'shh',
    GITHUB_TOKEN: 'ghp_x',
    HOME: '/home/x',
  });
  assert.equal(out.MMD_PROFILE, 'Pro');
  assert.equal(out.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(out.GITHUB_TOKEN, undefined);
  assert.equal(out.HOME, '/home/x');
});

// ── AC-5: buildPrompt consumes MMD_PROFILE ──

const base = { dream: 'une appli pour dessiner', slug: 'appli-dessiner', demoDir: '/tmp/demo/x' };

test('@unit AC-5: unset MMD_PROFILE leaves the prompt unchanged (back-compat)', () => {
  const without = buildPrompt({ ...base, env: {} });
  assert.doesNotMatch(without, /Audience profile/);
  assert.doesNotMatch(without, /safe-by-default/i);
});

test('@unit AC-5: a set profile is stated in the prompt', () => {
  const p = buildPrompt({ ...base, env: { MMD_PROFILE: 'Curious' } });
  assert.match(p, /Audience profile: Curious\./);
  // Non-Kid profiles do NOT carry the Kid constraints.
  assert.doesNotMatch(p, /safe-by-default/i);
});

test('@unit AC-5: Kid profile injects the safe-by-default directive', () => {
  const p = buildPrompt({ ...base, env: { MMD_PROFILE: 'Kid' } });
  assert.match(p, /Audience profile: Kid\./);
  assert.match(p, /safe-by-default/i);
  assert.match(p, /offline/i);
  assert.match(p, /third-party/i);
  assert.match(p, /accounts|sign-up|user-generated/i);
});

test('@unit AC-5: Pro profile states the profile without Kid constraints', () => {
  const p = buildPrompt({ ...base, env: { MMD_PROFILE: 'Pro' } });
  assert.match(p, /Audience profile: Pro\./);
  assert.doesNotMatch(p, /safe-by-default/i);
});

test('@unit AC-5: profile value is normalized (alias "enfant" → Kid framing)', () => {
  const p = buildPrompt({ ...base, env: { MMD_PROFILE: 'enfant' } });
  assert.match(p, /Audience profile: Kid\./);
  assert.match(p, /safe-by-default/i);
});

test('@unit AC-5: empty/whitespace MMD_PROFILE is treated as unset', () => {
  const p = buildPrompt({ ...base, env: { MMD_PROFILE: '   ' } });
  assert.doesNotMatch(p, /Audience profile/);
});

test('@unit AC-5: a custom prompt (--here) short-circuits, profile NOT injected', () => {
  const p = buildPrompt({ ...base, prompt: 'CUSTOM HERE PROMPT', env: { MMD_PROFILE: 'Kid' } });
  assert.equal(p, 'CUSTOM HERE PROMPT');
  assert.doesNotMatch(p, /Audience profile/);
});

test('@unit AC-5: profile block composes with the FAST engine block', () => {
  const p = buildPrompt({ ...base, engine: 'fast', env: { MMD_PROFILE: 'Kid' } });
  assert.match(p, /Engine: FAST/);
  assert.match(p, /Audience profile: Kid\./);
  assert.match(p, /safe-by-default/i);
});
