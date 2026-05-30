// @unit tests for parseUnblockArgs — SPEC_V02J AC-3.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseUnblockArgs, SUBCOMMANDS, detectSubcommand } from '../../lib/argv-parser.js';

test('@unit unblock is a registered subcommand', () => {
  assert.ok(SUBCOMMANDS.includes('unblock'));
  assert.equal(detectSubcommand(['unblock', '--dry-run']), 'unblock');
});

test('@unit empty args → all false, no branch, no error', () => {
  const r = parseUnblockArgs([]);
  assert.deepEqual(r, { dryRun: false, force: false, help: false, branch: null, error: null });
});

test('@unit --dry-run', () => {
  assert.equal(parseUnblockArgs(['--dry-run']).dryRun, true);
});

test('@unit --force', () => {
  assert.equal(parseUnblockArgs(['--force']).force, true);
});

test('@unit --help / -h', () => {
  assert.equal(parseUnblockArgs(['--help']).help, true);
  assert.equal(parseUnblockArgs(['-h']).help, true);
});

test('@unit positional branch captured', () => {
  const r = parseUnblockArgs(['slice/foo']);
  assert.equal(r.branch, 'slice/foo');
  assert.equal(r.error, null);
});

test('@unit flags + branch combine', () => {
  const r = parseUnblockArgs(['--dry-run', 'slice/foo']);
  assert.equal(r.dryRun, true);
  assert.equal(r.branch, 'slice/foo');
});

test('@unit dry-run and force are not mutex at parse level', () => {
  const r = parseUnblockArgs(['--dry-run', '--force']);
  assert.equal(r.dryRun, true);
  assert.equal(r.force, true);
  assert.equal(r.error, null);
});

test('@unit unknown flag → exit 2 error', () => {
  const r = parseUnblockArgs(['--bogus']);
  assert.equal(r.error.exitCode, 2);
  assert.match(r.error.message, /unknown unblock arg/);
});

test('@unit second positional → exit 2 error', () => {
  const r = parseUnblockArgs(['slice/a', 'slice/b']);
  assert.equal(r.error.exitCode, 2);
  assert.match(r.error.message, /at most one positional/);
});

test('@unit non-array input → exit 2 error', () => {
  const r = parseUnblockArgs('nope');
  assert.equal(r.error.exitCode, 2);
});
