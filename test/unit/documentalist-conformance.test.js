// @unit tests for lib/documentalist/conformance.js (SPEC_V07B AC-2).
//
// Two PURE checks, both heuristics, both never-throw:
//   checkArtifactConformance({docRefs, inventory, fileExistsFn})
//     → the refs that DON'T resolve (missing file, unknown subcommand, ADR with
//       no docs/adr/NNN-*.md, lib module not in inventory), each
//       {doc, line, ref, kind, reason}. Valid refs are NOT returned.
//   checkFactConformance({docs, inventory})
//     → mismatches for BOUNDED claims only (explicit N subcommands/ADRs/lessons
//       counts + "current/latest version X"), ignoring historical narrative.
//
// < 100ms (testing.md §V).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  checkArtifactConformance,
  checkFactConformance,
} from '../../lib/documentalist/conformance.js';

const INVENTORY = {
  subcommands: ['serve', 'discover', 'document-review', 'lessons'],
  adrs: [
    { number: 1, title: 'Adopt gStack', file: '001.md' },
    { number: 34, title: 'Coherence review', file: '034.md' },
  ],
  libModules: ['conductor', 'documentalist', 'here-mode'],
  lessonCount: 27,
  tags: ['v0.6.1', 'v0.7.0'],
};

// A fileExistsFn that knows a small set of real paths.
const REAL_FILES = new Set([
  'lib/documentalist/inventory.js',
  'bin/mmd.js',
  'docs/adr/034-coherence-review.md',
]);
const fileExistsFn = (rel) => REAL_FILES.has(rel);

test('@unit conformance(artifact): a missing file path is flagged with file:line + reason', () => {
  const docRefs = [
    { doc: 'README.md', line: 10, ref: 'lib/gone/missing.js', kind: 'file', value: 'lib/gone/missing.js' },
    { doc: 'README.md', line: 12, ref: 'lib/documentalist/inventory.js', kind: 'file', value: 'lib/documentalist/inventory.js' },
  ];
  const out = checkArtifactConformance({ docRefs, inventory: INVENTORY, fileExistsFn });
  assert.equal(out.length, 1, 'only the missing file is flagged');
  assert.equal(out[0].doc, 'README.md');
  assert.equal(out[0].line, 10);
  assert.equal(out[0].ref, 'lib/gone/missing.js');
  assert.equal(out[0].kind, 'file');
  assert.match(out[0].reason, /not found/i);
});

test('@unit conformance(artifact): an unknown subcommand is flagged; a real one is not', () => {
  const docRefs = [
    { doc: 'CLAUDE.md', line: 3, ref: 'mmd serve', kind: 'subcommand', value: 'serve' },
    { doc: 'CLAUDE.md', line: 4, ref: 'mmd lessons', kind: 'subcommand', value: 'lessons' },
    { doc: 'CLAUDE.md', line: 5, ref: 'mmd doctor', kind: 'subcommand', value: 'doctor' },
  ];
  const out = checkArtifactConformance({ docRefs, inventory: INVENTORY, fileExistsFn });
  assert.equal(out.length, 1);
  assert.equal(out[0].value ?? out[0].ref, out[0].ref); // shape sanity
  assert.equal(out[0].ref, 'mmd doctor');
  assert.match(out[0].reason, /not a (known |real )?subcommand/i);
});

test('@unit conformance(artifact): an ADR with no inventory entry is flagged; a real one is not', () => {
  const docRefs = [
    { doc: 'README.md', line: 88, ref: 'ADR-099', kind: 'adr', value: 99 },
    { doc: 'README.md', line: 90, ref: 'ADR-034', kind: 'adr', value: 34 },
    { doc: 'README.md', line: 92, ref: 'ADR-001', kind: 'adr', value: 1 },
  ];
  const out = checkArtifactConformance({ docRefs, inventory: INVENTORY, fileExistsFn });
  assert.equal(out.length, 1);
  assert.equal(out[0].ref, 'ADR-099');
  assert.match(out[0].reason, /no docs\/adr\/099/);
});

test('@unit conformance(artifact): a lib module not in the inventory is flagged', () => {
  const docRefs = [
    { doc: 'CLAUDE.md', line: 1, ref: 'lib/conductor', kind: 'lib-module', value: 'conductor' },
    { doc: 'CLAUDE.md', line: 2, ref: 'lib/dream-catcher', kind: 'lib-module', value: 'dream-catcher' },
  ];
  const out = checkArtifactConformance({ docRefs, inventory: INVENTORY, fileExistsFn });
  assert.equal(out.length, 1);
  assert.equal(out[0].ref, 'lib/dream-catcher');
  assert.match(out[0].reason, /not in the lib\/ inventory/i);
});

