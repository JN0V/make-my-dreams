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

// ── v0.15.a AC-1: MMD_NO_AUTO_HANDOFF=1 restores the single-spawn flow ───────
// Pre-v0.15 this property held "without --auto-handoff"; the transparent
// Conductor (SPEC_V015A) makes the handoff loop default-on, so the OFF state is
// now the explicit opt-out. With it, even a fake that requests a handoff every
// call is never acted on → exactly one spawn (today's EXACT behavior).

test('@integration v0.15.a AC-1: MMD_NO_AUTO_HANDOFF=1 → single-spawn flow, a marker is never acted on', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    initCleanRepo(tmp);
    const r = runMmd(['--here', 'a plain change'], {
      cwd: tmp,
      env: { MMD_FAKE_HANDOFF_MODE: 'always-stop', MMD_NO_AUTO_HANDOFF: '1' },
    });
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}`);
    assert.equal(callCount(tmp), 1, 'opt-out → exactly one auto-dev spawn');
    assert.ok(!/Auto-handoff \d/.test(r.stdout), 'no handoff log line under the opt-out');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── AC-2 + v0.13.1 regression: monitor writes the marker at 70%, but a run that
// reached NO phase boundary (no resumable checkpoint) must NOT false-handoff ──
// Uses the stream-json fake (crosses 70% but writes NO checkpoint of its own).
// This is exactly the scenario a live `--auto-handoff` run surfaced: the monitor
// correctly writes the marker (AC-2), but the orchestrator completed without ever
// reaching a phase boundary — so there is nothing to resume TO. The v0.13.1 fix
// makes `decideHandoff` FINISH here (a handoff would relaunch wasteful no-op
// successors). So we assert: the marker WAS requested (AC-2) AND the loop did NOT
// hand off (exactly one spawn, no `Auto-handoff` line) — the regression guard.

test('@integration AC-2 + v0.13.1: monitor writes the 70% marker, but NO checkpoint → no false handoff (exactly one spawn)', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    initCleanRepo(tmp);
    const r = runMmd(['--here', '--auto-handoff', 'long context-filling change'], {
      cwd: tmp,
      autodevCmd: FAKE_STREAM,
      env: { MMD_MAX_HANDOFFS: '1' },
    });
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}\nstdout=${r.stdout}`);
    // AC-2: the monitor crossed 70% → READY_FOR_HANDOFF + requested a cooperative handoff.
    assert.match(r.stdout, /READY_FOR_HANDOFF/);
    assert.match(r.stdout, /Requesting a cooperative handoff/i, 'monitor logs it is requesting a handoff');
    // v0.13.1: with NO resumable checkpoint (no phase boundary reached), the loop
    // must NOT hand off — a handoff would relaunch a wasteful no-op successor. The
    // absence of any `Auto-handoff` line proves the loop did not relaunch (the
    // stream fake doesn't write the autodev-calls counter, so callCount is N/A here).
    assert.ok(!/Auto-handoff \d/.test(r.stdout), 'no false handoff without a resumable checkpoint (v0.13.1)');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── v0.15.a AC-1: the opt-out runs no monitor + writes no marker ─────────────

test('@integration v0.15.a AC-1: MMD_NO_AUTO_HANDOFF=1 → no monitor, NO request marker', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    initCleanRepo(tmp);
    const r = runMmd(['--here', 'monitored but opted out'], {
      cwd: tmp,
      autodevCmd: FAKE_STREAM,
      env: { MMD_NO_AUTO_HANDOFF: '1' },
    });
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}`);
    // The opt-out uses the historical TEXT spawn → no monitor at all, so no
    // READY_FOR_HANDOFF line and no handoff-request marker (today's EXACT path).
    assert.doesNotMatch(r.stdout, /READY_FOR_HANDOFF/);
    assert.ok(!existsSync(path.join(tmp, '.mmd', 'local', 'handoff-request')), 'opt-out writes no marker');
    assert.ok(!/Auto-handoff \d/.test(r.stdout), 'no handoff loop under the opt-out');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── v0.15.a AC-2: the legacy --monitor / --auto-handoff flags are INERT ──────
// They parse without error (no "unknown flag") and change nothing — the
// Conductor is already default-on, so a run passing the legacy flag still
// monitors + requests a cooperative handoff at 70%, exactly as the no-flag run.

test('@integration v0.15.a AC-2: legacy --monitor is accepted but inert (default-on Conductor still active)', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    initCleanRepo(tmp);
    const r = runMmd(['--here', '--monitor', 'a change with the legacy monitor flag'], {
      cwd: tmp,
      autodevCmd: FAKE_STREAM,
      env: { MMD_MAX_HANDOFFS: '1' },
    });
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}\nstdout=${r.stdout}`);
    // Default-on: the monitor crossed 70% and requested a cooperative handoff —
    // the legacy flag neither errored nor changed the default behavior.
    assert.match(r.stdout, /READY_FOR_HANDOFF/);
    assert.match(r.stdout, /Requesting a cooperative handoff/i, 'default-on Conductor active despite the inert flag');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
