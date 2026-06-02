// @unit tests for lib/test-curator/redundancy.js — the Test Curator's PURE
// redundancy detector (SPEC_V077 AC-2). Pure, deterministic, never throws, no
// I/O. Per testing.md §V: pure logic, < 100 ms total.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  nearDuplicatePairs,
  targetClusters,
  keepRealTargets,
  tokenizeBody,
  DEFAULT_SIMILARITY,
} from '../../lib/test-curator/redundancy.js';

test('@unit keepRealTargets drops phantom (fixture-string) targets, keeps real ones', () => {
  const tests = [
    { file: 'a.test.js', targets: ['lib/server.js', 'lib/a.js'] },
    { file: 'b.test.js', targets: ['lib/x.js'] },
    { file: 'c.test.js', targets: ['lib/server.js'] },
  ];
  const real = new Set(['lib/server.js']); // only the real module exists
  const kept = keepRealTargets(tests, (m) => real.has(m));
  // Phantom fixture modules (lib/a.js, lib/x.js) are filtered out…
  assert.deepEqual(kept[0].targets, ['lib/server.js']);
  assert.deepEqual(kept[1].targets, []);
  assert.deepEqual(kept[2].targets, ['lib/server.js']);
  // …so the cluster table only counts the real module.
  const clusters = targetClusters(kept);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].module, 'lib/server.js');
  assert.equal(clusters[0].testCount, 2);
  // Pure + back-compat: no predicate → unchanged; non-array → [].
  assert.equal(keepRealTargets(tests), tests);
  assert.deepEqual(keepRealTargets(null, () => true), []);
});

// A realistic-ish body so it clears the MIN_TOKENS precision floor.
const BODY_A = ' const repo = await makeRepo(); const r = runMmd(repo, []); assert.equal(r.status, 0); cleanup(repo); ';
// Near-identical: copy-paste with a single literal changed (status 0 → 2). This
// is exactly the "same test written twice" the redundancy face should surface;
// the token-shingle Jaccard stays high because only one token differs.
const BODY_A_NEAR = ' const repo = await makeRepo(); const r = runMmd(repo, []); assert.equal(r.status, 2); cleanup(repo); ';
// Genuinely different body.
const BODY_B = ' const x = parseThing("input"); expect(x.value).toBe(42); cleanup(x); finalize(); ';

// ── nearDuplicatePairs ──────────────────────────────────────────────────────

test('@unit nearDuplicatePairs: flags a near-identical pair within a file', () => {
  const tests = [
    { file: 'a.test.js', line: 10, title: '@unit one', body: BODY_A },
    { file: 'a.test.js', line: 20, title: '@unit two', body: BODY_A_NEAR },
  ];
  const pairs = nearDuplicatePairs(tests, { threshold: 0.8 });
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].a.line, 10);
  assert.equal(pairs[0].b.line, 20);
  assert.ok(pairs[0].similarity >= 0.8, `similarity was ${pairs[0].similarity}`);
});

test('@unit nearDuplicatePairs: does NOT flag two genuinely-different tests', () => {
  const tests = [
    { file: 'a.test.js', line: 10, title: '@unit one', body: BODY_A },
    { file: 'a.test.js', line: 20, title: '@unit other', body: BODY_B },
  ];
  const pairs = nearDuplicatePairs(tests, { threshold: 0.9 });
  assert.equal(pairs.length, 0);
});

test('@unit nearDuplicatePairs: identical bodies score 1.0', () => {
  const tests = [
    { file: 'a.test.js', line: 1, title: 'x', body: BODY_A },
    { file: 'a.test.js', line: 2, title: 'y', body: BODY_A },
  ];
  const pairs = nearDuplicatePairs(tests, { threshold: 0.9 });
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].similarity, 1);
});

test('@unit nearDuplicatePairs: is BOUNDED — never compares across files', () => {
  // Identical bodies in DIFFERENT files must NOT be paired (within-file only).
  const tests = [
    { file: 'a.test.js', line: 1, title: 'x', body: BODY_A },
    { file: 'b.test.js', line: 1, title: 'y', body: BODY_A },
  ];
  const pairs = nearDuplicatePairs(tests, { threshold: 0.5 });
  assert.equal(pairs.length, 0);
});

test('@unit nearDuplicatePairs: skips trivially-tiny bodies (precision floor)', () => {
  const tests = [
    { file: 'a.test.js', line: 1, title: 'x', body: ' ok(); ' },
    { file: 'a.test.js', line: 2, title: 'y', body: ' ok(); ' },
  ];
  const pairs = nearDuplicatePairs(tests, { threshold: 0.5 });
  assert.equal(pairs.length, 0, 'two trivial stub bodies must not be flagged');
});

