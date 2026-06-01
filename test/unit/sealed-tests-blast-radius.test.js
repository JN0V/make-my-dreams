// @unit tests for lib/sealed-tests/blast-radius.js — the grep-based blast
// radius stub (SPEC_V04A AC-5). Pure over injected fs.

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

test('@unit computeBlastRadius: finds direct importers via import/require', () => {
  const io = makeIo({
    'lib/app.js': 'export const x = 1;',
    'lib/ui.js': "import { x } from './app.js';\nexport const y = x;",
    'lib/cli.js': "const { x } = require('./app');\n",
    'lib/unrelated.js': 'export const z = 2;',
  });
  const r = computeBlastRadius(['lib/app.js'], io);
  assert.deepEqual(r.changed, ['lib/app.js']);
  assert.deepEqual(r.importers, ['lib/cli.js', 'lib/ui.js']); // sorted
});

test('@unit computeBlastRadius: a file is never its own importer', () => {
  const io = makeIo({
    'lib/app.js': "import './app.js';\nexport const x = 1;", // self-mention
    'lib/ui.js': "import './app.js';",
  });
  const r = computeBlastRadius(['lib/app.js'], io);
  assert.deepEqual(r.importers, ['lib/ui.js']);
});

test('@unit computeBlastRadius: a mere comment mention is NOT an importer', () => {
  const io = makeIo({
    'lib/app.js': 'export const x = 1;',
    'docs/notes.js': '// see app.js for the counter logic\nconst n = 1;',
  });
  const r = computeBlastRadius(['lib/app.js'], io);
  // notes.js mentions app.js only in a comment with no import/require → excluded.
  assert.deepEqual(r.importers, []);
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
});

test('@unit computeBlastRadius: empty / junk changed input → explicit empty, no throw', () => {
  assert.deepEqual(computeBlastRadius([], makeIo({ 'x.js': '1' })), { changed: [], importers: [] });
  assert.deepEqual(computeBlastRadius(null, makeIo({ 'x.js': '1' })), { changed: [], importers: [] });
  assert.deepEqual(
    computeBlastRadius([42, '', null], makeIo({ 'x.js': '1' })),
    { changed: [], importers: [] },
  );
});

test('@unit computeBlastRadius: missing io (no lister/reader) → changed only, no throw', () => {
  const r = computeBlastRadius(['lib/app.js']);
  assert.deepEqual(r, { changed: ['lib/app.js'], importers: [] });
});

test('@unit computeBlastRadius: a throwing lister → changed only, no crash', () => {
  const io = {
    listFiles: () => { throw new Error('EACCES'); },
    readFile: () => '',
  };
  const r = computeBlastRadius(['lib/app.js'], io);
  assert.deepEqual(r, { changed: ['lib/app.js'], importers: [] });
});

test('@unit computeBlastRadius: vanilla PWA with no imports → no importers', () => {
  // The greenfield demo case: index.html / app.js with no module references.
  const io = makeIo({
    'index.html': '<!doctype html><script src="app.js"></script>',
    'app.js': 'document.querySelector("#inc").onclick = () => {};',
  });
  const r = computeBlastRadius(['app.js'], io);
  assert.deepEqual(r.changed, ['app.js']);
  // index.html references app.js via a <script src> (not import/require) → not
  // counted by this stub; documented limitation (AST upgrade in v0.5).
  assert.deepEqual(r.importers, []);
});
