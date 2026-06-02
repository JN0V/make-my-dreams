// test/unit/deps-adapters.test.js — AC-2 for the deps-gate POLYGLOT adapters +
// registry (SPEC_V09B). Covers: resolveAdapters per-manifest (npm/python/both/
// none) + detect/supported naming; npm + python parseDependencies incl. skip-local;
// fetchMetadata mapping incl. 404 + throw via the injected fetchJson seam. The core
// (deps-assess.js) must import NO adapter and an adapter import NO core. Tagged @unit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  resolveAdapters,
  detectStackNames,
  supportedStackNames,
  ADAPTERS,
  MANIFEST_STACKS,
} from '../../lib/security/deps-adapters/index.js';
import npmAdapter from '../../lib/security/deps-adapters/npm.js';
import pythonAdapter from '../../lib/security/deps-adapters/python.js';

// ── §VIII dependency-direction guard: the core imports no adapter; adapters import
// no core. We assert it structurally on the source text (the heart of this slice). ─
test('@unit the core imports NO adapter and adapters import NO core (§VIII)', () => {
  // Match actual `import … from '…'` statements, not prose comments that merely
  // mention the dependency direction (index.js documents "core ← adapters").
  const importRe = /\bimport\b[^\n;]*\bfrom\s*['"]([^'"]+)['"]/g;
  const importsOf = (src) => {
    const specs = [];
    let m;
    while ((m = importRe.exec(src)) !== null) specs.push(m[1]);
    return specs;
  };
  const coreSrc = readFileSync(fileURLToPath(new URL('../../lib/security/deps-assess.js', import.meta.url)), 'utf8');
  assert.ok(!importsOf(coreSrc).some((s) => s.includes('deps-adapters')), 'deps-assess.js must not import any adapter');
  for (const rel of ['npm.js', 'python.js']) {
    const src = readFileSync(fileURLToPath(new URL(`../../lib/security/deps-adapters/${rel}`, import.meta.url)), 'utf8');
    assert.ok(!importsOf(src).some((s) => s.includes('deps-assess')), `${rel} must not import the core`);
  }
});

// ── registry resolution ──────────────────────────────────────────────────────
test('@unit resolveAdapters: package.json → npm', () => {
  const r = resolveAdapters({ manifests: ['package.json'] });
  assert.deepEqual(r.map((a) => a.id), ['npm']);
});

test('@unit resolveAdapters: requirements.txt / pyproject.toml → python', () => {
  assert.deepEqual(resolveAdapters({ manifests: ['requirements.txt'] }).map((a) => a.id), ['python']);
  assert.deepEqual(resolveAdapters({ manifests: ['pyproject.toml'] }).map((a) => a.id), ['python']);
});

test('@unit resolveAdapters: both manifests → both adapters (npm first)', () => {
  const r = resolveAdapters({ manifests: ['package.json', 'requirements.txt'] });
  assert.deepEqual(r.map((a) => a.id), ['npm', 'python']);
});

test('@unit resolveAdapters: Cargo.toml / go.mod only → [] (no adapter), but named', () => {
  assert.deepEqual(resolveAdapters({ manifests: ['Cargo.toml'] }), []);
  assert.deepEqual(resolveAdapters({ manifests: ['go.mod'] }), []);
  assert.deepEqual(detectStackNames({ manifests: ['Cargo.toml'] }), ['Rust (crates.io)']);
  assert.deepEqual(detectStackNames({ manifests: ['go.mod'] }), ['Go (module proxy)']);
});

test('@unit resolveAdapters: garbage signals → [] (never throws)', () => {
  assert.deepEqual(resolveAdapters(null), []);
  assert.deepEqual(resolveAdapters('nope'), []);
  assert.deepEqual(resolveAdapters({}), []);
});

test('@unit supportedStackNames names exactly the implemented adapters', () => {
  const s = supportedStackNames();
  assert.ok(s.includes('npm (JavaScript/TypeScript)'));
  assert.ok(s.includes('Python (PyPI)'));
  assert.equal(ADAPTERS.length, 2);
  assert.equal(MANIFEST_STACKS['Cargo.toml'], 'Rust (crates.io)');
});

// ── npm parse ────────────────────────────────────────────────────────────────
test('@unit npm parseDependencies: deps + devDeps, skipping local/workspace/git', () => {
  const pkg = JSON.stringify({
    dependencies: {
      lodash: '^4.17.21',
      'local-lib': 'file:../local-lib',
      'ws-pkg': 'workspace:*',
      'git-pkg': 'git+https://example.com/x.git',
      'gh-pkg': 'user/repo',
    },
    devDependencies: { jest: '^29.0.0', './rel': '1.0.0' },
  });
  const files = ['package.json', 'README.md'];
  const readFile = (f) => (f === 'package.json' ? pkg : null);
  const deps = npmAdapter.parseDependencies({ files, readFile });
  const names = deps.map((d) => d.name).sort();
  assert.deepEqual(names, ['jest', 'lodash']);
  assert.equal(deps.find((d) => d.name === 'lodash').manifestFile, 'package.json');
});

test('@unit npm parseDependencies: a malformed package.json is skipped, never throws', () => {
  const deps = npmAdapter.parseDependencies({ files: ['package.json'], readFile: () => '{not json' });
  assert.deepEqual(deps, []);
});