test('@unit nearDuplicatePairs: a junk threshold falls back to the default', () => {
  const tests = [
    { file: 'a.test.js', line: 1, title: 'x', body: BODY_A },
    { file: 'a.test.js', line: 2, title: 'y', body: BODY_A },
  ];
  // 1.0 default-equivalent: identical bodies still match at DEFAULT_SIMILARITY.
  const pairs = nearDuplicatePairs(tests, { threshold: 'banana' });
  assert.equal(pairs.length, 1);
  assert.ok(DEFAULT_SIMILARITY <= 1);
});

test('@unit nearDuplicatePairs: junk input → [], never throws', () => {
  for (const junk of [null, undefined, 42, 'nope', {}]) {
    assert.doesNotThrow(() => nearDuplicatePairs(junk));
    assert.deepEqual(nearDuplicatePairs(junk), []);
  }
});

test('@unit nearDuplicatePairs: deterministic — same input, same output', () => {
  const tests = [
    { file: 'a.test.js', line: 1, title: 'x', body: BODY_A },
    { file: 'a.test.js', line: 2, title: 'y', body: BODY_A },
  ];
  assert.deepEqual(nearDuplicatePairs(tests), nearDuplicatePairs(tests));
});

// ── targetClusters ──────────────────────────────────────────────────────────

test('@unit targetClusters: groups by target, counts tests + files, largest first', () => {
  const tests = [
    { file: 'a.test.js', targets: ['lib/server.js'] },
    { file: 'a.test.js', targets: ['lib/server.js'] },
    { file: 'b.test.js', targets: ['lib/server.js'] },
    { file: 'c.test.js', targets: ['lib/small.js'] },
  ];
  const clusters = targetClusters(tests);
  assert.equal(clusters[0].module, 'lib/server.js');
  assert.equal(clusters[0].testCount, 3);
  assert.equal(clusters[0].fileCount, 2);
  assert.equal(clusters[1].module, 'lib/small.js');
  assert.equal(clusters[1].testCount, 1);
  assert.equal(clusters[1].fileCount, 1);
});

test('@unit targetClusters: a file importing two targets contributes to both', () => {
  const tests = [
    { file: 'a.test.js', targets: ['lib/x.js', 'lib/y.js'] },
  ];
  const clusters = targetClusters(tests);
  assert.equal(clusters.length, 2);
  assert.deepEqual(clusters.map((c) => c.module).sort(), ['lib/x.js', 'lib/y.js']);
});

test('@unit targetClusters: tests with no targets produce no clusters', () => {
  const tests = [
    { file: 'a.test.js', targets: [] },
    { file: 'b.test.js' },
  ];
  assert.deepEqual(targetClusters(tests), []);
});

test('@unit targetClusters: junk input → [], never throws', () => {
  for (const junk of [null, undefined, 42, 'nope', {}]) {
    assert.doesNotThrow(() => targetClusters(junk));
    assert.deepEqual(targetClusters(junk), []);
  }
});

test('@unit targetClusters: deterministic — stable sort on ties', () => {
  const tests = [
    { file: 'a.test.js', targets: ['lib/b.js'] },
    { file: 'c.test.js', targets: ['lib/a.js'] },
  ];
  // Both clusters have testCount 1, fileCount 1 → tie broken by module asc.
  const clusters = targetClusters(tests);
  assert.deepEqual(clusters.map((c) => c.module), ['lib/a.js', 'lib/b.js']);
  assert.deepEqual(targetClusters(tests), targetClusters(tests));
});

// ── tokenizeBody (the normalization primitive) ──────────────────────────────

test('@unit tokenizeBody: strips comments and whitespace', () => {
  const a = tokenizeBody(' foo(bar); // a comment\n baz(); ');
  const b = tokenizeBody('foo(bar);baz();');
  assert.deepEqual(a, b);
});

test('@unit tokenizeBody: block comments stripped', () => {
  const a = tokenizeBody(' foo(); /* gone } { */ bar(); ');
  assert.deepEqual(a, tokenizeBody('foo();bar();'));
});

test('@unit tokenizeBody: junk → [], never throws', () => {
  for (const junk of [null, undefined, 42, {}, '']) {
    assert.doesNotThrow(() => tokenizeBody(junk));
    assert.deepEqual(tokenizeBody(junk), []);
  }
});
