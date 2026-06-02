// @unit tests for lib/test-curator/extract-bodies.js — the Test Curator's PURE
// body + target extractor (SPEC_V077 AC-1). Pure, deterministic, never throws,
// no I/O. Per testing.md §V: pure logic, < 100 ms total.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractTestBody, extractFileTargets } from '../../lib/test-curator/extract-bodies.js';
import { scanTestCorpus } from '../../lib/test-curator/scan.js';

// ── extractTestBody ─────────────────────────────────────────────────────────

test('@unit extractTestBody: returns the code between the callback braces', () => {
  const src = "test('@unit x', () => { const a = 1; assert.equal(a, 1); });";
  const body = extractTestBody(src, 0);
  assert.equal(body, ' const a = 1; assert.equal(a, 1); ');
});

test('@unit extractTestBody: robust to nested braces', () => {
  const src = "test('@unit x', () => { if (a) { f({ k: 1 }); } });";
  const body = extractTestBody(src, 0);
  // The outer body is everything to the matching close of the FIRST brace.
  assert.equal(body, ' if (a) { f({ k: 1 }); } ');
});

test('@unit extractTestBody: a brace inside a STRING does not open/close the body', () => {
  const src = "test('@unit has { brace } in title', () => { return '}{'; });";
  const body = extractTestBody(src, 0);
  assert.equal(body, " return '}{'; ");
});

test('@unit extractTestBody: a brace inside a // comment is ignored', () => {
  const src = "test('@unit x', () => {\n  // a stray } brace in a comment\n  ok();\n});";
  const body = extractTestBody(src, 0);
  assert.match(body, /ok\(\);/);
  // The comment's `}` must NOT have closed the body early.
  assert.match(body, /stray \} brace/);
});

test('@unit extractTestBody: a brace inside a block comment is ignored', () => {
  const src = "test('@unit x', () => {\n  /* } not a close { */\n  done();\n});";
  const body = extractTestBody(src, 0);
  assert.match(body, /done\(\);/);
});

test('@unit extractTestBody: a template literal span is skipped wholesale', () => {
  const src = "test('@unit x', () => { const s = `a ${b} }{ c`; use(s); });";
  const body = extractTestBody(src, 0);
  assert.match(body, /use\(s\);/);
});

test('@unit extractTestBody: unterminated body → best-effort partial, no throw', () => {
  const src = "test('@unit x', () => { const a = 1;"; // never closes
  const body = extractTestBody(src, 0);
  assert.match(body, /const a = 1;/);
});

test('@unit extractTestBody: no opening brace → empty string', () => {
  assert.equal(extractTestBody("const noBracesHere = 1;", 0), '');
});

test('@unit extractTestBody: a bare callback REFERENCE has no body (Phase-4 F1)', () => {
  // test('name', fn) — no inline block. The scan must NOT run forward into the
  // next test and capture its body (which would manufacture a false 1.0 pair).
  const src = "test('@unit alpha', myHandler);\ntest('@unit beta', () => { realBody(); });";
  assert.equal(extractTestBody(src, 0), '', 'bare-ref callback must yield no body');
});

test('@unit extractTestBody: a bare ref without a trailing semicolon still has no body (F1)', () => {
  const src = "test('@unit alpha', myHandler)\ntest('@unit beta', () => { realBody(); })";
  assert.equal(extractTestBody(src, 0), '', 'must bail at the call close, not the next test');
});

test('@unit extractTestBody: a destructured callback PARAM is not mistaken for the body (Phase-4 F2)', () => {
  const src = "test('@unit x', ({ t, assert }) => { doRealWork(t); });";
  const body = extractTestBody(src, 0);
  assert.match(body, /doRealWork\(t\);/);
  assert.doesNotMatch(body, /assert/); // the param object was skipped, not captured
});

test('@unit extractTestBody: an options-object arg is skipped, the real body is captured', () => {
  const src = "test('@unit x', { concurrency: 2 }, () => { realStuff(); });";
  const body = extractTestBody(src, 0);
  assert.match(body, /realStuff\(\);/);
  assert.doesNotMatch(body, /concurrency/);
});

