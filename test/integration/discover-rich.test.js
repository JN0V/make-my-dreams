// @integration tests for `mmd discover` Case A (Rich = Spec Kit + BMAD).
// Copies the fixture into an isolated tmp dir + git init, then runs the
// real `node bin/discover.js .` inside it and asserts on the produced
// report + .mmd/shared/ artifacts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');
const FIXTURE = path.join(REPO_ROOT, 'test', 'fixtures', 'discover-repos', 'rich');

function makeTmpFixture(srcDir) {
  const dst = mkdtempSync(path.join(tmpdir(), 'mmd-disc-rich-'));
  cpSync(srcDir, dst, { recursive: true });
  // Initialize a real git repo so SCAN's git probe returns is_git_repo=true.
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dst });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { cwd: dst });
  spawnSync('git',
    ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'],
    { cwd: dst });
  return dst;
}

test('@integration mmd discover (Rich): exit 0 + report has expected case + sections', () => {
  const dir = makeTmpFixture(FIXTURE);
  try {
    const r = spawnSync('node', [MMD, 'discover', '.'], {
      cwd: dir, encoding: 'utf8', timeout: 30000,
    });
    assert.equal(r.status, 0, `stderr: ${r.stderr}\nstdout: ${r.stdout}`);
    const report = readFileSync(path.join(dir, 'mmd-discovery-report.md'), 'utf8');
    assert.match(report, /# MMD Discovery Report/);
    assert.match(report, /Status: PENDING VALIDATION/);
    assert.match(report, /Detected case\nRich \(Spec Kit \+ BMAD\)/);
    assert.match(report, /Spec Kit \(\.specify\/\)/);
    assert.match(report, /BMAD \(_bmad\/\)/);
    assert.match(report, /docs\/stories\/ \(3 files\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration mmd discover (Rich): ingests Spec Kit constitution + BMAD stories', () => {
  const dir = makeTmpFixture(FIXTURE);
  try {
    const r = spawnSync('node', [MMD, 'discover', '.'], {
      cwd: dir, encoding: 'utf8', timeout: 30000,
    });
    assert.equal(r.status, 0);
    const imported = readFileSync(path.join(dir, '.mmd', 'shared', 'constitution', 'imported.md'), 'utf8');
    assert.match(imported, /imported-from: spec-kit/);
    assert.match(imported, /# Fixture constitution/);
    const status = JSON.parse(readFileSync(path.join(dir, '.mmd', 'shared', 'status.json'), 'utf8'));
    assert.ok(Array.isArray(status.stories));
    assert.equal(status.stories.length, 3);
    const ids = status.stories.map((s) => s.id);
    assert.ok(ids.includes('story-001-login'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration mmd discover (Rich): writes scan.json + inferred.md', () => {
  const dir = makeTmpFixture(FIXTURE);
  try {
    const r = spawnSync('node', [MMD, 'discover', '.'], {
      cwd: dir, encoding: 'utf8', timeout: 30000,
    });
    assert.equal(r.status, 0);
    const scan = JSON.parse(readFileSync(path.join(dir, '.mmd', 'shared', 'project-onboarder', 'scan.json'), 'utf8'));
    assert.equal(scan.scan_version, 1);
    assert.equal(scan.methodologies.spec_kit, true);
    assert.equal(scan.methodologies.bmad, true);
    assert.equal(scan.git.is_git_repo, true);
    const inferred = readFileSync(path.join(dir, '.mmd', 'shared', 'project-onboarder', 'inferred.md'), 'utf8');
    assert.match(inferred, /# Inferred conventions/);
    assert.match(inferred, /## Stack/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration mmd discover --approve flips PENDING → VALIDATED', () => {
  const dir = makeTmpFixture(FIXTURE);
  try {
    const first = spawnSync('node', [MMD, 'discover', '.'], { cwd: dir, encoding: 'utf8', timeout: 30000 });
    assert.equal(first.status, 0);
    const approve = spawnSync('node', [MMD, 'discover', '--approve', '.'], {
      cwd: dir, encoding: 'utf8', timeout: 30000,
    });
    assert.equal(approve.status, 0, `stderr: ${approve.stderr}`);
    const report = readFileSync(path.join(dir, 'mmd-discovery-report.md'), 'utf8');
    assert.match(report, /Status: VALIDATED at \d{4}-\d{2}-\d{2}/);
    assert.ok(!/PENDING VALIDATION/.test(report));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration mmd discover --approve with no report → exit 2 + friendly error', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-disc-empty-'));
  try {
    spawnSync('git', ['init', '-q'], { cwd: dir });
    const r = spawnSync('node', [MMD, 'discover', '--approve', '.'], {
      cwd: dir, encoding: 'utf8', timeout: 30000,
    });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /no.*found.*mmd discover/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
