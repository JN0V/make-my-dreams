// @unit tests for lib/code-graph/adapters — the POLYGLOT import-edge adapter
// contract + registry (SPEC_V081 AC-1) and the JS adapter parity lock (AC-2).
// The JS specifier-parse + ./../ resolution moved here from import-graph.js with
// ZERO behavior change; these tests pin that. Pure over in-memory file sets.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import javascriptAdapter, {
  parseSpecifiers,
  resolveSpecifier,
} from '../../lib/code-graph/adapters/javascript.js';
import pythonAdapter from '../../lib/code-graph/adapters/python.js';
import {
  adapterFor,
  unanalyzedLanguageFor,
  classifyFile,
  extOf,
  ADAPTERS,
} from '../../lib/code-graph/adapters/index.js';

// ── AC-1: registry resolution ───────────────────────────────────────────────

test('@unit adapterFor: a .js/.mjs/.cjs file resolves to the JavaScript adapter', () => {
  assert.equal(adapterFor('lib/a.js'), javascriptAdapter);
  assert.equal(adapterFor('lib/a.mjs'), javascriptAdapter);
  assert.equal(adapterFor('lib/a.cjs'), javascriptAdapter);
  assert.equal(adapterFor('lib/a.js').id, 'javascript');
});

test('@unit adapterFor: .py resolves to the Python adapter', () => {
  assert.equal(adapterFor('pkg/__init__.py'), pythonAdapter);
  assert.equal(adapterFor('app/models.py').id, 'python');
});

test('@unit adapterFor: a file with no adapter (.rs/.md/junk) → null', () => {
  assert.equal(adapterFor('src/main.rs'), null); // code, but no adapter (yet)
  assert.equal(adapterFor('README.md'), null); // not code
  assert.equal(adapterFor(''), null);
  assert.equal(adapterFor(null), null);
  assert.equal(adapterFor(42), null);
});

test('@unit unanalyzedLanguageFor: a recognized code file with no adapter → its language; non-code → null', () => {
  assert.equal(unanalyzedLanguageFor('src/main.rs'), 'Rust');
  assert.equal(unanalyzedLanguageFor('cmd/server.go'), 'Go');
  assert.equal(unanalyzedLanguageFor('lib/core.c'), 'C');
  assert.equal(unanalyzedLanguageFor('app/types.ts'), 'TypeScript');
  // A file an adapter handles is NOT un-analyzed.
  assert.equal(unanalyzedLanguageFor('lib/a.js'), null);
  // Non-code files are never un-analyzed (no flooding a JS-only repo's list).
  assert.equal(unanalyzedLanguageFor('README.md'), null);
  assert.equal(unanalyzedLanguageFor('package.json'), null);
  assert.equal(unanalyzedLanguageFor('Makefile'), null);
});

test('@unit classifyFile: analyzed for JS, un-analyzed-with-language for Rust, plain for docs', () => {
  const js = classifyFile('lib/a.js');
  assert.equal(js.analyzed, true);
  assert.equal(js.adapter, javascriptAdapter);
  assert.equal(js.language, 'JavaScript');

  const rs = classifyFile('src/main.rs');
  assert.equal(rs.analyzed, false);
  assert.equal(rs.adapter, null);
  assert.equal(rs.language, 'Rust');
  assert.equal(rs.ext, '.rs');

  const md = classifyFile('docs/x.md');
  assert.equal(md.analyzed, false);
  assert.equal(md.language, null); // not code — ignored by the graph
});

test('@unit extOf: lowercased extension or empty; dotfiles and no-dot → empty', () => {
  assert.equal(extOf('lib/a.JS'), '.js');
  assert.equal(extOf('a/b/c.test.js'), '.js');
  assert.equal(extOf('Makefile'), '');
  assert.equal(extOf('.gitignore'), ''); // dotfile, not an extension
  assert.equal(extOf('noext'), '');
});

test('@unit ADAPTERS registry is frozen and includes JavaScript', () => {
  assert.ok(Object.isFrozen(ADAPTERS));
  assert.ok(ADAPTERS.includes(javascriptAdapter));
});

