// test/unit/document-readme-argv.test.js — parseDocumentReadmeArgs unit tests
// (SPEC_V03D AC-1). Pure parser: no spawn, no fs. Tagged @unit per testing.md §V.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseDocumentReadmeArgs, SUBCOMMANDS } from '../../lib/argv-parser.js';

test('@unit document-readme is a registered subcommand', () => {
  assert.ok(SUBCOMMANDS.includes('document-readme'));
});

test('@unit parseDocumentReadmeArgs: bare invocation has sane defaults', () => {
  const r = parseDocumentReadmeArgs([]);
  assert.equal(r.error, null);
  assert.equal(r.tests, null);
  assert.equal(r.dryRun, false);
  assert.equal(r.help, false);
});

test('@unit parseDocumentReadmeArgs: --tests parses a non-negative integer', () => {
  const r = parseDocumentReadmeArgs(['--tests', '1268']);
  assert.equal(r.error, null);
  assert.equal(r.tests, 1268);
});

test('@unit parseDocumentReadmeArgs: --tests 0 is valid', () => {
  const r = parseDocumentReadmeArgs(['--tests', '0']);
  assert.equal(r.error, null);
  assert.equal(r.tests, 0);
});

test('@unit parseDocumentReadmeArgs: --dry-run and --help booleans', () => {
  assert.equal(parseDocumentReadmeArgs(['--dry-run']).dryRun, true);
  assert.equal(parseDocumentReadmeArgs(['--help']).help, true);
  assert.equal(parseDocumentReadmeArgs(['-h']).help, true);
});

test('@unit parseDocumentReadmeArgs: --tests with a non-integer → exit 2', () => {
  for (const bad of ['abc', '1.5', '-3', '10x']) {
    const r = parseDocumentReadmeArgs(['--tests', bad]);
    assert.ok(r.error, `expected error for --tests ${bad}`);
    assert.equal(r.error.exitCode, 2);
  }
});

test('@unit parseDocumentReadmeArgs: --tests with a missing value → exit 2', () => {
  const r = parseDocumentReadmeArgs(['--tests']);
  assert.ok(r.error);
  assert.equal(r.error.exitCode, 2);
  const r2 = parseDocumentReadmeArgs(['--tests', '--dry-run']);
  assert.ok(r2.error);
  assert.equal(r2.error.exitCode, 2);
});

test('@unit parseDocumentReadmeArgs: unknown flag → exit 2 with a hint', () => {
  const r = parseDocumentReadmeArgs(['--bogus']);
  assert.ok(r.error);
  assert.equal(r.error.exitCode, 2);
  assert.match(r.error.message, /--help/);
});

test('@unit parseDocumentReadmeArgs: a positional is rejected (document-readme takes none)', () => {
  const r = parseDocumentReadmeArgs(['somefile']);
  assert.ok(r.error);
  assert.equal(r.error.exitCode, 2);
});

test('@unit parseDocumentReadmeArgs: a non-array argument → exit 2', () => {
  const r = parseDocumentReadmeArgs(null);
  assert.ok(r.error);
  assert.equal(r.error.exitCode, 2);
});
