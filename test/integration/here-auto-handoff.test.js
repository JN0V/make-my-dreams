// @integration tests for the v0.13.a cooperative auto-handoff loop on the
// `mmdream --here --auto-handoff` surface (SPEC_V013A AC-2 + AC-4, ADR-051).
//
// Strategy mirrors here-mode.test.js / monitor-run.test.js: run the REAL
// bin/mmd.js as a subprocess with MMD_AUTODEV_CMD pointed at a fake auto-dev, so
// no real claude / network is hit. Two fakes:
//   - fake-autodev-handoff.sh — a deterministic stand-in that writes the
//     checkpoint + handoff-request marker itself (it collapses "monitor wrote
//     marker + auto-dev saw it + stopped" into one shot) so the LOOP logic is
//     testable without a real stream-json crossing. Drives AC-4.
//   - fake-claude-streamjson.js — emits canned stream-json crossing 70%, so
//     MMD's OWN monitor writes the marker. Proves AC-2 (monitor writes a marker
//     at threshold) end-to-end + that the loop acts on it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import {
  mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync,
} from 'node:fs';
import { tmpdir, platform } from 'node:os';
import path from 'node:path';

import { buildSubprocessEnv } from '../../lib/invoke-autodev.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');
const FAKE_HANDOFF = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-autodev-handoff.sh');
const FAKE_STREAM = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-claude-streamjson.js');
const FAKE_PLAIN = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-autodev-here.sh');
const SKIP_ON_WINDOWS = platform() === 'win32';