// ── AC-2: JS adapter — matches + importEdges + the moved parse/resolve logic ──

test('@unit javascriptAdapter.matches: by extension only', () => {
  assert.equal(javascriptAdapter.matches('lib/a.js'), true);
  assert.equal(javascriptAdapter.matches('lib/a.mjs'), true);
  assert.equal(javascriptAdapter.matches('lib/a.cjs'), true);
  assert.equal(javascriptAdapter.matches('lib/a.py'), false);
  assert.equal(javascriptAdapter.matches('lib/a.ts'), false);
  assert.equal(javascriptAdapter.matches(null), false);
});

test('@unit javascriptAdapter.importEdges: resolved repo-relative imports, externals dropped', () => {
  const repoFiles = new Set(['lib/a.js', 'lib/b.js', 'lib/c.js']);
  const edges = javascriptAdapter.importEdges({
    filePath: 'lib/c.js',
    content: "import { b } from './b.js';\nimport fs from 'node:fs';\nconst x = require('lodash');",
    repoFiles,
  });
  assert.deepEqual(edges, ['lib/b.js']); // node:fs + lodash dropped (external)
});

test('@unit javascriptAdapter.importEdges: a file never imports itself; odd input → []', () => {
  const repoFiles = new Set(['lib/a.js']);
  assert.deepEqual(
    javascriptAdapter.importEdges({ filePath: 'lib/a.js', content: "import './a.js';", repoFiles }),
    [],
  );
  assert.deepEqual(javascriptAdapter.importEdges({ filePath: 'lib/a.js', content: '', repoFiles }), []);
  assert.deepEqual(javascriptAdapter.importEdges({}), []);
  assert.deepEqual(javascriptAdapter.importEdges(), []);
});

// parseSpecifiers — moved verbatim from import-graph.js (parity lock).
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
  assert.deepEqual(parseSpecifiers(src), ['./real.js']);
});

test('@unit parseSpecifiers: a /* inside a line comment or string does NOT swallow later imports', () => {
  const src = [
    '// all logic lives in lib/*. (this /* is NOT a block comment opener)',
    "const glob = 'src/*'; // a string containing /* must not start a block",
    "import { real } from './real.js';",
    "import { also } from './also.js';",
  ].join('\n');
  const specs = parseSpecifiers(src);
  assert.ok(specs.includes('./real.js'));
  assert.ok(specs.includes('./also.js'));
});

test('@unit parseSpecifiers: a real /* … */ block comment IS stripped (multi-line)', () => {
  const src = [
    '/*',
    "  import { stale } from './stale.js';",
    '*/',
    "import { fresh } from './fresh.js';",
  ].join('\n');
  assert.deepEqual(parseSpecifiers(src), ['./fresh.js']);
});

test('@unit parseSpecifiers: never throws on odd input → []', () => {
  assert.deepEqual(parseSpecifiers(undefined), []);
  assert.deepEqual(parseSpecifiers(null), []);
  assert.deepEqual(parseSpecifiers(42), []);
  assert.deepEqual(parseSpecifiers(''), []);
});

// resolveSpecifier — moved verbatim from import-graph.js (parity lock).
test('@unit resolveSpecifier: resolves literal, +ext, and /index against the file set', () => {
  const set = new Set(['lib/a.js', 'lib/b.mjs', 'lib/c/index.js', 'lib/d.cjs']);
  assert.equal(resolveSpecifier('lib/x.js', './a.js', set), 'lib/a.js');
  assert.equal(resolveSpecifier('lib/x.js', './a', set), 'lib/a.js');
  assert.equal(resolveSpecifier('lib/x.js', './b', set), 'lib/b.mjs');
  assert.equal(resolveSpecifier('lib/x.js', './d', set), 'lib/d.cjs');
  assert.equal(resolveSpecifier('lib/x.js', './c', set), 'lib/c/index.js');
});

test('@unit resolveSpecifier: ./a and ../a resolve to DIFFERENT files (no basename collision)', () => {
  const set = new Set(['lib/a.js', 'a.js']);
  assert.equal(resolveSpecifier('lib/b.js', './a.js', set), 'lib/a.js');
  assert.equal(resolveSpecifier('lib/b.js', '../a.js', set), 'a.js');
});