// ── npm fetchMetadata mapping (via the injected seam) ─────────────────────────
const NOW = Date.parse('2026-06-02T00:00:00Z');

test('@unit npm fetchMetadata: 200 → exists with age + downloads', async () => {
  const fetchJson = async (url) => {
    if (url.includes('registry.npmjs.org')) {
      return { status: 200, body: { time: { created: '2015-01-01T00:00:00Z' } } };
    }
    if (url.includes('api.npmjs.org')) return { status: 200, body: { downloads: 5_000_000 } };
    return { status: 404, body: null };
  };
  const md = await npmAdapter.fetchMetadata('lodash', { fetchJson, now: NOW });
  assert.equal(md.existsInRegistry, true);
  assert.ok(md.firstPublishedDaysAgo > 4000, 'an old package is thousands of days old');
  assert.equal(md.downloads, 5_000_000);
});

test('@unit npm fetchMetadata: 404 → existsInRegistry false', async () => {
  const fetchJson = async () => ({ status: 404, body: null });
  const md = await npmAdapter.fetchMetadata('totally-made-up', { fetchJson, now: NOW });
  assert.deepEqual(md, { existsInRegistry: false, firstPublishedDaysAgo: null, downloads: null });
});

test('@unit npm fetchMetadata: fetch throws → null (→ unverified, never a fabricated pass)', async () => {
  const fetchJson = async () => { throw new Error('network down'); };
  const md = await npmAdapter.fetchMetadata('lodash', { fetchJson, now: NOW });
  assert.equal(md, null);
});

test('@unit npm fetchMetadata: registry ok but downloads call throws → exists, downloads null', async () => {
  const fetchJson = async (url) => {
    if (url.includes('registry.npmjs.org')) return { status: 200, body: { time: { created: '2024-01-01T00:00:00Z' } } };
    throw new Error('downloads endpoint flaky');
  };
  const md = await npmAdapter.fetchMetadata('lodash', { fetchJson, now: NOW });
  assert.equal(md.existsInRegistry, true);
  assert.equal(md.downloads, null);
});

// ── python parse ─────────────────────────────────────────────────────────────
test('@unit python parseDependencies: requirements.txt incl. extras/markers, skip options/urls', () => {
  const reqs = [
    'requests>=2.0',
    'flask==2.0.1  # web',
    'django[argon2]>=3.0',
    'numpy ; python_version >= "3.8"',
    '-r other.txt',
    '-e .',
    'git+https://example.com/x.git#egg=x',
    './local-pkg',
    '# a comment',
    '',
  ].join('\n');
  const deps = pythonAdapter.parseDependencies({
    files: ['requirements.txt'],
    readFile: () => reqs,
  });
  assert.deepEqual(deps.map((d) => d.name).sort(), ['django', 'flask', 'numpy', 'requests']);
});

test('@unit python parseDependencies: pyproject PEP 621 + Poetry, skipping python pin + path entries', () => {
  const pyproject = [
    '[project]',
    'name = "demo"',
    'dependencies = [',
    '  "requests>=2.0",',
    '  "rich",',
    ']',
    '',
    '[tool.poetry.dependencies]',
    'python = "^3.10"',
    'flask = "^2.0"',
    'localdep = { path = "../localdep" }',
  ].join('\n');
  const deps = pythonAdapter.parseDependencies({
    files: ['pyproject.toml'],
    readFile: () => pyproject,
  });
  const names = deps.map((d) => d.name).sort();
  assert.ok(names.includes('requests'));
  assert.ok(names.includes('rich'));
  assert.ok(names.includes('flask'));
  assert.ok(!names.includes('python'), 'the Poetry python pin is not a package');
  assert.ok(!names.includes('localdep'), 'a path dependency is skipped');
});

// ── python fetchMetadata mapping ──────────────────────────────────────────────
test('@unit python fetchMetadata: 200 → exists with earliest-release age + downloads', async () => {
  const fetchJson = async (url) => {
    if (url.includes('pypi.org/pypi')) {
      return {
        status: 200,
        body: {
          releases: {
            '1.0.0': [{ upload_time_iso_8601: '2013-05-01T00:00:00Z' }],
            '2.0.0': [{ upload_time_iso_8601: '2020-01-01T00:00:00Z' }],
          },
        },
      };
    }
    if (url.includes('pypistats.org')) return { status: 200, body: { data: { last_month: 9_000_000 } } };
    return { status: 404, body: null };
  };
  const md = await pythonAdapter.fetchMetadata('requests', { fetchJson, now: NOW });
  assert.equal(md.existsInRegistry, true);
  assert.ok(md.firstPublishedDaysAgo > 4000, 'earliest release is the 2013 one');
  assert.equal(md.downloads, 9_000_000);
});

test('@unit python fetchMetadata: 404 → not exists; throw → null', async () => {
  const md404 = await pythonAdapter.fetchMetadata('reqeusts', { fetchJson: async () => ({ status: 404, body: null }), now: NOW });
  assert.deepEqual(md404, { existsInRegistry: false, firstPublishedDaysAgo: null, downloads: null });
  const mdThrow = await pythonAdapter.fetchMetadata('requests', { fetchJson: async () => { throw new Error('offline'); }, now: NOW });
  assert.equal(mdThrow, null);
});