test('@unit conformance(artifact): repoTopDirs — a non-rooted polyglot ref is NOT flagged (§VIII precision)', () => {
  // A Python repo whose real top-level dirs are src/ and tests/. doc-refs.js now
  // extracts file candidates under ANY dir; conformance only judges those rooted
  // at a real top-level dir, so a shorthand/illustrative token is not a false
  // positive even though it is missing.
  const pyRoot = new Set(['src', 'tests']);
  const docRefs = [
    // Rooted at a real top dir + missing → flagged.
    { doc: 'README.md', line: 1, ref: 'src/missing.py', kind: 'file', value: 'src/missing.py' },
    { doc: 'README.md', line: 2, ref: 'src/main.rs', kind: 'file', value: 'src/main.rs' },
    // NOT rooted at a real top dir (shorthand / illustrative) → skipped, not flagged.
    { doc: 'README.md', line: 3, ref: 'adapters/javascript.js', kind: 'file', value: 'adapters/javascript.js' },
    { doc: 'README.md', line: 4, ref: 'pkg/mod.py', kind: 'file', value: 'pkg/mod.py' },
  ];
  const out = checkArtifactConformance({
    docRefs, inventory: INVENTORY, fileExistsFn, repoTopDirs: pyRoot,
  });
  const flagged = out.map((f) => f.ref).sort();
  assert.deepEqual(flagged, ['src/main.rs', 'src/missing.py'], 'only repo-rooted missing refs flagged');
});

test('@unit conformance(artifact): repoTopDirs — a rooted EXISTING non-js source file is NOT flagged', () => {
  const pyRoot = new Set(['src']);
  const realPy = (rel) => rel === 'src/real_module.py';
  const docRefs = [
    { doc: 'README.md', line: 1, ref: 'src/real_module.py', kind: 'file', value: 'src/real_module.py' },
    { doc: 'README.md', line: 2, ref: 'src/gone.py', kind: 'file', value: 'src/gone.py' },
  ];
  const out = checkArtifactConformance({
    docRefs, inventory: INVENTORY, fileExistsFn: realPy, repoTopDirs: pyRoot,
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].ref, 'src/gone.py', 'existing .py not flagged; missing .py flagged');
});

test('@unit conformance(artifact): absent/empty repoTopDirs → filter OFF (back-compat, judge all)', () => {
  const docRefs = [{ doc: 'x', line: 1, ref: 'anydir/missing.js', kind: 'file', value: 'anydir/missing.js' }];
  // No repoTopDirs → judged via fileExistsFn (which knows only REAL_FILES) → flagged.
  const noFilter = checkArtifactConformance({ docRefs, inventory: INVENTORY, fileExistsFn });
  assert.equal(noFilter.length, 1, 'absent → judge all');
  // Empty array → still OFF (judge all), never "suppress everything".
  const emptyFilter = checkArtifactConformance({ docRefs, inventory: INVENTORY, fileExistsFn, repoTopDirs: [] });
  assert.equal(emptyFilter.length, 1, 'empty → judge all');
});

test('@unit conformance(artifact): PURE + never throws on empty/odd input', () => {
  assert.deepEqual(checkArtifactConformance({}), []);
  assert.deepEqual(checkArtifactConformance(null), []);
  assert.deepEqual(checkArtifactConformance({ docRefs: null, inventory: null }), []);
  // A ref of an unknown kind is simply ignored (conservative).
  const out = checkArtifactConformance({
    docRefs: [{ doc: 'x', line: 1, ref: '?', kind: 'mystery', value: '?' }],
    inventory: INVENTORY,
    fileExistsFn,
  });
  assert.deepEqual(out, []);
});

test('@unit conformance(artifact): missing fileExistsFn → file refs are NOT flagged (conservative)', () => {
  const docRefs = [{ doc: 'x', line: 1, ref: 'lib/whatever.js', kind: 'file', value: 'lib/whatever.js' }];
  const out = checkArtifactConformance({ docRefs, inventory: INVENTORY });
  assert.deepEqual(out, [], 'without an existence oracle, do not fabricate a "missing" verdict');
});