test('@unit resolveSpecifier: bare / node: / absolute / unresolvable → null', () => {
  const set = new Set(['lib/a.js']);
  assert.equal(resolveSpecifier('lib/x.js', 'fs', set), null);
  assert.equal(resolveSpecifier('lib/x.js', 'lodash', set), null);
  assert.equal(resolveSpecifier('lib/x.js', 'node:path', set), null);
  assert.equal(resolveSpecifier('lib/x.js', '/abs/path.js', set), null);
  assert.equal(resolveSpecifier('lib/x.js', './does-not-exist.js', set), null);
});

test('@unit resolveSpecifier: never throws on odd input → null', () => {
  assert.equal(resolveSpecifier(null, './a', new Set(['a'])), null);
  assert.equal(resolveSpecifier('x.js', null, new Set()), null);
  assert.equal(resolveSpecifier('x.js', './a', undefined), null);
});

// ── AC-5: Python adapter — import/from resolution (the proof of genericity) ──

test('@unit pythonAdapter.matches: .py only', () => {
  assert.equal(pythonAdapter.matches('app/models.py'), true);
  assert.equal(pythonAdapter.matches('app/models.js'), false);
  assert.equal(pythonAdapter.matches(null), false);
});

test('@unit pythonAdapter.importEdges: `import a.b` → a/b.py or a/b/__init__.py', () => {
  const repoFiles = new Set(['app/main.py', 'app/models.py', 'app/db/__init__.py']);
  const edges = pythonAdapter.importEdges({
    filePath: 'app/main.py',
    content: 'import app.models\nimport app.db\nimport os\nimport requests',
    repoFiles,
  });
  // os (stdlib) + requests (third-party) drop — no repo file.
  assert.deepEqual(edges.sort(), ['app/db/__init__.py', 'app/models.py']);
});

test('@unit pythonAdapter.importEdges: `from a.b import x` resolves the module AND a submodule name', () => {
  const repoFiles = new Set(['pkg/__init__.py', 'pkg/util.py', 'pkg/sub/__init__.py']);
  // `from pkg import util` → util is a submodule (pkg/util.py); `from pkg import sub`
  // → sub is a subpackage (pkg/sub/__init__.py). The module `pkg` also resolves.
  const edges = pythonAdapter.importEdges({
    filePath: 'pkg/main.py',
    content: 'from pkg import util, sub\nfrom pkg.util import helper',
    repoFiles,
  });
  assert.ok(edges.includes('pkg/util.py'));
  assert.ok(edges.includes('pkg/sub/__init__.py'));
  assert.ok(edges.includes('pkg/__init__.py'));
});

test('@unit pythonAdapter.importEdges: relative `from . import x` resolves in the package dir', () => {
  const repoFiles = new Set(['app/main.py', 'app/helpers.py', 'app/util/__init__.py']);
  const edges = pythonAdapter.importEdges({
    filePath: 'app/main.py',
    content: 'from . import helpers\nfrom .util import thing',
    repoFiles,
  });
  assert.ok(edges.includes('app/helpers.py'));
  assert.ok(edges.includes('app/util/__init__.py'));
});

test('@unit pythonAdapter.importEdges: a commented-out import is NOT an edge; never self', () => {
  const repoFiles = new Set(['app/a.py', 'app/b.py']);
  const edges = pythonAdapter.importEdges({
    filePath: 'app/a.py',
    content: '# import app.b\nimport app.a  # importing self resolves to nothing new',
    repoFiles,
  });
  assert.deepEqual(edges, []); // the only real import resolves to self → dropped
});

test('@unit pythonAdapter.importEdges: odd input → [] (never throws)', () => {
  assert.deepEqual(pythonAdapter.importEdges({}), []);
  assert.deepEqual(pythonAdapter.importEdges(), []);
  assert.deepEqual(pythonAdapter.importEdges({ filePath: 'a.py', content: '', repoFiles: [] }), []);
});
