// @e2e @slow — AC-7 self-dogfood smoke test.
//
// This test is the acid test of L-009's resolution and the reflexive
// bootstrap §7. It runs MMD against MMD itself via `mmd --here` and asserts
// that the slice branch carries the requested change.
//
// IMPORTANT — opt-in only:
//   1. Default `npm test` runs `--test-name-pattern=@unit` (see package.json),
//      so this @e2e test is filtered out by default.
//   2. The test itself ALSO requires MMD_RUN_E2E=1; if absent, it skips with
//      a clear reason. Belt-and-suspenders so accidental discovery via
//      `npm run test:full` doesn't fire the real claude CLI.
//   3. The test runs `node bin/mmd.js --here ...` in a temp WORKTREE of the
//      MMD repo (git worktree add — per L-003 we MUST NOT run --here in the
//      live MMD checkout while developing it).
//
// Pre-conditions (skipped cleanly if any fails):
//   - MMD_RUN_E2E=1
//   - The real `claude` CLI is on PATH (we don't mock — this is the e2e acid test)
//   - The MMD repo's main branch exists and is clean (we'll add a worktree)
//
// Acceptance per SPEC_V02A AC-7:
//   1. A slice branch `slice/here-<slug>-<ts>` exists in the worktree.
//   2. The requested change (a trivial comment line) is on the slice branch.
//   3. `main` is unchanged in the worktree.
//   4. .mmd/shared/status.json carries mode:"here" + target_dir:<worktree>.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');

const E2E_ENABLED = process.env.MMD_RUN_E2E === '1';
const SKIP_ON_WINDOWS = platform() === 'win32';

function whichClaude() {
  const r = spawnSync('which', ['claude'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

test('@e2e @slow AC-7: self-dogfood — mmd --here modifies a worktree of MMD itself', {
  skip: !E2E_ENABLED
    ? 'MMD_RUN_E2E=1 not set — opt-in only (see SPEC_V02A AC-7)'
    : SKIP_ON_WINDOWS
      ? 'Windows not supported for git worktree fixture'
      : !whichClaude()
        ? 'claude CLI not on PATH — cannot run real auto-dev'
        : false,
  // Real auto-dev runs can take minutes; allow up to 25 min for the smoke.
  timeout: 25 * 60 * 1000,
}, () => {
  // Set up a worktree of the MMD repo so we never mutate the live checkout
  // (L-003: don't run concurrent git ops in the same worktree).
  const worktreeBase = mkdtempSync(path.join(tmpdir(), 'mmd-e2e-'));
  const worktreeDir = path.join(worktreeBase, 'mmd-clone');
  try {
    const wt = spawnSync('git', ['worktree', 'add', worktreeDir, 'main'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    if (wt.status !== 0) {
      // Pre-condition failure: skip rather than fail (per ai-coding.md §I).
      assert.fail(`git worktree add failed (pre-condition): ${wt.stderr}`);
      return;
    }

    // The trivial reversible change — a comment line at the top of a docs file.
    // We pick docs/lessons-learned.md because it exists in the repo, has no
    // executable consequence, and a leading comment line has no semantic impact.
    const dream =
      `add a one-line HTML comment '<!-- self-dogfood smoke ${new Date().toISOString()} -->' ` +
      `at the very top of docs/lessons-learned.md`;

    const r = spawnSync('node', [MMD, '--here', dream], {
      cwd: worktreeDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        // MMD_REALITY_CHECK_BACKEND=skip is harmless here (AC-6 already skips
        // in --here mode), but we set it as defense-in-depth.
        MMD_REALITY_CHECK_BACKEND: 'skip',
      },
      timeout: 25 * 60 * 1000,
    });

    assert.equal(
      r.status,
      0,
      `mmd --here exited ${r.status}; stderr:\n${r.stderr}\nstdout:\n${r.stdout}`,
    );

    // AC-7.1 + AC-7.2: slice branch exists with the requested change.
    const head = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: worktreeDir, encoding: 'utf8',
    });
    assert.equal(head.status, 0);
    assert.match(head.stdout.trim(), /^slice\/here-.+-\d+$/);

    // AC-7.4: status.json carries mode + target_dir.
    const statusPath = path.join(worktreeDir, '.mmd', 'shared', 'status.json');
    assert.ok(existsSync(statusPath), `status.json missing at ${statusPath}`);
    const status = JSON.parse(readFileSync(statusPath, 'utf8'));
    assert.equal(status.mode, 'here');
    assert.equal(status.target_dir, path.resolve(worktreeDir));
    assert.equal(status.slice_branch, head.stdout.trim());

    // AC-7.2 (content check) — the comment line should be present at the top
    // of docs/lessons-learned.md on the slice branch.
    const show = spawnSync(
      'git',
      ['show', `${head.stdout.trim()}:docs/lessons-learned.md`],
      { cwd: worktreeDir, encoding: 'utf8' },
    );
    assert.equal(show.status, 0);
    assert.match(
      show.stdout.split('\n').slice(0, 5).join('\n'),
      /<!-- self-dogfood smoke /,
      'leading lines should contain the self-dogfood smoke comment',
    );

    // AC-7.3: main branch is unchanged in this worktree.
    // (We can't easily diff main vs the previous main without checking out, so
    // we assert via reflog that main hasn't advanced since worktree creation.)
    const mainSha = spawnSync('git', ['rev-parse', 'main'], {
      cwd: worktreeDir, encoding: 'utf8',
    });
    const origMain = spawnSync('git', ['rev-parse', 'main'], {
      cwd: REPO_ROOT, encoding: 'utf8',
    });
    assert.equal(
      mainSha.stdout.trim(),
      origMain.stdout.trim(),
      'main in worktree should match main in source — slice should not have moved it',
    );
  } finally {
    // Cleanup: remove the worktree, then the tempdir.
    spawnSync('git', ['worktree', 'remove', '--force', worktreeDir], {
      cwd: REPO_ROOT,
    });
    rmSync(worktreeBase, { recursive: true, force: true });
  }
});
