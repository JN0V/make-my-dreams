// @unit regression lock for SPEC_V011A AC-2: "the alignment gate adds NOTHING to
// the auto-dev spawn". The alignment gate is a POST-completion step — it must
// NEVER alter how auto-dev is launched. v0.15.a (SPEC_V015A) flipped the spawn
// DEFAULT to monitored (transparent Conductor), so the pin is INVERTED: the
// default now INCLUDES --output-format stream-json --verbose, and the opt-out
// (monitor:false, resolved from MMD_NO_AUTO_HANDOFF=1) is the historical shape.
// Either way, NO alignment-gate token may leak into the args.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildAutodevArgs } from '../../lib/invoke-autodev.js';

test('@unit AC-2: default CLI auto-dev args carry the monitor (transparent Conductor) but no gate token', () => {
  const args = buildAutodevArgs({ isClaudeCli: true, prompt: 'BODY', dream: 'd' });
  assert.deepEqual(args, ['-p', '/bmad-adv-auto-dev BODY', '--output-format', 'stream-json', '--verbose']);
  // The alignment gate adds NOTHING to the spawn.
  assert.ok(!args.some((a) => /align|judge|MMD_SKIP_ALIGN|MMD_ALIGN/.test(a)),
    'no alignment-gate token may leak into the auto-dev spawn args');
});

test('@unit AC-2: opt-out (monitor:false) CLI args are byte-for-byte the historical shape', () => {
  const args = buildAutodevArgs({ isClaudeCli: true, prompt: 'BODY', dream: 'd', monitor: false });
  assert.deepEqual(args, ['-p', '/bmad-adv-auto-dev BODY']);
  assert.ok(!args.includes('--output-format'));
});

test('@unit AC-2: test-fixture auto-dev args remain [dream] in both modes', () => {
  assert.deepEqual(buildAutodevArgs({ isClaudeCli: false, prompt: 'BODY', dream: 'd' }), ['d']);
  assert.deepEqual(buildAutodevArgs({ isClaudeCli: false, prompt: 'BODY', dream: 'd', monitor: true }), ['d']);
});
