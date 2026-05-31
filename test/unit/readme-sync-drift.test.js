// test/unit/readme-sync-drift.test.js — pure drift-detector unit tests
// (SPEC_V03D AC-5). No I/O — plain strings. Tagged @unit.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { detectDrift } from '../../lib/readme-sync/detect-drift.js';

test('@unit detectDrift: a subcommand absent from the README is reported', () => {
  const readme = 'docs mention mmd serve and mmd bench but nothing else';
  const r = detectDrift({ subcommands: ['serve', 'bench', 'handover'], flags: [], readmeText: readme });
  assert.deepEqual(r.subcommands, ['handover']);
  assert.deepEqual(r.flags, []);
});

test('@unit detectDrift: a flag absent from the README is reported', () => {
  const readme = 'we document --here here, but not the other one';
  const r = detectDrift({ subcommands: [], flags: ['--here', '--catch'], readmeText: readme });
  assert.deepEqual(r.flags, ['--catch']);
});

test('@unit detectDrift: `mmd <name>` form counts as mentioned', () => {
  const readme = 'run `mmd document-readme --tests N`';
  const r = detectDrift({ subcommands: ['document-readme'], flags: [], readmeText: readme });
  assert.deepEqual(r.subcommands, []);
});

test('@unit detectDrift: empty README → everything reported missing', () => {
  const r = detectDrift({ subcommands: ['serve', 'bench'], flags: ['--here'], readmeText: '' });
  assert.deepEqual(r.subcommands, ['serve', 'bench']);
  assert.deepEqual(r.flags, ['--here']);
});

test('@unit detectDrift: no input → no missing (pure, never throws)', () => {
  const r = detectDrift();
  assert.deepEqual(r.subcommands, []);
  assert.deepEqual(r.flags, []);
});
