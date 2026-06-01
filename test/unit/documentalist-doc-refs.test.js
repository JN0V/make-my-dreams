// @unit tests for lib/documentalist/doc-refs.js (SPEC_V07B AC-1).
//
// The Documentalist's drift detector starts here: given a doc's text, pull the
// artifacts the doc CLAIMS exist — code file paths, `mmd <subcommand>` mentions,
// `ADR-NNN` references, and bare `lib/<module>` names — line-aware, deduped,
// tagged by kind. PURE, never throws, conservative (precision-first per AC-4).
//
// Distinct in PURPOSE from the grounding extractor (lib/here-mode/extract-file-refs.js):
// that one is input-focused and intentionally ignores `.js`; this one targets
// code artifacts to verify they still exist. < 100ms (testing.md §V).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractDocRefs } from '../../lib/documentalist/doc-refs.js';

// Find one ref by kind + value (the normalized identifier the conformance step checks).
function find(refs, kind, value) {
  return refs.find((r) => r.kind === kind && r.value === value);
}

test('@unit doc-refs: extracts code file paths under lib/bin/test/docs (.js/.md) with line numbers', () => {
  const text = [
    'See lib/documentalist/inventory.js for the gatherer.', // line 1
    'The entry point is bin/mmd.js.', // line 2
    'Tested by test/integration/document-review.test.js.', // line 3
    'The ADR lives at docs/adr/034-documentalist-coherence-review.md today.', // line 4
  ].join('\n');
  const refs = extractDocRefs(text);

  const f1 = find(refs, 'file', 'lib/documentalist/inventory.js');
  assert.ok(f1, 'lib .js path extracted');
  assert.equal(f1.line, 1);

  assert.ok(find(refs, 'file', 'bin/mmd.js'), 'bin .js path extracted');
  assert.ok(find(refs, 'file', 'test/integration/document-review.test.js'), 'test path extracted');

  const md = find(refs, 'file', 'docs/adr/034-documentalist-coherence-review.md');
  assert.ok(md, 'docs .md path extracted');
  assert.equal(md.line, 4);
});

test('@unit doc-refs: a trailing punctuation / paren does not get swallowed into the path', () => {
  const text = 'Render lives in `lib/documentalist/coherence-report.js`, see (lib/server.js).';
  const refs = extractDocRefs(text);
  assert.ok(find(refs, 'file', 'lib/documentalist/coherence-report.js'));
  assert.ok(find(refs, 'file', 'lib/server.js'), 'paren-wrapped path is clean');
});

test('@unit doc-refs: extracts `mmd <subcommand>` ONLY inside inline code (precision)', () => {
  const text = [
    'Run `mmd document-review` to regenerate the dashboard.', // line 1: captured
    'Then `mmd serve --monitor` launches the web UI.', // line 2: captured (flag ignored)
    'We pulled the spec from the roadmap before coding.', // line 3: prose "from" NOT captured
    'mmd discover names the stack in bare prose here.', // line 4: bare prose NOT captured (precision)
  ].join('\n');
  const refs = extractDocRefs(text);

  const a = find(refs, 'subcommand', 'document-review');
  assert.ok(a, 'backticked subcommand captured');
  assert.equal(a.line, 1);
  assert.equal(a.ref, 'mmd document-review');

  const b = find(refs, 'subcommand', 'serve');
  assert.ok(b, 'subcommand captured, trailing flag dropped');

  // Bare-prose mentions are deliberately NOT captured — precision over recall.
  assert.ok(!find(refs, 'subcommand', 'discover'), 'bare-prose subcommand not captured');
  assert.ok(!refs.some((r) => r.kind === 'subcommand' && r.value === 'from'), 'prose word not a subcommand');
});

test('@unit doc-refs: `mmd --here` and `mmd "<dream>"` are NOT subcommand refs', () => {
  const text = 'Use `mmd --here` on your repo, or `mmd "<dream>"` for greenfield.';
  const refs = extractDocRefs(text);
  assert.ok(!refs.some((r) => r.kind === 'subcommand'), 'flags/dream args are not subcommands');
});

