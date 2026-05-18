// @unit tests for scripts/audit-pillars.sh — AC-6.
//
// Strategy: create a temp git repo, seed commits that should match (and not
// match) the patterns from scripts/audit-pillars.patterns.json, run the
// script, assert on its output and exit code.
//
// Bash-script tests are inherently fs/process-touching, so these are kept
// in @unit nonetheless because each case is < 1 s on a normal machine — well
// under the per-unit budget of testing.md §V. Bash + node spawn overhead is
// the only cost.
//
// v0.2.f: audit-pillars.sh uses `node` (not jq) to parse the patterns JSON,
// so the script is fully self-sufficient on any machine that can already run
// MMD (engines.node >=20 is a hard package.json dep).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'audit-pillars.sh');
const PATTERNS_FILE = path.join(REPO_ROOT, 'scripts', 'audit-pillars.patterns.json');

function makeTmpRepo(prefix = 'mmd-audit-') {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  const r1 = spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  if (r1.status !== 0) throw new Error(`git init failed: ${r1.stderr}`);
  const r2 = spawnSync(
    'git',
    ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init', '-q'],
    { cwd: dir },
  );
  if (r2.status !== 0) throw new Error(`init commit failed: ${r2.stderr}`);
  return dir;
}

function gitInRepo(repo, args) {
  const r = spawnSync(
    'git',
    ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args],
    { cwd: repo, encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}\n${r.stdout}`);
  return r.stdout;
}

function installScript(repo) {
  const scriptsDir = path.join(repo, 'scripts');
  mkdirSync(scriptsDir, { recursive: true });
  copyFileSync(SCRIPT, path.join(scriptsDir, 'audit-pillars.sh'));
  copyFileSync(PATTERNS_FILE, path.join(scriptsDir, 'audit-pillars.patterns.json'));
  spawnSync('chmod', ['+x', path.join(scriptsDir, 'audit-pillars.sh')]);
}

function runScript(repo, args = [], opts = {}) {
  const scriptInRepo = path.join(repo, 'scripts', 'audit-pillars.sh');
  return spawnSync('bash', [scriptInRepo, ...args], {
    cwd: opts.cwd ?? repo,
    encoding: 'utf8',
    timeout: 15000,
    env: opts.env || process.env,
  });
}

test('@unit audit-pillars: --help prints usage and exits 0', () => {
  const repo = makeTmpRepo();
  try {
    installScript(repo);
    const r = runScript(repo, ['--help']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /audit-pillars/);
    assert.match(r.stdout, /Usage:/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('@unit audit-pillars: outside a git repo exits 2', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'mmd-audit-nogit-'));
  try {
    const scriptsDir = path.join(tmp, 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    copyFileSync(SCRIPT, path.join(scriptsDir, 'audit-pillars.sh'));
    copyFileSync(PATTERNS_FILE, path.join(scriptsDir, 'audit-pillars.patterns.json'));
    spawnSync('chmod', ['+x', path.join(scriptsDir, 'audit-pillars.sh')]);
    const r = spawnSync('bash', [path.join(scriptsDir, 'audit-pillars.sh')], {
      cwd: tmp,
      encoding: 'utf8',
      timeout: 15000,
    });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /not inside a git repository/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@unit audit-pillars: empty range (HEAD == main) reports all pillars NOT INVOKED', () => {
  const repo = makeTmpRepo();
  try {
    installScript(repo);
    const r = runScript(repo);
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}\nstdout=${r.stdout}`);
    const patterns = JSON.parse(readFileSync(PATTERNS_FILE, 'utf8'));
    for (const pillar of patterns.pillars) {
      const escName = pillar.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      assert.match(
        r.stdout,
        new RegExp(`${escName}\\s*\\|\\s*NOT INVOKED`),
        `pillar ${pillar.name} should be NOT INVOKED on empty range`,
      );
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('@unit audit-pillars: hard-error when node is unavailable (exit 2)', () => {
  // v0.2.f uses node (not jq) to parse patterns JSON. node is a hard MMD dep
  // (engines.node >=20 in package.json), so when it is absent the script
  // SHOULD fail loudly rather than skip silently.
  const repo = makeTmpRepo();
  const sandbox = mkdtempSync(path.join(tmpdir(), 'mmd-nonode-'));
  try {
    installScript(repo);
    const which = spawnSync('bash', ['-c', 'command -v git'], { encoding: 'utf8' });
    const gitPath = which.stdout.trim();
    if (!gitPath) return; // no git on host — skip
    try { symlinkSync(gitPath, path.join(sandbox, 'git')); } catch { /* idempotent */ }
    for (const tool of [
      'sed', 'head', 'grep', 'cat', 'bash', 'tr', 'mktemp', 'rm', 'printf', 'awk', 'wc',
      'dirname', 'basename', 'cd', 'pwd', 'true', 'false', 'test', 'chmod', 'ls', 'mkdir', 'cp', 'mv',
    ]) {
      const w = spawnSync('bash', ['-c', `command -v ${tool}`], { encoding: 'utf8' });
      const p = w.stdout.trim();
      if (p) {
        try { symlinkSync(p, path.join(sandbox, tool)); } catch { /* idempotent */ }
      }
    }
    const scriptInRepo = path.join(repo, 'scripts', 'audit-pillars.sh');
    const r = spawnSync('bash', [scriptInRepo], {
      cwd: repo,
      encoding: 'utf8',
      timeout: 15000,
      env: { PATH: sandbox, HOME: process.env.HOME ?? '/tmp' },
    });
    assert.equal(r.status, 2, `expected exit 2 (node required); stderr=${r.stderr}\nstdout=${r.stdout}`);
    assert.match(r.stderr, /node is required/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('@unit audit-pillars: commit mentioning gStack /ship matches the gStack pillar', () => {
  const repo = makeTmpRepo();
  try {
    installScript(repo);
    gitInRepo(repo, ['checkout', '-q', '-b', 'slice/test-gstack']);
    writeFileSync(path.join(repo, 'foo.txt'), 'placeholder\n');
    gitInRepo(repo, ['add', 'foo.txt']);
    gitInRepo(repo, ['commit', '-q', '-m', 'feat: invoke /ship from mmd ship subcommand']);

    const r = runScript(repo);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /gStack\s*\|\s*INVOKED/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('@unit audit-pillars: BMAD pillar matches _bmad/ paths in diff', () => {
  const repo = makeTmpRepo();
  try {
    installScript(repo);
    gitInRepo(repo, ['checkout', '-q', '-b', 'slice/test-bmad']);
    mkdirSync(path.join(repo, '_bmad'), { recursive: true });
    writeFileSync(path.join(repo, '_bmad', 'placeholder.md'), 'BMAD ref\n');
    gitInRepo(repo, ['add', '_bmad/placeholder.md']);
    gitInRepo(repo, ['commit', '-q', '-m', 'chore: touch _bmad/']);
    const r = runScript(repo);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /BMAD\s*\|\s*INVOKED/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('@unit audit-pillars: --ci on a slice with no pillar invocations exits 1', () => {
  const repo = makeTmpRepo();
  try {
    installScript(repo);
    gitInRepo(repo, ['checkout', '-q', '-b', 'slice/test-empty']);
    writeFileSync(path.join(repo, 'unrelated.txt'), 'just a placeholder\n');
    gitInRepo(repo, ['add', 'unrelated.txt']);
    gitInRepo(repo, ['commit', '-q', '-m', 'chore: unrelated change']);
    const r = runScript(repo, ['--ci']);
    assert.equal(
      r.status,
      1,
      `expected exit 1 in --ci mode with no invocations; got ${r.status}\nstdout=${r.stdout}\nstderr=${r.stderr}`,
    );
    assert.match(r.stderr, /NOT INVOKED/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('@unit audit-pillars: advisory mode (no --ci) returns 0 even with NOT INVOKED rows', () => {
  const repo = makeTmpRepo();
  try {
    installScript(repo);
    gitInRepo(repo, ['checkout', '-q', '-b', 'slice/test-advisory']);
    writeFileSync(path.join(repo, 'x.txt'), 'placeholder\n');
    gitInRepo(repo, ['add', 'x.txt']);
    gitInRepo(repo, ['commit', '-q', '-m', 'feat: unrelated change']);
    const r = runScript(repo);
    assert.equal(r.status, 0, `expected exit 0 in advisory mode; got ${r.status}\nstderr=${r.stderr}`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('@unit audit-pillars: unknown flag exits 2', () => {
  const repo = makeTmpRepo();
  try {
    installScript(repo);
    const r = runScript(repo, ['--nonsense']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /unknown flag/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('@unit audit-pillars: patterns.json contains all 5 README pillars', () => {
  const patterns = JSON.parse(readFileSync(PATTERNS_FILE, 'utf8'));
  // v0.2.g AC-6: schema bumped to v2 additively (adds optional `skills`
  // metadata on the gStack pillar). The script accepts both versions —
  // this test only enforces the value is one of the accepted schema versions.
  assert.ok(
    [1, 2].includes(patterns.version),
    `unexpected patterns.version: ${patterns.version} (accepted: 1, 2)`,
  );
  const names = patterns.pillars.map((p) => p.name);
  for (const expected of ['Spec Kit', 'OpenSpec', 'BMAD', 'gStack', 'Ralph Loop']) {
    assert.ok(names.includes(expected), `missing pillar: ${expected} (got: ${names.join(', ')})`);
  }
});

test('@unit audit-pillars: v2 — gStack pillar advertises all four v0.2.g-wrapped skills', () => {
  // v0.2.g AC-6: per-skill metadata. The schema is additive — production
  // count logic does not depend on it — but the field's PRESENCE is what
  // makes the patterns.json self-documenting for future skills.
  const patterns = JSON.parse(readFileSync(PATTERNS_FILE, 'utf8'));
  if (patterns.version < 2) {
    // Backward-compatible escape hatch: v1 patterns don't carry the skills
    // metadata. Skip rather than fail to keep the test future-proof.
    return;
  }
  const gstack = patterns.pillars.find((p) => p.name === 'gStack');
  assert.ok(gstack, 'gStack pillar missing');
  assert.ok(Array.isArray(gstack.skills), 'gStack.skills must be an array in v2');
  const skillNames = gstack.skills.map((s) => s.name);
  for (const expected of ['ship', 'qa', 'cso', 'document-release']) {
    assert.ok(
      skillNames.includes(expected),
      `missing v0.2.g-wrapped skill in patterns.json: ${expected} (got: ${skillNames.join(', ')})`,
    );
  }
});

test('@unit @integration F6 — audit-pillars v2 renders per-skill names in NOTES for gStack', () => {
  // F6 (Phase-4 review): v2 added `skills[]` metadata on the gStack pillar,
  // but the original implementation parsed and DISCARDED it — the Notes
  // column still listed pattern strings. The fix: when v2 + skills[] is
  // present, Notes lists per-skill names with their match counts.
  const repo = makeTmpRepo();
  try {
    installScript(repo);
    gitInRepo(repo, ['checkout', '-q', '-b', 'slice/test-skills-notes']);
    // Seed commits that mention every v0.2.g-wrapped skill name.
    writeFileSync(path.join(repo, 'a.md'), 'we ran mmd ship\n');
    gitInRepo(repo, ['add', 'a.md']);
    gitInRepo(repo, ['commit', '-q', '-m', 'feat: mmd ship test']);
    writeFileSync(path.join(repo, 'b.md'), 'we ran mmd qa\n');
    gitInRepo(repo, ['add', 'b.md']);
    gitInRepo(repo, ['commit', '-q', '-m', 'feat: mmd qa test']);
    writeFileSync(path.join(repo, 'c.md'), 'we ran mmd cso\n');
    gitInRepo(repo, ['add', 'c.md']);
    gitInRepo(repo, ['commit', '-q', '-m', 'feat: mmd cso test']);
    writeFileSync(path.join(repo, 'd.md'), 'we ran mmd document-release\n');
    gitInRepo(repo, ['add', 'd.md']);
    gitInRepo(repo, ['commit', '-q', '-m', 'feat: mmd document-release test']);

    const r = runScript(repo);
    assert.equal(r.status, 0, `stderr=${r.stderr}\nstdout=${r.stdout}`);
    // Each v0.2.g-wrapped skill name should appear in the gStack Notes column.
    for (const skill of ['ship', 'qa', 'cso', 'document-release']) {
      assert.ok(
        r.stdout.includes(`${skill} (`),
        `expected '${skill} (<count>)' in gStack Notes; got:\n${r.stdout}`,
      );
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('@unit audit-pillars: range syntax <base>..<head> is honored', () => {
  const repo = makeTmpRepo();
  try {
    installScript(repo);
    gitInRepo(repo, ['checkout', '-q', '-b', 'slice/test-range']);
    writeFileSync(path.join(repo, 'm.txt'), 'mmd ship something\n');
    gitInRepo(repo, ['add', 'm.txt']);
    gitInRepo(repo, ['commit', '-q', '-m', 'feat: use mmd ship in passing']);
    const r = runScript(repo, ['main..HEAD']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /range: main..HEAD/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
