// test/integration/test-health-polyglot.test.js — CLI-level tests for the
// POLYGLOT Test Curator (SPEC_V080). We spawn the real bin/mmd.js in throwaway
// git repos for each stack to cover the §VIII gate end-to-end:
//   AC-4  a Rust-only repo (Cargo.toml + a #[test] file) → HONEST refusal, exit 6,
//         NO report written, NO fabricated numbers.
//   AC-5  a Python repo (pyproject + def test_* + pytest markers) → a REAL report:
//         tests discovered, stratified, clustered, redundancy honestly unavailable.
//   AC-2  a JS repo → analyzed as before, naming the stack; read-only contract.
//   mixed JS + Rust → JS analyzed, Rust named as detected-but-unsupported.
// Tagged @integration. Every spawned child has a hard timeout (L-016/L-019).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 20000 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

function runMmd(cwd, args, extraEnv = {}) {
  return spawnSync('node', [MMD, 'test-health', ...args], {
    cwd, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, MMD_SKIP_SETUP: '1', MMD_SKIP_GROUNDING: '1', ...extraEnv },
  });
}

async function initGit(dir) {
  // A committed doc so docs/ is tracked (a fixture artifact; real MMD tracks docs/).
  await mkdir(path.join(dir, 'docs'), { recursive: true });
  await writeFile(path.join(dir, 'docs', 'placeholder.md'), 'placeholder\n');
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 't@t.t']);
  git(dir, ['config', 'user.name', 'T']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'baseline']);
}

// ── AC-4: a Rust-only repo gets an HONEST refusal, not garbage ───────────────
async function makeRustRepo() {
  const dir = await mkdtemp(path.join(tmpdir(), 'mmd-th-rust-'));
  await mkdir(path.join(dir, 'src'), { recursive: true });
  await writeFile(path.join(dir, 'Cargo.toml'), '[package]\nname = "fixture"\nversion = "0.1.0"\n');
  await writeFile(
    path.join(dir, 'src', 'lib.rs'),
    ['pub fn add(a: i32, b: i32) -> i32 { a + b }', '', '#[test]', 'fn test_add() { assert_eq!(add(1, 2), 3); }'].join('\n'),
  );
  await initGit(dir);
  return dir;
}

