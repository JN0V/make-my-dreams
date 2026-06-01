// @unit tests for lib/documentalist/coherence-graph.js (SPEC_V07D AC-2).
//
// The coherence graph composes the three derived edge sources into ONE
// file-level bidirectional adjacency, and coupledNeighbors walks it to report
// the ranked coupled neighbors of a changed set. PURE, deterministic, never
// throws. Covers: bidirectionality, kind tagging, ranking (strong>weak),
// transitive (2-hop), isolated node, dedup. < 100ms (testing.md §V).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCoherenceGraph,
  coupledNeighbors,
  HUB_DEGREE,
} from '../../lib/documentalist/coherence-graph.js';

// Find the single changed-file entry, then its neighbor record by target.
function neighborsOf(result, file) {
  const e = result.find((r) => r.file === file);
  assert.ok(e, `entry for ${file}`);
  return e.neighbors;
}
function nb(neighbors, to) {
  return neighbors.find((n) => n.to === to);
}

test('@unit coherence-graph: an edge is walkable BOTH ways (bidirectional)', () => {
  const g = buildCoherenceGraph({
    docToCodeEdges: [{ from: 'docs/adr/032-x.md', to: 'lib/discover/classify.js' }],
  });
  // From the code side: the doc that references it surfaces.
  const fromCode = neighborsOf(coupledNeighbors(g, ['lib/discover/classify.js']), 'lib/discover/classify.js');
  assert.ok(nb(fromCode, 'docs/adr/032-x.md'), 'doc surfaces when the code changes');
  // From the doc side: the code it references surfaces.
  const fromDoc = neighborsOf(coupledNeighbors(g, ['docs/adr/032-x.md']), 'docs/adr/032-x.md');
  assert.ok(nb(fromDoc, 'lib/discover/classify.js'), 'code surfaces when the doc changes');
});

test('@unit coherence-graph: each direct neighbor keeps its edge kind, ranked strong', () => {
  const g = buildCoherenceGraph({
    importEdges: [{ from: 'lib/a.js', to: 'test/a.test.js' }],
    docToCodeEdges: [{ from: 'docs/adr/001-a.md', to: 'lib/a.js' }],
    docLinkEdges: [{ from: 'lib/a.js', to: 'docs/guide.md' }], // (artificial, just to test the kind)
  });
  const n = neighborsOf(coupledNeighbors(g, ['lib/a.js']), 'lib/a.js');
  assert.equal(nb(n, 'test/a.test.js').kind, 'import');
  assert.equal(nb(n, 'docs/adr/001-a.md').kind, 'doc-ref');
  assert.equal(nb(n, 'docs/guide.md').kind, 'doc-link');
  assert.ok(n.every((x) => x.strength === 'strong'), 'all direct → strong');
  // Ranking: import < doc-ref < doc-link (kind precedence) within strong.
  assert.deepEqual(n.map((x) => x.kind), ['import', 'doc-ref', 'doc-link']);
});

test('@unit coherence-graph: a 2-hop neighbor is reported WEAK / transitive', () => {
  // code ← test (import); the test also references a doc (doc-ref). Changing the
  // code reaches the doc transitively (code→test→doc).
  const g = buildCoherenceGraph({
    importEdges: [{ from: 'lib/a.js', to: 'test/a.test.js' }],
    docToCodeEdges: [{ from: 'docs/a.md', to: 'test/a.test.js' }],
  });
  const n = neighborsOf(coupledNeighbors(g, ['lib/a.js']), 'lib/a.js');
  assert.equal(nb(n, 'test/a.test.js').strength, 'strong', 'the test is direct');
  const doc = nb(n, 'docs/a.md');
  assert.ok(doc, 'the transitively-coupled doc surfaces');
  assert.equal(doc.strength, 'weak');
  assert.equal(doc.kind, 'transitive');
  // Strong ranks before weak.
  assert.equal(n[0].to, 'test/a.test.js');
  assert.equal(n[n.length - 1].to, 'docs/a.md');
});

