// @unit regression lock for SPEC_V013A AC-4: "WITHOUT --auto-handoff the spawn
// args + single-spawn flow MUST be byte-for-byte today's." The cooperative
// auto-handoff loop is a POST-spawn wrapper that runs ONLY under --auto-handoff;
// it must NEVER alter how auto-dev is launched (the bootstrap / --monitor
// byte-for-byte contract that builds MMD itself). This pins buildAutodevArgs +
// asserts the new --auto-handoff flag parses without leaking into the argv of a
// non-flag run. Mirrors the v0.5.b / v0.11 spawn-pin locks.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildAutodevArgs } from '../../lib/invoke-autodev.js';
import { parseArgv, HANDOFF_FLAGS, KNOWN_FLAGS } from '../../lib/argv-parser.js';

test('@unit AC-4: default CLI auto-dev args are byte-for-byte unchanged (no handoff token)', () => {
  const args = buildAutodevArgs({ isClaudeCli: true, prompt: 'BODY', dream: 'd' });
  assert.deepEqual(args, ['-p', '/bmad-adv-auto-dev BODY']);
  assert.ok(!args.some((a) => /handoff|auto-handoff|MMD_MAX_HANDOFFS/i.test(a)),
    'no auto-handoff token may leak into the auto-dev spawn args');
  assert.ok(!args.includes('--output-format'));
});

test('@unit AC-4: monitor CLI auto-dev args are unchanged (handoff implies monitor, adds nothing more)', () => {
  // --auto-handoff implies --monitor; the resulting spawn is the EXISTING monitor
  // spawn (stream-json), with NO extra handoff-specific argv. The loop is driven
  // by the marker + checkpoint files, never by a new spawn flag.
  const args = buildAutodevArgs({ isClaudeCli: true, prompt: 'BODY', dream: 'd', monitor: true });
  assert.deepEqual(args, ['-p', '/bmad-adv-auto-dev BODY', '--output-format', 'stream-json', '--verbose']);
});

test('@unit AC-4: --auto-handoff is a known boolean flag, default false', () => {
  assert.ok(KNOWN_FLAGS.includes('auto-handoff'), 'auto-handoff is a known flag');
  assert.deepEqual(HANDOFF_FLAGS, ['auto-handoff']);
  const { flags, error } = parseArgv(['--here', 'do a thing']);
  assert.equal(error, null);
  assert.equal(flags['auto-handoff'], false, 'default false when the flag is absent');
});

test('@unit AC-4: --auto-handoff parses to true and composes with --here (no mutex)', () => {
  const { flags, positional, error } = parseArgv(['--here', '--auto-handoff', 'a long change']);
  assert.equal(error, null);
  assert.equal(flags['auto-handoff'], true);
  assert.equal(flags.here, true);
  assert.deepEqual(positional, ['a long change']);
  // It does NOT itself set monitor at the parse layer — the implication is
  // resolved in bin/mmd.js (kept out of the pure parser).
  assert.equal(flags.monitor, false, 'the parser leaves monitor false; the implication is resolved downstream');
});

test('@unit AC-4: --auto-handoff composes with --monitor (redundant but not an error)', () => {
  const { flags, error } = parseArgv(['--here', '--monitor', '--auto-handoff', 'x']);
  assert.equal(error, null);
  assert.equal(flags['auto-handoff'], true);
  assert.equal(flags.monitor, true);
});
