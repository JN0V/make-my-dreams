// @integration tests for the v0.14.b HYBRID auto-handoff ENFORCE backstop on the
// `mmdream --here --auto-handoff` surface (SPEC_V014B AC-3, ADR-053).
//
// Strategy mirrors here-auto-handoff.test.js: run the REAL bin/mmd.js as a
// subprocess with MMD_AUTODEV_CMD → fake-claude-enforce.js, so no real claude /
// network is hit. The fake IGNORES the cooperative incitation (crosses the
// threshold, advances the checkpoint a new boundary, STAYS ALIVE), forcing MMD's
// abort seam to terminate it (Path B) and relaunch resume. A tiny
// MMD_HANDOFF_GRACE_MS keeps the tests fast (terminate almost immediately once
// the predicate fires).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import path from 'node:path';

import { buildSubprocessEnv } from '../../lib/invoke-autodev.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');
const FAKE_ENFORCE = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-claude-enforce.js');
const SKIP_ON_WINDOWS = platform() === 'win32'; // POSIX process-group signalling

// Avoid the substring "handoff" in the tmp path (MMD prints the repo path, which
// would make negative "no handoff log" assertions match the PATH).
function makeTmp() {
  return mkdtempSync(path.join(tmpdir(), 'mmd-hybrid-enf-'));
}

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

function initCleanRepo(dir) {
  mkdirSync(dir, { recursive: true });
  git(['init', '-q', '-b', 'main'], dir);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init', '-q'], dir);
  return dir;
}

function baseEnv(extra = {}) {
  return {
    ...buildSubprocessEnv(process.env),
    MMD_AUTODEV_CMD: FAKE_ENFORCE,
    MMD_REALITY_CHECK_BACKEND: 'skip',
    MMD_SKIP_SETUP: '1',
    MMD_SKIP_ALIGN: '1', // isolate the handoff loop; the gate is tested separately
    MMD_QUIET: '1',
    MMD_HANDOFF_GRACE_MS: '50', // terminate ~immediately once the predicate fires
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
    ...extra,
  };
}

// Async spawn so a slow/hung child can be killed without blocking the test loop.
function runMmdAsync(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [MMD, ...args], { cwd: opts.cwd, env: baseEnv(opts.env) });
    let stdout = '';
    let stderr = '';
    const killer = setTimeout(() => child.kill('SIGKILL'), 60000);
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('close', (status) => { clearTimeout(killer); resolve({ status, stdout, stderr }); });
    child.on('error', (err) => { clearTimeout(killer); reject(err); });
  });
}

function callCount(dir) {
  const f = path.join(dir, '.mmd', 'local', 'runs', 'autodev-calls');
  if (!existsSync(f)) return 0;
  return readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).length;
}

// ── AC-3 Path B: an orchestrator that ignores the incitation is ENFORCED at a
// checkpoint, and a fresh successor resumes + completes ──────────────────────

