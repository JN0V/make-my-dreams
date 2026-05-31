// test/unit/handover-argv.test.js — parseHandoverArgs unit tests (SPEC_V02P AC-1).
// Pure parser: no spawn, no fs. Tagged @unit per testing.md §V.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseHandoverArgs, SUBCOMMANDS } from '../../lib/argv-parser.js';

test('@unit handover is a registered subcommand', () => {
  assert.ok(SUBCOMMANDS.includes('handover'));
});

test('@unit parseHandoverArgs: bare invocation has sane defaults', () => {
  const r = parseHandoverArgs([]);
  assert.equal(r.error, null);
  assert.equal(r.tests, null);
  assert.equal(r.dryRun, false);
  assert.equal(r.help, false);
});

test('@unit parseHandoverArgs: --tests parses a non-negative integer', () => {
  const r = parseHandoverArgs(['--tests', '1055']);
  assert.equal(r.error, null);
  assert.equal(r.tests, 1055);
});

test('@unit parseHandoverArgs: --tests 0 is valid', () => {
  const r = parseHandoverArgs(['--tests', '0']);
  assert.equal(r.error, null);
  assert.equal(r.tests, 0);
});

test('@unit parseHandoverArgs: --dry-run and --help booleans', () => {
  const r = parseHandoverArgs(['--dry-run']);
  assert.equal(r.dryRun, true);
  assert.equal(parseHandoverArgs(['--help']).help, true);
  assert.equal(parseHandoverArgs(['-h']).help, true);
});

test('@unit parseHandoverArgs: --tests with a non-integer → exit 2', () => {
  for (const bad of ['abc', '1.5', '-3', '10x']) {
    const r = parseHandoverArgs(['--tests', bad]);
    assert.ok(r.error, `expected error for --tests ${bad}`);
    assert.equal(r.error.exitCode, 2);
  }
});

test('@unit parseHandoverArgs: --tests with a missing value → exit 2', () => {
  const r = parseHandoverArgs(['--tests']);
  assert.ok(r.error);
  assert.equal(r.error.exitCode, 2);
  const r2 = parseHandoverArgs(['--tests', '--dry-run']);
  assert.ok(r2.error);
  assert.equal(r2.error.exitCode, 2);
});

test('@unit parseHandoverArgs: unknown flag → exit 2 with a hint', () => {
  const r = parseHandoverArgs(['--bogus']);
  assert.ok(r.error);
  assert.equal(r.error.exitCode, 2);
  assert.match(r.error.message, /--help/);
});

test('@unit parseHandoverArgs: a positional is rejected (handover takes none)', () => {
  const r = parseHandoverArgs(['somebranch']);
  assert.ok(r.error);
  assert.equal(r.error.exitCode, 2);
});
