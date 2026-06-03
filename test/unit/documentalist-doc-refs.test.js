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

test('@unit doc-refs: extracts POLYGLOT source-file refs under ANY top-level dir (§VIII)', () => {
  // The drift detector must work on a Python/Rust/Go/TS repo, not only a JS one.
  // A path-like token with a directory segment + a common source extension is a
  // candidate `file` ref regardless of the top-level dir or the language.
  const text = [
    'The handler lives in src/foo.py today.', // line 1: Python, src/
    'Entry point is cmd/app/main.go for the daemon.', // line 2: Go, cmd/
    'The binary core is crate/src/main.rs here.', // line 3: Rust
    'The button is app/components/Button.tsx in the UI.', // line 4: TSX, app/
    'A header pkg/include/widget.hpp declares it.', // line 5: C++ header
  ].join('\n');
  const refs = extractDocRefs(text);

  const py = find(refs, 'file', 'src/foo.py');
  assert.ok(py, 'Python source path captured');
  assert.equal(py.line, 1);
  assert.ok(find(refs, 'file', 'cmd/app/main.go'), 'Go source path captured');
  assert.ok(find(refs, 'file', 'crate/src/main.rs'), 'Rust source path captured');
  assert.ok(find(refs, 'file', 'app/components/Button.tsx'), 'TSX source path captured');
  assert.ok(find(refs, 'file', 'pkg/include/widget.hpp'), 'C++ header path captured');
});

test('@unit doc-refs: a bare filename with NO directory segment is NOT captured (path-like only)', () => {
  // "a path-like token that has a directory segment" — a lone `main.py` / `README.md`
  // is not a directory-anchored reference, so it is not a code-artifact claim.
  const text = 'Run main.py directly, or read README.md and Cargo.toml first.';
  const refs = extractDocRefs(text);
  assert.ok(!refs.some((r) => r.kind === 'file'), 'no directory segment → not a file ref');
});

test('@unit doc-refs: a leading-dot directory (.specify/...) is NOT half-captured (precision)', () => {
  // The lookbehind must reject starting mid-token after a leading `.`, so a dotted
  // top-level dir like `.specify/memory/constitution.md` does NOT yield a phantom
  // `specify/memory/constitution.md` dangling ref.
  const text = 'The constitution lives at .specify/memory/constitution.md in the repo.';
  const refs = extractDocRefs(text);
  assert.ok(
    !refs.some((r) => r.kind === 'file' && /constitution\.md$/.test(r.value)),
    'leading-dot dir not half-captured as a dangling phantom',
  );
});

test('@unit doc-refs: a scheme URL is not captured as a source-file path', () => {
  // `https://host/path/x.md` must not become a `file` ref (the `:` after the scheme
  // is not a path char, so the token cannot start there; precision over recall).
  const text = 'See https://example.com/docs/guide.md for details.';
  const refs = extractDocRefs(text);
  assert.ok(!refs.some((r) => r.kind === 'file' && r.value.includes('guide.md')), 'URL path not a file ref');
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

test('@unit doc-refs: a NEGATED / hypothetical / future `mmd <name>` is NOT captured (precision)', () => {
  const text = [
    'There is no standalone `mmd judge` command.', // negation before
    'No `mmd init` step is needed.', // negation before
    'A future `mmd doctor` could check the install.', // future before
    'Adding a 5th skill (e.g. `mmd context-save`).', // e.g. before
    'v0.7.c — active compaction via `mmd document-compact`.', // version-plan before
    'But `mmd teleport` was never built.', // affirmative claim ("never" is AFTER) → captured
  ].join('\n');
  const refs = extractDocRefs(text);
  for (const name of ['judge', 'init', 'doctor', 'context-save', 'document-compact']) {
    assert.ok(!find(refs, 'subcommand', name), `not-a-claim '${name}' must be suppressed`);
  }
  // The affirmative dangling claim is still captured (recall preserved).
  assert.ok(find(refs, 'subcommand', 'teleport'), 'a plain affirmative ref is still captured');
});

test('@unit doc-refs: a git commit-log backtick span (`<hash> <subject>`) yields NO subcommand ref', () => {
  // HANDOVER.md auto-generates a recent-commits block whose backtick spans are
  // `<hash> <subject>` lines. A subject mentioning `mmd`/`mmdream` + a word must
  // NOT be read as a phantom subcommand (which conformance would flag as dangling).
  const text = [
    'Recent commits:', // line 1
    '- `ea2dc27 rename command mmd to mmdream across all surfaces`', // line 2: hash + mmd/mmdream subject
    '- `dfe79aa fix(dream): avoid an mmdream collision in the global scope`', // line 3
    '- `abcdef0 docs: note the mmd discover behavior`', // line 4
  ].join('\n');
  const refs = extractDocRefs(text);
  for (const phantom of ['across', 'collision', 'global', 'discover', 'to']) {
    assert.ok(!find(refs, 'subcommand', phantom), `commit-log word '${phantom}' must not be a subcommand`);
  }
  assert.ok(!refs.some((r) => r.kind === 'subcommand'), 'a commit-log span yields no subcommand refs at all');
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

test('@unit doc-refs: a placeholder template path is NOT collected as a claim', () => {
  const text = [
    'Name the new ADR `docs/adr/0NN-slug.md` under the ADR folder.', // 0NN placeholder
    'A handler lives in `lib/<module>/handler.js`.', // angle-bracket placeholder
    'But lib/documentalist/doc-refs.js is real.', // real → kept
  ].join('\n');
  const refs = extractDocRefs(text);
  assert.ok(!refs.some((r) => r.kind === 'file' && /0NN/.test(r.value)), 'NN-run placeholder skipped');
  assert.ok(!refs.some((r) => r.kind === 'file' && /[<>]/.test(r.value)), 'angle-bracket placeholder skipped');
  assert.ok(find(refs, 'file', 'lib/documentalist/doc-refs.js'), 'the real path is still collected');
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
