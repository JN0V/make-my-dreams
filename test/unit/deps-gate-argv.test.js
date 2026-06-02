// test/unit/deps-gate-argv.test.js — AC-3 @unit for the deps-gate argv parser +
// env-threshold resolver (SPEC_V09B). Mirrors the secret-scan argv tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseDepsGateArgs, resolveNumber } from '../../bin/security/deps-gate.js';
import { SUBCOMMANDS } from '../../lib/argv-parser.js';

test('@unit deps-gate is a registered subcommand', () => {
  assert.ok(SUBCOMMANDS.includes('deps-gate'));
});

test('@unit parseDepsGateArgs: bare → no since, no help, no error', () => {
  assert.deepEqual(parseDepsGateArgs([]), { since: null, help: false, error: null });
});

test('@unit parseDepsGateArgs: --since <ref> captures the ref', () => {
  const p = parseDepsGateArgs(['--since', 'HEAD']);
  assert.equal(p.since, 'HEAD');
  assert.equal(p.error, null);
});

test('@unit parseDepsGateArgs: --since with no value → exit 2', () => {
  const p = parseDepsGateArgs(['--since']);
  assert.equal(p.error.exitCode, 2);
  assert.match(p.error.message, /--since requires/);
});

test('@unit parseDepsGateArgs: --since followed by another flag → exit 2', () => {
  const p = parseDepsGateArgs(['--since', '--help']);
  assert.equal(p.error.exitCode, 2);
});

test('@unit parseDepsGateArgs: --help / -h set help', () => {
  assert.equal(parseDepsGateArgs(['--help']).help, true);
  assert.equal(parseDepsGateArgs(['-h']).help, true);
});

test('@unit parseDepsGateArgs: unknown flag → exit 2', () => {
  const p = parseDepsGateArgs(['--nope']);
  assert.equal(p.error.exitCode, 2);
  assert.match(p.error.message, /unknown deps-gate arg/);
});

test('@unit parseDepsGateArgs: non-array → exit 2 (never throws)', () => {
  const p = parseDepsGateArgs('not-an-array');
  assert.equal(p.error.exitCode, 2);
});

test('@unit resolveNumber: valid override wins; junk / out-of-range falls back honestly', () => {
  assert.deepEqual(resolveNumber('3', 2, { min: 0, max: 10 }), { value: 3, ignored: false });
  assert.deepEqual(resolveNumber('', 2), { value: 2, ignored: false });
  assert.deepEqual(resolveNumber(undefined, 2), { value: 2, ignored: false });
  assert.deepEqual(resolveNumber('nope', 2, { min: 0, max: 10 }), { value: 2, ignored: true });
  assert.deepEqual(resolveNumber('999', 2, { min: 0, max: 10 }), { value: 2, ignored: true });
});
