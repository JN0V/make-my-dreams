// @unit tests for lib/onboarding/cheatsheet.js — SPEC_V06A AC-4.
// buildOnboardingCheatsheet() is a pure string builder covering the non-evident
// operational rules, each code paired with a plain-language line (universal §VII).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildOnboardingCheatsheet } from '../../lib/onboarding/cheatsheet.js';

test('@unit cheatsheet: returns a non-trivial multi-line string', () => {
  const s = buildOnboardingCheatsheet();
  assert.equal(typeof s, 'string');
  assert.ok(s.split('\n').length >= 8, 'expected a multi-line cheat-sheet');
});

test('@unit cheatsheet: covers every required operational rule', () => {
  const s = buildOnboardingCheatsheet();
  for (const token of ['MMD_TIMEOUT_MS=0', '--sealed', '--monitor', 'MMD_NOTIFY_URL']) {
    assert.ok(s.includes(token), `cheat-sheet missing ${token}`);
  }
  // The frozen-spec dream directive and the commit-per-AC cadence (worded, not coded).
  assert.match(s, /FROZEN/i);
  assert.match(s, /directly to\s+implementation/i);
  assert.match(s, /commit/i);
});

test('@unit cheatsheet: every code/flag is paired with explanatory prose (universal §VII)', () => {
  const s = buildOnboardingCheatsheet();
  // Each switch line carries an em-dash / dash explanation, not a bare token.
  for (const token of ['MMD_TIMEOUT_MS=0', '--sealed', '--monitor', 'MMD_NOTIFY_URL']) {
    const line = s.split('\n').find((l) => l.includes(token));
    assert.ok(line, `no line for ${token}`);
    assert.match(line, /—|--?\s|-\s/, `line for ${token} has no plain-language explanation: ${line}`);
  }
});

test('@unit cheatsheet: pure — identical output across calls, no side effects', () => {
  assert.equal(buildOnboardingCheatsheet(), buildOnboardingCheatsheet());
});
