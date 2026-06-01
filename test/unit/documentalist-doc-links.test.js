// @unit tests for lib/documentalist/doc-links.js (SPEC_V07D AC-1).
//
// The coherence graph's doc↔doc edge source: given a doc's text, pull the OTHER
// docs it links to — `[[wiki]]` links, `ADR-NNN` references, and relative
// markdown `](../foo.md)` links — each as a {to, kind:'doc-link'} resolved to a
// repo-relative path where determinable. PURE, never throws, conservative
// (no edge for unresolvable / external targets). < 100ms (testing.md §V).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractDocLinks } from '../../lib/documentalist/doc-links.js';

const tos = (edges) => edges.map((e) => e.to);

test('@unit doc-links: wiki-link [[name]] resolves to a sibling .md, relative to the doc', () => {
  const edges = extractDocLinks('See [[architecture]] and [[error-handling]].', {
    docPath: 'docs/notes/index.md',
  });
  assert.ok(edges.every((e) => e.kind === 'doc-link'), 'every edge tagged doc-link');
  assert.ok(tos(edges).includes('docs/notes/architecture.md'));
  assert.ok(tos(edges).includes('docs/notes/error-handling.md'));
});

test('@unit doc-links: a wiki-link [[target|alias]] keeps the target and drops a #anchor', () => {
  const edges = extractDocLinks('[[universal|the universal module]] and [[testing#section]]', {
    docPath: 'CLAUDE.md',
  });
  assert.ok(tos(edges).includes('universal.md'));
  assert.ok(tos(edges).includes('testing.md'));
});

test('@unit doc-links: ADR-NNN resolves to the real file when a resolver is injected', () => {
  const resolveAdr = (n) => (n === 27 ? 'docs/adr/027-import-graph-blast-radius.md' : null);
  const edges = extractDocLinks('Built on ADR-27, see ADR-099.', {
    docPath: 'docs/adr/037-coherence-graph.md',
    resolveAdr,
  });
  assert.ok(tos(edges).includes('docs/adr/027-import-graph-blast-radius.md'), 'resolved ADR-27');
  // ADR-099 has no resolver hit → the number-keyed stem (still determinable).
  assert.ok(tos(edges).includes('docs/adr/099'), 'unresolved ADR falls back to the stem');
});

test('@unit doc-links: ADR-NNN without a resolver falls back to the number-keyed stem', () => {
  const edges = extractDocLinks('Per ADR-034 and ADR-7.', { docPath: 'README.md' });
  assert.ok(tos(edges).includes('docs/adr/034'));
  assert.ok(tos(edges).includes('docs/adr/007'), 'zero-padded to 3 digits');
});

test('@unit doc-links: relative markdown links to other .md docs resolve repo-relative', () => {
  const text = 'See [the spec](../specs/SPEC_V06A.md) and [readme](docs/x.md "title").';
  const edges = extractDocLinks(text, { docPath: 'docs/adr/037-x.md' });
  assert.ok(tos(edges).includes('docs/specs/SPEC_V06A.md'), '../ resolved from the doc dir');
  // `](docs/x.md ...)` from docs/adr/ resolves relative to that dir (markdown semantics).
  assert.ok(tos(edges).includes('docs/adr/docs/x.md'));
});

test('@unit doc-links: external / absolute / anchor / non-md links produce NO edge (conservative)', () => {
  const text = [
    '[site](https://example.com/page.md)', // external — skip even if .md
    '[mail](mailto:a@b.c)',
    '[abs](/etc/passwd.md)', // absolute — skip
    '[anchor](#section)',
    '[code](../lib/server.js)', // code link — doc-refs.js territory, not doc-link
  ].join('\n');
  const edges = extractDocLinks(text, { docPath: 'docs/a.md' });
  assert.deepEqual(edges, [], 'no inter-doc edges for external/absolute/anchor/code links');
});

test('@unit doc-links: deduplicates repeated targets, preserves first-seen order', () => {
  const edges = extractDocLinks('[[a]] then [[a]] then [[b]]', { docPath: 'r.md' });
  assert.deepEqual(tos(edges), ['a.md', 'b.md']);
});

test('@unit doc-links: never throws on odd input', () => {
  assert.deepEqual(extractDocLinks(undefined), []);
  assert.deepEqual(extractDocLinks(123), []);
  assert.deepEqual(extractDocLinks(''), []);
  assert.deepEqual(extractDocLinks('[[x]]', { docPath: null }), [{ to: 'x.md', kind: 'doc-link' }]);
  // A throwing resolver is swallowed → the stem fallback, never a crash.
  const edges = extractDocLinks('ADR-5', { docPath: 'r.md', resolveAdr: () => { throw new Error('boom'); } });
  assert.deepEqual(edges, [{ to: 'docs/adr/005', kind: 'doc-link' }]);
});