// --- checkFactConformance --------------------------------------------------

test('@unit conformance(fact): a wrong ADR count is flagged; a correct one is not', () => {
  const docs = [
    { doc: 'README.md', text: 'MMD ships 30 ADRs today.' }, // inventory has 2 → mismatch
    { doc: 'CLAUDE.md', text: 'There are 2 ADRs in the fixture.' }, // matches → no flag
  ];
  const out = checkFactConformance({ docs, inventory: INVENTORY });
  const adrFlag = out.find((f) => /ADR/.test(f.claim));
  assert.ok(adrFlag, 'wrong ADR count flagged');
  assert.equal(adrFlag.doc, 'README.md');
  assert.equal(adrFlag.line, 1);
  assert.match(adrFlag.claim, /30 ADRs/);
  assert.equal(adrFlag.actual, 2);
  // The correct "2 ADRs" claim is NOT flagged.
  assert.ok(!out.some((f) => f.doc === 'CLAUDE.md' && /ADR/.test(f.claim)));
});

test('@unit conformance(fact): subcommand + lesson counts checked against the inventory', () => {
  const docs = [
    { doc: 'README.md', text: 'The CLI exposes 12 subcommands.\nWe have 21 active lessons.' },
  ];
  const out = checkFactConformance({ docs, inventory: INVENTORY });
  // inventory.subcommands.length === 4, lessonCount === 27 → both mismatch.
  assert.ok(out.some((f) => /subcommands/.test(f.claim) && f.actual === 4));
  const lesson = out.find((f) => /lessons/.test(f.claim));
  assert.ok(lesson && lesson.actual === 27 && lesson.line === 2);
});

test('@unit conformance(fact): "current version X" mismatch flagged against the latest tag', () => {
  const docs = [
    { doc: 'CLAUDE.md', text: 'The current version is v0.5.2 right now.' },
  ];
  const out = checkFactConformance({ docs, inventory: INVENTORY });
  const v = out.find((f) => /version/i.test(f.claim));
  assert.ok(v, 'stale current-version flagged');
  assert.match(String(v.actual), /v0\.7\.0/);
});

test('@unit conformance(fact): a compound or quoted number is NOT read as a count claim', () => {
  const docs = [
    // "top-5 lessons" (compound), and a quoted historical value — neither is a
    // current count claim; precision-first, both must be ignored.
    { doc: 'README.md', text: 'See the top-5 lessons by injection count.\nThe file once claimed "17 active lessons" while the parser counted 13.' },
  ];
  const out = checkFactConformance({ docs, inventory: INVENTORY });
  assert.deepEqual(out, [], 'compound / quoted numbers are not stale-fact drift');
});

test('@unit conformance(fact): historical narrative is IGNORED (no false positive)', () => {
  const docs = [
    { doc: 'CLAUDE.md', text: 'As of v0.5.2 there were 30 ADRs.\nShipped in v0.2.x with 5 subcommands.' },
  ];
  const out = checkFactConformance({ docs, inventory: INVENTORY });
  assert.deepEqual(out, [], 'clearly-historical claims are not drift');
});

test('@unit conformance(fact): "by/until vX" is NOT a historical marker — current claim still checked', () => {
  // F4: "by v0.5 standards" frames a CURRENT requirement, not a past state, so
  // it must NOT suppress the count check. Past-tense framings still suppress.
  const current = [
    { doc: 'README.md', text: 'The CLI must expose 9 subcommands by v0.5 standards.' },
  ];
  const out = checkFactConformance({ docs: current, inventory: INVENTORY });
  assert.ok(out.some((f) => /subcommands/.test(f.claim) && f.actual === 4), '"by vX" no longer suppresses');

  const historical = [
    { doc: 'README.md', text: 'Shipped in v0.2 with 9 subcommands.' },
  ];
  assert.deepEqual(checkFactConformance({ docs: historical, inventory: INVENTORY }), [], 'past-tense still suppresses');
});

test('@unit conformance(fact): PURE + never throws on empty/odd input', () => {
  assert.deepEqual(checkFactConformance({}), []);
  assert.deepEqual(checkFactConformance(null), []);
  assert.deepEqual(checkFactConformance({ docs: null, inventory: null }), []);
  assert.doesNotThrow(() => checkFactConformance({ docs: [{ doc: 'x', text: null }], inventory: INVENTORY }));
});
