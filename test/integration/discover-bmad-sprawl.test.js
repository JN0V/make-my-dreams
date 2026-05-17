// @integration tests for `mmd discover` Case B (BMAD-alone with spec sprawl).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');
const FIXTURE = path.join(REPO_ROOT, 'test', 'fixtures', 'discover-repos', 'bmad-sprawl');

function makeTmpFixture(srcDir) {
  const dst = mkdtempSync(path.join(tmpdir(), 'mmd-disc-bmad-'));
  cpSync(srcDir, dst, { recursive: true });
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dst });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { cwd: dst });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: dst });
  return dst;
}

// AC-6 Case B — Note: this fixture has `_bmad/` (so methodology.bmad=true), so
// classify() returns 'rich'. The spec's "bmad-alone" priority kicks in only
// when stories_count >= 10 AND neither spec_kit nor bmad is set. To exercise
// the explicit "BMAD-alone (possible spec sprawl)" label in the report we
// would need a fixture without `_bmad/`. We test BOTH cases here:
// 1. The fixture as-is exercises the 15-story ingest path on a 'rich' label.
// 2. A second test removes `_bmad/` on the tmp copy to surface 'bmad-alone'.

test('@integration mmd discover (BMAD-sprawl): ingests 15 stories with mixed statuses', () => {
  const dir = makeTmpFixture(FIXTURE);
  try {
    const r = spawnSync('node', [MMD, 'discover', '.'], {
      cwd: dir, encoding: 'utf8', timeout: 30000,
    });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const status = JSON.parse(readFileSync(path.join(dir, '.mmd', 'shared', 'status.json'), 'utf8'));
    assert.equal(status.stories.length, 15);
    const counts = status.stories.reduce((acc, s) => {
      acc[s.status] = (acc[s.status] || 0) + 1;
      return acc;
    }, {});
    assert.equal(counts.done, 5);
    assert.equal(counts.draft, 10); // 5 draft + 5 obsolete (both map to 'draft')
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration mmd discover (BMAD-sprawl without _bmad/): label is "BMAD-alone"', () => {
  const dir = makeTmpFixture(FIXTURE);
  // Remove the _bmad/ marker so classify() does NOT hit the 'rich' branch.
  rmSync(path.join(dir, '_bmad'), { recursive: true, force: true });
  try {
    const r = spawnSync('node', [MMD, 'discover', '.'], {
      cwd: dir, encoding: 'utf8', timeout: 30000,
    });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const report = readFileSync(path.join(dir, 'mmd-discovery-report.md'), 'utf8');
    assert.match(report, /BMAD-alone \(possible spec sprawl\)/);
    assert.match(report, /15 stories detected/);
    assert.match(report, /deferred to v0\.2c\+/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