test('@unit coherence-graph: a node reachable directly AND transitively is reported once, as STRONG', () => {
  // a↔b (import), b↔c (import), a↔c (doc-ref). c is both a direct neighbor of a
  // (doc-ref) and a 2-hop neighbor (a→b→c). It must appear once, strong.
  const g = buildCoherenceGraph({
    importEdges: [{ from: 'a.js', to: 'b.js' }, { from: 'b.js', to: 'c.js' }],
    docToCodeEdges: [{ from: 'a.js', to: 'c.js' }],
  });
  const n = neighborsOf(coupledNeighbors(g, ['a.js']), 'a.js');
  const cs = n.filter((x) => x.to === 'c.js');
  assert.equal(cs.length, 1, 'c reported once');
  assert.equal(cs[0].strength, 'strong');
});

test('@unit coherence-graph: an isolated changed node reports NO neighbors', () => {
  const g = buildCoherenceGraph({ importEdges: [{ from: 'x.js', to: 'y.js' }] });
  const result = coupledNeighbors(g, ['lonely.js']);
  assert.deepEqual(result, [{ file: 'lonely.js', neighbors: [] }]);
});

test('@unit coherence-graph: the changed set itself is excluded from neighbors', () => {
  const g = buildCoherenceGraph({ importEdges: [{ from: 'a.js', to: 'b.js' }] });
  // Both a and b changed → neither lists the other (co-changed, no review needed).
  const result = coupledNeighbors(g, ['a.js', 'b.js']);
  assert.deepEqual(neighborsOf(result, 'a.js'), []);
  assert.deepEqual(neighborsOf(result, 'b.js'), []);
});

test('@unit coherence-graph: empty graph or no changes → empty result', () => {
  assert.deepEqual(coupledNeighbors(buildCoherenceGraph({}), ['a.js']), [{ file: 'a.js', neighbors: [] }]);
  assert.deepEqual(coupledNeighbors(buildCoherenceGraph({}), []), []);
  const g = buildCoherenceGraph({ importEdges: [{ from: 'a.js', to: 'b.js' }] });
  assert.deepEqual(coupledNeighbors(g, []), []);
});

test('@unit coherence-graph: changed-file entries are de-duplicated, input order preserved', () => {
  const g = buildCoherenceGraph({ importEdges: [{ from: 'a.js', to: 'b.js' }] });
  const result = coupledNeighbors(g, ['a.js', 'a.js']);
  assert.equal(result.length, 1);
  assert.equal(result[0].file, 'a.js');
});

test('@unit coherence-graph: deterministic — same inputs, same output (order-independent edges)', () => {
  const a = buildCoherenceGraph({
    importEdges: [{ from: 'x.js', to: 'y.js' }, { from: 'y.js', to: 'z.js' }],
  });
  const b = buildCoherenceGraph({
    importEdges: [{ from: 'y.js', to: 'z.js' }, { from: 'x.js', to: 'y.js' }],
  });
  assert.deepEqual(coupledNeighbors(a, ['x.js']), coupledNeighbors(b, ['x.js']));
});

// ── v0.7.e: hub-SOURCE cap (the symmetric counterpart to hub-transit suppression).
// When the CHANGED file itself is a hub (> HUB_DEGREE direct neighbors), the report
// would flood with dozens of "strong" lines. Cap to the top HUB_DEGREE, record the
// suppressed count, and skip transitive expansion for that source. ────────────────

// Build a doc-link star: `hub` directly linked to `count` leaf docs, lexically
// ordered leaf-00.md .. leaf-NN.md so the deterministic ranking is checkable.
function hubStar(count) {
  const docLinkEdges = [];
  for (let i = 0; i < count; i += 1) {
    docLinkEdges.push({ from: 'hub.md', to: `leaf-${String(i).padStart(2, '0')}.md` });
  }
  return buildCoherenceGraph({ docLinkEdges });
}

