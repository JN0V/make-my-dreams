// @integration — SPEC_V02K AC-1 + AC-2 (L-017): `mmd discover` on a realistic
// Node project (scripts.test = "node --test ..." + nested test dirs, NO
// test-runner devDependency) detects the runner from package.json.scripts and
// counts the nested test files. Asserts on the persisted scan.json (the source
// of truth) and the human report.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');
const FIXTURE = path.join(REPO_ROOT, 'test', 'fixtures', 'discover-repos', 'realistic-node');

function makeTmpFixture(srcDir) {
  const dst = mkdtempSync(path.join(tmpdir(), 'mmd-disc-realnode-'));
  cpSync(srcDir, dst, { recursive: true });
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dst });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { cwd: dst });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: dst });
  return dst;
}

function readScan(dir) {
  const p = path.join(dir, '.mmd', 'shared', 'project-onboarder', 'scan.json');
  return JSON.parse(readFileSync(p, 'utf8'));
}

test('@integration discover (realistic-node): runner from scripts + recursive test count (AC-1, AC-2)', () => {
  const dir = makeTmpFixture(FIXTURE);
  try {
    const r = spawnSync('node', [MMD, 'discover', '.'], { cwd: dir, encoding: 'utf8', timeout: 30000 });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);

    const scan = readScan(dir);
    // AC-1: runner detected from package.json.scripts ("node --test ...").
    assert.equal(scan.frameworks.test_runner, 'node --test');
    // AC-2: recursive walk over test/ + tests/ counts > 5 real test files.
    assert.ok(scan.tests && scan.tests.count > 5,
      `expected > 5 tests, got ${JSON.stringify(scan.tests)}`);

    // The human report surfaces both (AC-1 "Test runner" line, AC-2 "Tests").
    const report = readFileSync(path.join(dir, 'mmd-discovery-report.md'), 'utf8');
    assert.match(report, /node --test/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
