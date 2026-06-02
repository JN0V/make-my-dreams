// @unit tests for lib/test-curator/adapters/ — the POLYGLOT adapter contract +
// registry (SPEC_V080 AC-1) and the JS/Python adapter discovery (AC-2, AC-5).
// Pure, deterministic, never throws — discovery uses an INJECTED file reader, so
// no real filesystem is touched. Per testing.md §V: < 100 ms total.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveAdapters,
  detectStackNames,
  supportedStackNames,
  ADAPTERS,
  CAPABILITY_FLAGS,
  MANIFEST_STACKS,
} from '../../lib/test-curator/adapters/index.js';
import javascriptAdapter from '../../lib/test-curator/adapters/javascript.js';
import pythonAdapter from '../../lib/test-curator/adapters/python.js';

// A reader backed by an in-memory {path: content} map (the injection seam).
function fakeReader(map) {
  return (rel) => (Object.prototype.hasOwnProperty.call(map, rel) ? map[rel] : null);
}

// ── AC-1: registry resolution ────────────────────────────────────────────────

test('@unit resolveAdapters: package.json → JS only', () => {
  const ids = resolveAdapters({ manifests: ['package.json'] }).map((a) => a.id);
  assert.deepEqual(ids, ['javascript']);
});

test('@unit resolveAdapters: pyproject.toml / setup.py / requirements.txt → Python only', () => {
  for (const m of ['pyproject.toml', 'setup.py', 'requirements.txt']) {
    const ids = resolveAdapters({ manifests: [m] }).map((a) => a.id);
    assert.deepEqual(ids, ['python'], `manifest ${m}`);
  }
});

test('@unit resolveAdapters: a polyglot repo → BOTH adapters (registry order)', () => {
  const ids = resolveAdapters({ manifests: ['package.json', 'requirements.txt'] }).map((a) => a.id);
  assert.deepEqual(ids, ['javascript', 'python']);
});

test('@unit resolveAdapters: an unsupported stack (Cargo.toml / go.mod) → [] (none match)', () => {
  assert.deepEqual(resolveAdapters({ manifests: ['Cargo.toml'] }), []);
  assert.deepEqual(resolveAdapters({ manifests: ['go.mod'] }), []);
  assert.deepEqual(resolveAdapters({ manifests: [] }), []);
});

test('@unit resolveAdapters: accepts a bare string[] and junk → never throws', () => {
  assert.deepEqual(resolveAdapters(['package.json']).map((a) => a.id), ['javascript']);
  for (const junk of [null, undefined, 42, {}, 'x']) {
    assert.doesNotThrow(() => resolveAdapters(junk));
    assert.deepEqual(resolveAdapters(junk), []);
  }
});

test('@unit detectStackNames: names detected stacks INCLUDING unsupported (Rust/Go)', () => {
  assert.deepEqual(detectStackNames({ manifests: ['Cargo.toml'] }), ['Rust']);
  assert.deepEqual(detectStackNames({ manifests: ['go.mod', 'Cargo.toml'] }), ['Go', 'Rust']);
  // dedup across the two Python manifests
  assert.deepEqual(detectStackNames({ manifests: ['pyproject.toml', 'setup.py'] }), ['Python']);
});

test('@unit supportedStackNames: only stacks with an implemented adapter', () => {
  assert.deepEqual(supportedStackNames(), ['JavaScript/TypeScript', 'Python']);
});

test('@unit every registered adapter satisfies the contract (shape + capability flags)', () => {
  for (const a of ADAPTERS) {
    assert.equal(typeof a.id, 'string');
    assert.equal(typeof a.displayName, 'string');
    assert.equal(typeof a.matches, 'function');
    assert.equal(typeof a.discoverTests, 'function');
    for (const flag of CAPABILITY_FLAGS) {
      assert.equal(typeof a[flag], 'boolean', `${a.id}.${flag} must be a boolean`);
    }
  }
  // Coverage is deferred for ALL adapters in v0.8.0 (ADR: will be polyglot).
  assert.ok(ADAPTERS.every((a) => a.supportsCoverage === false));
  assert.ok(MANIFEST_STACKS['package.json']);
});

// ── AC-2: JS adapter discovery ───────────────────────────────────────────────

test('@unit JS adapter: discovers test()/it(), maps @-tags → stratum, untagged → null', () => {
  const map = {
    'test/unit/a.test.js': [
      "import { test } from 'node:test';",
      "import x from '../../lib/foo.js';",
      "test('@unit alpha', () => { const r = run(); assert.ok(r); cleanup(); });",
      "it('@smoke boots', () => {});",
      "test('plainly untagged', () => {});",
    ].join('\n'),
    'test/fixtures/sub/skip.test.js': "test('@unit fixture, excluded', () => {});",
    'lib/foo.js': 'export const foo = 1;',
  };
  const out = javascriptAdapter.discoverTests({
    files: Object.keys(map), readFile: fakeReader(map),
  });
  assert.equal(out.entries.length, 3); // fixture excluded
  const byTitle = Object.fromEntries(out.entries.map((e) => [e.title, e]));
  assert.equal(byTitle['@unit alpha'].stratum, 'unit');
  assert.equal(byTitle['@smoke boots'].stratum, 'smoke');
  assert.equal(byTitle['plainly untagged'].stratum, null);
  // targets resolved from the import
  assert.deepEqual(byTitle['@unit alpha'].targets, ['lib/foo.js']);
  // a body is extracted (supportsBodies)
  assert.ok(byTitle['@unit alpha'].body.includes('run()'));
});

