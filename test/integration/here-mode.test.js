// @integration tests for v0.2a --here mode end-to-end (AC-1..AC-6).
//
// Strategy: set up REAL temp git repos at test time (the spec asks for
// "fixture git repos under test/fixtures/here-repos/" but a repo with a
// nested .git inside our own repo is fragile; tempdir setup is the same
// test surface with cleaner lifecycle).
//
// CRITICAL: every test that reaches invokeAutodev MUST set MMD_AUTODEV_CMD to
// our fake-autodev-here.sh and MMD_REALITY_CHECK_BACKEND=skip — per the
// recursion-guard rule established in test/integration/mmd.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync,
  chmodSync, symlinkSync, realpathSync,
} from 'node:fs';
import { tmpdir, platform } from 'node:os';
import path from 'node:path';

import { buildSubprocessEnv } from '../../lib/invoke-autodev.js';
import { slugify } from '../../lib/parse-dream.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');
const FIXTURE_HERE = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-autodev-here.sh');

const SKIP_ON_WINDOWS = platform() === 'win32';

function makeTmp(prefix = 'mmd-here-') {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

/** Run `git` synchronously inside cwd, asserting success. */
function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${r.stderr}`);
  }
  return r.stdout;
}

/** Initialize a clean git repo at `dir`, one commit, on branch `main`. */
function initCleanRepo(dir) {
  mkdirSync(dir, { recursive: true });
  git(['init', '-q', '-b', 'main'], dir);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init', '-q'], dir);
  return dir;
}

/** Initialize a git repo with an uncommitted tracked-file change. */
function initDirtyRepo(dir) {
  initCleanRepo(dir);
  writeFileSync(path.join(dir, 'README.md'), '# tmp\n');
  git(['add', 'README.md'], dir);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'add readme', '-q'], dir);
  // Mutate without committing → dirty tree.
  writeFileSync(path.join(dir, 'README.md'), '# tmp\nmore\n');
  return dir;
}

function runMmd(args, opts = {}) {
  const baseEnv = buildSubprocessEnv(process.env);
  const env = {
    ...baseEnv,
    MMD_AUTODEV_CMD: opts.autodevCmd ?? FIXTURE_HERE,
    MMD_REALITY_CHECK_BACKEND: 'skip',
    // Provide git identity defensively for repos created without a global config.
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
    ...(opts.env || {}),
  };
  return spawnSync('node', [MMD, ...args], {
    cwd: opts.cwd,
    env,
    encoding: 'utf8',
    timeout: 30000,
  });
}

// AC-2 — exit 3 when cwd is not a git repo.
test('@integration v0.2a AC-2: --here outside any git repo exits 3', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp(); // plain dir, no `git init`
  try {
    const r = runMmd(['--here', 'tweak something'], { cwd: tmp });
    assert.equal(r.status, 3, `expected exit 3; got ${r.status}; stderr=${r.stderr}`);
    assert.match(r.stderr, /git repository|git could not run/i);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// AC-2 — exit 4 when working tree is dirty.
test('@integration v0.2a AC-2: --here in a dirty git repo exits 4', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    initDirtyRepo(tmp);
    const r = runMmd(['--here', 'tweak something'], { cwd: tmp });
    assert.equal(r.status, 4, `expected exit 4; got ${r.status}; stderr=${r.stderr}`);
    assert.match(r.stderr, /clean working tree/i);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// AC-1 + AC-3 + AC-5 + AC-6 — happy path on a clean repo.
test('@integration v0.2a AC-1+3+5+6: --here on clean repo creates slice branch, status.json with required fields, skips reality check', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    initCleanRepo(tmp);
    const baseSha = git(['rev-parse', 'HEAD'], tmp).trim();
    const dream = 'add a comment line at the top of README.md';
    const r = runMmd(['--here', dream], { cwd: tmp });
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}\nstdout=${r.stdout}`);

    // AC-1: the "Mode: --here" announcement on stdout.
    assert.match(r.stdout, /Mode: --here \(modifying current repo: /);

    // AC-3: slice branch was created with the expected shape.
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], tmp).trim();
    // L-005 + L-007: derive the slug from the production function, never hardcode.
    const expectedSlug = slugify(dream);
    assert.match(
      branch,
      new RegExp(`^slice/here-${expectedSlug}-\\d+$`),
      `branch '${branch}' should match slice/here-${expectedSlug}-<unix-ts>`,
    );

    // AC-5: status.json carries mode + target_dir + slice_branch + base_branch + base_sha.
    const statusPath = path.join(tmp, '.mmd', 'shared', 'status.json');
    assert.ok(existsSync(statusPath), 'status.json should exist at <cwd>/.mmd/shared/status.json');
    const status = JSON.parse(readFileSync(statusPath, 'utf8'));
    assert.equal(status.mode, 'here');
    assert.equal(status.target_dir, path.resolve(tmp));
    assert.equal(status.slice_branch, branch);
    assert.equal(status.base_branch, 'main');
    assert.equal(status.base_sha, baseSha);
    assert.equal(status.state, 'done');
    // Existing v0.2 fields preserved.
    assert.equal(status.engine, 'standard');
    assert.ok(status.engine_metrics);

    // AC-3: no demo/<slug>/ was created.
    assert.equal(
      existsSync(path.join(tmp, 'demo')),
      false,
      'demo/ must NOT exist in --here mode',
    );

    // AC-6: Reality Check skipped on stdout with the documented reason.
    assert.match(r.stdout, /Reality Check: SKIPPED — --here mode/);

    // F1 (Phase 4 review): two independent oracles for AC-3.
    //   (a) The fixture-recorded branchRecord (what auto-dev SAW during its
    //       run) must match the canonical slice-branch pattern derived from
    //       the slugifier — NOT from a post-hoc git read. If an L-008-style
    //       violation occurred (auto-dev switched branches after running),
    //       comparing branchRecord against a post-hoc rev-parse would still
    //       pass; comparing against the pattern catches it.
    //   (b) The post-hoc git rev-parse (`branch` above) confirms AC-3's
    //       "the user is left on the slice branch for review" — independent
    //       reading after auto-dev finished.
    // Per ai-coding.md §V (verification before delivery): an independent
    // oracle is required when one exists.
    const branchRecord = readFileSync(
      path.join(tmp, '.mmd', 'local', 'runs', 'here-branch.txt'),
      'utf8',
    ).trim();
    assert.match(
      branchRecord,
      new RegExp(`^slice/here-${expectedSlug}-\\d+$`),
      `fixture recorded branch '${branchRecord}' must match the canonical slice-branch pattern`,
    );
    // Secondary safety check: both oracles agree.
    assert.equal(branchRecord, branch, 'fixture should have run on the slice branch');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// AC-2 protected-branch exemption: --here from main does NOT fail; it creates the slice anyway.
