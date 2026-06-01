// @unit tests for lib/test-curator/report.js — the Test Curator's PURE report
// builder (SPEC_V076 AC-2). Pure, deterministic, never throws. No I/O.
// Per testing.md §V: pure logic, < 100 ms total.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTestHealthReport,
  DEFAULT_MAX_LINES,
  DEFAULT_MAX_TESTS,
} from '../../lib/test-curator/report.js';

// A small helper to hand-craft a scan result (the shape scan.js emits).
function scan({ tests = [], files = [] } = {}) {
  const byTag = { smoke: 0, unit: 0, integration: 0, e2e: 0, untagged: 0 };
  for (const t of tests) byTag[t.tag] += 1;
  return {
    tests,
    files,
    totals: { testCount: tests.length, fileCount: files.length, byTag },
  };
}

test('@unit buildTestHealthReport: renders the stratification distribution counts', () => {
  const s = scan({
    tests: [
      { title: '@unit a', tag: 'unit', file: 'a.test.js', line: 1 },
      { title: '@unit b', tag: 'unit', file: 'a.test.js', line: 2 },
      { title: '@integration c', tag: 'integration', file: 'b.test.js', line: 1 },
      { title: '@smoke d', tag: 'smoke', file: 'b.test.js', line: 2 },
    ],
    files: [
      { path: 'a.test.js', lineCount: 10, testCount: 2 },
      { path: 'b.test.js', lineCount: 8, testCount: 2 },
    ],
  });
  const md = buildTestHealthReport(s, { maxLines: 500, maxTests: 60 });
  assert.match(md, /unit/);
  assert.match(md, /2/); // unit count
  assert.match(md, /integration/);
  assert.match(md, /heuristic/i); // honest advisory framing
});

test('@unit buildTestHealthReport: lists UNTAGGED tests with file and line', () => {
  const s = scan({
    tests: [
      { title: 'plain one', tag: 'untagged', file: 'x.test.js', line: 7 },
      { title: '@unit tagged', tag: 'unit', file: 'x.test.js', line: 9 },
    ],
    files: [{ path: 'x.test.js', lineCount: 20, testCount: 2 }],
  });
  const md = buildTestHealthReport(s, { maxLines: 500, maxTests: 60 });
  assert.match(md, /untagged/i);
  assert.match(md, /x\.test\.js:7/);
  assert.match(md, /plain one/);
  // The tagged test must NOT appear in the untagged list.
  assert.doesNotMatch(md, /x\.test\.js:9/);
});

test('@unit buildTestHealthReport: a corpus with zero untagged says so positively', () => {
  const s = scan({
    tests: [{ title: '@unit a', tag: 'unit', file: 'a.test.js', line: 1 }],
    files: [{ path: 'a.test.js', lineCount: 5, testCount: 1 }],
  });
  const md = buildTestHealthReport(s, { maxLines: 500, maxTests: 60 });
  assert.match(md, /no untagged|0 untagged|all .* tagged/i);
});

test('@unit buildTestHealthReport: smoke line flags a THIN subset below the §V band', () => {
  const s = scan({
    tests: [
      { title: '@smoke a', tag: 'smoke', file: 'a.test.js', line: 1 },
      { title: '@smoke b', tag: 'smoke', file: 'a.test.js', line: 2 },
    ],
    files: [{ path: 'a.test.js', lineCount: 5, testCount: 2 }],
  });
  const md = buildTestHealthReport(s, { maxLines: 500, maxTests: 60 });
  assert.match(md, /smoke/i);
  assert.match(md, /thin/i);
});

test('@unit buildTestHealthReport: smoke line reads as usable within the §V band', () => {
  const tests = [];
  for (let i = 0; i < 7; i += 1) tests.push({ title: '@smoke s', tag: 'smoke', file: 's.test.js', line: i + 1 });
  const s = scan({ tests, files: [{ path: 's.test.js', lineCount: 30, testCount: 7 }] });
  const md = buildTestHealthReport(s, { maxLines: 500, maxTests: 60 });
  assert.match(md, /usable|within/i);
  assert.doesNotMatch(md, /\bthin\b/i);
});

test('@unit buildTestHealthReport: oversized by LINE count is a split candidate', () => {
  const s = scan({
    tests: [{ title: '@unit a', tag: 'unit', file: 'big.test.js', line: 1 }],
    files: [
      { path: 'big.test.js', lineCount: 900, testCount: 3 },
      { path: 'small.test.js', lineCount: 50, testCount: 3 },
    ],
  });
  const md = buildTestHealthReport(s, { maxLines: 500, maxTests: 60 });
  assert.match(md, /big\.test\.js/);
  assert.match(md, /900/);
  assert.doesNotMatch(md, /small\.test\.js/);
});

test('@unit buildTestHealthReport: oversized by TEST count is a split candidate', () => {
  const s = scan({
    tests: [],
    files: [
      { path: 'manytests.test.js', lineCount: 200, testCount: 120 },
      { path: 'ok.test.js', lineCount: 200, testCount: 10 },
    ],
  });
  const md = buildTestHealthReport(s, { maxLines: 500, maxTests: 60 });
  assert.match(md, /manytests\.test\.js/);
  assert.match(md, /120/);
  assert.doesNotMatch(md, /ok\.test\.js/);
});

test('@unit buildTestHealthReport: no oversized files says so positively', () => {
  const s = scan({
    tests: [{ title: '@unit a', tag: 'unit', file: 'a.test.js', line: 1 }],
    files: [{ path: 'a.test.js', lineCount: 50, testCount: 5 }],
  });
  const md = buildTestHealthReport(s, { maxLines: 500, maxTests: 60 });
  assert.match(md, /no oversized|0 oversized|within|none/i);
});

test('@unit buildTestHealthReport: the thresholds used are stated in the report', () => {
  const s = scan({ tests: [], files: [] });
  const md = buildTestHealthReport(s, { maxLines: 777, maxTests: 88 });
  assert.match(md, /777/);
  assert.match(md, /88/);
});

test('@unit buildTestHealthReport: empty scan → honest "no tests" report, never throws', () => {
  const md = buildTestHealthReport(scan({}), { maxLines: 500, maxTests: 60 });
  assert.equal(typeof md, 'string');
  assert.match(md, /no tests|0 tests/i);
});

test('@unit buildTestHealthReport: junk / missing scan → string, never throws', () => {
  for (const junk of [null, undefined, 42, 'x', {}]) {
    assert.doesNotThrow(() => buildTestHealthReport(junk, { maxLines: 500, maxTests: 60 }));
    assert.equal(typeof buildTestHealthReport(junk, {}), 'string');
  }
});

test('@unit buildTestHealthReport: missing thresholds fall back to the exported defaults', () => {
  const s = scan({ tests: [], files: [{ path: 'a.test.js', lineCount: DEFAULT_MAX_LINES + 1, testCount: 1 }] });
  const md = buildTestHealthReport(s, {});
  assert.equal(typeof DEFAULT_MAX_LINES, 'number');
  assert.equal(typeof DEFAULT_MAX_TESTS, 'number');
  assert.match(md, /a\.test\.js/); // flagged using the default line threshold
});

test('@unit buildTestHealthReport: deterministic — same input yields identical bytes', () => {
  const s = scan({
    tests: [{ title: 'p', tag: 'untagged', file: 'a.test.js', line: 3 }],
    files: [{ path: 'a.test.js', lineCount: 5, testCount: 1 }],
  });
  assert.equal(
    buildTestHealthReport(s, { maxLines: 500, maxTests: 60 }),
    buildTestHealthReport(s, { maxLines: 500, maxTests: 60 }),
  );
});