test('@integration test-health: a Rust repo → honest refusal (exit 6), NO report, NO numbers', async () => {
  const dir = await makeRustRepo();
  try {
    const r = runMmd(dir, []);
    assert.equal(r.status, 6, `expected exit 6, got ${r.status}: ${r.stderr}`);
    assert.match(r.stderr, /no Test Curator adapter/i);
    assert.match(r.stderr, /Rust/);
    assert.match(r.stderr, /Supported stacks:.*JavaScript\/TypeScript.*Python/);
    assert.match(r.stderr, /§VIII|fabricate/i);
    // NO report written, NO fabricated numbers on stdout.
    assert.ok(!existsSync(path.join(dir, 'docs', 'test-health.md')), 'must NOT write a report');
    assert.doesNotMatch(r.stdout, /Corpus:/);
    // Read-only: nothing changed in the tree.
    assert.equal(git(dir, ['status', '--porcelain']).trim(), '');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── AC-5: a Python repo yields a REAL, honest report ─────────────────────────
async function makePythonRepo() {
  const dir = await mkdtemp(path.join(tmpdir(), 'mmd-th-py-'));
  await mkdir(path.join(dir, 'app'), { recursive: true });
  await mkdir(path.join(dir, 'tests'), { recursive: true });
  await writeFile(path.join(dir, 'pyproject.toml'), '[project]\nname = "fixture"\nversion = "0.1.0"\n');
  await writeFile(path.join(dir, 'app', '__init__.py'), '');
  await writeFile(path.join(dir, 'app', 'calc.py'), 'def add(a, b):\n    return a + b\n');
  await writeFile(
    path.join(dir, 'tests', 'test_calc.py'),
    [
      'from app.calc import add',
      '',
      '@pytest.mark.smoke',
      'def test_add_smoke():',
      '    assert add(1, 2) == 3',
      '',
      '@pytest.mark.unit',
      'def test_add_unit():',
      '    assert add(2, 2) == 4',
      '',
      'def test_untagged():',
      '    assert add(0, 0) == 0',
    ].join('\n'),
  );
  await writeFile(
    path.join(dir, 'tests', 'test_models.py'),
    ['import unittest', 'from app.calc import add', '', 'class TestModels(unittest.TestCase):', '    def test_method(self):', '        self.assertEqual(add(1, 1), 2)'].join('\n'),
  );
  await initGit(dir);
  return dir;
}

test('@integration test-health: a Python repo → real report (discovered, stratified, clustered, honest redundancy)', async () => {
  const dir = await makePythonRepo();
  try {
    const r = runMmd(dir, ['--dry-run']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /# MMD Test Health/);
    // Names Python as the analyzed stack.
    assert.match(r.stdout, /analyzed stack[\s\S]*Python/);
    // Tests discovered: 4 (3 in test_calc + 1 method in test_models).
    assert.match(r.stdout, /\*\*4 tests\*\*/);
    // Stratification: marker-derived strata present.
    assert.match(r.stdout, /\|\s*`@smoke`\s*\|\s*1\s*\|/);
    assert.match(r.stdout, /\|\s*`@unit`\s*\|\s*1\s*\|/);
    // The untagged tests (a §V violation) are listed by title — both the
    // module-level pytest fn and the unittest method that carry no marker.
    assert.match(r.stdout, /test_untagged/);
    assert.match(r.stdout, /test_method/);
    // Clustering works — the project module is detected as a target.
    assert.match(r.stdout, /app\/calc\.py/);
    // Redundancy honestly UNAVAILABLE for Python (no body extractor), NOT "✅ none".
    assert.match(r.stdout, /[Nn]ot available[\s\S]*Python/);
    assert.doesNotMatch(r.stdout, /No near-duplicate test pairs/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration test-health: a Python repo write → only docs/test-health.md changes (read-only)', async () => {
  const dir = await makePythonRepo();
  try {
    const r = runMmd(dir, []);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Analyzed stack\(s\): Python/);
    const changed = git(dir, ['status', '--porcelain']).split('\n').map((l) => l.slice(3)).filter(Boolean);
    assert.deepEqual(changed, ['docs/test-health.md'], `unexpected changes: ${changed}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── AC-2: a JS repo is analyzed as before, naming the stack ──────────────────
async function makeJsRepo() {
  const dir = await mkdtemp(path.join(tmpdir(), 'mmd-th-js-'));
  await mkdir(path.join(dir, 'test', 'unit'), { recursive: true });
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture', version: '0.8.0' }));
  await writeFile(
    path.join(dir, 'test', 'unit', 'a.test.js'),
    ["import { test } from 'node:test';", "test('@unit alpha', () => {});", "test('plain', () => {});"].join('\n'),
  );
  await initGit(dir);
  return dir;
}

test('@integration test-health: a JS repo → analyzed, names JavaScript/TypeScript', async () => {
  const dir = await makeJsRepo();
  try {
    const r = runMmd(dir, ['--dry-run']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /analyzed stack[\s\S]*JavaScript\/TypeScript/);
    assert.match(r.stdout, /\*\*2 tests\*\*/);
    assert.match(r.stdout, /plain/); // the untagged test is listed
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── Mixed JS + Rust → JS analyzed, Rust named as detected-but-unsupported ────
test('@integration test-health: a mixed JS+Rust repo → JS analyzed, Rust noted as unsupported', async () => {
  const dir = await makeJsRepo();
  try {
    await writeFile(path.join(dir, 'Cargo.toml'), '[package]\nname = "x"\nversion = "0.1.0"\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'add rust manifest']);
    const r = runMmd(dir, []);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Analyzed stack\(s\): JavaScript\/TypeScript/);
    assert.match(r.stdout, /UNSUPPORTED.*Rust|Rust.*not analyzed|Detected but UNSUPPORTED[\s\S]*Rust/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
