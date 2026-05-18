// @unit tests for lib/skills/_common/redact-env.js
// F1 — Phase-4 adversarial review: dry-run output must not leak credentials.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isSensitiveEnvKey,
  redactSensitiveEnv,
} from '../../lib/skills/_common/redact-env.js';

test('@unit redactSensitiveEnv redacts ANTHROPIC_API_KEY', () => {
  const out = redactSensitiveEnv({ ANTHROPIC_API_KEY: 'sk-ant-abcdef123456' });
  assert.equal(out.ANTHROPIC_API_KEY, '<redacted>');
});

test('@unit redactSensitiveEnv redacts GITHUB_TOKEN (suffix _TOKEN)', () => {
  const out = redactSensitiveEnv({ GITHUB_TOKEN: 'ghp_xxxxx' });
  assert.equal(out.GITHUB_TOKEN, '<redacted>');
});

test('@unit redactSensitiveEnv redacts SOME_PASSWORD (suffix _PASSWORD)', () => {
  const out = redactSensitiveEnv({ SOME_PASSWORD: 'hunter2' });
  assert.equal(out.SOME_PASSWORD, '<redacted>');
});

test('@unit redactSensitiveEnv redacts OPENAI_API_KEY (substring API_KEY)', () => {
  const out = redactSensitiveEnv({ OPENAI_API_KEY: 'sk-openai-...' });
  assert.equal(out.OPENAI_API_KEY, '<redacted>');
});

test('@unit redactSensitiveEnv redacts NPM_TOKEN, FOO_SECRET, BAR_KEY, SUDO_PASS', () => {
  const out = redactSensitiveEnv({
    NPM_TOKEN: 'npm_xxx',
    FOO_SECRET: 's3cret',
    BAR_KEY: 'k3y',
    SUDO_PASS: 'p4ss',
  });
  assert.equal(out.NPM_TOKEN, '<redacted>');
  assert.equal(out.FOO_SECRET, '<redacted>');
  assert.equal(out.BAR_KEY, '<redacted>');
  assert.equal(out.SUDO_PASS, '<redacted>');
});

test('@unit redactSensitiveEnv preserves MMD_GSTACK_SKILLS_DIR, PATH, HOME', () => {
  const out = redactSensitiveEnv({
    MMD_GSTACK_SKILLS_DIR: '/tmp/skills',
    PATH: '/usr/bin:/bin',
    HOME: '/home/user',
  });
  assert.equal(out.MMD_GSTACK_SKILLS_DIR, '/tmp/skills');
  assert.equal(out.PATH, '/usr/bin:/bin');
  assert.equal(out.HOME, '/home/user');
});

test('@unit redactSensitiveEnv is case-insensitive', () => {
  const out = redactSensitiveEnv({
    anthropic_api_key: 'sk-lower',
    Github_Token: 'tok-mixed',
  });
  assert.equal(out.anthropic_api_key, '<redacted>');
  assert.equal(out.Github_Token, '<redacted>');
});

test('@unit redactSensitiveEnv handles empty / null / undefined safely', () => {
  assert.deepEqual(redactSensitiveEnv({}), {});
  assert.deepEqual(redactSensitiveEnv(null), {});
  assert.deepEqual(redactSensitiveEnv(undefined), {});
});

test('@unit redactSensitiveEnv returns a fresh object (no mutation)', () => {
  const input = { ANTHROPIC_API_KEY: 'sk-keep-original', PATH: '/bin' };
  const out = redactSensitiveEnv(input);
  // Original NOT mutated.
  assert.equal(input.ANTHROPIC_API_KEY, 'sk-keep-original');
  assert.notEqual(out, input);
  // Output redacts.
  assert.equal(out.ANTHROPIC_API_KEY, '<redacted>');
});

test('@unit isSensitiveEnvKey true cases', () => {
  for (const k of [
    'ANTHROPIC_API_KEY',
    'GITHUB_TOKEN',
    'SOME_PASSWORD',
    'X_API_KEY',
    'MY_SECRET',
    'CLAUDE_AUTH_TOKEN',
    'SUDO_PASS',
    'SECRETS_BUNDLE',
    'STRIPE_API_KEY_PROD',
  ]) {
    assert.equal(isSensitiveEnvKey(k), true, `expected ${k} to be sensitive`);
  }
});

test('@unit isSensitiveEnvKey false cases', () => {
  for (const k of [
    'PATH',
    'HOME',
    'MMD_GSTACK_SKILLS_DIR',
    'MMD_QUIET',
    'MMD_HEARTBEAT_INTERVAL_MS',
    'CLAUDE_PROJECT_DIR',
    'LANG',
    'TZ',
  ]) {
    assert.equal(isSensitiveEnvKey(k), false, `expected ${k} to NOT be sensitive`);
  }
});

test('@unit isSensitiveEnvKey handles non-strings gracefully', () => {
  assert.equal(isSensitiveEnvKey(''), false);
  assert.equal(isSensitiveEnvKey(null), false);
  assert.equal(isSensitiveEnvKey(undefined), false);
  assert.equal(isSensitiveEnvKey(42), false);
});
