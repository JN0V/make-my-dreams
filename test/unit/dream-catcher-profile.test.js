// @unit tests for lib/dream-catcher/profile.js — SPEC_V03A1 AC-3.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PROFILES,
  DEFAULT_PROFILE,
  normalizeProfile,
  isKid,
  toneHint,
} from '../../lib/dream-catcher/profile.js';

test('@unit canonical enum values normalize to themselves', () => {
  assert.equal(normalizeProfile('Kid'), PROFILES.KID);
  assert.equal(normalizeProfile('Curious'), PROFILES.CURIOUS);
  assert.equal(normalizeProfile('Pro'), PROFILES.PRO);
});

test('@unit French UI labels map to canonical profiles', () => {
  assert.equal(normalizeProfile('Enfant'), PROFILES.KID);
  assert.equal(normalizeProfile('Curieux'), PROFILES.CURIOUS);
  assert.equal(normalizeProfile('Pro'), PROFILES.PRO);
});

test('@unit normalization is case- and whitespace-insensitive', () => {
  assert.equal(normalizeProfile('  ENFANT '), PROFILES.KID);
  assert.equal(normalizeProfile('cUrIoUs'), PROFILES.CURIOUS);
});

test('@unit absent / non-string / unrecognized input defaults to Curious (AC-3)', () => {
  assert.equal(normalizeProfile(undefined), DEFAULT_PROFILE);
  assert.equal(normalizeProfile(null), DEFAULT_PROFILE);
  assert.equal(normalizeProfile(42), DEFAULT_PROFILE);
  assert.equal(normalizeProfile(''), DEFAULT_PROFILE);
  assert.equal(normalizeProfile('hacker'), DEFAULT_PROFILE);
  assert.equal(DEFAULT_PROFILE, PROFILES.CURIOUS);
});

test('@unit isKid is true only for the Kid profile (and its aliases)', () => {
  assert.equal(isKid('Kid'), true);
  assert.equal(isKid('Enfant'), true);
  assert.equal(isKid('Curious'), false);
  assert.equal(isKid('Pro'), false);
  assert.equal(isKid(undefined), false); // defaults to Curious
});

test('@unit toneHint returns a non-empty hint for every profile and the default', () => {
  for (const p of [PROFILES.KID, PROFILES.CURIOUS, PROFILES.PRO]) {
    assert.equal(typeof toneHint(p), 'string');
    assert.ok(toneHint(p).length > 0);
  }
  // Unknown input falls back to the Curious hint, never undefined.
  assert.equal(toneHint('nope'), toneHint(PROFILES.CURIOUS));
});

test('@unit Kid tone hint stays plain/friendly (safe-by-default vocabulary)', () => {
  assert.match(toneHint(PROFILES.KID), /plain|friendly|young/i);
});

test('@unit PROFILES enum is frozen (cannot be mutated by callers)', () => {
  assert.throws(() => {
    'use strict';
    PROFILES.KID = 'mutated';
  }, TypeError);
});