test('@unit doc-refs: extracts ADR-NNN references with their number', () => {
  const text = 'Per [ADR-029](x) and ADR-034 the monitor is opt-in. See also ADR-007.';
  const refs = extractDocRefs(text);
  const a = find(refs, 'adr', 29);
  assert.ok(a, 'ADR number captured as value');
  assert.equal(a.ref, 'ADR-029');
  assert.ok(find(refs, 'adr', 34));
  assert.ok(find(refs, 'adr', 7), 'ADR-007 → numeric 7');
});

test('@unit doc-refs: extracts bare lib/<module> names but NOT when part of a deeper file path', () => {
  const text = [
    'The whole lib/conductor module handles notifications.', // line 1: bare module
    'Specifically lib/conductor/notify.js does the POST.', // line 2: file, NOT a bare module
    'See lib/here-mode for the precheck.', // line 3: hyphenated module
  ].join('\n');
  const refs = extractDocRefs(text);

  const m = find(refs, 'lib-module', 'conductor');
  assert.ok(m, 'bare lib/conductor module captured');
  assert.equal(m.line, 1);
  assert.ok(find(refs, 'lib-module', 'here-mode'), 'hyphenated module captured');

  // The deeper path is a `file` ref, and must NOT also produce a lib-module for it.
  assert.ok(find(refs, 'file', 'lib/conductor/notify.js'), 'deeper path is a file ref');
  const libModulesFromLine2 = refs.filter((r) => r.kind === 'lib-module' && r.line === 2);
  assert.equal(libModulesFromLine2.length, 0, 'no bare module from the deeper file-path line');
});

test('@unit doc-refs: skips fenced code blocks (illustrative/future paths not over-collected)', () => {
  const text = [
    'Real prose ref: lib/documentalist/inventory.js exists.', // line 1
    '```', // line 2 fence open
    'lib/dream-catcher/elicit.js   # future, illustrative', // line 3 (inside fence)
    'mmd judge --foo', // line 4 (inside fence)
    'ADR-099 placeholder', // line 5 (inside fence)
    '```', // line 6 fence close
    'Back in prose: bin/mmd.js.', // line 7
  ].join('\n');
  const refs = extractDocRefs(text);

  assert.ok(find(refs, 'file', 'lib/documentalist/inventory.js'), 'prose ref kept');
  assert.ok(find(refs, 'file', 'bin/mmd.js'), 'post-fence prose ref kept');
  // Everything inside the fence is skipped.
  assert.ok(!find(refs, 'file', 'lib/dream-catcher/elicit.js'), 'fenced path skipped');
  assert.ok(!find(refs, 'adr', 99), 'fenced ADR skipped');
  assert.ok(!refs.some((r) => r.kind === 'subcommand'), 'fenced subcommand skipped');
});

test('@unit doc-refs: deduplicates by kind+value, keeping the first line', () => {
  const text = [
    'First mention bin/mmd.js here.', // line 1
    'Later we touch bin/mmd.js again.', // line 2
  ].join('\n');
  const refs = extractDocRefs(text);
  const hits = refs.filter((r) => r.kind === 'file' && r.value === 'bin/mmd.js');
  assert.equal(hits.length, 1, 'deduped');
  assert.equal(hits[0].line, 1, 'first line kept');
});

test('@unit doc-refs: PURE + never throws on empty / non-string / odd input', () => {
  assert.deepEqual(extractDocRefs(''), []);
  assert.deepEqual(extractDocRefs(null), []);
  assert.deepEqual(extractDocRefs(undefined), []);
  assert.deepEqual(extractDocRefs(42), []);
  assert.doesNotThrow(() => extractDocRefs('```\nunclosed fence\nlib/x.js'));
});

test('@unit doc-refs: every returned ref carries {ref, kind, line, value}', () => {
  const refs = extractDocRefs('See `mmd serve`, lib/server.js, ADR-031, lib/conductor.');
  assert.ok(refs.length >= 4);
  for (const r of refs) {
    assert.equal(typeof r.ref, 'string');
    assert.ok(['file', 'subcommand', 'adr', 'lib-module'].includes(r.kind));
    assert.equal(typeof r.line, 'number');
    assert.ok('value' in r);
  }
});
