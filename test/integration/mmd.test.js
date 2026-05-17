// End-to-end CLI tests for bin/mmd.js (dream-bench prototype).
// CRITICAL: never let a test invoke the real claude CLI. See SPEC §4.4.1 + F1 recursion-guard rule.
// Every test that reaches invokeAutodev/realityCheck MUST set both:
//   MMD_AUTODEV_CMD=<fixture> and MMD_REALITY_CHECK_BACKEND=skip
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync, symlinkSync, statSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import path from 'node:path';

import { buildSubprocessEnv } from '../../lib/invoke-autodev.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');
const FIXTURE_OK = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-autodev.sh');
const FIXTURE_FAIL = path.join(REPO_ROOT, 'test', 'fixtures', 'failing-autodev.sh');

function makeTmp() {
  return mkdtempSync(path.join(tmpdir(), 'mmd-cli-'));
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

test('mmd --version exits 0 with the version from package.json', () => {
  // Read the version dynamically from package.json so the test does NOT need
  // to be edited on every version bump. v0.1 had this hardcoded to /0\.1\.0/
  // which broke when we bumped to 0.2.5 — the test had to be generalized.
  // Lesson learned: when a constant exists in a single source of truth
  // (package.json here), the test should read from THAT source, not hardcode.
  const pkg = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
  );
  const r = spawnSync('node', [MMD, '--version'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^\d+\.\d+\.\d+\n?$/);
  assert.equal(r.stdout.trim(), pkg.version);
});

test('mmd --help exits 0 and mentions --resume/--fresh/--cancel', () => {
  const r = spawnSync('node', [MMD, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /--resume/);
  assert.match(r.stdout, /--fresh/);
  assert.match(r.stdout, /--cancel/);
});

test('mmd with no args exits non-zero with usage on stderr', () => {
  const r = spawnSync('node', [MMD], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /usage|dream/i);
});

test('mmd "" exits with code 2 (usage error)', () => {
  const r = spawnSync('node', [MMD, ''], { encoding: 'utf8' });
  assert.equal(r.status, 2);
});

test('happy path end-to-end with autodev stub creates demo dir + state files', () => {
  const tmp = makeTmp();
  try {
    const r = runMmd(['a tiny test app that shows hello world'], { cwd: tmp });
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}\nstdout=${r.stdout}`);
    const demoDir = path.join(tmp, 'demo', 'tiny-test-app-shows-hello-world');
    assert.ok(existsSync(demoDir), 'demoDir should exist');
    assert.ok(existsSync(path.join(demoDir, '.mmd', 'shared', 'vision.md')), 'vision.md missing');
    assert.ok(existsSync(path.join(demoDir, '.mmd', 'shared', 'slice.md')), 'slice.md missing');
    assert.ok(existsSync(path.join(demoDir, '.mmd', 'shared', 'status.json')), 'status.json missing');
    assert.ok(existsSync(path.join(demoDir, 'index.html')), 'stub-generated index.html missing');
    assert.match(r.stdout, /Catching your dream/);
    assert.match(r.stdout, /\[OK\] Delivered/);
    // decisions.log transitions
    const log = readFileSync(path.join(demoDir, '.mmd', 'shared', 'decisions.log'), 'utf8');
    const lines = log.trim().split('\n');
    assert.match(lines[0], /\(initial\) -> in_progress/);
    assert.ok(lines.some(l => /in_progress -> done/.test(l)), `expected an in_progress -> done line; got:\n${log}`);
    // AC-3: subprocess stdout/stderr captured into .mmd/local/runs/<ts>.log
    const runsDir = path.join(demoDir, '.mmd', 'local', 'runs');
    assert.ok(existsSync(runsDir), 'runs dir missing');
    const runFiles = readdirSync(runsDir).filter(f => f.endsWith('.log'));
    assert.equal(runFiles.length, 1, `expected exactly one run log; got ${runFiles.length}`);
    const runLog = readFileSync(path.join(runsDir, runFiles[0]), 'utf8');
    assert.match(runLog, /fake-autodev: received prompt/, `run log missing stub marker; content=${runLog}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('AC-2 slug: drawing-app dream produces drawing-app-overlays-image-camera-feed demo dir', () => {
  const tmp = makeTmp();
  try {
    const r = runMmd(['a drawing app that overlays an image on the camera feed'], { cwd: tmp });
    assert.equal(r.status, 0, r.stderr);
    const expectedDir = path.join(tmp, 'demo', 'drawing-app-overlays-image-camera-feed');
    assert.ok(existsSync(expectedDir), `expected ${expectedDir}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('re-run in non-TTY without flags exits 2', () => {
  const tmp = makeTmp();
  try {
    // First run to create state
    let r = runMmd(['a tiny test app that shows hello world'], { cwd: tmp });
    assert.equal(r.status, 0, r.stderr);
    // Second run with no flag in non-TTY context
    r = runMmd(['a tiny test app that shows hello world'], { cwd: tmp });
    assert.equal(r.status, 2);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('re-run with --resume exits 3 and reports state', () => {
  const tmp = makeTmp();
  try {
    let r = runMmd(['a tiny test app that shows hello world'], { cwd: tmp });
    assert.equal(r.status, 0, r.stderr);
    r = runMmd(['a tiny test app that shows hello world', '--resume'], { cwd: tmp });
    assert.equal(r.status, 3);
    assert.match(r.stdout, /state/i);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('re-run with --cancel exits 1', () => {
  const tmp = makeTmp();
  try {
    let r = runMmd(['a tiny test app that shows hello world'], { cwd: tmp });
    assert.equal(r.status, 0, r.stderr);
    r = runMmd(['a tiny test app that shows hello world', '--cancel'], { cwd: tmp });
    assert.equal(r.status, 1);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('re-run with --fresh deletes existing demo dir and restarts', () => {
  const tmp = makeTmp();
  try {
    let r = runMmd(['a tiny test app that shows hello world'], { cwd: tmp });
    assert.equal(r.status, 0, r.stderr);
    const demoDir = path.join(tmp, 'demo', 'tiny-test-app-shows-hello-world');
    // Place a marker file we expect to be removed
    writeFileSync(path.join(demoDir, 'marker.txt'), 'before-fresh');
    r = runMmd(['a tiny test app that shows hello world', '--fresh'], { cwd: tmp });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(path.join(demoDir, 'marker.txt')), false,
      'marker should have been deleted by --fresh');
    assert.ok(existsSync(path.join(demoDir, '.mmd', 'shared', 'status.json')));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('autodev failure: status.json is written with state=failed and all five fields', () => {
  const tmp = makeTmp();
  try {
    const r = runMmd(['a tiny test app that shows hello world'], {
      cwd: tmp,
      autodevCmd: FIXTURE_FAIL,
    });
    assert.notEqual(r.status, 0);
    const statusPath = path.join(tmp, 'demo', 'tiny-test-app-shows-hello-world', '.mmd', 'shared', 'status.json');
    assert.ok(existsSync(statusPath), 'status.json should still exist on failure path');
    const status = JSON.parse(readFileSync(statusPath, 'utf8'));
    assert.equal(status.state, 'failed');
    assert.ok(typeof status.slice_id === 'string' && status.slice_id.length > 0);
    assert.match(status.created_at, /^\d{4}-/);
    assert.match(status.updated_at, /^\d{4}-/);
    assert.ok(Array.isArray(status.tasks) && status.tasks.length > 0);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('symlink-bypass refusal on --fresh (exit 5, target preserved)', { skip: platform() === 'win32' }, () => {
  const tmp = makeTmp();
  try {
    // Pre-create demo/<slug> as a SYMLINK to outside ./demo/
    const demoRoot = path.join(tmp, 'demo');
    mkdirSync(demoRoot, { recursive: true });
    const outsideTarget = path.join(tmp, 'outside-target');
    mkdirSync(outsideTarget);
    writeFileSync(path.join(outsideTarget, 'precious.txt'), 'do not delete');
    const slug = 'tiny-test-app-shows-hello-world';
    symlinkSync(outsideTarget, path.join(demoRoot, slug));
    // Tamper a status.json under the symlinked dir (which writes to outsideTarget) so AC-7 fires.
    mkdirSync(path.join(demoRoot, slug, '.mmd', 'shared'), { recursive: true });
    writeFileSync(path.join(demoRoot, slug, '.mmd', 'shared', 'status.json'), JSON.stringify({
      slice_id: slug,
      dream: 'a tiny test app that shows hello world',
      state: 'done',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      tasks: [],
    }));
    const r = runMmd(['a tiny test app that shows hello world', '--fresh'], { cwd: tmp });
    assert.equal(r.status, 5, `expected exit 5; got ${r.status}; stderr=${r.stderr}`);
    assert.ok(existsSync(path.join(outsideTarget, 'precious.txt')),
      'symlink target must NOT have been deleted');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('slug collision: different dream same slug → -2 suffix', () => {
  const tmp = makeTmp();
  try {
    // Pre-create the slug directory with a status.json whose dream differs.
    const slug = 'tiny-test-app-shows-hello-world';
    const dir = path.join(tmp, 'demo', slug, '.mmd', 'shared');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'status.json'), JSON.stringify({
      slice_id: slug,
      dream: 'different dream string',
      state: 'done',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      tasks: [],
    }));
    const r = runMmd(['a tiny test app that shows hello world'], { cwd: tmp });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /slug collision; using .*-2/);
    assert.ok(existsSync(path.join(tmp, 'demo', `${slug}-2`)), '<slug>-2 should be created');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('corrupt status.json triggers defensive rename + warning + proceed', async () => {
  const tmp = makeTmp();
  try {
    const slug = 'tiny-test-app-shows-hello-world';
    const dir = path.join(tmp, 'demo', slug, '.mmd', 'shared');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'status.json'), '{not valid json');
    const r = runMmd(['a tiny test app that shows hello world'], { cwd: tmp });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /malformed|corrupt|WARNING/i);
    const { readdirSync } = await import('node:fs');
    const remaining = readdirSync(dir);
    assert.ok(remaining.some(f => /^status\.json\.corrupt-/.test(f)),
      `expected a status.json.corrupt-* file under ${dir}; got ${remaining.join(',')}`);
    assert.ok(remaining.includes('status.json'), 'a fresh status.json should be written');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
