// @unit tests for lib/sealed-tests/import-graph.js — the import-graph analysis
// that upgrades the v0.4.a fragment-grep stub (SPEC_V04C AC-1/2/3). Pure over
// in-memory file maps (no real fs).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseSpecifiers,
  resolveSpecifier,
  buildImportGraph,
  invertGraph,
  reverseClosure,
} from '../../lib/sealed-tests/import-graph.js';

// ── AC-1: parseSpecifiers ──────────────────────────────────────────────────

test('@unit parseSpecifiers: extracts all five import forms (single + double quotes)', () => {
  const src = [
    "import a from './a.js';",
    'import b from "./b.js";',
    "import { c } from './c.js';",
    "import './side-effect.js';",
    "export { d } from './d.js';",
    "export * from './e.js';",
    "const f = require('./f.js');",
    'const g = require("./g.js");',
    "const h = await import('./h.js');",
    'const i = await import("./i.js");',
  ].join('\n');
  const specs = parseSpecifiers(src);
  for (const s of [
    './a.js', './b.js', './c.js', './side-effect.js', './d.js',
    './e.js', './f.js', './g.js', './h.js', './i.js',
  ]) {
    assert.ok(specs.includes(s), `expected specifier ${s} to be extracted`);
  }
});

test('@unit parseSpecifiers: a filename only in a comment or unrelated string is NOT returned', () => {
  const src = [
    "// import './commented-out.js';",
    "/* import './block-commented.js'; */",
    "const label = 'see ./app.js for details'; // a plain string, not an import",
    "import { real } from './real.js';",
  ].join('\n');
  const specs = parseSpecifiers(src);
  assert.deepEqual(specs, ['./real.js']);
  assert.ok(!specs.includes('./commented-out.js'));
  assert.ok(!specs.includes('./block-commented.js'));
});

test('@unit parseSpecifiers: bare and node: specifiers are returned as-is (resolution drops them later)', () => {
  const src = "import fs from 'node:fs';\nimport _ from 'lodash';\nimport x from './x.js';";
  const specs = parseSpecifiers(src);
  assert.ok(specs.includes('node:fs'));
  assert.ok(specs.includes('lodash'));
  assert.ok(specs.includes('./x.js'));
});

test('@unit parseSpecifiers: a /* inside a line comment or string does NOT swallow later imports', () => {
  // Regression (v0.4.c Phase-4): a naive block-comment regex saw the `/*` in
  // `lib/*.` and ate everything up to the next `*/`, dropping real imports. The
  // char scanner keeps line-comments and strings from opening a block comment.
  const src = [
    '// all logic lives in lib/*. (this /* is NOT a block comment opener)',
    "const glob = 'src/*'; // a string containing /* must not start a block",
    "import { real } from './real.js';",
    "import { also } from './also.js';",
  ].join('\n');
  const specs = parseSpecifiers(src);
  assert.ok(specs.includes('./real.js'), 'the import after a /*-in-comment must survive');
  assert.ok(specs.includes('./also.js'));
});

test('@unit parseSpecifiers: a real /* … */ block comment IS stripped (multi-line)', () => {
  const src = [
    '/*',
    "  import { stale } from './stale.js';",
    '*/',
    "import { fresh } from './fresh.js';",
  ].join('\n');
  const specs = parseSpecifiers(src);
  assert.deepEqual(specs, ['./fresh.js']);
});

test('@unit parseSpecifiers: never throws on odd input → []', () => {
  assert.deepEqual(parseSpecifiers(undefined), []);
  assert.deepEqual(parseSpecifiers(null), []);
  assert.deepEqual(parseSpecifiers(42), []);
  assert.deepEqual(parseSpecifiers(''), []);
  assert.deepEqual(parseSpecifiers('no imports here at all'), []);
});

// ── AC-2: resolveSpecifier ─────────────────────────────────────────────────

test('@unit resolveSpecifier: resolves literal, +ext, and /index against the file set', () => {
  const set = new Set(['lib/a.js', 'lib/b.mjs', 'lib/c/index.js', 'lib/d.cjs']);
  assert.equal(resolveSpecifier('lib/x.js', './a.js', set), 'lib/a.js'); // literal
  assert.equal(resolveSpecifier('lib/x.js', './a', set), 'lib/a.js'); // +.js
  assert.equal(resolveSpecifier('lib/x.js', './b', set), 'lib/b.mjs'); // +.mjs
  assert.equal(resolveSpecifier('lib/x.js', './d', set), 'lib/d.cjs'); // +.cjs
  assert.equal(resolveSpecifier('lib/x.js', './c', set), 'lib/c/index.js'); // /index.js
});

test('@unit resolveSpecifier: ./a and ../a resolve to DIFFERENT files (no basename collision)', () => {
  const set = new Set(['lib/a.js', 'a.js']);
  // from lib/b.js: ./a → lib/a.js ; ../a → a.js
  assert.equal(resolveSpecifier('lib/b.js', './a.js', set), 'lib/a.js');
  assert.equal(resolveSpecifier('lib/b.js', '../a.js', set), 'a.js');
  assert.notEqual(
    resolveSpecifier('lib/b.js', './a.js', set),
    resolveSpecifier('lib/b.js', '../a.js', set),
  );
});

test('@unit resolveSpecifier: bare / node: / absolute / unresolvable → null', () => {
  const set = new Set(['lib/a.js']);
  assert.equal(resolveSpecifier('lib/x.js', 'fs', set), null); // bare
  assert.equal(resolveSpecifier('lib/x.js', 'lodash', set), null); // bare npm
  assert.equal(resolveSpecifier('lib/x.js', 'node:path', set), null); // node:
  assert.equal(resolveSpecifier('lib/x.js', '/abs/path.js', set), null); // absolute
  assert.equal(resolveSpecifier('lib/x.js', './does-not-exist.js', set), null); // unresolvable
});

test('@unit resolveSpecifier: never throws on odd input → null', () => {
  assert.equal(resolveSpecifier(null, './a', new Set(['a'])), null);
  assert.equal(resolveSpecifier('x.js', null, new Set()), null);
  assert.equal(resolveSpecifier('x.js', './a', undefined), null);
});

// ── AC-3: buildImportGraph + reverse closure ───────────────────────────────

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
