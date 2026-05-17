// @integration tests for `mmd discover` Case D (Already-onboarded refresh path).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');
const FIXTURE = path.join(REPO_ROOT, 'test', 'fixtures', 'discover-repos', 'already-onboarded');

function makeTmpFixture(srcDir) {
  const dst = mkdtempSync(path.join(tmpdir(), 'mmd-disc-already-'));
  cpSync(srcDir, dst, { recursive: true });
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dst });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { cwd: dst });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: dst });
  return dst;
}

test('@integration mmd discover (Already-onboarded): detected case = already-onboarded', () => {
  const dir = makeTmpFixture(FIXTURE);
  try {
    const r = spawnSync('node', [MMD, 'discover', '.'], {
      cwd: dir, encoding: 'utf8', timeout: 30000,
    });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const report = readFileSync(path.join(dir, 'mmd-discovery-report.md'), 'utf8');
    assert.match(report, /Already-onboarded \(refresh\)/);
    assert.match(report, /A previous VALIDATED report exists/);
    assert.match(r.stdout, /already onboarded/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration mmd discover --refresh on already-onboarded: still produces a report', () => {
  const dir = makeTmpFixture(FIXTURE);
  try {
    const r = spawnSync('node', [MMD, 'discover', '--refresh', '.'], {
      cwd: dir, encoding: 'utf8', timeout: 30000,
    });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const report = readFileSync(path.join(dir, 'mmd-discovery-report.md'), 'utf8');
    assert.match(report, /Status: PENDING VALIDATION/); // fresh report is pending
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration mmd discover --no-report-update: writes last.md but NOT the root report', () => {
  const dir = makeTmpFixture(FIXTURE);
  try {
    // Wipe the root report first so we can verify it is NOT recreated.
    rmSync(path.join(dir, 'mmd-discovery-report.md'), { force: true });
    const r = spawnSync('node', [MMD, 'discover', '--no-report-update', '.'], {
      cwd: dir, encoding: 'utf8', timeout: 30000,
    });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const lastMd = readFileSync(path.join(dir, '.mmd', 'shared', 'project-onboarder', 'last.md'), 'utf8');
    assert.match(lastMd, /# MMD Discovery Report/);
    assert.equal(
      existsSync(path.join(dir, 'mmd-discovery-report.md')),
      false,
      'root mmd-discovery-report.md should NOT have been recreated under --no-report-update',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
