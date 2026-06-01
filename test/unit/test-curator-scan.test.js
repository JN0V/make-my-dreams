// @unit tests for lib/test-curator/scan.js — the Test Curator's PURE scanner
// (SPEC_V076 AC-1). Pure, deterministic, never throws. No I/O.
// Per testing.md §V: pure logic, < 100 ms total.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scanTestCorpus } from '../../lib/test-curator/scan.js';

test('@unit scanTestCorpus: reads the stratification tag from a test title prefix', () => {
  const files = [
    {
      path: 'test/unit/a.test.js',
      content: [
        "import { test } from 'node:test';",
        "test('@unit alpha does a thing', () => {});",
        "test('@integration beta crosses a boundary', () => {});",
      ].join('\n'),
    },
  ];
  const { tests } = scanTestCorpus(files);
  assert.equal(tests.length, 2);
  assert.equal(tests[0].tag, 'unit');
  assert.equal(tests[0].title, '@unit alpha does a thing');
  assert.equal(tests[0].file, 'test/unit/a.test.js');
  assert.equal(tests[0].line, 2);
  assert.equal(tests[1].tag, 'integration');
  assert.equal(tests[1].line, 3);
});

test('@unit scanTestCorpus: a title with none of the four tags is untagged', () => {
  const files = [
    { path: 'x.test.js', content: "test('plain title, no stratum', () => {});" },
  ];
  const { tests } = scanTestCorpus(files);
  assert.equal(tests.length, 1);
  assert.equal(tests[0].tag, 'untagged');
});

test('@unit scanTestCorpus: recognizes all four strata and it() as well as test()', () => {
  const files = [
    {
      path: 'q.test.js',
      content: [
        "test('@smoke critical path', () => {});",
        "it('@e2e full browser flow', () => {});",
        "test('@unit pure', () => {});",
        "it('@integration fs touch', () => {});",
      ].join('\n'),
    },
  ];
  const { tests, totals } = scanTestCorpus(files);
  assert.deepEqual(
    tests.map((t) => t.tag),
    ['smoke', 'e2e', 'unit', 'integration'],
  );
  assert.deepEqual(totals.byTag, {
    smoke: 1, unit: 1, integration: 1, e2e: 1, untagged: 0,
  });
});

test('@unit scanTestCorpus: per-file metrics — lineCount and testCount', () => {
  const content = [
    "// header comment",
    "import { test } from 'node:test';",
    "test('@unit one', () => {});",
    "test('@unit two', () => {});",
    "it('@unit three', () => {});",
  ].join('\n');
  const { files } = scanTestCorpus([{ path: 'm.test.js', content }]);
  assert.equal(files.length, 1);
  assert.equal(files[0].path, 'm.test.js');
  assert.equal(files[0].lineCount, 5);
  assert.equal(files[0].testCount, 3);
});

test('@unit scanTestCorpus: a commented-out test call is NOT counted (precision)', () => {
  const content = [
    "// test('@unit this is commented out', () => {});",
    "test('@unit this is real', () => {});",
    "  * test('@unit jsdoc star line', () => {});",
  ].join('\n');
  const { tests } = scanTestCorpus([{ path: 'c.test.js', content }]);
  assert.equal(tests.length, 1);
  assert.equal(tests[0].title, '@unit this is real');
  assert.equal(tests[0].line, 2);
});

test('@unit scanTestCorpus: describe() is not counted as a test', () => {
  const content = [
    "describe('@unit a group', () => {",
    "  test('@unit inside', () => {});",
    "});",
  ].join('\n');
  const { tests, files } = scanTestCorpus([{ path: 'd.test.js', content }]);
  assert.equal(tests.length, 1);
  assert.equal(files[0].testCount, 1);
});

test('@unit scanTestCorpus: multiline / open-quote title is best-effort, never throws', () => {
  const content = [
    "test('@unit a title that runs to the",
    "  end of the source line without closing', () => {});",
  ].join('\n');
  const r = scanTestCorpus([{ path: 'ml.test.js', content }]);
  assert.equal(r.tests.length, 1);
  assert.equal(r.tests[0].tag, 'unit');
  assert.equal(r.tests[0].line, 1);
});

test('@unit scanTestCorpus: template-literal title (backtick) is read', () => {
  const content = "test(`@smoke ${name} boots`, () => {});";
  const { tests } = scanTestCorpus([{ path: 't.test.js', content }]);
  assert.equal(tests.length, 1);
  assert.equal(tests[0].tag, 'smoke');
});

test('@unit scanTestCorpus: totals aggregate across files', () => {
  const files = [
    { path: 'a.test.js', content: "test('@unit a', () => {});\ntest('@smoke b', () => {});" },
    { path: 'b.test.js', content: "test('untagged c', () => {});" },
  ];
  const { totals } = scanTestCorpus(files);
  assert.equal(totals.fileCount, 2);
  assert.equal(totals.testCount, 3);
  assert.equal(totals.byTag.unit, 1);
  assert.equal(totals.byTag.smoke, 1);
  assert.equal(totals.byTag.untagged, 1);
});

// ── never-throws / determinism contract ────────────────────────────────────

test('@unit scanTestCorpus: empty input → empty result, no throw', () => {
  const r = scanTestCorpus([]);
  assert.deepEqual(r.tests, []);
  assert.deepEqual(r.files, []);
  assert.equal(r.totals.testCount, 0);
  assert.equal(r.totals.fileCount, 0);
});

test('@unit scanTestCorpus: null / undefined / junk input → empty result, no throw', () => {
  for (const junk of [null, undefined, 42, 'nope', {}]) {
    const r = scanTestCorpus(junk);
    assert.deepEqual(r.tests, []);
    assert.equal(r.totals.fileCount, 0);
  }
});

test('@unit scanTestCorpus: a file entry with missing/non-string content is skipped, not thrown', () => {
  const files = [
    { path: 'good.test.js', content: "test('@unit ok', () => {});" },
    { path: 'bad.test.js', content: null },
    { path: 'nopath', content: "test('@unit orphan', () => {});" },
    null,
    'garbage',
  ];
  const r = scanTestCorpus(files);
  // good.test.js contributes 1 test; bad.test.js → 0 tests but a file entry with lineCount 0;
  // the nopath entry still scans (path coerced); null/'garbage' are skipped.
  assert.ok(r.tests.some((t) => t.file === 'good.test.js'));
  assert.doesNotThrow(() => scanTestCorpus(files));
});

test('@unit scanTestCorpus: deterministic — same input yields identical output', () => {
  const files = [
    { path: 'a.test.js', content: "test('@unit a', () => {});\nit('@e2e b', () => {});" },
  ];
  assert.deepEqual(scanTestCorpus(files), scanTestCorpus(files));
});
