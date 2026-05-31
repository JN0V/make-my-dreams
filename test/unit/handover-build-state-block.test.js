// test/unit/handover-build-state-block.test.js — pure builder unit tests
// (SPEC_V02P AC-2 + AC-4). All I/O is injected (fake git/fs/clock + the REAL
// parseLessons over a fixture), so no real git/fs is touched. Tagged @unit.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildStateBlock } from '../../lib/handover/build-state-block.js';
import { parseLessons } from '../../lib/composer/parse-lessons.js';

// A lessons fixture with FOUR lessons, only THREE active (one milestone). This
// proves the builder renders the ACTIVE count (3), not the total (4) — the
// exact "13 not 17" mechanism the live repo needed (SPEC §1).
const LESSONS_FIXTURE = [
  '# Lessons',
  '',
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
  '**Rule**: naming convention only',
  '',
  '## L-004 — third active',
  '**Status**: active',
  '**Rule**: do z',
  '**Keywords for matching**: c',
  '',
].join('\n');

const PKG_FIXTURE = JSON.stringify({ name: 'make-my-dreams', version: '0.2.16' });

function fakeReadFile(map) {
  return (p) => {
    if (p in map) return map[p];
    const err = new Error(`ENOENT: ${p}`);
    err.code = 'ENOENT';
    throw err;
  };
}

// Fake git runner: matches by the joined args prefix.
function fakeGit(responses) {
  return async (args) => {
    const key = args.join(' ');
    for (const [prefix, resp] of responses) {
      if (key.startsWith(prefix)) return resp;
    }
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };
}

const FIXED_CLOCK = () => new Date('2026-05-31T09:30:00.000Z');

function baseDeps(overrides = {}) {
  const paths = { packageJson: '/repo/package.json', lessons: '/repo/docs/lessons-learned.md' };
  return {
    runGit: fakeGit([
      ['describe --tags', { ok: true, code: 0, stdout: 'v0.2.16\n', stderr: '' }],
      ['branch --show-current', { ok: true, code: 0, stdout: 'slice/here-x\n', stderr: '' }],
      ['log --oneline', { ok: true, code: 0, stdout: 'abc123 feat: a\ndef456 fix: b\n', stderr: '' }],
    ]),
    repoRoot: '/repo',
    readFile: fakeReadFile({
      [paths.packageJson]: PKG_FIXTURE,
      [paths.lessons]: LESSONS_FIXTURE,
    }),
    parseLessons,
    listAdrFiles: () => ['001-a.md', '002-b.md', '020-z.md'],
    clock: FIXED_CLOCK,
    paths,
    tests: 1055,
    ...overrides,
  };
}

test('@unit buildStateBlock: renders all derived fields from injected sources', async () => {
  const block = await buildStateBlock(baseDeps());
  assert.match(block, /\*\*Latest tag\*\*: `v0\.2\.16`/);
  assert.match(block, /\*\*Branch\*\*: `slice\/here-x`/);
  assert.match(block, /\*\*Version\*\*: `0\.2\.16` \(package\.json\)/);
  assert.match(block, /\*\*Tests\*\*: 1055 passing/);
  assert.match(block, /\*\*Generated\*\*: 2026-05-31/);
  // recent commits each rendered as `<sha> <subject>`
  assert.match(block, /- `abc123 feat: a`/);
  assert.match(block, /- `def456 fix: b`/);
});

test('@unit buildStateBlock: active-lessons count is the ACTIVE count, not the total (3 not 4)', async () => {
  const block = await buildStateBlock(baseDeps());
  assert.match(block, /\*\*Active lessons\*\*: 3 \(/);
  assert.match(block, /L-001, L-002, L-004/); // sorted, milestone L-003 excluded
  assert.ok(!/L-003/.test(block), 'milestone L-003 must NOT appear in the active id list');
});

test('@unit buildStateBlock: ADR count derived from the file list with a range', async () => {
  const block = await buildStateBlock(baseDeps());
  assert.match(block, /\*\*ADRs\*\*: 3 \(ADR-001\.\.ADR-020\)/);
});

test('@unit buildStateBlock: a failing git call renders (unavailable: …), never crashes', async () => {
  const block = await buildStateBlock(
    baseDeps({
      runGit: fakeGit([
        ['describe --tags', { ok: true, code: 128, stdout: '', stderr: 'fatal: No names found\n' }],
        ['branch --show-current', { ok: false, error: new Error('git missing') }],
        ['log --oneline', { ok: true, code: 0, stdout: '', stderr: '' }],
      ]),
    }),
  );
  assert.match(block, /\*\*Latest tag\*\*: \(unavailable: fatal: No names found\)/);
  assert.match(block, /\*\*Branch\*\*: \(unavailable: git missing\)/);
  assert.match(block, /\*\*Recent commits\*\*: \(unavailable: no commits\)/);
});

test('@unit buildStateBlock AC-4: no --tests → explicit placeholder, never a number', async () => {
  const block = await buildStateBlock(baseDeps({ tests: null }));
  assert.match(block, /\*\*Tests\*\*: \(run `npm test` to refresh/);
  assert.ok(!/\d+ passing/.test(block), 'must not invent a passing count');
});

test('@unit buildStateBlock AC-4: --tests 0 renders "0 passing" (honest, explicit)', async () => {
  const block = await buildStateBlock(baseDeps({ tests: 0 }));
  assert.match(block, /\*\*Tests\*\*: 0 passing/);
});

test('@unit buildStateBlock: a missing package.json renders (unavailable: …) for version', async () => {
  const paths = { packageJson: '/repo/package.json', lessons: '/repo/docs/lessons-learned.md' };
  const block = await buildStateBlock(
    baseDeps({
      paths,
      readFile: fakeReadFile({ [paths.lessons]: LESSONS_FIXTURE }), // package.json absent
    }),
  );
  assert.match(block, /\*\*Version\*\*: \(unavailable:/);
});
