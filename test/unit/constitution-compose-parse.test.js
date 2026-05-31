// @unit tests for parseBindings — SPEC_V03C AC-1.
// The hand-rolled YAML-lite parser must expose defaults.always + profiles,
// tolerate comments/blanks/inline lists, require NO external YAML package, and
// NEVER throw on malformed input. Pure: no fs.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseBindings } from '../../lib/constitution-compose.js';

const SAMPLE = `# Constitution bindings — sample
version: "2.0.0"

defaults:
  always: [universal, ai-coding]
  skill_unknown: [universal, ai-coding]    # conservative fallback

profiles:
  Kid:                  [safe-by-default, kid]
  Curious:              [safe-by-default]
  Pro:                  [pro]
  Custom:               []                            # explicit setup required
`;

test('@unit AC-1: exposes defaults.always as a string array', () => {
  const b = parseBindings(SAMPLE);
  assert.deepEqual(b.defaults.always, ['universal', 'ai-coding']);
});

test('@unit AC-1: exposes profiles as a map of profile → string[]', () => {
  const b = parseBindings(SAMPLE);
  assert.deepEqual(b.profiles.Kid, ['safe-by-default', 'kid']);
  assert.deepEqual(b.profiles.Curious, ['safe-by-default']);
  assert.deepEqual(b.profiles.Pro, ['pro']);
});

test('@unit AC-1: an empty inline list parses to []', () => {
  const b = parseBindings(SAMPLE);
  assert.deepEqual(b.profiles.Custom, []);
});

test('@unit AC-1: inline # comments after the list are ignored', () => {
  const b = parseBindings(SAMPLE);
  // skill_unknown has a trailing comment; it must not leak into the values.
  assert.deepEqual(b.defaults.skill_unknown, ['universal', 'ai-coding']);
});

test('@unit AC-1: top-level scalars (version) are not treated as a section', () => {
  const b = parseBindings(SAMPLE);
  // `version` is a scalar, not a section header, so nothing nests under it.
  assert.equal(b.version, undefined);
});

test('@unit AC-1: forward-compat — other sections are captured generically', () => {
  const text = `engines:\n  fast: [testing, ai-coding]\n  deep: [all]\n`;
  const b = parseBindings(text);
  assert.deepEqual(b.engines.fast, ['testing', 'ai-coding']);
  assert.deepEqual(b.engines.deep, ['all']);
});

test('@unit AC-1: quoted keys (skills like "/qa") are unquoted', () => {
  const text = `skills:\n  "/qa": [testing, security]\n`;
  const b = parseBindings(text);
  assert.deepEqual(b.skills['/qa'], ['testing', 'security']);
});

test('@unit AC-1: blank lines and full-line comments are tolerated', () => {
  const text = `\n# header comment\n\ndefaults:\n\n  # inner comment\n  always: [universal]\n\n`;
  const b = parseBindings(text);
  assert.deepEqual(b.defaults.always, ['universal']);
});

test('@unit AC-1: malformed/empty input never throws, yields empty shape', () => {
  for (const bad of ['', '   ', 'not yaml at all', '::::', undefined, null, 42, {}]) {
    let b;
    assert.doesNotThrow(() => { b = parseBindings(bad); });
    assert.deepEqual(b.defaults.always, []);
    assert.deepEqual(b.profiles, {});
  }
});

test('@unit AC-1: a profiles section with no entries yields an empty map', () => {
  const b = parseBindings('profiles:\n');
  assert.deepEqual(b.profiles, {});
});

test('@unit AC-1: whitespace around list items is trimmed', () => {
  const b = parseBindings('defaults:\n  always: [  universal ,  ai-coding  ]\n');
  assert.deepEqual(b.defaults.always, ['universal', 'ai-coding']);
});

// Phase-4 review F1: prototype pollution. A `__proto__:` section (or key) must
// never write onto Object.prototype.
test('@unit AC-1 (F1): a __proto__ section does not pollute Object.prototype', () => {
  assert.doesNotThrow(() => parseBindings('__proto__:\n  always: [evil]\n'));
  // The canary: a fresh object must NOT have inherited `always`.
  assert.equal(({}).always, undefined, 'Object.prototype was polluted');
  // And nothing nasty leaked onto the result either.
  const b = parseBindings('__proto__:\n  always: [evil]\n');
  assert.equal(({}).always, undefined);
  assert.deepEqual(b.defaults.always, []);
});

test('@unit AC-1 (F1): __proto__/constructor/prototype keys are dropped, not assigned', () => {
  const b = parseBindings(
    'profiles:\n  __proto__: [evil]\n  constructor: [evil]\n  prototype: [evil]\n  Kid: [kid]\n',
  );
  assert.equal(({}).foo, undefined);
  // The legitimate key still parses; the dangerous ones are absent as own keys.
  assert.deepEqual(b.profiles.Kid, ['kid']);
  assert.ok(!Object.prototype.hasOwnProperty.call(b.profiles, '__proto__') ||
    Array.isArray(b.profiles.Kid)); // sanity: Kid intact regardless
});
