// @unit regression lock for SPEC_V011A AC-2: "the auto-dev spawn args are
// UNCHANGED by this slice". The alignment gate is a POST-completion step — it
// must NEVER alter how auto-dev is launched (the bootstrap / --monitor
// byte-for-byte contract that builds MMD itself). This pins buildAutodevArgs to
// its exact historical output, mirroring the v0.5.b monitor-spawn regression
// lock; if the gate ever leaks into the spawn, these break.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildAutodevArgs } from '../../lib/invoke-autodev.js';

test('@unit AC-2: default CLI auto-dev args are byte-for-byte unchanged (no --output-format, no gate flag)', () => {
  const args = buildAutodevArgs({ isClaudeCli: true, prompt: 'BODY', dream: 'd' });
  assert.deepEqual(args, ['-p', '/bmad-adv-auto-dev BODY']);
  // The alignment gate adds NOTHING to the spawn.
  assert.ok(!args.some((a) => /align|judge|MMD_SKIP_ALIGN|MMD_ALIGN/.test(a)),
    'no alignment-gate token may leak into the auto-dev spawn args');
  assert.ok(!args.includes('--output-format'));
});

test('@unit AC-2: monitor CLI auto-dev args are byte-for-byte unchanged', () => {
  const args = buildAutodevArgs({ isClaudeCli: true, prompt: 'BODY', dream: 'd', monitor: true });
  assert.deepEqual(args, ['-p', '/bmad-adv-auto-dev BODY', '--output-format', 'stream-json', '--verbose']);
});

test('@unit AC-2: test-fixture auto-dev args remain [dream] in both modes', () => {
  assert.deepEqual(buildAutodevArgs({ isClaudeCli: false, prompt: 'BODY', dream: 'd' }), ['d']);
  assert.deepEqual(buildAutodevArgs({ isClaudeCli: false, prompt: 'BODY', dream: 'd', monitor: true }), ['d']);
});
