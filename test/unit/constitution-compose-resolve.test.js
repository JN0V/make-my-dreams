// @unit tests for resolveModules — SPEC_V03C AC-2.
// Pure: defaults.always ∪ profiles[profile], deduped, deterministic order
// (defaults first, then profile additions), unknown/absent profile → defaults
// only, never throws. No fs.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveModules, parseBindings } from '../../lib/constitution-compose.js';

const BINDINGS = {
  defaults: { always: ['universal', 'ai-coding'] },
  profiles: {
    Kid: ['safe-by-default', 'kid'],
    Curious: ['safe-by-default'],
    Pro: ['pro'],
    Custom: [],
  },
};

test('@unit AC-2: Kid → [universal, ai-coding, safe-by-default, kid]', () => {
  assert.deepEqual(
    resolveModules({ profile: 'Kid' }, BINDINGS),
    ['universal', 'ai-coding', 'safe-by-default', 'kid'],
  );
});

test('@unit AC-2: Pro → [universal, ai-coding, pro]', () => {
  assert.deepEqual(
    resolveModules({ profile: 'Pro' }, BINDINGS),
    ['universal', 'ai-coding', 'pro'],
  );
});

test('@unit AC-2: order is deterministic — defaults first, then additions', () => {
  // Even if the profile listed a module already in defaults, defaults keep
  // their leading position and the duplicate is dropped.
  const b = {
    defaults: { always: ['universal', 'ai-coding'] },
    profiles: { X: ['ai-coding', 'extra'] },
  };
  assert.deepEqual(
    resolveModules({ profile: 'X' }, b),
    ['universal', 'ai-coding', 'extra'],
  );
});

test('@unit AC-2: result is deduplicated', () => {
  const b = {
    defaults: { always: ['universal', 'universal'] },
    profiles: { X: ['universal', 'kid', 'kid'] },
  };
  assert.deepEqual(resolveModules({ profile: 'X' }, b), ['universal', 'kid']);
});

test('@unit AC-2: unknown profile → defaults.always only', () => {
  assert.deepEqual(
    resolveModules({ profile: 'Nope' }, BINDINGS),
    ['universal', 'ai-coding'],
  );
});

test('@unit AC-2: absent profile → defaults.always only', () => {
  assert.deepEqual(resolveModules({}, BINDINGS), ['universal', 'ai-coding']);
  assert.deepEqual(resolveModules(undefined, BINDINGS), ['universal', 'ai-coding']);
});

test('@unit AC-2: Custom (empty additions) → defaults only', () => {
  assert.deepEqual(
    resolveModules({ profile: 'Custom' }, BINDINGS),
    ['universal', 'ai-coding'],
  );
});

test('@unit AC-2: never throws on degenerate bindings', () => {
  for (const bad of [undefined, null, {}, { defaults: null }, { profiles: 5 }]) {
    assert.doesNotThrow(() => resolveModules({ profile: 'Kid' }, bad));
  }
  assert.deepEqual(resolveModules({ profile: 'Kid' }, {}), []);
});

test('@unit AC-2: composes with parseBindings end to end', () => {
  const text = `defaults:\n  always: [universal, ai-coding]\nprofiles:\n  Kid: [safe-by-default, kid]\n`;
  const b = parseBindings(text);
  assert.deepEqual(
    resolveModules({ profile: 'Kid' }, b),
    ['universal', 'ai-coding', 'safe-by-default', 'kid'],
  );
});
