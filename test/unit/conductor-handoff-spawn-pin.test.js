// @unit regression lock for the handoff loop's spawn contract. The hybrid
// auto-handoff loop is a POST-spawn wrapper driven by the marker + checkpoint
// files, never by a new spawn flag — so it must add NO handoff-specific argv.
// v0.15.a (SPEC_V015A) made the monitored spawn the DEFAULT (transparent
// Conductor), so the pin is INVERTED: the default now carries the monitor
// (stream-json), and the opt-out (monitor:false, resolved from
// MMD_NO_AUTO_HANDOFF=1) is the historical shape. Either way: no handoff token.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildAutodevArgs } from '../../lib/invoke-autodev.js';
import { parseArgv, HANDOFF_FLAGS, KNOWN_FLAGS } from '../../lib/argv-parser.js';

test('@unit AC-4: default CLI auto-dev args carry the monitor but NO handoff token', () => {
  const args = buildAutodevArgs({ isClaudeCli: true, prompt: 'BODY', dream: 'd' });
  assert.deepEqual(args, ['-p', '/bmad-adv-auto-dev BODY', '--output-format', 'stream-json', '--verbose']);
  assert.ok(!args.some((a) => /handoff|auto-handoff|MMD_MAX_HANDOFFS/i.test(a)),
    'no auto-handoff token may leak into the auto-dev spawn args');
});

test('@unit AC-4: opt-out (monitor:false) CLI args are byte-for-byte the historical shape', () => {
  // MMD_NO_AUTO_HANDOFF=1 resolves monitor:false → the pre-v0.15 text spawn, with
  // NO --output-format and NO handoff-specific argv (the loop never runs).
  const args = buildAutodevArgs({ isClaudeCli: true, prompt: 'BODY', dream: 'd', monitor: false });
  assert.deepEqual(args, ['-p', '/bmad-adv-auto-dev BODY']);
  assert.ok(!args.includes('--output-format'));
  assert.ok(!args.some((a) => /handoff|auto-handoff|MMD_MAX_HANDOFFS/i.test(a)));
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
