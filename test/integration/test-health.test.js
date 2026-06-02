// test/integration/test-health.test.js — CLI-level tests for `mmdream test-health`
// (SPEC_V076 AC-3). We spawn the real bin/mmd.js child in a throwaway git repo
// so the dispatch wiring, the real git ls-files gather, the scan + build, the
// single-file write, the --dry-run, the env-override + fallback, and --help are
// covered end-to-end. Tagged @integration.
//
// The HEADLINE assertion is the READ-ONLY CONTRACT (SPEC §4): after a run, the
// ONLY changed tracked path is docs/test-health.md. L-016/L-019: every spawned
// child has a hard timeout.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
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

// A fixture repo with a handful of test files: tagged + untagged + a deliberately
// oversized one, plus a discover-style fixture under test/fixtures/ that MUST be
// excluded from the corpus.
async function makeRepo() {
  const dir = await mkdtemp(path.join(tmpdir(), 'mmd-testhealth-'));
  await mkdir(path.join(dir, 'docs'), { recursive: true });
  await mkdir(path.join(dir, 'test', 'unit'), { recursive: true });
  await mkdir(path.join(dir, 'test', 'fixtures', 'sub'), { recursive: true });

  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture', version: '0.7.6' }));
  // A committed doc so docs/ is a tracked dir — otherwise git reports the whole
  // untracked `docs/` rather than the single new docs/test-health.md (a fixture
  // artifact; the real MMD repo already tracks docs/).
  await writeFile(path.join(dir, 'docs', 'placeholder.md'), 'placeholder\n');

  await writeFile(
    path.join(dir, 'test', 'unit', 'a.test.js'),
    [
      "import { test } from 'node:test';",
      "test('@unit alpha', () => {});",
      "test('@smoke boots', () => {});",
      "test('plainly untagged thing', () => {});",
    ].join('\n'),
  );
  // A deliberately oversized file (many lines).
  const big = ["import { test } from 'node:test';"];
  for (let i = 0; i < 30; i += 1) big.push(`test('@unit big case ${i}', () => {});`);
  while (big.length < 80) big.push('// filler line to push the file over the line threshold');
  await writeFile(path.join(dir, 'test', 'unit', 'big.test.js'), big.join('\n'));

  // A discover fixture test — MUST be excluded from MMD's corpus.
  await writeFile(
    path.join(dir, 'test', 'fixtures', 'sub', 'fixture.test.js'),
    "test('@unit this is a fixture, not corpus', () => {});\n",
  );

  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 't@t.t']);
  git(dir, ['config', 'user.name', 'T']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'baseline']);
  return dir;
}

test('@integration test-health: writes docs/test-health.md and prints a summary', async () => {
  const dir = await makeRepo();
  try {
    const r = runMmd(dir, []);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Test-health report written to docs\/test-health\.md/);
    assert.match(r.stdout, /Corpus:/);
    assert.match(r.stdout, /Stratification:/);
    // The fixture test must be excluded → corpus counts only a.test.js + big.test.js.
    assert.doesNotMatch(r.stdout, /fixture, not corpus/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration test-health: READ-ONLY — only docs/test-health.md changes', async () => {
  const dir = await makeRepo();
  try {
    const r = runMmd(dir, []);
    assert.equal(r.status, 0, r.stderr);
    const status = git(dir, ['status', '--porcelain']);
    const changed = status.split('\n').map((l) => l.slice(3)).filter(Boolean);
    assert.deepEqual(changed, ['docs/test-health.md'], `unexpected changes: ${status}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration test-health: the report names the untagged test and excludes fixtures', async () => {
  const dir = await makeRepo();
  try {
    const r = runMmd(dir, ['--dry-run']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /# MMD Test Health/);
    assert.match(r.stdout, /plainly untagged thing/);
    assert.match(r.stdout, /test\/unit\/a\.test\.js:4/);
    // fixtures excluded from the corpus
    assert.doesNotMatch(r.stdout, /test\/fixtures/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration test-health: --dry-run writes nothing (clean tree)', async () => {
  const dir = await makeRepo();
  try {
    const r = runMmd(dir, ['--dry-run']);
    assert.equal(r.status, 0, r.stderr);
    const status = git(dir, ['status', '--porcelain']);
    assert.equal(status.trim(), '', `dry-run must write nothing, got: ${status}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration test-health: MMD_TEST_FILE_MAX_LINES override flags big.test.js', async () => {
  const dir = await makeRepo();
  try {
    // big.test.js is ~80 lines; a low override flags it as oversized.
    const r = runMmd(dir, ['--dry-run'], { MMD_TEST_FILE_MAX_LINES: '40' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /big\.test\.js/);
    assert.match(r.stdout, /split candidate/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration test-health: a junk env threshold falls back with an honest note', async () => {
  const dir = await makeRepo();
  try {
    const r = runMmd(dir, ['--dry-run'], { MMD_TEST_FILE_MAX_LINES: 'banana' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /MMD_TEST_FILE_MAX_LINES.*not a positive integer.*default/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration test-health: --help prints usage and exits 0', async () => {
  const dir = await makeRepo();
  try {
    const r = runMmd(dir, ['--help']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /mmdream test-health/);
    assert.match(r.stdout, /READ-ONLY/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration test-health: unknown flag → exit 2', async () => {
  const dir = await makeRepo();
  try {
    const r = runMmd(dir, ['--bogus']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /unknown test-health arg/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration test-health: not a git repo → honest exit 5', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mmd-testhealth-nogit-'));
  try {
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', version: '0.7.6' }));
    const r = runMmd(dir, []);
    assert.equal(r.status, 5);
    assert.match(r.stderr, /not a git repo|git failed/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
