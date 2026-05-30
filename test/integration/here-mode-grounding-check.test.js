// @integration tests for the v0.2.h prompt-grounding precheck (SPEC_V02H).
//
//   - AC-2: verifyGrounding against a REAL git repo (known-existing + known-missing).
//   - AC-3: end-to-end `mmd --here` with a dream citing a missing file → exit 6.
//   - AC-4: MMD_SKIP_GROUNDING=1 bypasses the check with a warning.
//
// Strategy mirrors test/integration/here-mode.test.js: real temp git repos at
// test time, fake auto-dev + reality-check skipped to keep the surface fast.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import path from 'node:path';

import { buildSubprocessEnv } from '../../lib/invoke-autodev.js';
import { verifyGrounding } from '../../lib/here-mode/verify-grounding.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');
const FIXTURE_HERE = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-autodev-here.sh');
const SKIP_ON_WINDOWS = platform() === 'win32';

function makeTmp(prefix = 'mmd-grounding-') {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${r.stderr}`);
  }
  return r.stdout;
}

/** Clean repo on main with a SPEC file committed so a grounded dream succeeds. */
function initRepoWithSpec(dir) {
  mkdirSync(dir, { recursive: true });
  git(['init', '-q', '-b', 'main'], dir);
  writeFileSync(path.join(dir, 'SPEC_REAL.md'), '# real spec\n');
  git(['add', 'SPEC_REAL.md'], dir);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'add spec', '-q'], dir);
  return dir;
}

function runMmd(args, opts = {}) {
  const baseEnv = buildSubprocessEnv(process.env);
  const env = {
    ...baseEnv,
    MMD_AUTODEV_CMD: opts.autodevCmd ?? FIXTURE_HERE,
    MMD_REALITY_CHECK_BACKEND: 'skip',
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
    ...(opts.env || {}),
  };
  return spawnSync('node', [MMD, ...args], { cwd: opts.cwd, env, encoding: 'utf8', timeout: 30000 });
}

// ── AC-2: verifyGrounding against a live repo ──────────────────────────────
test('@integration v0.2.h AC-2: verifyGrounding on a live repo flags only the missing file', {
  skip: SKIP_ON_WINDOWS,
}, async () => {
  const tmp = makeTmp();
  try {
    initRepoWithSpec(tmp);
    const baseSha = git(['rev-parse', 'HEAD'], tmp).trim();
    const out = await verifyGrounding({
      files: ['SPEC_REAL.md', 'SPEC_GHOST.md'],
      baseSha,
      repoRoot: tmp,
    });
    assert.deepEqual(out.missing, ['SPEC_GHOST.md']);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── AC-3: end-to-end mmd --here, missing file → exit 6 ─────────────────────
test('@integration v0.2.h AC-3: --here with a dream citing a missing SPEC exits 6, no branch created', {
  skip: SKIP_ON_WINDOWS,
}, () => {
  const tmp = makeTmp();
  try {
    initRepoWithSpec(tmp);
    const r = runMmd(['--here', '--skip-onboarding', 'implement v9.9.9 per SPEC_V99X.md'], { cwd: tmp });
    assert.equal(r.status, 6, `expected exit 6; got ${r.status}; stderr=${r.stderr}`);
    assert.match(r.stderr, /Prompt-grounding failed \(per L-015\)/);
    assert.match(r.stderr, /SPEC_V99X\.md/);
    assert.match(r.stderr, /MMD_SKIP_GROUNDING=1/);
    // Fail-fast: the precheck runs BEFORE slice-branch creation, so HEAD is
    // still on main and no slice/here-* branch exists.
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], tmp).trim();
    assert.equal(branch, 'main', 'no slice branch should be created on grounding failure');
    const branches = git(['branch', '--list', 'slice/*'], tmp).trim();
    assert.equal(branches, '', 'no slice/* branch should exist');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── AC-3: a grounded dream proceeds normally (exit 0) ──────────────────────
test('@integration v0.2.h AC-3: --here with a dream citing an EXISTING SPEC proceeds (exit 0)', {
  skip: SKIP_ON_WINDOWS,
}, () => {
  const tmp = makeTmp();
  try {
    initRepoWithSpec(tmp);
    const r = runMmd(['--here', '--skip-onboarding', 'implement the change per SPEC_REAL.md'], { cwd: tmp });
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}\nstdout=${r.stdout}`);
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], tmp).trim();
    assert.match(branch, /^slice\/here-/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── AC-4: MMD_SKIP_GROUNDING=1 bypasses the check with a warning ───────────
test('@integration v0.2.h AC-4: MMD_SKIP_GROUNDING=1 bypasses the precheck (warning, exit 0)', {
  skip: SKIP_ON_WINDOWS,
}, () => {
  const tmp = makeTmp();
  try {
    initRepoWithSpec(tmp);
    const r = runMmd(
      ['--here', '--skip-onboarding', 'implement v9.9.9 per SPEC_V99X.md'],
      { cwd: tmp, env: { MMD_SKIP_GROUNDING: '1' } },
    );
    assert.equal(r.status, 0, `expected exit 0 with bypass; got ${r.status}; stderr=${r.stderr}`);
    assert.match(r.stderr, /grounding check skipped \(MMD_SKIP_GROUNDING=1\)/);
    // The slice proceeds: a slice branch IS created despite the missing file.
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], tmp).trim();
    assert.match(branch, /^slice\/here-/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