test('@unit coherence-graph: a HUB SOURCE caps to HUB_DEGREE direct neighbors + records the suppressed count', () => {
  const extra = 5;
  const g = hubStar(HUB_DEGREE + extra);
  const result = coupledNeighbors(g, ['hub.md']);
  const entry = result[0];
  assert.equal(entry.file, 'hub.md');
  assert.equal(entry.neighbors.length, HUB_DEGREE, 'capped to HUB_DEGREE');
  assert.equal(entry.hubSuppressed, extra, 'records how many direct neighbors were dropped');
  assert.ok(entry.neighbors.every((n) => n.strength === 'strong'), 'all kept neighbors are direct/strong');
  // The kept top-N is deterministic: leaves are doc-links of one kind, so ranked
  // lexically by path → leaf-00 .. leaf-(HUB_DEGREE-1).
  assert.equal(entry.neighbors[0].to, 'leaf-00.md');
  assert.equal(entry.neighbors[HUB_DEGREE - 1].to, `leaf-${String(HUB_DEGREE - 1).padStart(2, '0')}.md`);
});

test('@unit coherence-graph: a HUB SOURCE skips the transitive layer (no weak neighbors on top of a flood)', () => {
  // hub.md → many leaves (hub source); one leaf also links to deep.md. Without the
  // hub-source short-circuit, deep.md would surface WEAK/transitive. It must not.
  const g = buildCoherenceGraph({
    docLinkEdges: [
      ...Array.from({ length: HUB_DEGREE + 3 }, (_, i) => ({ from: 'hub.md', to: `leaf-${String(i).padStart(2, '0')}.md` })),
      { from: 'leaf-00.md', to: 'deep.md' },
    ],
  });
  const entry = coupledNeighbors(g, ['hub.md'])[0];
  assert.ok(!entry.neighbors.some((n) => n.to === 'deep.md'), 'no transitive neighbor for a hub source');
  assert.ok(entry.neighbors.every((n) => n.strength === 'strong'), 'hub source emits only direct/strong neighbors');
});

test('@unit coherence-graph: a source at EXACTLY HUB_DEGREE is NOT a hub (no cap, no suppressed field, transitive intact)', () => {
  // Exactly HUB_DEGREE direct leaves + one leaf linking onward to deep.md.
  const g = buildCoherenceGraph({
    docLinkEdges: [
      ...Array.from({ length: HUB_DEGREE }, (_, i) => ({ from: 'hub.md', to: `leaf-${String(i).padStart(2, '0')}.md` })),
      { from: 'leaf-00.md', to: 'deep.md' },
    ],
  });
  const entry = coupledNeighbors(g, ['hub.md'])[0];
  assert.equal(entry.hubSuppressed, undefined, 'no hubSuppressed field for a non-hub source');
  assert.equal(entry.neighbors.length, HUB_DEGREE + 1, 'all direct leaves + the transitive deep.md');
  const deep = nb(entry.neighbors, 'deep.md');
  assert.ok(deep && deep.strength === 'weak' && deep.kind === 'transitive', 'transitive layer intact below the threshold');
});

test('@unit coherence-graph: an ordinary entry carries NO hubSuppressed field (back-compat shape)', () => {
  const g = buildCoherenceGraph({ importEdges: [{ from: 'a.js', to: 'b.js' }] });
  const entry = coupledNeighbors(g, ['a.js'])[0];
  assert.equal(entry.hubSuppressed, undefined);
  assert.deepEqual(Object.keys(entry).sort(), ['file', 'neighbors']);
});

test('@unit coherence-graph: never throws on junk input', () => {
  assert.deepEqual(coupledNeighbors(null, ['a.js']), [{ file: 'a.js', neighbors: [] }]);
  assert.deepEqual(coupledNeighbors(undefined, undefined), []);
  const g = buildCoherenceGraph({ importEdges: [null, { from: 'a.js' }, { to: 'b.js' }, 7, { from: 'a.js', to: 'a.js' }] });
  // All edges are junk or self-edges → empty graph.
  assert.equal(g.size, 0);
});