test('@unit JS adapter: declares its capability flags + matches package.json only', () => {
  assert.equal(javascriptAdapter.supportsBodies, true);
  assert.equal(javascriptAdapter.supportsStratification, true);
  assert.equal(javascriptAdapter.supportsCoverage, false);
  assert.equal(javascriptAdapter.matches({ manifests: ['package.json'] }), true);
  assert.equal(javascriptAdapter.matches({ manifests: ['pyproject.toml'] }), false);
});

test('@unit JS adapter: junk input → empty, never throws', () => {
  for (const junk of [undefined, {}, { files: null }, { files: [1, 2, null] }]) {
    assert.doesNotThrow(() => javascriptAdapter.discoverTests(junk));
    const out = javascriptAdapter.discoverTests(junk);
    assert.ok(Array.isArray(out.entries) && Array.isArray(out.files));
  }
});

// ── AC-5: Python adapter discovery ───────────────────────────────────────────

test('@unit Python adapter: discovers def test_* (pytest fn + unittest method) with file/line/title', () => {
  const map = {
    'tests/test_math.py': [
      'import app.models',
      'from app.helpers import h',
      '',
      '@pytest.mark.smoke',
      'def test_add():',
      '    assert 1 + 1 == 2',
      '',
      'class TestThing:',
      '    def test_method(self):',
      '        assert True',
    ].join('\n'),
    'app/models.py': 'X = 1',
    'app/helpers.py': 'def h(): pass',
  };
  const out = pythonAdapter.discoverTests({ files: Object.keys(map), readFile: fakeReader(map) });
  assert.equal(out.entries.length, 2);
  const add = out.entries.find((e) => e.title === 'test_add');
  const method = out.entries.find((e) => e.title === 'test_method');
  assert.ok(add && method);
  assert.equal(add.stratum, 'smoke'); // from @pytest.mark.smoke
  assert.equal(method.stratum, null); // no marker
  assert.equal(add.line, 5);
  assert.equal(method.line, 9);
  // body is null (supportsBodies=false for v1 — honest)
  assert.equal(add.body, null);
  // targets: both module + package candidates emitted (bin filters to real files)
  assert.ok(add.targets.includes('app/models.py'));
  assert.ok(add.targets.includes('app/helpers.py'));
});

test('@unit Python adapter: file-glob — test_*.py / *_test.py / under tests/, excludes conftest.py', () => {
  const map = {
    'test_a.py': 'def test_one(): pass',
    'b_test.py': 'def test_two(): pass',
    'pkg/tests/c.py': 'def test_three(): pass',
    'conftest.py': 'def test_not_a_test(): pass',
    'app/main.py': 'def test_in_a_non_test_file(): pass',
  };
  const out = pythonAdapter.discoverTests({ files: Object.keys(map), readFile: fakeReader(map) });
  const titles = out.entries.map((e) => e.title).sort();
  assert.deepEqual(titles, ['test_one', 'test_three', 'test_two']);
});

test('@unit Python adapter: declares supportsBodies=false honestly + matches python manifests', () => {
  assert.equal(pythonAdapter.supportsBodies, false);
  assert.equal(pythonAdapter.supportsStratification, true);
  assert.equal(pythonAdapter.supportsCoverage, false);
  assert.equal(pythonAdapter.matches({ manifests: ['pyproject.toml'] }), true);
  assert.equal(pythonAdapter.matches({ manifests: ['package.json'] }), false);
});

test('@unit Python adapter: a non-marker decorator line does not leak a stratum', () => {
  const map = {
    'tests/test_x.py': [
      '@pytest.mark.unit',
      '@some.other.decorator',
      'def test_one():',
      '    pass',
      '',
      'def test_two():',
      '    pass',
    ].join('\n'),
  };
  const out = pythonAdapter.discoverTests({ files: Object.keys(map), readFile: fakeReader(map) });
  const one = out.entries.find((e) => e.title === 'test_one');
  const two = out.entries.find((e) => e.title === 'test_two');
  assert.equal(one.stratum, 'unit'); // marker still applies through the second decorator
  assert.equal(two.stratum, null); // marker did NOT leak to the next def
});

test('@unit Python adapter: junk input → empty, never throws', () => {
  for (const junk of [undefined, {}, { files: null }]) {
    assert.doesNotThrow(() => pythonAdapter.discoverTests(junk));
    const out = pythonAdapter.discoverTests(junk);
    assert.ok(Array.isArray(out.entries) && Array.isArray(out.files));
  }
});