// F6 (Phase 4 review): also asserts the MMD_HERE_PROTECTED_BRANCHES note is
// emitted to stderr when --here-ing from a protected branch, giving the env
// var an observable runtime consequence (universal.md §II KISS, no dead code).
test('@integration v0.2a AC-2 + F6: --here from main auto-creates slice branch AND emits protected-branch note', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    initCleanRepo(tmp);
    // Confirm we are on main.
    const before = git(['rev-parse', '--abbrev-ref', 'HEAD'], tmp).trim();
    assert.equal(before, 'main');
    const dream = 'a tweak from main';
    const expectedSlug = slugify(dream);
    const r = runMmd(['--here', dream], { cwd: tmp });
    assert.equal(r.status, 0, `protected-branch run should succeed; got ${r.status}; stderr=${r.stderr}`);
    const after = git(['rev-parse', '--abbrev-ref', 'HEAD'], tmp).trim();
    assert.match(
      after,
      new RegExp(`^slice/here-${expectedSlug}-\\d+$`),
      `expected slice branch, got ${after}`,
    );
    // F6: protected-branch note observable on stderr.
    assert.match(
      r.stderr,
      /Note: --here from a protected branch 'main'/,
      'stderr should announce that the slice was created from a protected branch',
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// F6 (Phase 4 review): when --here is run from a NON-protected branch (e.g.
// an existing topic branch), the protected-branch note MUST NOT appear.
test('@integration v0.2a F6: --here from a topic branch does NOT emit the protected-branch note', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    initCleanRepo(tmp);
    // Move off main onto a topic branch BEFORE running --here.
    git(['checkout', '-b', 'topic/some-feature', '-q'], tmp);
    const before = git(['rev-parse', '--abbrev-ref', 'HEAD'], tmp).trim();
    assert.equal(before, 'topic/some-feature');
    const r = runMmd(['--here', 'tweak from topic branch'], { cwd: tmp });
    assert.equal(r.status, 0, `run from topic branch should succeed; got ${r.status}; stderr=${r.stderr}`);
    // F6: no protected-branch note when base is not in MMD_HERE_PROTECTED_BRANCHES.
    assert.doesNotMatch(
      r.stderr,
      /Note: --here from a protected branch/,
      'protected-branch note must NOT appear when base branch is not protected',
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// AC-6 — npm test suggestion when package.json declares a `test` script.
test('@integration v0.2a AC-6: --here suggests `npm test` when cwd package.json has a test script', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    initCleanRepo(tmp);
    writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 't', scripts: { test: 'echo ok' } }, null, 2),
    );
    git(['add', 'package.json'], tmp);
    git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'pkg', '-q'], tmp);
    // v0.2c: --skip-onboarding bypasses the new Project Onboarder gate.
    // The cwd now LOOKS like a brownfield (has package.json) so the gate
    // would fire otherwise (exit 5). This test exercises AC-6 (npm test
    // suggestion), not AC-7 (the gate); --skip-onboarding scopes the run.
    const r = runMmd(['--here', '--skip-onboarding', 'verify suggestion path'], { cwd: tmp });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Suggestion: run `npm test`/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// AC-6 — no suggestion when package.json has no test script.