test('@unit extractTestBody: an expression-body arrow (no block) has no body (F1)', () => {
  const src = "test('@unit x', () => doThing());\ntest('@unit y', () => { other(); });";
  assert.equal(extractTestBody(src, 0), '');
});

test('@unit extractTestBody: a function-keyword callback body is captured', () => {
  const src = "test('@unit x', function () { fnBody(); });";
  const body = extractTestBody(src, 0);
  assert.match(body, /fnBody\(\);/);
});

test('@unit extractTestBody: junk input → empty string, never throws', () => {
  for (const junk of [null, undefined, 42, {}, '']) {
    assert.doesNotThrow(() => extractTestBody(junk, 0));
    assert.equal(extractTestBody(junk, 0), '');
  }
});

// ── extractFileTargets ──────────────────────────────────────────────────────

test('@unit extractFileTargets: captures lib/ and bin/ imports, normalized', () => {
  const src = [
    "import { scanTestCorpus } from '../../lib/test-curator/scan.js';",
    "import { runMmd } from '../../bin/mmd.js';",
    "const x = require('../../lib/server.js');",
  ].join('\n');
  assert.deepEqual(extractFileTargets(src), [
    'bin/mmd.js', 'lib/server.js', 'lib/test-curator/scan.js',
  ]);
});

test('@unit extractFileTargets: ignores node:/external/relative-non-lib specifiers', () => {
  const src = [
    "import { test } from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import express from 'express';",
    "import { helper } from './util.js';",
  ].join('\n');
  assert.deepEqual(extractFileTargets(src), []);
});

test('@unit extractFileTargets: de-dupes and sorts', () => {
  const src = [
    "import { a } from '../../lib/z.js';",
    "import { b } from '../../lib/z.js';",
    "import { c } from '../../lib/a.js';",
  ].join('\n');
  assert.deepEqual(extractFileTargets(src), ['lib/a.js', 'lib/z.js']);
});

test('@unit extractFileTargets: a commented-out import is not captured', () => {
  const src = [
    "// import { gone } from '../../lib/removed.js';",
    "import { real } from '../../lib/kept.js';",
  ].join('\n');
  assert.deepEqual(extractFileTargets(src), ['lib/kept.js']);
});

test('@unit extractFileTargets: junk input → [], never throws', () => {
  for (const junk of [null, undefined, 42, {}, '']) {
    assert.doesNotThrow(() => extractFileTargets(junk));
    assert.deepEqual(extractFileTargets(junk), []);
  }
});

// ── scan.js integration: body + targets attached ───────────────────────────

test('@unit scanTestCorpus: attaches body + targets to each test (additive)', () => {
  const content = [
    "import { test } from 'node:test';",
    "import { thing } from '../../lib/thing.js';",
    "test('@unit alpha', () => { expect(1).toBe(1); });",
  ].join('\n');
  const { tests, files } = scanTestCorpus([{ path: 't.test.js', content }]);
  assert.equal(tests.length, 1);
  // Existing fields unchanged.
  assert.equal(tests[0].tag, 'unit');
  assert.equal(tests[0].line, 3);
  // New fields.
  assert.match(tests[0].body, /expect\(1\)\.toBe\(1\);/);
  assert.deepEqual(tests[0].targets, ['lib/thing.js']);
  assert.deepEqual(files[0].targets, ['lib/thing.js']);
});

test('@unit scanTestCorpus: body offset is correct for the SECOND test in a file', () => {
  const content = [
    "test('@unit first', () => { aaa(); });",
    "test('@unit second', () => { bbb(); });",
  ].join('\n');
  const { tests } = scanTestCorpus([{ path: 'm.test.js', content }]);
  assert.match(tests[0].body, /aaa\(\);/);
  assert.doesNotMatch(tests[0].body, /bbb/);
  assert.match(tests[1].body, /bbb\(\);/);
  assert.doesNotMatch(tests[1].body, /aaa/);
});

test('@unit scanTestCorpus: still deterministic with body+targets', () => {
  const files = [
    { path: 'a.test.js', content: "import {x} from '../../lib/x.js';\ntest('@unit a', () => { x(); });" },
  ];
  assert.deepEqual(scanTestCorpus(files), scanTestCorpus(files));
});
