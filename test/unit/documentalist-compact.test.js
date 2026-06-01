// test/unit/documentalist-compact.test.js — the pure compaction planner +
// reference-rewrite transform (SPEC_V07C AC-1 + AC-3). Tagged @unit: no I/O, no
// git — just data in, plan/text out. The subcommand's git mv / fs side is covered
// by test/integration/document-compact.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  planCompaction,
  applyReferenceRewrites,
  countReferences,
  parseSpecVersion,
  ARCHIVE_DIR,
} from '../../lib/documentalist/compact.js';

// ── AC-1: planCompaction ───────────────────────────────────────────────────

test('@unit planCompaction: several root SPECs → moves, rewrites, newest-first index', () => {
  const specs = [
    { name: 'SPEC_V01.md', title: '# Make My Dreams — v0.1 Spec: the walking skeleton' },
    { name: 'SPEC_V07C.md', title: '# Make My Dreams — v0.7.c Spec: the Documentalist compacts' },
    { name: 'SPEC_V02P.md', title: '# Make My Dreams — v0.2.p Spec: mechanical handover' },
  ];
  const plan = planCompaction({ specs, existingArchive: [] });

  // moves: each root SPEC → docs/specs/<name>
  assert.deepEqual(
    plan.moves.sort((a, b) => a.src.localeCompare(b.src)),
    [
      { src: 'SPEC_V01.md', dst: 'docs/specs/SPEC_V01.md' },
      { src: 'SPEC_V02P.md', dst: 'docs/specs/SPEC_V02P.md' },
      { src: 'SPEC_V07C.md', dst: 'docs/specs/SPEC_V07C.md' },
    ],
  );

  // referenceRewrites: token → prefixed token
  assert.deepEqual(
    plan.referenceRewrites.sort((a, b) => a.from.localeCompare(b.from)),
    [
      { from: 'SPEC_V01.md', to: 'docs/specs/SPEC_V01.md' },
      { from: 'SPEC_V02P.md', to: 'docs/specs/SPEC_V02P.md' },
      { from: 'SPEC_V07C.md', to: 'docs/specs/SPEC_V07C.md' },
    ],
  );

  // index: newest-first (v0.7.c before v0.2.p before v0.1), each entry carries
  // filename + parsed version + the title line.
  const idx = plan.indexMarkdown;
  assert.match(idx, /# Archived SPECs/);
  assert.match(idx, /do not hand-edit/i);
  const order = ['SPEC_V07C.md', 'SPEC_V02P.md', 'SPEC_V01.md'].map((n) => idx.indexOf(n));
  assert.ok(order[0] < order[1] && order[1] < order[2], `index not newest-first: ${idx}`);
  assert.match(idx, /\*\*v0\.7\.c\*\* — \[`SPEC_V07C\.md`\]\(SPEC_V07C\.md\) — Make My Dreams — v0\.7\.c Spec: the Documentalist compacts/);
});

test('@unit planCompaction: empty specs → empty plan (no-op)', () => {
  const plan = planCompaction({ specs: [], existingArchive: [] });
  assert.deepEqual(plan.moves, []);
  assert.deepEqual(plan.referenceRewrites, []);
  assert.match(plan.indexMarkdown, /No archived specs yet/);
});

test('@unit planCompaction: already-archived SPECs are not re-planned (idempotency)', () => {
  const specs = [
    { name: 'SPEC_V07A.md', title: '# v0.7.a' },
    { name: 'SPEC_V07B.md', title: '# v0.7.b' },
  ];
  // Both already under docs/specs/ → nothing to move, but the index still lists them.
  const plan = planCompaction({ specs, existingArchive: ['SPEC_V07A.md', 'SPEC_V07B.md'] });
  assert.deepEqual(plan.moves, []);
  assert.deepEqual(plan.referenceRewrites, []);
  assert.match(plan.indexMarkdown, /SPEC_V07A\.md/);
  assert.match(plan.indexMarkdown, /SPEC_V07B\.md/);
});

test('@unit planCompaction: only the unarchived subset moves; index stays complete', () => {
  const specs = [
    { name: 'SPEC_V07A.md', title: '# v0.7.a (already archived)' },
    { name: 'SPEC_V08A.md', title: '# v0.8.a (new at root)' },
  ];
  const plan = planCompaction({ specs, existingArchive: ['SPEC_V07A.md'] });
  assert.deepEqual(plan.moves, [{ src: 'SPEC_V08A.md', dst: 'docs/specs/SPEC_V08A.md' }]);
  assert.deepEqual(plan.referenceRewrites, [{ from: 'SPEC_V08A.md', to: 'docs/specs/SPEC_V08A.md' }]);
  // Index covers BOTH (complete archive view), newest-first.
  const idx = plan.indexMarkdown;
  assert.ok(idx.indexOf('SPEC_V08A.md') < idx.indexOf('SPEC_V07A.md'), 'v0.8.a should precede v0.7.a');
});

test('@unit planCompaction: malformed / missing input → empty plan, never throws', () => {
  assert.doesNotThrow(() => planCompaction());
  assert.doesNotThrow(() => planCompaction({}));
  assert.doesNotThrow(() => planCompaction({ specs: 'nope', existingArchive: 42 }));
  const plan = planCompaction({ specs: [null, { name: 5 }, { title: 'x' }] });
  assert.deepEqual(plan.moves, []); // every entry filtered out as malformed
});

test('@unit ARCHIVE_DIR is the docs/specs folder', () => {
  assert.equal(ARCHIVE_DIR, 'docs/specs');
});

// ── parseSpecVersion ────────────────────────────────────────────────────────

test('@unit parseSpecVersion: filename → display version + comparable tuple', () => {
  assert.equal(parseSpecVersion('SPEC_V01.md').display, 'v0.1');
  assert.equal(parseSpecVersion('SPEC_V07C.md').display, 'v0.7.c');
  assert.equal(parseSpecVersion('SPEC_V02P.md').display, 'v0.2.p');
  assert.equal(parseSpecVersion('not-a-spec.md').valid, false);
  assert.equal(parseSpecVersion('not-a-spec.md').display, '');
});

// ── AC-3: applyReferenceRewrites (idempotent, all textual forms) ────────────

const REWRITES = [
  { from: 'SPEC_V06A.md', to: 'docs/specs/SPEC_V06A.md' },
  { from: 'SPEC_V05C.md', to: 'docs/specs/SPEC_V05C.md' },
  { from: 'SPEC_V03B.md', to: 'docs/specs/SPEC_V03B.md' },
  { from: 'SPEC_V07A.md', to: 'docs/specs/SPEC_V07A.md' },
];

test('@unit applyReferenceRewrites: link target', () => {
  assert.equal(
    applyReferenceRewrites('see [the spec](SPEC_V06A.md) here', REWRITES),
    'see [the spec](docs/specs/SPEC_V06A.md) here',
  );
});

test('@unit applyReferenceRewrites: anchored link keeps the anchor', () => {
  assert.equal(
    applyReferenceRewrites('[x](SPEC_V05C.md#anchor)', REWRITES),
    '[x](docs/specs/SPEC_V05C.md#anchor)',
  );
});

test('@unit applyReferenceRewrites: bare prose mention', () => {
  assert.equal(
    applyReferenceRewrites('as described in SPEC_V03B.md, the flow is…', REWRITES),
    'as described in docs/specs/SPEC_V03B.md, the flow is…',
  );
});

test('@unit applyReferenceRewrites: backticked link form', () => {
  assert.equal(
    applyReferenceRewrites('[`SPEC_V07A.md`](SPEC_V07A.md)', REWRITES),
    '[`docs/specs/SPEC_V07A.md`](docs/specs/SPEC_V07A.md)',
  );
});

test('@unit applyReferenceRewrites: idempotent — already-prefixed is untouched', () => {
  const once = applyReferenceRewrites('[x](SPEC_V06A.md)', REWRITES);
  const twice = applyReferenceRewrites(once, REWRITES);
  assert.equal(twice, once);
  assert.doesNotMatch(twice, /docs\/specs\/docs\/specs/);
  // An already-archived path passed straight in is a no-op.
  assert.equal(
    applyReferenceRewrites('[x](docs/specs/SPEC_V06A.md)', REWRITES),
    '[x](docs/specs/SPEC_V06A.md)',
  );
});

test('@unit applyReferenceRewrites: a SPEC not in the rewrite set is untouched', () => {
  // SPEC_V99Z.md is not moving → left alone.
  assert.equal(
    applyReferenceRewrites('untouched SPEC_V99Z.md stays', REWRITES),
    'untouched SPEC_V99Z.md stays',
  );
});

test('@unit applyReferenceRewrites: does not split a token inside a deeper path', () => {
  // A reference already living under another directory must not be double-prefixed.
  assert.equal(
    applyReferenceRewrites('archive/SPEC_V06A.md', REWRITES),
    'archive/SPEC_V06A.md',
  );
});

test('@unit applyReferenceRewrites: .md is not glued onto a longer extension', () => {
  assert.equal(
    applyReferenceRewrites('SPEC_V06A.mdx is different', REWRITES),
    'SPEC_V06A.mdx is different',
  );
});

test('@unit applyReferenceRewrites: empty / malformed input never throws', () => {
  assert.equal(applyReferenceRewrites('', REWRITES), '');
  assert.equal(applyReferenceRewrites('text', []), 'text');
  assert.equal(applyReferenceRewrites('text', null), 'text');
  assert.doesNotThrow(() => applyReferenceRewrites(null, REWRITES));
});

// ── countReferences (honest "N references" summary count) ───────────────────

test('@unit countReferences: counts every rewritable token, ignores already-prefixed', () => {
  const text = 'see [a](SPEC_V06A.md) and SPEC_V06A.md again, plus docs/specs/SPEC_V05C.md (already)';
  // Two bare SPEC_V06A.md tokens; the docs/specs/-prefixed one is not counted.
  assert.equal(countReferences(text, REWRITES), 2);
  assert.equal(countReferences('', REWRITES), 0);
  assert.equal(countReferences('text', null), 0);
});
