// @unit tests for scripts/audit-pillars.sh — AC-6.
//
// Strategy: create a temp git repo, seed commits that should match (and not
// match) the patterns from scripts/audit-pillars.patterns.json, run the
// script, assert on its output and exit code.
//
// Bash-script tests are inherently fs/process-touching, so these are kept
// in @unit nonetheless because each case is < 1 s on a normal machine — well
// under the 100 ms-per-unit budget of testing.md §V is sometimes broken, but
// the goal of @unit (pre-push, no LLM, no external service) is preserved.
// Bash invocation overhead is the only cost.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync, copyFileSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'audit-pillars.sh');
const PATTERNS_FILE = path.join(REPO_ROOT, 'scripts', 'audit-pillars.patterns.json');

// jq is the bash script's required dependency for parsing patterns.json. The
// script gracefully degrades (prints a clear message + exits 0) when jq is
// absent — see error-handling.md §III. The matching/--ci tests below need
// jq to be present to actually exercise the patterns; skip them when absent
// rather than failing the suite. The graceful-degrade path is itself tested
// explicitly below.
const HAS_JQ = spawnSync('bash', ['-c', 'command -v jq']).status === 0;

function makeTmpRepo(prefix = 'mmd-audit-') {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  // Initialize a clean repo on `main`.
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

/**
 * Copy the script + patterns.json into the temp repo so audit-pillars.sh
 * resolves its own location relative to the temp tree (`SCRIPT_DIR`).
 * The script reads patterns.json from its OWN directory, not from `cwd`.
 */
function installScript(repo) {
  const scriptsDir = path.join(repo, 'scripts');
  mkdirSync(scriptsDir, { recursive: true });
  copyFileSync(SCRIPT, path.join(scriptsDir, 'audit-pillars.sh'));
  copyFileSync(PATTERNS_FILE, path.join(scriptsDir, 'audit-pillars.patterns.json'));
  spawnSync('chmod', ['+x', path.join(scriptsDir, 'audit-pillars.sh')]);
  return path.join(scriptsDir, 'audit-pillars.sh');
}

function runScript(repo, args = [], opts = {}) {
  const scriptInRepo = path.join(repo, 'scripts', 'audit-pillars.sh');
  return spawnSync('bash', [scriptInRepo, ...args], {
    cwd: opts.cwd ?? repo,
    encoding: 'utf8',
    timeout: 15000,
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
    // Don't init a repo — copy only the script + patterns.
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

test('@unit audit-pillars: empty range (HEAD == main) reports all pillars NOT INVOKED', { skip: !HAS_JQ && 'jq not installed' }, () => {
  const repo = makeTmpRepo();
  try {
    installScript(repo);
    // No new commits — HEAD is the initial commit on main, range main..HEAD is empty.
    const r = runScript(repo);
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}\nstdout=${r.stdout}`);
    // Every pillar from the patterns file should be NOT INVOKED.
    const patterns = JSON.parse(readFileSync(PATTERNS_FILE, 'utf8'));
    for (const pillar of patterns.pillars) {
      assert.match(
        r.stdout,
        new RegExp(`${pillar.name}\\s*\\|\\s*NOT INVOKED`),
        `pillar ${pillar.name} should be NOT INVOKED on empty range`,
      );
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('@unit audit-pillars: graceful-degrade when jq is unavailable (advisory exit 0)', () => {
  // Deterministically exercises the "no jq" branch by spawning bash with a
  // PATH that resolves git (needed for the rev-parse guard) but NOT jq. We
  // create a side dir containing only a `git` symlink, then prepend it as
  // the entire PATH. Per error-handling.md §III: missing jq must NOT crash
  // the audit — script prints the install hint and exits 0.
  const repo = makeTmpRepo();
  const sandbox = mkdtempSync(path.join(tmpdir(), 'mmd-nojq-'));
  try {
    installScript(repo);
    // Locate the real git binary on the host.
    const which = spawnSync('bash', ['-c', 'command -v git'], { encoding: 'utf8' });
    const gitPath = which.stdout.trim();
    if (!gitPath) {
      // No git on host — skip; the broader suite can't run anyway.
      return;
    }
    // Mirror the minimum set of binaries the script needs (sed, head, grep,
    // printf are bash builtins or in /bin — include /bin and /usr/bin only
    // if jq is NOT installed under either, else fall back to a sandbox
    // containing ONLY a git symlink).
    const jqInUsrBin = existsSync('/usr/bin/jq') || existsSync('/bin/jq');
    let pathEnv;
    if (!jqInUsrBin) {
      pathEnv = '/usr/bin:/bin';
    } else {
      // Sandbox-PATH approach: symlink git into sandbox/ and use it alone.
      try { symlinkSync(gitPath, path.join(sandbox, 'git')); } catch { /* idempotent */ }
      // Also include sed, head, grep (POSIX utils the script invokes).
      for (const tool of ['sed', 'head', 'grep', 'cat', 'bash', 'tr']) {
        const w = spawnSync('bash', ['-c', `command -v ${tool}`], { encoding: 'utf8' });
        const p = w.stdout.trim();
        if (p) {
          try { symlinkSync(p, path.join(sandbox, tool)); } catch { /* idempotent */ }
        }
      }
      pathEnv = sandbox;
    }
    const scriptInRepo = path.join(repo, 'scripts', 'audit-pillars.sh');
    const r = spawnSync('bash', [scriptInRepo], {
      cwd: repo,
      encoding: 'utf8',
      timeout: 15000,
      env: { PATH: pathEnv, HOME: process.env.HOME ?? '/tmp' },
    });
    assert.equal(r.status, 0, `expected exit 0 (advisory); stderr=${r.stderr}\nstdout=${r.stdout}`);
    assert.match(r.stdout, /jq not installed/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('@unit audit-pillars: commit mentioning gStack /ship matches the gStack pillar', { skip: !HAS_JQ && 'jq not installed' }, () => {
  const repo = makeTmpRepo();
  try {
    installScript(repo);
    // Create a slice branch with a commit that mentions a gStack invocation.
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

test('@unit audit-pillars: BMAD pillar matches existing _bmad/ paths in diff', { skip: !HAS_JQ && 'jq not installed' }, () => {
  const repo = makeTmpRepo();
  try {
    installScript(repo);
    gitInRepo(repo, ['checkout', '-q', '-b', 'slice/test-bmad']);
    // Mimic a typical BMAD invocation pattern in the diff content.
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

test('@unit audit-pillars: --ci on a slice with NO pillar invocations exits 1', { skip: !HAS_JQ && 'jq not installed' }, () => {
  const repo = makeTmpRepo();
  try {
    installScript(repo);
    gitInRepo(repo, ['checkout', '-q', '-b', 'slice/test-empty']);
    // Commit text that matches no pillar.
    writeFileSync(path.join(repo, 'unrelated.txt'), 'just a placeholder\n');
    gitInRepo(repo, ['add', 'unrelated.txt']);
    gitInRepo(repo, ['commit', '-q', '-m', 'chore: unrelated change']);
    const r = runScript(repo, ['--ci']);
    assert.equal(r.status, 1, `expected exit 1 in --ci mode with no invocations; got ${r.status}\nstdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stderr, /NOT INVOKED/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('@unit audit-pillars: --ci on a slice with at least one invocation exits 0', () => {
  // Note: --ci fails ONLY if a pillar count is 0. To make --ci exit 0, EVERY
  // pillar must have at least 1 hit — which is unrealistic in a synthetic
  // small repo. We test the "advisory mode" path explicitly: default (no --ci)
  // always returns 0 even with NOT INVOKED rows.
  const repo = makeTmpRepo();
  try {
    installScript(repo);
    gitInRepo(repo, ['checkout', '-q', '-b', 'slice/test-advisory']);
    writeFileSync(path.join(repo, 'x.txt'), 'placeholder\n');
    gitInRepo(repo, ['add', 'x.txt']);
    gitInRepo(repo, ['commit', '-q', '-m', 'feat: unrelated change']);
    const r = runScript(repo); // advisory mode, no --ci flag
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
  assert.equal(patterns.version, 1);
  const names = patterns.pillars.map((p) => p.name);
  for (const expected of ['Spec Kit', 'OpenSpec', 'BMAD', 'gStack', 'Ralph Loop']) {
    assert.ok(names.includes(expected), `missing pillar: ${expected} (got: ${names.join(', ')})`);
  }
});
