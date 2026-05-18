// @unit tests for bin/lessons.js — SPEC_V02E AC-7.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseLessonsArgs } from '../../bin/lessons.js';

test('@unit parseLessonsArgs: no args → list', () => {
  assert.deepEqual(parseLessonsArgs([]), { action: 'list' });
});

test('@unit parseLessonsArgs: --help → help', () => {
  assert.deepEqual(parseLessonsArgs(['--help']), { action: 'help' });
  assert.deepEqual(parseLessonsArgs(['-h']), { action: 'help' });
});

test('@unit parseLessonsArgs: match with prompt → match action', () => {
  const r = parseLessonsArgs(['match', 'git', 'checkout', 'switch']);
  assert.equal(r.action, 'match');
  assert.equal(r.prompt, 'git checkout switch');
});

test('@unit parseLessonsArgs: match without prompt → error exit 2', () => {
  const r = parseLessonsArgs(['match']);
  assert.equal(r.action, 'match');
  assert.equal(r.error?.exitCode, 2);
});

test('@unit parseLessonsArgs: --show <id> → show action', () => {
  const r = parseLessonsArgs(['--show', 'L-008']);
  assert.equal(r.action, 'show');
  assert.equal(r.id, 'L-008');
});

test('@unit parseLessonsArgs: --show without id → error exit 2', () => {
  const r = parseLessonsArgs(['--show']);
  assert.equal(r.action, 'show');
  assert.equal(r.error?.exitCode, 2);
});

test('@unit parseLessonsArgs: --show <bad-id> → error exit 2', () => {
  const r = parseLessonsArgs(['--show', 'banana']);
  assert.equal(r.action, 'show');
  assert.equal(r.error?.exitCode, 2);
  assert.match(r.error.message, /invalid lesson id/);
});

test('@unit parseLessonsArgs: unknown subaction → error exit 2', () => {
  const r = parseLessonsArgs(['banana']);
  assert.equal(r.error?.exitCode, 2);
  assert.match(r.error.message, /unknown subaction/);
});
