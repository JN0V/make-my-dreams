// test/integration/test-health-redundancy.test.js — CLI-level tests for the
// REDUNDANCY face of `mmd test-health` (SPEC_V077 AC-3). We spawn the real
// bin/mmd.js in a throwaway git repo whose corpus contains a deliberate
// near-duplicate pair (within one file) and a module tested by several files,
// then assert the report's "Redundancy candidates" section surfaces them —
// while the READ-ONLY contract still holds (only docs/test-health.md changes).
// Tagged @integration. L-016/L-019: every spawned child has a hard timeout.

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

// A body long enough to clear the redundancy precision floor; two copies differ
// by a single literal (status 0 → 2) so their token-shingle Jaccard stays ~0.93
// — squarely in (0.9, 1.0), a real copy-paste near-duplicate.
const DUP_BODY_1 = `{
    const repo = await makeRepo();
    const r = runThing(repo, ['--flag', '--verbose']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /report written/);
    assert.doesNotMatch(r.stdout, /error/);
    const tree = git(repo, ['status', '--porcelain']);
    assert.equal(tree.trim(), '');
    cleanup(repo);
  }`;
const DUP_BODY_2 = `{
    const repo = await makeRepo();
    const r = runThing(repo, ['--flag', '--verbose']);
    assert.equal(r.status, 2);
    assert.match(r.stdout, /report written/);
    assert.doesNotMatch(r.stdout, /error/);
    const tree = git(repo, ['status', '--porcelain']);
    assert.equal(tree.trim(), '');
    cleanup(repo);
  }`;
// A genuinely different body — must NOT be flagged against the dup pair.
const DIFFERENT_BODY = `{
    const parsed = parseConfig('a=1;b=2');
    expect(parsed.a).toBe(1);
    expect(parsed.b).toBe(2);
    expect(Object.keys(parsed)).toHaveLength(2);
  }`;

async function makeRepo() {
  const dir = await mkdtemp(path.join(tmpdir(), 'mmd-redundancy-'));
  await mkdir(path.join(dir, 'docs'), { recursive: true });
  await mkdir(path.join(dir, 'test', 'integration'), { recursive: true });
  await mkdir(path.join(dir, 'lib'), { recursive: true });
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture', version: '0.7.7' }));
  await writeFile(path.join(dir, 'docs', 'placeholder.md'), 'placeholder\n');
  // The REAL target module the test files import — so it resolves to a real file
  // and survives keepRealTargets (the cluster table only counts real modules,
  // not fixture-string phantoms).
  await writeFile(path.join(dir, 'lib', 'widget.js'), 'export const runThing = () => 1;\n');

  // A file with a near-duplicate pair + one genuinely-different test. It imports
  // lib/widget.js so the file clusters on that target.
  await writeFile(
    path.join(dir, 'test', 'integration', 'widget.test.js'),
    [
      "import { test } from 'node:test';",
      "import { runThing } from '../../lib/widget.js';",
      `test('@integration widget happy path', async () => ${DUP_BODY_1});`,
      `test('@integration widget alternate path', async () => ${DUP_BODY_2});`,
      `test('@integration widget parses config', () => ${DIFFERENT_BODY});`,
    ].join('\n'),
  );
  // Two more files that also test lib/widget.js → a cluster of 3 files.
  for (const name of ['widget-extra', 'widget-more']) {
    await writeFile(
      path.join(dir, 'test', 'integration', `${name}.test.js`),
      [
        "import { runThing } from '../../lib/widget.js';",
        `test('@integration ${name} a', () => { runThing(1); });`,
      ].join('\n'),
    );
  }

  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 't@t.t']);
  git(dir, ['config', 'user.name', 'T']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'baseline']);
  return dir;
}

test('@integration test-health redundancy: the report surfaces the near-duplicate pair', async () => {
  const dir = await makeRepo();
  try {
    const r = runMmd(dir, ['--dry-run']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /## Redundancy candidates/);
    assert.match(r.stdout, /DETECT-BEFORE-CUT/);
    // The two near-identical tests in widget.test.js are paired (line-number
    // agnostic — assert a pair line referencing the file twice with high similarity).
    assert.match(r.stdout, /widget\.test\.js:\d+` ↔ `.*widget\.test\.js:\d+` — \*\*0\.9\d?\*\* similar/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration test-health redundancy: surfaces the most-tested module cluster', async () => {
  const dir = await makeRepo();
  try {
    const r = runMmd(dir, ['--dry-run']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Most-tested modules/);
    // lib/widget.js is imported by 3 files (widget + widget-extra + widget-more).
    assert.match(r.stdout, /lib\/widget\.js/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration test-health redundancy: a genuinely-different test is NOT paired (no crying wolf)', async () => {
  const dir = await makeRepo();
  try {
    const r = runMmd(dir, ['--dry-run']);
    assert.equal(r.status, 0, r.stderr);
    // EXACTLY one near-duplicate pair: the genuinely-different "parses config"
    // test was not falsely paired with either copy. Singular wording proves it.
    assert.match(r.stdout, /\*\*1 near-duplicate pair\*\*/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration test-health redundancy: a high threshold drops the pair (env override honored)', async () => {
  const dir = await makeRepo();
  try {
    // The dup pair sits below 1.0 (one literal differs) → a 1.0 threshold drops it.
    const r = runMmd(dir, ['--dry-run'], { MMD_TEST_DUP_SIMILARITY: '1' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /No near-duplicate test pairs/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration test-health redundancy: a junk similarity env falls back with an honest note', async () => {
  const dir = await makeRepo();
  try {
    const r = runMmd(dir, ['--dry-run'], { MMD_TEST_DUP_SIMILARITY: '9' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /MMD_TEST_DUP_SIMILARITY.*not a number in \(0,1\].*default/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration test-health redundancy: READ-ONLY — only docs/test-health.md changes', async () => {
  const dir = await makeRepo();
  try {
    const r = runMmd(dir, []);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Redundancy:/); // summary line present
    const status = git(dir, ['status', '--porcelain']);
    const changed = status.split('\n').map((l) => l.slice(3)).filter(Boolean);
    assert.deepEqual(changed, ['docs/test-health.md'], `unexpected changes: ${status}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
