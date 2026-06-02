// @unit tests for lib/test-curator/report.js — the Test Curator's PURE,
// LANGUAGE-NEUTRAL report builder (SPEC_V076 AC-2, polyglot in SPEC_V080 AC-3).
// Pure, deterministic, never throws. No I/O. Per testing.md §V: < 100 ms total.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTestHealthReport,
  DEFAULT_MAX_LINES,
  DEFAULT_MAX_TESTS,
} from '../../lib/test-curator/report.js';

// Hand-craft a NORMALIZED corpus (the shape the adapters emit + the bin
// aggregates): entries carry `stratum` (a value or null), files carry metrics,
// stacks carry capability flags.
function corpus({ tests = [], files = [], stacks = [{
  displayName: 'JavaScript/TypeScript', supportsBodies: true, supportsStratification: true, supportsCoverage: false,
}] } = {}) {
  return { tests, files, stacks };
}

test('@unit buildTestHealthReport: renders the stratification distribution counts', () => {
  const s = corpus({
    tests: [
      { title: '@unit a', stratum: 'unit', file: 'a.test.js', line: 1 },
      { title: '@unit b', stratum: 'unit', file: 'a.test.js', line: 2 },
      { title: '@integration c', stratum: 'integration', file: 'b.test.js', line: 1 },
      { title: '@smoke d', stratum: 'smoke', file: 'b.test.js', line: 2 },
    ],
    files: [
      { path: 'a.test.js', lineCount: 10, testCount: 2 },
      { path: 'b.test.js', lineCount: 8, testCount: 2 },
    ],
  });
  const md = buildTestHealthReport(s, { maxLines: 500, maxTests: 60 });
  assert.match(md, /\|\s*`@unit`\s*\|\s*2\s*\|/);
  assert.match(md, /\|\s*`@integration`\s*\|\s*1\s*\|/);
  assert.match(md, /\|\s*`@smoke`\s*\|\s*1\s*\|/);
  assert.match(md, /heuristic/i); // honest advisory framing
});

test('@unit buildTestHealthReport: untagged is stratum===null, listed with file:line', () => {
  const s = corpus({
    tests: [
      { title: 'plain one', stratum: null, file: 'x.test.js', line: 7 },
      { title: '@unit tagged', stratum: 'unit', file: 'x.test.js', line: 9 },
    ],
    files: [{ path: 'x.test.js', lineCount: 20, testCount: 2 }],
  });
  const md = buildTestHealthReport(s, { maxLines: 500, maxTests: 60 });
  assert.match(md, /untagged/i);
  assert.match(md, /x\.test\.js:7/);
  assert.match(md, /plain one/);
  assert.doesNotMatch(md, /x\.test\.js:9/);
});

test('@unit buildTestHealthReport: a corpus with zero untagged says so positively', () => {
  const s = corpus({
    tests: [{ title: '@unit a', stratum: 'unit', file: 'a.test.js', line: 1 }],
    files: [{ path: 'a.test.js', lineCount: 5, testCount: 1 }],
  });
  const md = buildTestHealthReport(s, { maxLines: 500, maxTests: 60 });
  assert.match(md, /no untagged|0 untagged|all .* tagged/i);
});

test('@unit buildTestHealthReport: smoke line flags a THIN subset below the §V band', () => {
  const s = corpus({
    tests: [
      { title: '@smoke a', stratum: 'smoke', file: 'a.test.js', line: 1 },
      { title: '@smoke b', stratum: 'smoke', file: 'a.test.js', line: 2 },
    ],
    files: [{ path: 'a.test.js', lineCount: 5, testCount: 2 }],
  });
  const md = buildTestHealthReport(s, { maxLines: 500, maxTests: 60 });
  assert.match(md, /smoke/i);
  assert.match(md, /thin/i);
});

test('@unit buildTestHealthReport: smoke line reads as usable within the §V band', () => {
  const tests = [];
  for (let i = 0; i < 7; i += 1) tests.push({ title: '@smoke s', stratum: 'smoke', file: 's.test.js', line: i + 1 });
  const s = corpus({ tests, files: [{ path: 's.test.js', lineCount: 30, testCount: 7 }] });
  const md = buildTestHealthReport(s, { maxLines: 500, maxTests: 60 });
  assert.match(md, /usable|within/i);
  assert.doesNotMatch(md, /\bthin\b/i);
});

