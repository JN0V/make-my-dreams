// @integration tests for `mmd discover` Case C (Blank — no SDD methodology).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');
const FIXTURE = path.join(REPO_ROOT, 'test', 'fixtures', 'discover-repos', 'blank');

function makeTmpFixture(srcDir) {
  const dst = mkdtempSync(path.join(tmpdir(), 'mmd-disc-blank-'));
  cpSync(srcDir, dst, { recursive: true });
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dst });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { cwd: dst });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: dst });
  return dst;
}

test('@integration mmd discover (Blank): detected case is Blank + suggested next step matches spec', () => {
  const dir = makeTmpFixture(FIXTURE);
  try {
    const r = spawnSync('node', [MMD, 'discover', '.'], {
      cwd: dir, encoding: 'utf8', timeout: 30000,
    });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const report = readFileSync(path.join(dir, 'mmd-discovery-report.md'), 'utf8');
    assert.match(report, /Blank \(no SDD methodology\)/);
    assert.match(report, /## Suggested next step/);
    assert.match(report, /mmd --here/);
    // Nothing was ingested (no methodologies).
    assert.match(report, /\(nothing to ingest\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration mmd discover (Blank): non-git directory without --force-non-git → exit 4', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-disc-nogit-'));
  try {
    cpSync(FIXTURE, dir, { recursive: true });
    // intentionally NOT initializing git
    const r = spawnSync('node', [MMD, 'discover', '.'], {
      cwd: dir, encoding: 'utf8', timeout: 30000,
    });
    assert.equal(r.status, 4);
    assert.match(r.stderr, /not a git repo/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration mmd discover --force-non-git: works on a non-git directory (exit 0)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-disc-force-'));
  try {
    cpSync(FIXTURE, dir, { recursive: true });
    const r = spawnSync('node', [MMD, 'discover', '--force-non-git', '.'], {
      cwd: dir, encoding: 'utf8', timeout: 30000,
    });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration mmd discover: non-existent path → exit 3', () => {
  const r = spawnSync('node', [MMD, 'discover', '/nonexistent-path-xyz-9999'], {
    cwd: REPO_ROOT, encoding: 'utf8', timeout: 30000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /does not exist|not a directory/);
});

test('@integration mmd discover --help → exit 0 with usage', () => {
  const r = spawnSync('node', [MMD, 'discover', '--help'], {
    cwd: REPO_ROOT, encoding: 'utf8', timeout: 30000,
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /mmd discover — Project Onboarder/);
  assert.match(r.stdout, /--approve/);
  assert.match(r.stdout, /--refresh/);
  assert.match(r.stdout, /--infer-with-claude/);
  assert.match(r.stdout, /--no-report-update/);
  assert.match(r.stdout, /--force-non-git/);
});
