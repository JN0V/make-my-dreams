// @unit tests for lib/sealed-tests/import-graph.js — the GENERIC import-graph
// core (SPEC_V04C origin; made polyglot in SPEC_V081 — the JS specifier parsing
// moved to adapters/javascript.js, tested in code-graph-adapters.test.js). This
// file pins the core's GENERIC behavior: per-file adapter dispatch, the reverse
// closure, and the honest `unanalyzed` list. Pure over in-memory file maps.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildImportGraph,
  buildForwardGraph,
  invertGraph,
  reverseClosure,
} from '../../lib/sealed-tests/import-graph.js';

// ── buildImportGraph + reverse closure (generic, JS edges via the adapter) ──

function graphIo(files) {
  return (rel) => {
    if (!(rel in files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return files[rel];
  };
}

test('@unit buildImportGraph: maps each file to its resolved imports', () => {
  const files = {
    'lib/a.js': 'export const a = 1;',
    'lib/b.js': "import { a } from './a.js';\nexport const b = a;",
    'lib/c.js': "import { b } from './b.js';\nimport fs from 'node:fs';",
  };
  const graph = buildImportGraph(Object.keys(files), graphIo(files));
  assert.deepEqual([...graph.get('lib/a.js')], []);
  assert.deepEqual([...graph.get('lib/b.js')], ['lib/a.js']);
  // node:fs is dropped (bare) — only the resolved relative import remains.
  assert.deepEqual([...graph.get('lib/c.js')], ['lib/b.js']);
});

test('@unit buildImportGraph: unreadable files are skipped, never fatal', () => {
  const files = { 'lib/a.js': 'export const a = 1;' };
  // List a file the reader cannot read → it is skipped, no throw.
  const graph = buildImportGraph(['lib/a.js', 'lib/missing.js'], graphIo(files));
  assert.ok(graph.has('lib/a.js'));
  assert.ok(!graph.has('lib/missing.js'));
});

test('@unit reverseClosure: A←B←C chain — a change to A surfaces both B and C', () => {
  const files = {
    'lib/a.js': 'export const a = 1;',
    'lib/b.js': "import { a } from './a.js';",
    'lib/c.js': "import './b.js';",
  };
  const graph = buildImportGraph(Object.keys(files), graphIo(files));
  const closure = reverseClosure(graph, ['lib/a.js']);
  assert.deepEqual([...closure].sort(), ['lib/b.js', 'lib/c.js']);
});

test('@unit reverseClosure: an import cycle does not hang (visited-set guard)', () => {
  const files = {
    'lib/a.js': "import './b.js';",
    'lib/b.js': "import './a.js';", // a ↔ b cycle
    'lib/c.js': "import './a.js';",
  };
  const graph = buildImportGraph(Object.keys(files), graphIo(files));
  const closure = reverseClosure(graph, ['lib/a.js']);
  // b imports a, c imports a; b is reached, c is reached; the a↔b cycle does
  // not loop forever. Seed a is excluded.
  assert.deepEqual([...closure].sort(), ['lib/b.js', 'lib/c.js']);
});

test('@unit invertGraph: importee → its direct importers', () => {
  const files = {
    'lib/a.js': 'export const a = 1;',
    'lib/b.js': "import './a.js';",
    'lib/c.js': "import './a.js';",
  };
  const graph = buildImportGraph(Object.keys(files), graphIo(files));
  const reverse = invertGraph(graph);
  assert.deepEqual([...reverse.get('lib/a.js')].sort(), ['lib/b.js', 'lib/c.js']);
});

test('@unit reverseClosure: empty / odd input → empty set, never throws', () => {
  assert.deepEqual([...reverseClosure(new Map(), [])], []);
  assert.deepEqual([...reverseClosure(null, ['x'])], []);
  assert.deepEqual([...reverseClosure(new Map(), null)], []);
});

// ── SPEC_V081: generic core + honest `unanalyzed` (§VIII / §VI) ─────────────

test('@unit buildForwardGraph: a JS-only repo → forward edges + EMPTY unanalyzed (back-compat)', () => {
  const files = {
    'lib/a.js': 'export const a = 1;',
    'lib/b.js': "import { a } from './a.js';",
  };
  const { graph, unanalyzed } = buildForwardGraph(Object.keys(files), graphIo(files));
  assert.deepEqual([...graph.get('lib/b.js')], ['lib/a.js']);
  assert.deepEqual(unanalyzed, []); // no un-adapted code → empty (the AC-3 guarantee)
});

test('@unit buildForwardGraph: an un-adapted CODE file (Rust) → recorded in unanalyzed, no fake edges', () => {
  const files = {
    'lib/a.js': 'export const a = 1;',
    'src/main.rs': 'use crate::a; fn main() {}', // no Rust adapter → un-analyzed
  };
  const { graph, unanalyzed } = buildForwardGraph(Object.keys(files), graphIo(files));
  // The Rust file contributes NO edges and is NOT a graph node (never faked).
  assert.ok(!graph.has('src/main.rs'));
  assert.deepEqual(unanalyzed, [{ file: 'src/main.rs', language: 'Rust' }]);
});

test('@unit buildForwardGraph: a non-code file (.md/.json) is neither edged nor reported un-analyzed', () => {
  const files = {
    'lib/a.js': 'export const a = 1;',
    'README.md': '# hi — see lib/a.js',
    'package.json': '{}',
  };
  const { unanalyzed } = buildForwardGraph(Object.keys(files), graphIo(files));
  assert.deepEqual(unanalyzed, []); // docs/config never flood the list
});

test('@unit buildForwardGraph: junk input → empty graph + empty unanalyzed, never throws', () => {
  assert.deepEqual(buildForwardGraph(null, () => '').unanalyzed, []);
  assert.equal(buildForwardGraph(['a.js'], null).graph.size, 0);
});