test('@unit buildTestHealthReport: oversized by LINE count is a split candidate', () => {
  const s = corpus({
    tests: [{ title: '@unit a', stratum: 'unit', file: 'big.test.js', line: 1 }],
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
  const s = corpus({
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
  const s = corpus({
    tests: [{ title: '@unit a', stratum: 'unit', file: 'a.test.js', line: 1 }],
    files: [{ path: 'a.test.js', lineCount: 50, testCount: 5 }],
  });
  const md = buildTestHealthReport(s, { maxLines: 500, maxTests: 60 });
  assert.match(md, /no oversized|0 oversized|within|none/i);
});

test('@unit buildTestHealthReport: the thresholds used are stated in the report', () => {
  const s = corpus({ tests: [], files: [] });
  const md = buildTestHealthReport(s, { maxLines: 777, maxTests: 88 });
  assert.match(md, /777/);
  assert.match(md, /88/);
});

test('@unit buildTestHealthReport: empty corpus → honest "no tests" report, never throws', () => {
  const md = buildTestHealthReport(corpus({}), { maxLines: 500, maxTests: 60 });
  assert.equal(typeof md, 'string');
  assert.match(md, /no tests|0 tests/i);
});

test('@unit buildTestHealthReport: junk / missing corpus → string, never throws', () => {
  for (const junk of [null, undefined, 42, 'x', {}]) {
    assert.doesNotThrow(() => buildTestHealthReport(junk, { maxLines: 500, maxTests: 60 }));
    assert.equal(typeof buildTestHealthReport(junk, {}), 'string');
  }
});

test('@unit buildTestHealthReport: missing thresholds fall back to the exported defaults', () => {
  const s = corpus({ tests: [], files: [{ path: 'a.test.js', lineCount: DEFAULT_MAX_LINES + 1, testCount: 1 }] });
  const md = buildTestHealthReport(s, {});
  assert.equal(typeof DEFAULT_MAX_LINES, 'number');
  assert.equal(typeof DEFAULT_MAX_TESTS, 'number');
  assert.match(md, /a\.test\.js/);
});

test('@unit buildTestHealthReport: deterministic — same input yields identical bytes', () => {
  const s = corpus({
    tests: [{ title: 'p', stratum: null, file: 'a.test.js', line: 3 }],
    files: [{ path: 'a.test.js', lineCount: 5, testCount: 1 }],
  });
  assert.equal(
    buildTestHealthReport(s, { maxLines: 500, maxTests: 60 }),
    buildTestHealthReport(s, { maxLines: 500, maxTests: 60 }),
  );
});

test('@unit buildTestHealthReport: names the analyzed stack(s) in the corpus line (AC-4 face)', () => {
  const s = corpus({
    tests: [{ title: '@unit a', stratum: 'unit', file: 'a.test.js', line: 1 }],
    files: [{ path: 'a.test.js', lineCount: 5, testCount: 1 }],
    stacks: [{ displayName: 'Python', supportsBodies: false, supportsStratification: true, supportsCoverage: false }],
  });
  const md = buildTestHealthReport(s, {});
  assert.match(md, /analyzed stack[\s\S]*Python/);
});

// ── Capability honesty (AC-3) — a fake adapter lacking a capability → honest
//    "not available" note, NEVER a silent empty that reads as "clean". ──

test('@unit buildTestHealthReport: a stack without body support → redundancy honestly UNAVAILABLE (not "✅ none")', () => {
  const s = corpus({
    tests: [
      { title: 'test_a', stratum: 'unit', file: 't.py', line: 1, body: null, targets: ['pkg/mod.py'] },
      { title: 'test_b', stratum: 'unit', file: 't.py', line: 5, body: null, targets: ['pkg/mod.py'] },
    ],
    files: [{ path: 't.py', lineCount: 10, testCount: 2, targets: ['pkg/mod.py'] }],
    stacks: [{ displayName: 'Python', supportsBodies: false, supportsStratification: true, supportsCoverage: false }],
  });
  const md = buildTestHealthReport(s, {});
  // Honest unavailable, naming the stack — and crucially NOT the "no duplicates" verdict.
  assert.match(md, /[Nn]ot available[\s\S]*Python/);
  assert.doesNotMatch(md, /No near-duplicate test pairs/);
  // Clustering still works for a body-less stack.
  assert.match(md, /pkg\/mod\.py/);
});

test('@unit buildTestHealthReport: a MIXED corpus runs body similarity but NAMES the body-less stack', () => {
  const longBody = 'const x = compute(1); assert.equal(x, 2); const y = compute(3); assert.equal(y, 4); cleanup();';
  const s = corpus({
    tests: [
      { title: 't1', stratum: 'unit', file: 'a.test.js', line: 1, body: longBody, targets: ['lib/x.js'] },
      { title: 't2', stratum: 'unit', file: 'a.test.js', line: 9, body: longBody, targets: ['lib/x.js'] },
      { title: 'test_py', stratum: 'unit', file: 't.py', line: 1, body: null, targets: ['pkg/mod.py'] },
    ],
    files: [
      { path: 'a.test.js', lineCount: 12, testCount: 2, targets: ['lib/x.js'] },
      { path: 't.py', lineCount: 4, testCount: 1, targets: ['pkg/mod.py'] },
    ],
    stacks: [
      { displayName: 'JavaScript/TypeScript', supportsBodies: true, supportsStratification: true, supportsCoverage: false },
      { displayName: 'Python', supportsBodies: false, supportsStratification: true, supportsCoverage: false },
    ],
  });
  const md = buildTestHealthReport(s, {});
  // The JS near-duplicate pair IS found (identical long bodies).
  assert.match(md, /near-duplicate pair/);
  assert.match(md, /a\.test\.js:1[\s\S]*a\.test\.js:9/);
  // …and the body-less stack is honestly named as not compared.
  assert.match(md, /not available[\s\S]*Python/i);
});

test('@unit buildTestHealthReport: a stack without stratification → untagged framed as expected, not a §V violation', () => {
  const s = corpus({
    tests: [{ title: 'test_x', stratum: null, file: 't.py', line: 1, body: null, targets: [] }],
    files: [{ path: 't.py', lineCount: 3, testCount: 1, targets: [] }],
    stacks: [{ displayName: 'NoStrat', supportsBodies: false, supportsStratification: false, supportsCoverage: false }],
  });
  const md = buildTestHealthReport(s, {});
  assert.match(md, /NoStrat[\s\S]*no stratification convention|no stratification convention[\s\S]*NoStrat/);
  assert.match(md, /not[\s\S]*§V violation|not a §V violation/i);
});
