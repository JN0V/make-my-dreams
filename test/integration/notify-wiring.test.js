// @integration tests for v0.5.a Conductor notification wiring (SPEC_V05A AC-3).
//
// Strategy: run the REAL bin/mmd.js as a subprocess (as the other CLI tests do)
// with MMD_NOTIFY_URL pointed at a LOOPBACK http server this test spins up — the
// "captured fake sender". No real (public) network is ever hit. The server
// records each POST so we can assert which lifecycle event fired and that the
// payload carries run metadata only.
//
// CRITICAL (recursion-guard): every run sets MMD_AUTODEV_CMD to a fixture and
// MMD_REALITY_CHECK_BACKEND=skip so the real claude CLI is never invoked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import path from 'node:path';

import { buildSubprocessEnv } from '../../lib/invoke-autodev.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');
const FIXTURE_OK = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-autodev.sh');
const FIXTURE_FAIL = path.join(REPO_ROOT, 'test', 'fixtures', 'failing-autodev.sh');
const FIXTURE_HERE = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-autodev-here.sh');

const SKIP_ON_WINDOWS = platform() === 'win32';

function makeTmp(prefix = 'mmd-notify-') {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

/**
 * Start a loopback http server that records every received POST (method, path,
 * parsed JSON body). Resolves to { url, requests, close }.
 */
function startCaptureServer() {
  const requests = [];
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => {
        raw += c;
      });
      req.on('end', () => {
        let body = null;
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
        requests.push({ method: req.method, url: req.url, body });
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

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

function initCleanRepo(dir) {
  mkdirSync(dir, { recursive: true });
  git(['init', '-q', '-b', 'main'], dir);
  writeFileSync(path.join(dir, 'README.md'), '# tmp repo\n');
  git(['add', 'README.md'], dir);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'init', '-q'], dir);
  return dir;
}

// Async spawn (NOT spawnSync): the loopback capture server lives in this same
// process, so the run MUST NOT block the event loop — otherwise the server can
// never accept mmd's POST and it would hang to its timeout.
function runMmd(args, opts = {}) {
  const env = {
    ...buildSubprocessEnv(process.env),
    MMD_AUTODEV_CMD: opts.autodevCmd ?? FIXTURE_OK,
    MMD_REALITY_CHECK_BACKEND: 'skip',
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
    ...(opts.env || {}),
  };
  return new Promise((resolve, reject) => {
    const child = spawn('node', [MMD, ...args], { cwd: opts.cwd, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const killer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('mmd run timed out')); }, 30000);
    child.on('close', (status) => { clearTimeout(killer); resolve({ status, stdout, stderr }); });
    child.on('error', (err) => { clearTimeout(killer); reject(err); });
  });
}

// AC-3 — greenfield done fires run_done.
test('@integration AC-3: greenfield done POSTs a run_done notification', { skip: SKIP_ON_WINDOWS }, async () => {
  const srv = await startCaptureServer();
  const tmp = makeTmp();
  try {
    const r = await runMmd(['a tiny test app that shows hello world'], {
      cwd: tmp,
      env: { MMD_NOTIFY_URL: srv.url },
    });
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}`);
    assert.equal(srv.requests.length, 1, 'exactly one notification fired');
    const req = srv.requests[0];
    assert.equal(req.method, 'POST');
    assert.equal(req.body.event, 'run_done');
    assert.equal(req.body.state, 'done');
    assert.match(req.body.message, /✅/);
    // metadata only — the body must not leak env/secrets.
    assert.deepEqual(
      Object.keys(req.body).sort(),
      ['event', 'message', 'slice', 'state', 'summary', 'ts'].sort(),
    );
  } finally {
    await srv.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});

// AC-3 — greenfield failure fires run_failed; the run's failing exit is unchanged.
test('@integration AC-3: greenfield failure POSTs run_failed and keeps the failing exit', { skip: SKIP_ON_WINDOWS }, async () => {
  const srv = await startCaptureServer();
  const tmp = makeTmp();
  try {
    const r = await runMmd(['a tiny test app that shows hello world'], {
      cwd: tmp,
      autodevCmd: FIXTURE_FAIL,
      env: { MMD_NOTIFY_URL: srv.url },
    });
    assert.notEqual(r.status, 0, 'the run still fails');
    assert.equal(srv.requests.length, 1);
    assert.equal(srv.requests[0].body.event, 'run_failed');
    assert.equal(srv.requests[0].body.state, 'failed');
    assert.match(srv.requests[0].body.message, /❌/);
  } finally {
    await srv.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});

// AC-3 — --here done fires run_done.
test('@integration AC-3: --here done POSTs a run_done notification', { skip: SKIP_ON_WINDOWS }, async () => {
  const srv = await startCaptureServer();
  const tmp = makeTmp();
  try {
    initCleanRepo(tmp);
    const r = await runMmd(['--here', 'add a comment line at the top of README.md'], {
      cwd: tmp,
      autodevCmd: FIXTURE_HERE,
      env: { MMD_NOTIFY_URL: srv.url },
    });
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}`);
    assert.equal(srv.requests.length, 1);
    assert.equal(srv.requests[0].body.event, 'run_done');
    assert.match(srv.requests[0].body.slice, /^slice\/here-/);
  } finally {
    await srv.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});

// AC-3 — --here failure fires run_failed; the run's failing exit is unchanged.
test('@integration AC-3: --here failure POSTs run_failed and keeps the failing exit', { skip: SKIP_ON_WINDOWS }, async () => {
  const srv = await startCaptureServer();
  const tmp = makeTmp();
  try {
    initCleanRepo(tmp);
    const r = await runMmd(['--here', 'add a comment line at the top of README.md'], {
      cwd: tmp,
      autodevCmd: FIXTURE_FAIL,
      env: { MMD_NOTIFY_URL: srv.url },
    });
    assert.notEqual(r.status, 0, 'the run still fails');
    assert.equal(srv.requests.length, 1);
    assert.equal(srv.requests[0].body.event, 'run_failed');
    assert.equal(srv.requests[0].body.state, 'failed');
    assert.match(srv.requests[0].body.slice, /^slice\/here-/);
  } finally {
    await srv.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});

// AC-3 — unset MMD_NOTIFY_URL → NO notification code runs (no request received).
test('@integration AC-3: with MMD_NOTIFY_URL unset, no notification is sent', { skip: SKIP_ON_WINDOWS }, async () => {
  const srv = await startCaptureServer();
  const tmp = makeTmp();
  try {
    const r = await runMmd(['a tiny test app that shows hello world'], { cwd: tmp });
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}`);
    assert.equal(srv.requests.length, 0, 'no notification when opt-in var is unset');
  } finally {
    await srv.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});

// AC-3 — a failing sink (connection refused) never breaks the run.
test('@integration AC-3: a dead notify URL never breaks the run (best-effort)', { skip: SKIP_ON_WINDOWS }, async () => {
  // Bind+immediately-close a server to obtain a port nothing listens on, so the
  // POST is refused (the sender "throws"); the run must still succeed.
  const srv = await startCaptureServer();
  const deadUrl = srv.url;
  await srv.close();
  const tmp = makeTmp();
  try {
    const r = await runMmd(['a tiny test app that shows hello world'], {
      cwd: tmp,
      env: { MMD_NOTIFY_URL: deadUrl },
    });
    assert.equal(r.status, 0, `the run still succeeds despite a dead sink; stderr=${r.stderr}`);
    // The best-effort failure is logged on stderr, not fatal.
    assert.match(r.stderr, /notify: run_done not delivered/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
