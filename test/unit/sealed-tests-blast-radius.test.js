// @unit tests for lib/sealed-tests/blast-radius.js — import-graph-accurate
// blast radius (SPEC_V04C AC-4; upgrades the v0.4.a fragment-grep stub). Pure
// over injected fs. The shape is now { changed, importers, transitive } where
// `importers` = direct one-hop importers (resolved) and `transitive` = the full
// reverse closure (the blast radius). Resolved semantics: a comment-only mention
// is excluded; ./x and ../x are not conflated; cycles do not hang.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeBlastRadius } from '../../lib/sealed-tests/blast-radius.js';

function makeIo(files) {
  return {
    listFiles: () => Object.keys(files),
    readFile: (rel) => {
      if (!(rel in files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return files[rel];
    },
  };
}

test('@unit computeBlastRadius: finds direct importers via resolved import/require', () => {
  const io = makeIo({
    'lib/app.js': 'export const x = 1;',
    'lib/ui.js': "import { x } from './app.js';\nexport const y = x;",
    'lib/cli.js': "const { x } = require('./app');\n", // resolves via +.js
    'lib/unrelated.js': 'export const z = 2;',
  });
  const r = computeBlastRadius(['lib/app.js'], io);
  assert.deepEqual(r.changed, ['lib/app.js']);
  assert.deepEqual(r.importers, ['lib/cli.js', 'lib/ui.js']); // sorted, direct
  assert.deepEqual(r.transitive, ['lib/cli.js', 'lib/ui.js']); // same here (one hop)
});

test('@unit computeBlastRadius: transitive reverse closure — A←B←C surfaces both B and C', () => {
  // The mission validation (SPEC §1): change to lib/a.js, imported by lib/b.js,
  // imported by lib/c.js. transitive = [b, c]; importers (direct) = [b].
  const io = makeIo({
    'lib/a.js': 'export const a = 1;',
    'lib/b.js': "import { a } from './a.js';\nexport const b = a;",
    'lib/c.js': "import { b } from './b.js';\nexport const c = b;",
  });
  const r = computeBlastRadius(['lib/a.js'], io);
  assert.deepEqual(r.changed, ['lib/a.js']);
  assert.deepEqual(r.importers, ['lib/b.js']); // direct only
  assert.deepEqual(r.transitive, ['lib/b.js', 'lib/c.js']); // full closure
});

test('@unit computeBlastRadius: a file is never its own importer', () => {
  const io = makeIo({
    'lib/app.js': "import './app.js';\nexport const x = 1;", // self-mention
    'lib/ui.js': "import './app.js';",
  });
  const r = computeBlastRadius(['lib/app.js'], io);
  assert.deepEqual(r.importers, ['lib/ui.js']);
  assert.deepEqual(r.transitive, ['lib/ui.js']);
});

test('@unit computeBlastRadius: a mere comment mention is NOT an importer (resolved semantics)', () => {
  const io = makeIo({
    'lib/app.js': 'export const x = 1;',
    // mentions ./app.js ONLY in a comment and in a plain string — no real import.
    'docs/notes.js': "// import './app.js' for the counter logic\nconst n = 'see ./app.js';",
  });
  const r = computeBlastRadius(['lib/app.js'], io);
  assert.deepEqual(r.importers, []);
  assert.deepEqual(r.transitive, []);
});

test('@unit computeBlastRadius: ./x and ../x are NOT conflated (no basename collision)', () => {
  // Two distinct files share the basename `helper.js`. A real importer of the
  // nested one must NOT be counted as an importer of the top-level one.
  const io = makeIo({
    'helper.js': 'export const top = 1;',
    'lib/helper.js': 'export const nested = 1;',
    'lib/uses-nested.js': "import { nested } from './helper.js';", // → lib/helper.js
  });
  const top = computeBlastRadius(['helper.js'], io);
  assert.deepEqual(top.importers, [], 'top-level helper.js has no real importer');
  assert.deepEqual(top.transitive, []);

  const nested = computeBlastRadius(['lib/helper.js'], io);
  assert.deepEqual(nested.importers, ['lib/uses-nested.js']);
});

test('@unit computeBlastRadius: an import cycle does not hang', () => {
  const io = makeIo({
    'lib/a.js': "import './b.js';\nexport const a = 1;",
    'lib/b.js': "import './a.js';\nexport const b = 1;", // a ↔ b cycle
    'lib/c.js': "import './a.js';",
  });
  const r = computeBlastRadius(['lib/a.js'], io);
  // b imports a, c imports a; both surface; the a↔b cycle does not loop forever.
  assert.deepEqual(r.importers, ['lib/b.js', 'lib/c.js']);
  assert.deepEqual(r.transitive, ['lib/b.js', 'lib/c.js']);
});

test('@unit computeBlastRadius: multiple changed files union their importers', () => {
  const io = makeIo({
    'lib/a.js': 'export const a = 1;',
    'lib/b.js': 'export const b = 1;',
    'lib/uses-a.js': "import { a } from './a.js';",
    'lib/uses-b.js': "import { b } from './b.js';",
  });
  const r = computeBlastRadius(['lib/a.js', 'lib/b.js'], io);
  assert.deepEqual(r.changed, ['lib/a.js', 'lib/b.js']);
  assert.deepEqual(r.importers, ['lib/uses-a.js', 'lib/uses-b.js']);
  assert.deepEqual(r.transitive, ['lib/uses-a.js', 'lib/uses-b.js']);
});

test('@unit computeBlastRadius: empty / junk changed input → explicit empty, no throw', () => {
  const e = { changed: [], importers: [], transitive: [] };
  assert.deepEqual(computeBlastRadius([], makeIo({ 'x.js': '1' })), e);
  assert.deepEqual(computeBlastRadius(null, makeIo({ 'x.js': '1' })), e);
  assert.deepEqual(computeBlastRadius([42, '', null], makeIo({ 'x.js': '1' })), e);
});

test('@unit computeBlastRadius: missing io (no lister/reader) → changed only, no throw', () => {
  const r = computeBlastRadius(['lib/app.js']);
  assert.deepEqual(r, { changed: ['lib/app.js'], importers: [], transitive: [] });
});

test('@unit computeBlastRadius: a throwing lister → changed only, no crash', () => {
  const io = {
    listFiles: () => { throw new Error('EACCES'); },
    readFile: () => '',
  };
  const r = computeBlastRadius(['lib/app.js'], io);
  assert.deepEqual(r, { changed: ['lib/app.js'], importers: [], transitive: [] });
});

test('@unit computeBlastRadius: vanilla PWA with a <script src> (not a module import) → no importers', () => {
  // The greenfield demo case: index.html references app.js via <script src>,
  // which is NOT a JS module import/require → not in the import graph. Documented
  // residual gap (non-JS importers) — see ADR-027.
  const io = makeIo({
    'index.html': '<!doctype html><script src="app.js"></script>',
    'app.js': 'document.querySelector("#inc").onclick = () => {};',
  });
  const r = computeBlastRadius(['app.js'], io);
  assert.deepEqual(r.changed, ['app.js']);
  assert.deepEqual(r.importers, []);
  assert.deepEqual(r.transitive, []);
});