test('@integration v0.2a AC-6: --here omits npm test suggestion when no package.json test script', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    initCleanRepo(tmp);
    const r = runMmd(['--here', 'no pkg suggestion path'], { cwd: tmp });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /Suggestion: run `npm test`/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// F2 (Phase 4 review) — symlinked cwd: status.json.target_dir MUST be the
// canonical real path, not the symlink. Otherwise the audit trail records
// `target_dir=/path/to/symlink` while git operates on `/path/to/real-repo`
// → traceability mismatch when the symlink is removed/repointed.
// Skip cleanly on platforms where symlink creation is restricted (e.g.
// stock Windows without Developer Mode). ai-coding.md §I: document the skip.
test('@integration v0.2a F2: --here from a symlinked cwd records canonical real path in status.json', { skip: SKIP_ON_WINDOWS }, () => {
  const parent = makeTmp('mmd-here-symlink-');
  const realRepo = path.join(parent, 'real-repo');
  const linkRepo = path.join(parent, 'link-repo');
  try {
    initCleanRepo(realRepo);
    try {
      symlinkSync(realRepo, linkRepo, 'dir');
    } catch (err) {
      // Documented skip per ai-coding.md §I: failure honesty.
      // Cannot exercise F2 on this platform without symlink privileges.
      // eslint-disable-next-line no-console
      console.log(`# SKIP F2 symlink test: cannot symlink (${err.code}: ${err.message})`);
      return;
    }
    const canonical = realpathSync(linkRepo);
    assert.equal(canonical, realRepo, 'realpathSync sanity: link resolves to real-repo');

    const r = runMmd(['--here', 'tweak via symlinked cwd'], { cwd: linkRepo });
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}; stdout=${r.stdout}`);

    // F2 invariant: status.json.target_dir is the canonical real path,
    // never the symlink path. Read from the real repo path (the canonical
    // location) since that's where the writes land.
    const statusPath = path.join(realRepo, '.mmd', 'shared', 'status.json');
    assert.ok(existsSync(statusPath), 'status.json should exist at canonical path');
    const status = JSON.parse(readFileSync(statusPath, 'utf8'));
    assert.equal(
      status.target_dir,
      realRepo,
      `target_dir must be the canonical real path, not the symlink '${linkRepo}'`,
    );
    // Sanity: stdout's "Mode: --here" announcement also reports the real path.
    assert.ok(
      r.stdout.includes(realRepo),
      `stdout should announce the canonical real path; got: ${r.stdout}`,
    );
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

// F4 (Phase 4 review) — post-checkout FS failure must:
//   - exit 6 (subprocess-style failure, not 99 catch-all),
//   - print the slice branch + base SHA + recovery hint to stderr,
//   - NOT leave the user with a stack trace.
// We force the failure by committing .mmd/shared as a REGULAR FILE in the
// fixture repo: validation sees a clean tree (file is tracked), then
// ensureLayout's mkdir('.mmd/shared') hits EEXIST/ENOTDIR (it's not a dir).
test('@integration v0.2a F4: post-checkout FS failure exits 6 with recovery hint', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    initCleanRepo(tmp);
    // Pre-create .mmd as a dir, but .mmd/shared as a REGULAR FILE → tracked,
    // clean working tree, but ensureLayout's mkdir(.mmd/shared) hits ENOTDIR
    // (it's a file, not a dir). recursive:true on mkdir does NOT silently
    // succeed when the leaf exists as a non-directory.
    mkdirSync(path.join(tmp, '.mmd'));
    writeFileSync(path.join(tmp, '.mmd', 'shared'), 'booby trap\n');
    git(['add', '.mmd'], tmp);
    git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'booby', '-q'], tmp);
    const baseSha = git(['rev-parse', 'HEAD'], tmp).trim();

    const r = runMmd(['--here', 'this should fail at state init'], { cwd: tmp });
    assert.equal(r.status, 6, `expected exit 6; got ${r.status}; stderr=${r.stderr}`);
    // Recovery hint contains the slice branch name (matched as a pattern,
    // not the exact unix-ts) and the base sha + branch.
    assert.match(r.stderr, /failed to initialize --here state/);
    assert.match(r.stderr, /To recover: git checkout main && git reset --hard /);
    assert.ok(
      r.stderr.includes(baseSha),
      `recovery hint should include base SHA ${baseSha}; got: ${r.stderr}`,
    );
    assert.match(r.stderr, /git branch -D slice\/here-/);
    // The slice branch DID get created (createSliceBranch ran successfully
    // before the FS write) — that's the recovery target.
    const head = git(['rev-parse', '--abbrev-ref', 'HEAD'], tmp).trim();
    assert.match(head, /^slice\/here-/);
  } finally {
    // Ensure we can rm the booby-trapped dir.
    try { chmodSync(path.join(tmp, '.mmd'), 0o700); } catch { /* not present */ }
    rmSync(tmp, { recursive: true, force: true });
  }
});

// Regression — without --here the greenfield path is still creating demo/.
test('@integration v0.2a regression: without --here the greenfield path is unchanged (demo/<slug>/ created)', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    // greenfield doesn't need a git repo; use the regular fixture
    const r = spawnSync('node', [MMD, 'a tiny test app shows hello world'], {
      cwd: tmp,
      env: {
        ...buildSubprocessEnv(process.env),
        MMD_AUTODEV_CMD: path.join(REPO_ROOT, 'test', 'fixtures', 'fake-autodev.sh'),
        MMD_REALITY_CHECK_BACKEND: 'skip',
      },
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(path.join(tmp, 'demo', 'tiny-test-app-shows-hello-world')));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// AC-3 — exit 5 when slice branch already exists. We pre-create the branch
// name that generateSliceBranchName WILL produce next second; the run should
// fail on `git checkout -b`. Since the timestamp suffix changes per second,
// we make a branch that matches by injecting a collision: pre-create
// `slice/here-<slug>-<freezing-ts>` AND mock by... in practice, this is hard
// to deterministically trigger without injecting `now`. We rely instead on
// pre-existing branch with a matching prefix being rare. Skip this case in
// favor of the simpler "branch with explicit name conflict" — checkout-b
// fails when the EXACT name exists. We can force it by creating a branch
// with the form slice/here-x-9999999999 and... too brittle.
//
// Instead: cover the exit-5 path by giving --here a slug that triggers
// branch creation failure another way — set HEAD to an empty-tree state.
// On reflection: this overlaps validateHereTarget. Better to assert exit 5
// when checkout fails by mocking git: we'd need to ship a fake `git`
// shadowing PATH. Skip the dedicated exit-5 e2e test here; the
// @integration test in test/integration/here-mode-lib.test.js covers the
// createSliceBranch contract via the typed return shape (pre-existing
// branch with same name → exit 5).
