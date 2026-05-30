// test/unit/documentalist-cmd.test.js — @unit
// SPEC_V02I AC-1: argv parsing for `mmd document-lessons`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseDocumentLessonsArgs } from '../../bin/documentalist/document-lessons.js';

test('@unit defaults: no flags', () => {
  const p = parseDocumentLessonsArgs([]);
  assert.deepEqual({ dryRun: p.dryRun, since: p.since, help: p.help, error: p.error }, {
    dryRun: false,
    since: null,
    help: false,
    error: undefined,
  });
});

test('@unit --dry-run + --since parse', () => {
  const p = parseDocumentLessonsArgs(['--dry-run', '--since', '2026-05-01']);
  assert.equal(p.dryRun, true);
  assert.equal(p.since, '2026-05-01');
  assert.equal(p.error, undefined);
});

test('@unit --help short-circuits', () => {
  assert.equal(parseDocumentLessonsArgs(['--help']).help, true);
  assert.equal(parseDocumentLessonsArgs(['-h']).help, true);
});

test('@unit --since requires a value (exit 2)', () => {
  const p = parseDocumentLessonsArgs(['--since']);
  assert.equal(p.error.exitCode, 2);
});

test('@unit --since rejects an invalid timestamp (exit 2)', () => {
  const p = parseDocumentLessonsArgs(['--since', 'not-a-date']);
  assert.equal(p.error.exitCode, 2);
});

test('@unit unknown flag is rejected (exit 2)', () => {
  const p = parseDocumentLessonsArgs(['--frobnicate']);
  assert.equal(p.error.exitCode, 2);
});
