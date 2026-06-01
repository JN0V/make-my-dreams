// @unit tests for lib/sealed-tests/tester-prompt.js — the two pure prompt
// builders of the sealed-test oracle (SPEC_V04A AC-3, AC-4). No fs, no spawn.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTesterPrompt,
  buildCoderPrompt,
  SHARED_MARKER,
} from '../../lib/sealed-tests/tester-prompt.js';

const SEALED = '/tmp/demo/counter/.mmd/shared/sealed-tests';

test('@unit buildTesterPrompt: instructs DERIVE tests + NOT implement, names sealed dir', () => {
  const p = buildTesterPrompt({ dream: 'a counter app with + and − buttons', sealedDir: SEALED });
  // Carries the shared marker (so the fake-claude can branch on it).
  assert.ok(p.includes(SHARED_MARKER), 'tester prompt must carry the shared marker');
  // Derives acceptance tests.
  assert.match(p, /DERIVE ACCEPTANCE TESTS/i);
  // Explicitly forbids implementing the app (the oracle must be blind).
  assert.match(p, /do NOT implement/i);
  assert.match(p, /ZERO production code/i);
  // Names the sealed dir and the verbatim dream.
  assert.ok(p.includes(SEALED));
  assert.ok(p.includes('a counter app with + and − buttons'));
});

test('@unit buildTesterPrompt: includes the slice spec when provided', () => {
  const withSlice = buildTesterPrompt({
    dream: 'a counter app',
    slice: '## Acceptance\n- pressing + increments the displayed count',
    sealedDir: SEALED,
  });
  assert.match(withSlice, /pressing \+ increments the displayed count/);

  const withoutSlice = buildTesterPrompt({ dream: 'a counter app', sealedDir: SEALED });
  assert.ok(!withoutSlice.includes('Slice spec'), 'no slice section when slice absent');
});

test('@unit buildTesterPrompt: throws on empty dream or missing sealedDir', () => {
  assert.throws(() => buildTesterPrompt({ dream: '   ', sealedDir: SEALED }), /non-empty dream/);
  assert.throws(() => buildTesterPrompt({ dream: 'x', sealedDir: '' }), /sealedDir/);
});

test('@unit buildCoderPrompt: states the sealed dir is READ-ONLY and tamper = fail', () => {
  const p = buildCoderPrompt({
    dream: 'a counter app',
    slug: 'counter-app',
    demoDir: '/tmp/demo/counter',
    sealedDir: SEALED,
  });
  // Reuses the greenfield base body (DRY): the stack constraint is present.
  assert.match(p, /vanilla HTML\/CSS\/JS/);
  // The read-only sealed contract is appended and names the dir.
  assert.ok(p.includes(SHARED_MARKER));
  assert.match(p, /READ-ONLY/);
  assert.ok(p.includes(SEALED));
  assert.match(p, /MUST NOT edit, weaken, rename, move, or delete/i);
  assert.match(p, /TAMPER/);
  // It tells the coder to implement the APP, not the tests.
  assert.match(p, /implementing the APPLICATION/i);
});

test('@unit buildCoderPrompt: throws on missing sealedDir', () => {
  assert.throws(
    () => buildCoderPrompt({ dream: 'x', slug: 'x', demoDir: '/d', sealedDir: '' }),
    /sealedDir/,
  );
});
