// @integration tests for `scripts/audit-pillars.sh --with-composer` —
// SPEC_V02E AC-6.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'audit-pillars.sh');

function makeRepoWithRuns(audits) {
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-audit-composer-'));
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  spawnSync(
    'git',
    ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init', '-q'],
    { cwd: dir },
  );
  // Install script under <repo>/scripts/.
  const scriptsDir = path.join(dir, 'scripts');
  mkdirSync(scriptsDir, { recursive: true });
  spawnSync('cp', [SCRIPT, path.join(scriptsDir, 'audit-pillars.sh')]);
  spawnSync('cp', [
    path.join(REPO_ROOT, 'scripts', 'audit-pillars.patterns.json'),
    path.join(scriptsDir, 'audit-pillars.patterns.json'),
  ]);
  spawnSync('chmod', ['+x', path.join(scriptsDir, 'audit-pillars.sh')]);
  // Seed composer.json sidecars.
  if (audits && audits.length > 0) {
    const runsDir = path.join(dir, '.mmd', 'local', 'qa-runs');
    mkdirSync(runsDir, { recursive: true });
    for (let i = 0; i < audits.length; i++) {
      writeFileSync(
        path.join(runsDir, `${i}.composer.json`),
        JSON.stringify(audits[i]),
        'utf8',
      );
    }
  }
  return dir;
}

function runScript(repo, args) {
  return spawnSync('bash', [path.join(repo, 'scripts', 'audit-pillars.sh'), ...args], {
    cwd: repo,
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, MMD_LIB_DIR: REPO_ROOT },
  });
}

test('@integration audit-pillars --with-composer: empty repo emits "0 run(s) audited"', () => {
  const repo = makeRepoWithRuns([]);
  try {
    const r = runScript(repo, ['--with-composer']);
    assert.equal(r.status, 0, `stderr=${r.stderr}`);
    assert.match(r.stdout, /Composer: 0 run\(s\) audited/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('@integration audit-pillars --with-composer: tallies + ranks lessons', () => {
  const repo = makeRepoWithRuns([
    { injected_count: 2, matched: [{ id: 'L-001' }, { id: 'L-003' }] },
    { injected_count: 1, matched: [{ id: 'L-001' }] },
    { injected_count: 0, matched: [] },
  ]);
  try {
    const r = runScript(repo, ['--with-composer']);
    assert.equal(r.status, 0, `stderr=${r.stderr}\nstdout=${r.stdout}`);
    assert.match(r.stdout, /Composer: 3 run\(s\) audited, 2 auto-injected lessons/);
    // L-001 has 2 hits, L-003 has 1 → top order is L-001 first.
    assert.match(r.stdout, /L-001 \(2\)/);
    assert.match(r.stdout, /L-003 \(1\)/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('@integration audit-pillars without --with-composer: no Composer section emitted', () => {
  const repo = makeRepoWithRuns([{ injected_count: 1, matched: [{ id: 'L-X' }] }]);
  try {
    const r = runScript(repo, []);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!/Composer:/.test(r.stdout), 'Composer line MUST NOT appear without --with-composer');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('@integration audit-pillars --help: usage mentions --with-composer flag', () => {
  const repo = makeRepoWithRuns([]);
  try {
    const r = runScript(repo, ['--help']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /--with-composer/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