// NB: the prefix deliberately avoids the substring "handoff" — MMD prints the
// repo path in its "Mode: --here" line, so a "handoff" in the tmp dir name would
// make the negative "no handoff log" assertions match the PATH, not a log line.
function makeTmp() {
  return mkdtempSync(path.join(tmpdir(), 'mmd-coop-ho-'));
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

function startCaptureServer() {
  const requests = [];
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        let body = null;
        try { body = JSON.parse(raw); } catch { body = raw; }
        requests.push({ method: req.method, body });
        res.writeHead(204);
        res.end();
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}/mmd-runs`,
        requests,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

function runMmd(args, opts = {}) {
  const env = {
    ...buildSubprocessEnv(process.env),
    MMD_AUTODEV_CMD: opts.autodevCmd ?? FAKE_HANDOFF,
    MMD_REALITY_CHECK_BACKEND: 'skip',
    MMD_SKIP_SETUP: '1',
    MMD_SKIP_ALIGN: '1', // isolate the handoff loop; the gate is tested separately
    MMD_QUIET: '1',
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
    ...(opts.env || {}),
  };
  return spawnSync('node', [MMD, ...args], { cwd: opts.cwd, env, encoding: 'utf8', timeout: 60000 });
}

// Async spawn (NOT spawnSync) for the test that captures notifications: the
// loopback capture server lives in THIS process, so a blocking spawnSync would
// stop its event loop and the subprocess's POST would time out (mirrors
// notify-wiring.test.js). Same env shape as runMmd.
function runMmdAsync(args, opts = {}) {
  const env = {
    ...buildSubprocessEnv(process.env),
    MMD_AUTODEV_CMD: opts.autodevCmd ?? FAKE_HANDOFF,
    MMD_REALITY_CHECK_BACKEND: 'skip',
    MMD_SKIP_SETUP: '1',
    MMD_SKIP_ALIGN: '1',
    MMD_QUIET: '1',
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
    ...(opts.env || {}),
  };
  return new Promise((resolve, reject) => {
    const child = spawn('node', [MMD, ...args], { cwd: opts.cwd, env });
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

// ── AC-4: cooperative stop → relaunch resume → finish on completion ─────────

test('@integration AC-4: --here --auto-handoff hands off then resumes a fresh successor that completes', { skip: SKIP_ON_WINDOWS }, async () => {
  const tmp = makeTmp();
  const capture = await startCaptureServer();
  try {
    initCleanRepo(tmp);
    const r = await runMmdAsync(['--here', '--auto-handoff', 'add a cooperative handoff widget'], {
      cwd: tmp,
      env: { MMD_FAKE_HANDOFF_MODE: 'complete-on-2', MMD_FAKE_COMPLETE_AT: '2', MMD_NOTIFY_URL: capture.url },
    });
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}\nstdout=${r.stdout}`);
    // Exactly two spawns: the initial cooperative stop + one resumed successor.
    assert.equal(callCount(tmp), 2, 'one handoff → exactly 2 auto-dev spawns');
    assert.ok(existsSync(path.join(tmp, '.mmd', 'local', 'runs', 'autodev-call-2')), 'a successor was relaunched');
    assert.ok(!existsSync(path.join(tmp, '.mmd', 'local', 'runs', 'autodev-call-3')), 'no extra spawn after completion');
    // The handoff was announced + the run resumed in resume mode.
    assert.match(r.stdout, /Auto-handoff 1\/\d+/i, 'announces handoff 1/N');
    assert.match(r.stdout, /resume mode/i, 'relaunches in resume mode');
    // The successor ran on the slice branch (never main).
    const branch = readFileSync(path.join(tmp, '.mmd', 'local', 'runs', 'handoff-branch-2.txt'), 'utf8').trim();
    assert.match(branch, /^slice\//, 'successor ran on the slice branch');
    // The marker is cleared at the end (no stale stop signal survives).
    assert.ok(!existsSync(path.join(tmp, '.mmd', 'local', 'handoff-request')), 'request marker cleared after the run');
    // A `handoff` notification fired (reusing the v0.5.a fan-out).
    const handoffNotifs = capture.requests.filter((q) => q.body && q.body.event === 'handoff');
    assert.equal(handoffNotifs.length, 1, 'exactly one handoff notification fired');
    // The run completes done.
    assert.match(r.stdout, /Changes applied on slice\//);
  } finally {
    await capture.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── AC-4: the cap → one final un-handoffed successor + honest cap log ───────

test('@integration AC-4: at MMD_MAX_HANDOFFS the loop launches one final un-handoffed successor', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    initCleanRepo(tmp);
    const r = runMmd(['--here', '--auto-handoff', 'never-completing change'], {
      cwd: tmp,
      env: { MMD_FAKE_HANDOFF_MODE: 'always-stop', MMD_MAX_HANDOFFS: '2' },
    });
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}\nstdout=${r.stdout}`);
    // 2 handoffs (calls 1→2, 2→3) then the cap launches 1 final successor (call 4).
    assert.equal(callCount(tmp), 4, 'initial + 2 handoffs + 1 final successor = 4 spawns');
    assert.ok(!existsSync(path.join(tmp, '.mmd', 'local', 'runs', 'autodev-call-5')), 'no spawn past the final successor');
    assert.match(r.stdout, /Auto-handoff 1\/2/);
    assert.match(r.stdout, /Auto-handoff 2\/2/);
    assert.match(r.stdout, /cap reached \(2\)/i, 'honest cap log');
    assert.match(r.stdout, /FINAL successor with handoff DISABLED/i);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── AC-4: WITHOUT --auto-handoff a marker is ignored; exactly one spawn ─────

test('@integration AC-4: without --auto-handoff the single-spawn flow is unchanged (a marker is never acted on)', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    initCleanRepo(tmp);
    // The fake would request a handoff every call, but without --auto-handoff
    // MMD never reads/acts on the marker → exactly one spawn.
    const r = runMmd(['--here', 'a plain change'], {
      cwd: tmp,
      env: { MMD_FAKE_HANDOFF_MODE: 'always-stop' },
    });
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}`);
    assert.equal(callCount(tmp), 1, 'no --auto-handoff → exactly one auto-dev spawn');
    assert.ok(!/Auto-handoff \d/.test(r.stdout), 'no handoff log line without the flag');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── AC-2 + AC-4 end-to-end: the MONITOR writes the marker at 70% ────────────
// Uses the stream-json fake (no checkpoint/marker of its own). The ONLY thing
// that can produce a handoff-request marker here is MMD's own monitor crossing
// 70% — so a handoff happening proves AC-2 (monitor writes the marker) + the
// loop acting on it. MMD_MAX_HANDOFFS=1 bounds it to a quick terminate.

test('@integration AC-2: --auto-handoff makes the monitor write the marker at 70% and the loop relaunches', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    initCleanRepo(tmp);
    const r = runMmd(['--here', '--auto-handoff', 'long context-filling change'], {
      cwd: tmp,
      autodevCmd: FAKE_STREAM,
      env: { MMD_MAX_HANDOFFS: '1' },
    });
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}\nstdout=${r.stdout}`);
    // The monitor crossed 70% → READY_FOR_HANDOFF + a cooperative handoff request.
    assert.match(r.stdout, /READY_FOR_HANDOFF/);
    assert.match(r.stdout, /Requesting a cooperative handoff/i, 'monitor logs it is requesting a handoff');
    // The loop acted: a handoff then the cap (max 1) → final successor.
    assert.match(r.stdout, /Auto-handoff 1\/1/);
    assert.match(r.stdout, /cap reached \(1\)/i);
    // Terminates cleanly with no stale marker.
    assert.ok(!existsSync(path.join(tmp, '.mmd', 'local', 'handoff-request')), 'marker cleared at the end');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── AC-4 default-unchanged: plain --monitor never writes a marker ───────────

test('@integration AC-4: plain --monitor (no --auto-handoff) writes NO request marker', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    initCleanRepo(tmp);
    const r = runMmd(['--here', '--monitor', 'monitored but not handed off'], {
      cwd: tmp,
      autodevCmd: FAKE_STREAM,
    });
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}`);
    // The monitor still crosses 70% (READY_FOR_HANDOFF) but writes NO marker and
    // the run is a single spawn (it says so: "no auto-handoff yet").
    assert.match(r.stdout, /READY_FOR_HANDOFF/);
    assert.match(r.stdout, /no auto-handoff yet/i);
    assert.ok(!existsSync(path.join(tmp, '.mmd', 'local', 'handoff-request')), 'plain --monitor writes no marker');
    assert.ok(!/Auto-handoff \d/.test(r.stdout), 'no handoff loop without the flag');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
