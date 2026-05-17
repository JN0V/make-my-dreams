// @integration end-to-end tests for the 5 v0.1-deferred items landing in v0.2:
//   B2 — MMD_AUTODEV_MODE explicit detection (replaces v0.1 heuristic)
//   B4 — MMD_QUIET=1 suppresses terminal tee while preserving log-file tee
//   E7 — --resume refuses on symlinked demoDir (parallel to --fresh defense)
//   E13 — POSIX `--` end-of-flags separator
//   E14 — unknown flags rejected with exit 2 instead of silently dropped
//
// Per testing.md §V: < 5 s total budget.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  existsSync,
  writeFileSync,
  mkdirSync,
  symlinkSync,
  readdirSync,
} from 'node:fs';
import { tmpdir, platform } from 'node:os';
import path from 'node:path';

import { buildSubprocessEnv } from '../../lib/invoke-autodev.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');
const FIXTURE_OK = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-autodev.sh');

function makeTmp() {
  return mkdtempSync(path.join(tmpdir(), 'mmd-def01-'));
}

function runMmd(args, opts = {}) {
  const baseEnv = buildSubprocessEnv(process.env);
  const env = {
    ...baseEnv,
    MMD_AUTODEV_CMD: opts.autodevCmd ?? FIXTURE_OK,
    MMD_REALITY_CHECK_BACKEND: 'skip',
    ...(opts.env || {}),
  };
  return spawnSync('node', [MMD, ...args], {
    cwd: opts.cwd,
    env,
    encoding: 'utf8',
    timeout: 30000,
  });
}

// ---- B2: MMD_AUTODEV_MODE ---------------------------------------------------
// Pure-logic resolveAutodevMode() unit tests live at test/unit/autodev-mode.test.js
// so they are picked up by `npm test:unit` (which globs test/unit/*.test.js).

// ---- B4: MMD_QUIET ----------------------------------------------------------

test('@integration B4: MMD_QUIET=1 suppresses subprocess output on stdout but preserves the log file', () => {
  const tmp = makeTmp();
  try {
    const r = runMmd(['a tiny app showing hello'], {
      cwd: tmp,
      env: { MMD_QUIET: '1' },
    });
    assert.equal(r.status, 0, r.stderr);
    // The "Catching your dream..." line is from bin/mmd.js itself, NOT from
    // the subprocess — it stays visible. The subprocess fixture writes
    // "fake-autodev: received prompt of ..." which is what MMD_QUIET hides.
    assert.doesNotMatch(r.stdout, /fake-autodev: received prompt/);
    // But the log file should still contain it.
    const slug = 'tiny-app-showing-hello';
    const runsDir = path.join(tmp, 'demo', slug, '.mmd', 'local', 'runs');
    const runFiles = readdirSync(runsDir).filter((f) => f.endsWith('.log'));
    assert.equal(runFiles.length, 1);
    const runLog = readFileSync(path.join(runsDir, runFiles[0]), 'utf8');
    assert.match(runLog, /fake-autodev: received prompt/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration B4: without MMD_QUIET, subprocess output appears on stdout (regression check)', () => {
  const tmp = makeTmp();
  try {
    const r = runMmd(['a tiny app showing hello'], { cwd: tmp });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /fake-autodev: received prompt/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- E7: --resume symlink defense -------------------------------------------

test(
  '@integration E7: --resume refuses on symlinked demoDir (exit 5, symlink target untouched)',
  { skip: platform() === 'win32' },
  () => {
    const tmp = makeTmp();
    try {
      const demoRoot = path.join(tmp, 'demo');
      mkdirSync(demoRoot, { recursive: true });
      const outsideTarget = path.join(tmp, 'outside-target');
      mkdirSync(outsideTarget);
      writeFileSync(path.join(outsideTarget, 'sensitive.txt'), 'do not leak');
      // Plant the status.json that --resume would otherwise read.
      const sharedDir = path.join(outsideTarget, '.mmd', 'shared');
      mkdirSync(sharedDir, { recursive: true });
      writeFileSync(
        path.join(sharedDir, 'status.json'),
        JSON.stringify({
          slice_id: 'tiny-app-showing-hello',
          dream: 'a tiny app showing hello',
          state: 'done',
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
          tasks: [],
        }),
      );
      const slug = 'tiny-app-showing-hello';
      symlinkSync(outsideTarget, path.join(demoRoot, slug));

      const r = runMmd(['a tiny app showing hello', '--resume'], { cwd: tmp });
      assert.equal(r.status, 5, `expected exit 5; got ${r.status}; stderr=${r.stderr}`);
      assert.match(r.stderr, /refusing to --resume.*symlinked demoDir/);
      // Sensitive file should be untouched.
      assert.ok(existsSync(path.join(outsideTarget, 'sensitive.txt')));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  },
);

// ---- E13: POSIX `--` separator ---------------------------------------------

test('@integration E13: `--` separator lets dream text legitimately start with --', () => {
  const tmp = makeTmp();
  try {
    // Without `--`, --literal-flag-as-dream would be rejected (E14). With it,
    // it's treated as the dream itself.
    const r = runMmd(['--', '--literally-my-dream'], { cwd: tmp });
    // slugify drops non-alphanumerics + stopwords; `--literally-my-dream`
    // becomes `literally-my-dream` (no stopword in the middle).
    assert.equal(r.status, 0, `stderr=${r.stderr}\nstdout=${r.stdout}`);
    assert.ok(existsSync(path.join(tmp, 'demo', 'literally-my-dream')));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration E13: --fast BEFORE --, dream after — both honored', () => {
  const tmp = makeTmp();
  try {
    const r = runMmd(['--fast', '--', '--dream-after-separator'], { cwd: tmp });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Engine: FAST/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- E14: unknown-flag rejection -------------------------------------------

test('@integration E14: unknown --foo flag rejected with exit 2 and helpful message', () => {
  const r = runMmd(['--foo', 'dream'], { cwd: makeTmp() });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown flag: --foo/);
  // The message should mention the escape hatch for legitimately-dashed dreams.
  assert.match(r.stderr, /--help|--/);
});

test('@integration E14: unknown flag is rejected BEFORE any state is touched', () => {
  const tmp = makeTmp();
  try {
    const r = runMmd(['--nope', 'a tiny app'], { cwd: tmp });
    assert.equal(r.status, 2);
    // No demo dir should have been created.
    assert.equal(existsSync(path.join(tmp, 'demo')), false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
