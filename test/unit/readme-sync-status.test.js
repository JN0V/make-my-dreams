// test/unit/readme-sync-status.test.js — pure builder unit tests for the README
// Status block (SPEC_V03D AC-2). All I/O is injected (fake git/fs + the REAL
// parseLessons over a fixture), so no real git/fs is touched. Tagged @unit.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildStatusBlock } from '../../lib/readme-sync/build-status-block.js';
import { parseLessons } from '../../lib/composer/parse-lessons.js';

// FOUR lessons, only THREE active (one milestone) — proves the builder renders
// the ACTIVE count (3), not the total (4).
const LESSONS_FIXTURE = [
  '## L-001 — first active',
  '**Status**: active',
  '**Rule**: do x',
  '**Keywords for matching**: a',
  '',
  '## L-002 — second active',
  '**Status**: active',
  '**Rule**: do y',
  '**Keywords for matching**: b',
  '',
  '## L-003 — a milestone (NOT counted)',
  '**Status**: milestone',
  '**Rule**: naming only',
  '',
  '## L-004 — third active',
  '**Status**: active',
  '**Rule**: do z',
  '**Keywords for matching**: c',
  '',
].join('\n');

const PKG_FIXTURE = JSON.stringify({ name: 'make-my-dreams', version: '0.3.4' });

function fakeReadFile(map) {
  return (p) => {
    if (p in map) return map[p];
    const err = new Error(`ENOENT: ${p}`);
    err.code = 'ENOENT';
    throw err;
  };
}

function fakeGit(responses) {
  return async (args) => {
    const key = args.join(' ');
    for (const [prefix, resp] of responses) {
      if (key.startsWith(prefix)) return resp;
    }
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };
}

function baseDeps(overrides = {}) {
  const paths = { packageJson: '/repo/package.json', lessons: '/repo/docs/lessons-learned.md' };
  return {
    runGit: fakeGit([
      ['describe --tags', { ok: true, code: 0, stdout: 'v0.3.3\n', stderr: '' }],
      ['tag --list v*', { ok: true, code: 0, stdout: 'v0.1.0\nv0.2.1\nv0.3.3\n', stderr: '' }],
    ]),
    repoRoot: '/repo',
    readFile: fakeReadFile({
      [paths.packageJson]: PKG_FIXTURE,
      [paths.lessons]: LESSONS_FIXTURE,
    }),
    parseLessons,
    listAdrFiles: () => ['001-a.md', '002-b.md', '025-z.md'],
    paths,
    tests: 1268,
    ...overrides,
  };
}

test('@unit buildStatusBlock: renders all derived fields from injected sources', async () => {
  const block = await buildStatusBlock(baseDeps());
  assert.match(block, /\*\*Version\*\*: `0\.3\.4` \(package\.json\)/);
  assert.match(block, /\*\*Latest tag\*\*: `v0\.3\.3`/);
  assert.match(block, /\*\*ADRs\*\*: 3 \(ADR-001\.\.ADR-025\)/);
  assert.match(block, /\*\*Active lessons\*\*: 3 active/);
  assert.match(block, /\*\*Reflexive slices \(release tags\)\*\*: 3/);
  assert.match(block, /\*\*Tests\*\*: 1268 passing/);
});

test('@unit buildStatusBlock: active-lessons count is ACTIVE not total (3 not 4)', async () => {
  const block = await buildStatusBlock(baseDeps());
  assert.match(block, /\*\*Active lessons\*\*: 3 active/);
  assert.ok(!/4 active/.test(block), 'milestone lesson must not be counted');
});

test('@unit buildStatusBlock AC-2: no --tests → explicit placeholder, never a number', async () => {
  const block = await buildStatusBlock(baseDeps({ tests: null }));
  assert.match(block, /\*\*Tests\*\*: \(run `npm test` to refresh/);
  assert.ok(!/\d+ passing/.test(block), 'must not invent a passing count');
});

test('@unit buildStatusBlock AC-2: --tests 0 renders "0 passing" (honest, explicit)', async () => {
  const block = await buildStatusBlock(baseDeps({ tests: 0 }));
  assert.match(block, /\*\*Tests\*\*: 0 passing/);
});

test('@unit buildStatusBlock: a failing git tag call renders (unavailable: …), never crashes', async () => {
  const block = await buildStatusBlock(
    baseDeps({
      runGit: fakeGit([
        ['describe --tags', { ok: true, code: 128, stdout: '', stderr: 'fatal: No names found\n' }],
        ['tag --list v*', { ok: false, error: new Error('git missing') }],
      ]),
    }),
  );
  assert.match(block, /\*\*Latest tag\*\*: \(unavailable: fatal: No names found\)/);
  assert.match(block, /\*\*Reflexive slices \(release tags\)\*\*: \(unavailable: git missing\)/);
});

test('@unit buildStatusBlock: a missing package.json renders (unavailable: …) for version', async () => {
  const paths = { packageJson: '/repo/package.json', lessons: '/repo/docs/lessons-learned.md' };
  const block = await buildStatusBlock(
    baseDeps({
      paths,
      readFile: fakeReadFile({ [paths.lessons]: LESSONS_FIXTURE }), // package.json absent
    }),
  );
  assert.match(block, /\*\*Version\*\*: \(unavailable:/);
});

test('@unit buildStatusBlock: a missing lessons file renders (unavailable: …)', async () => {
  const paths = { packageJson: '/repo/package.json', lessons: '/repo/docs/lessons-learned.md' };
  const block = await buildStatusBlock(
    baseDeps({
      paths,
      readFile: fakeReadFile({ [paths.packageJson]: PKG_FIXTURE }), // lessons absent
    }),
  );
  assert.match(block, /\*\*Active lessons\*\*: \(unavailable:/);
});
