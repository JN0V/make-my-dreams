// @unit tests for lib/documentalist/inventory.js (SPEC_V07A AC-1).
//
// The gatherer is pure-ish by injection: every fs touch goes through readFile /
// readDir / listTags, so we drive it entirely on an in-memory fixture repo —
// no real filesystem, < 100ms (testing.md §V). The headline guarantee under
// test is NEVER-THROWS: a throwing reader degrades one field to empty/null and
// the review still runs (error-handling §III, universal §VI honesty).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { gatherInventory, DEFAULT_DOC_CAP } from '../../lib/documentalist/inventory.js';

// ── A small in-memory fixture repo ──────────────────────────────────────────

const FIXTURE_FILES = {
  'docs/adr/001-adopt-gstack.md': '# ADR-001 — Adopt gStack as the backbone\n\n**Status**: Accepted\n',
  'docs/adr/002-vanilla-pwa.md': '# ADR-002 — Vanilla PWA for v0.1\n',
  'MAKE_MY_DREAMS.md': Array.from({ length: 250 }, (_, i) => `line ${i}`).join('\n') + '\n',
  'README.md': 'a\nb\nc\n', // 3 lines, under cap
  'docs/lessons-learned.md': [
    '## L-001 — alpha',
    '**Status**: active',
    '## L-002 — beta',
    '**Status**: milestone',
    '## L-003 — gamma',
    '**Status**: active',
    '',
  ].join('\n'),
};

const FIXTURE_DIRS = {
  '.': ['SPEC_V01.md', 'SPEC_V02.md', 'README.md', 'package.json', 'notaspec.md'],
  'docs/adr': ['001-adopt-gstack.md', '002-vanilla-pwa.md', 'README.md', 'not-an-adr.txt'],
  lib: ['engine.js', 'state.js', 'conductor', 'documentalist'],
};

function makeReaders(files = FIXTURE_FILES, dirs = FIXTURE_DIRS) {
  return {
    readFile: (p) => {
      if (!(p in files)) {
        const e = new Error(`ENOENT: ${p}`);
        throw e;
      }
      return files[p];
    },
    readDir: (p) => {
      if (!(p in dirs)) throw new Error(`ENOENT dir: ${p}`);
      return dirs[p];
    },
    listTags: () => ['v0.1.0', 'v0.2.0'],
  };
}

const SUBCOMMANDS = ['serve', 'bench', 'discover'];

// ── Happy path ──────────────────────────────────────────────────────────────

test('@unit inventory: gathers the full documented surface from a fixture repo', () => {
  const inv = gatherInventory({ ...makeReaders(), subcommands: SUBCOMMANDS });

  assert.deepEqual(inv.subcommands, ['serve', 'bench', 'discover']);
  assert.deepEqual(inv.tags, ['v0.1.0', 'v0.2.0']);

  // ADRs: only NNN-*.md, sorted, with number + human title (the "ADR-NNN — "
  // prefix stripped). README.md / .txt in the adr dir are not ADRs.
  assert.equal(inv.adrs.length, 2);
  assert.deepEqual(inv.adrs[0], {
    number: 1,
    title: 'Adopt gStack as the backbone',
    file: '001-adopt-gstack.md',
  });
  assert.equal(inv.adrs[1].number, 2);

  // lib modules: .js stripped, dirs kept, sorted.
  assert.deepEqual(inv.libModules, ['conductor', 'documentalist', 'engine', 'state']);

  // SPEC sprawl: only SPEC_V*.md at root (notaspec.md / README.md excluded).
  assert.equal(inv.specCount, 2);

  // Active lessons only (milestone excluded).
  assert.equal(inv.lessonCount, 2);

  // Doc line counts + overCap. MAKE_MY_DREAMS has 250 lines > 200 cap.
  assert.equal(inv.docCap, DEFAULT_DOC_CAP);
  const mmd = inv.docLineCounts.find((d) => d.doc === 'MAKE_MY_DREAMS.md');
  assert.equal(mmd.lines, 250);
  assert.equal(mmd.overCap, true);
  const readme = inv.docLineCounts.find((d) => d.doc === 'README.md');
  assert.equal(readme.lines, 3);
  assert.equal(readme.overCap, false);
  // A key doc that isn't in the fixture is simply omitted (no fabricated 0).
  assert.equal(inv.docLineCounts.some((d) => d.doc === 'CLAUDE.md'), false);
});

test('@unit inventory: uses an injected parseLessons when provided', () => {
  const parseLessons = () => [
    { status: 'active' }, { status: 'active' }, { status: 'milestone' }, { status: 'active' },
  ];
  const inv = gatherInventory({ ...makeReaders(), parseLessons });
  assert.equal(inv.lessonCount, 3);
});

// ── Never-throws degradation (AC-1 headline) ────────────────────────────────

test('@unit inventory: a throwing readDir degrades that field, never throws', () => {
  const readers = makeReaders();
  const inv = gatherInventory({
    ...readers,
    readDir: () => { throw new Error('boom'); },
    subcommands: SUBCOMMANDS,
  });
  // ADRs, libModules, specCount all depend on readDir → degrade to empty/0.
  assert.deepEqual(inv.adrs, []);
  assert.deepEqual(inv.libModules, []);
  assert.equal(inv.specCount, 0);
  // Subcommands are injected, not read — still present.
  assert.deepEqual(inv.subcommands, SUBCOMMANDS);
});

test('@unit inventory: a throwing readFile degrades doc counts + lessons, never throws', () => {
  const inv = gatherInventory({
    readFile: () => { throw new Error('boom'); },
    readDir: makeReaders().readDir,
    listTags: () => ['v0.1.0'],
  });
  assert.deepEqual(inv.docLineCounts, []);
  assert.equal(inv.lessonCount, null); // honest "unknown", not a fabricated 0
  // ADR titles degrade to '' when the body can't be read, but the number from
  // the filename survives.
  assert.equal(inv.adrs[0].number, 1);
  assert.equal(inv.adrs[0].title, '');
});

test('@unit inventory: a throwing listTags degrades tags to [], never throws', () => {
  const inv = gatherInventory({
    ...makeReaders(),
    listTags: () => { throw new Error('no git'); },
  });
  assert.deepEqual(inv.tags, []);
});

test('@unit inventory: empty/garbage deps never throw (fully degraded inventory)', () => {
  for (const deps of [undefined, {}, null, { subcommands: 'not-an-array' }]) {
    const inv = gatherInventory(deps);
    assert.deepEqual(inv.subcommands, []);
    assert.deepEqual(inv.adrs, []);
    assert.deepEqual(inv.libModules, []);
    assert.equal(inv.specCount, 0);
    assert.equal(inv.lessonCount, null);
    assert.deepEqual(inv.docLineCounts, []);
  }
});