test('@integration AC-3: --auto-handoff ENFORCES a still-alive over-threshold agent, then resumes to completion',
  { skip: SKIP_ON_WINDOWS }, async () => {
    const tmp = makeTmp();
    try {
      initCleanRepo(tmp);
      const r = await runMmdAsync(['--here', '--auto-handoff', 'a context-filling change that ignores the incitation'], {
        cwd: tmp,
        env: { MMD_FAKE_ENFORCE_MODE: 'enforce-then-complete', MMD_FAKE_COMPLETE_AT: '2', MMD_MAX_HANDOFFS: '3' },
      });
      assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}\nstdout=${r.stdout}`);
      // Exactly two spawns: the enforced first run + one resumed successor.
      assert.equal(callCount(tmp), 2, 'one enforce → exactly 2 auto-dev spawns');
      assert.ok(existsSync(path.join(tmp, '.mmd', 'local', 'runs', 'autodev-call-2')), 'a successor was relaunched');
      assert.ok(!existsSync(path.join(tmp, '.mmd', 'local', 'runs', 'autodev-call-3')), 'no extra spawn after completion');
      // The HONEST enforce wording (not "stopped cleanly") + resume mode.
      assert.match(r.stdout, /Auto-handoff 1\/\d+/i, 'announces handoff 1/N');
      assert.match(r.stdout, /ENFORCED a terminate/i, 'honestly reports it was an enforced terminate, not a clean stop');
      assert.match(r.stdout, /resume mode/i, 'relaunches in resume mode');
      // The successor ran on the slice branch (never main).
      const branch = readFileSync(path.join(tmp, '.mmd', 'local', 'runs', 'enforce-branch-2.txt'), 'utf8').trim();
      assert.match(branch, /^slice\//, 'successor ran on the slice branch');
      // The marker is cleared at the end (no stale stop signal survives).
      assert.ok(!existsSync(path.join(tmp, '.mmd', 'local', 'handoff-request')), 'request marker cleared after the run');
      assert.match(r.stdout, /Changes applied on slice\//);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

// ── AC-3 cap: enforced handoffs are bounded by MMD_MAX_HANDOFFS, then one final
// un-enforced successor ──────────────────────────────────────────────────────

test('@integration AC-3: enforced handoffs are bounded — at the cap, one final un-enforced successor',
  { skip: SKIP_ON_WINDOWS }, async () => {
    const tmp = makeTmp();
    try {
      initCleanRepo(tmp);
      const r = await runMmdAsync(['--here', '--auto-handoff', 'a never-completing context-filling change'], {
        cwd: tmp,
        env: { MMD_FAKE_ENFORCE_MODE: 'enforce-to-cap', MMD_MAX_HANDOFFS: '2' },
      });
      assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}\nstdout=${r.stdout}`);
      // calls 1,2 enforced → handoffs 1,2; call 3 is the cap-eligible cooperative
      // stop → cap-final → one final successor (call 4). 4 spawns total.
      assert.equal(callCount(tmp), 4, 'initial + 2 enforced handoffs + 1 final successor = 4 spawns');
      assert.ok(!existsSync(path.join(tmp, '.mmd', 'local', 'runs', 'autodev-call-5')), 'no spawn past the final successor');
      assert.match(r.stdout, /Auto-handoff 1\/2/);
      assert.match(r.stdout, /Auto-handoff 2\/2/);
      assert.match(r.stdout, /ENFORCED a terminate/i, 'the enforced handoffs are reported honestly');
      assert.match(r.stdout, /cap reached \(2\)/i, 'honest cap log');
      assert.match(r.stdout, /FINAL successor with handoff DISABLED/i);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

// ── AC-3 / v0.13.1 preserved: crosses the threshold but advances NO checkpoint →
// MMD must NOT enforce (no new boundary) ─────────────────────────────────────

test('@integration AC-3: crosses threshold but advances NO checkpoint → never enforced (v0.13.1 preserved)',
  { skip: SKIP_ON_WINDOWS }, async () => {
    const tmp = makeTmp();
    try {
      initCleanRepo(tmp);
      const r = await runMmdAsync(['--here', '--auto-handoff', 'fills context but reaches no phase boundary'], {
        cwd: tmp,
        env: { MMD_FAKE_ENFORCE_MODE: 'cross-no-advance' },
      });
      assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}\nstdout=${r.stdout}`);
      // The monitor crossed 70% (marker requested) but with no new boundary the
      // enforce predicate never fires → exactly one spawn, no handoff line.
      assert.match(r.stdout, /READY_FOR_HANDOFF/);
      assert.equal(callCount(tmp), 1, 'no new checkpoint → no enforce → exactly one spawn');
      assert.ok(!/Auto-handoff \d/.test(r.stdout), 'no handoff/enforce without a new resumable boundary (v0.13.1)');
      assert.ok(!/ENFORCED a terminate/i.test(r.stdout), 'no enforced terminate without a new boundary');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

// ── Phase-4 review F1: a COMPLETE pipeline that is over-threshold at the final
// boundary must NOT be enforce-killed (and thus mis-reported as a failure) ────

test('@integration F1: a complete (phase-4) run over the threshold is NOT enforced — it finishes successfully',
  { skip: SKIP_ON_WINDOWS }, async () => {
    const tmp = makeTmp();
    try {
      initCleanRepo(tmp);
      // The fake writes checkpoint 4 (complete), crosses 70%, then stays alive a
      // beat (post-pipeline wrap-up) before exiting on its own. Without the
      // completeness guard MMD would SIGTERM it during that beat and report exit 6.
      const r = await runMmdAsync(['--here', '--auto-handoff', 'a run that finishes while context is full'], {
        cwd: tmp,
        env: { MMD_FAKE_ENFORCE_MODE: 'complete-over-threshold' },
      });
      assert.equal(r.status, 0, `a complete run must succeed, not be force-failed; stderr=${r.stderr}\nstdout=${r.stdout}`);
      assert.equal(callCount(tmp), 1, 'a complete run is not handed off → exactly one spawn');
      assert.ok(!/ENFORCED a terminate/i.test(r.stdout), 'a finished pipeline is never enforce-killed');
      assert.ok(!/Auto-handoff \d/.test(r.stdout), 'no handoff on a complete run');
      assert.match(r.stdout, /Changes applied on slice\//);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

// ── AC-3 default-unchanged: WITHOUT --auto-handoff, a still-alive marker-crossing
// agent is never enforced (the abort seam is inert) ──────────────────────────

test('@integration AC-3: without --auto-handoff the abort seam is inert (no enforce; default spawn)',
  { skip: SKIP_ON_WINDOWS }, async () => {
    const tmp = makeTmp();
    try {
      initCleanRepo(tmp);
      // cross-no-advance exits on its own quickly; without --auto-handoff there is
      // no monitor and no abort predicate at all → a single, unmonitored spawn.
      const r = await runMmdAsync(['--here', 'a plain change'], {
        cwd: tmp,
        env: { MMD_FAKE_ENFORCE_MODE: 'cross-no-advance' },
      });
      assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}`);
      assert.equal(callCount(tmp), 1, 'no --auto-handoff → exactly one auto-dev spawn');
      assert.ok(!/Auto-handoff \d/.test(r.stdout), 'no handoff log without the flag');
      assert.ok(!/ENFORCED a terminate/i.test(r.stdout), 'no enforce without the flag');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
