// @integration — SPEC_V06A AC-1 (discover surface): `mmd discover` on a real
// Node app (package.json + index.js, no SDD methodology) reports the new
// `brownfield-app` case, NOT `blank`. The companion truly-empty `blank` fixture
// still reports `blank` (the negative side of the same AC).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');
const REPOS = path.join(REPO_ROOT, 'test', 'fixtures', 'discover-repos');

function makeTmpFixture(srcDir, tag) {
  const dst = mkdtempSync(path.join(tmpdir(), `mmd-disc-${tag}-`));
  cpSync(srcDir, dst, { recursive: true });
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dst });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { cwd: dst });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: dst });
  return dst;
}

test('@integration discover (brownfield-node): detected case = brownfield-app', () => {
  const dir = makeTmpFixture(path.join(REPOS, 'brownfield-node'), 'brownfield');
  try {
    const r = spawnSync('node', [MMD, 'discover', '.'], { cwd: dir, encoding: 'utf8', timeout: 30000 });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    // The stdout "detected case = …" line surfaces the new label.
    assert.match(r.stdout, /detected case = brownfield-app/);

    // The written report surfaces the human-readable label, NOT the blank one.
    const report = readFileSync(path.join(dir, 'mmd-discovery-report.md'), 'utf8');
    assert.match(report, /Brownfield app \(recognized stack, no SDD methodology\)/);
    assert.doesNotMatch(report, /Blank \(no SDD methodology\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration discover (truly-empty blank): detected case stays blank', () => {
  const dir = makeTmpFixture(path.join(REPOS, 'blank'), 'blank2');
  try {
    const r = spawnSync('node', [MMD, 'discover', '.'], { cwd: dir, encoding: 'utf8', timeout: 30000 });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /detected case = blank/);
    assert.doesNotMatch(r.stdout, /brownfield-app/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
