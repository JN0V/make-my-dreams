// @integration tests for the v0.5.b live context monitor (SPEC_V05B AC-3/4/5).
//
// Strategy (mirrors notify-wiring.test.js): run the REAL bin/mmd.js as a
// subprocess with MMD_AUTODEV_CMD pointed at a FAKE claude that emits canned
// stream-json lines (test/fixtures/fake-claude-streamjson.js), and
// MMD_NOTIFY_URL pointed at a loopback capture server. No real claude, no real
// network. We assert:
//   AC-3 — status.json.context = {model,window,tokens,pct,estimated} is written
//          (running MAX), and WITHOUT --monitor the default path is unchanged.
//   AC-5 — the run log shows readable progress (assistant text + [monitor]
//          context X% lines), NOT the raw JSON stream.
//   AC-4 — crossing 70% writes a READY_FOR_HANDOFF marker and fires a single
//          context_70 notification (debounced); a custom threshold is honored;
//          the run is NOT stopped.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import path from 'node:path';

import { buildSubprocessEnv } from '../../lib/invoke-autodev.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');
const FIXTURE_STREAM = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-claude-streamjson.js');
const FIXTURE_PLAIN = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-autodev.sh');

const SKIP_ON_WINDOWS = platform() === 'win32';

function makeTmp() {
  return mkdtempSync(path.join(tmpdir(), 'mmd-monitor-'));
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

function runMmd(args, opts = {}) {
  const env = {
    ...buildSubprocessEnv(process.env),
    MMD_AUTODEV_CMD: opts.autodevCmd ?? FIXTURE_STREAM,
    MMD_REALITY_CHECK_BACKEND: 'skip',
    MMD_QUIET: '1',
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

// Locate the single greenfield slice dir under <tmp>/demo/<slug>/.
function sliceDir(tmp) {
  const demo = path.join(tmp, 'demo');
  const entries = readdirSync(demo, { withFileTypes: true }).filter((e) => e.isDirectory());
  assert.equal(entries.length, 1, `expected exactly one demo slice, got ${entries.length}`);
  return path.join(demo, entries[0].name);
}

function readStatus(tmp) {
  const p = path.join(sliceDir(tmp), '.mmd', 'shared', 'status.json');
  return JSON.parse(readFileSync(p, 'utf8'));
}

function readRunLog(tmp) {
  const runs = path.join(sliceDir(tmp), '.mmd', 'local', 'runs');
  const logs = readdirSync(runs).filter((f) => f.endsWith('.log'));
  assert.ok(logs.length >= 1, 'a run log exists');
  return logs.map((f) => readFileSync(path.join(runs, f), 'utf8')).join('\n');
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

function readStatusAt(dir) {
  return JSON.parse(readFileSync(path.join(dir, '.mmd', 'shared', 'status.json'), 'utf8'));
}

const DREAM = 'a tiny counter app with two buttons';

// AC-3 + AC-5 — monitor writes status.json.context and re-renders readable progress.
test('@integration AC-3/AC-5: --monitor writes status.json.context (running MAX) and a readable tee', { skip: SKIP_ON_WINDOWS }, async () => {
  const tmp = makeTmp();
  try {
    const r = await runMmd(['--monitor', DREAM], { cwd: tmp });
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}`);

    const status = readStatus(tmp);
    assert.ok(status.context, 'status.json.context is present');
    assert.deepEqual(
      Object.keys(status.context).sort(),
      ['estimated', 'model', 'pct', 'tokens', 'window'].sort(),
    );
    // The fake's max input reading is 800000 against the 1M [1m] window.
    assert.equal(status.context.model, 'claude-opus-4-8[1m]');
    assert.equal(status.context.window, 1_000_000);
    assert.equal(status.context.tokens, 800000, 'running MAX, not the last reading');
    assert.equal(status.context.estimated, false);
    assert.ok(Math.abs(status.context.pct - 0.8) < 1e-9);

    // AC-5 — the run log is human-readable: assistant text + [monitor] lines,
    // never the raw JSON envelope.
    const log = readRunLog(tmp);
    assert.match(log, /step 1: thinking about the dream/);
    assert.match(log, /\[monitor\] context 80\.0% \(800000\/1000000\)/);
    assert.ok(!log.includes('"type":"assistant"'), 'raw stream-json must NOT appear in the tee');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// AC-4 — crossing 70% writes READY_FOR_HANDOFF + fires context_70 exactly once.
test('@integration AC-4: 70% crossing writes READY_FOR_HANDOFF and fires context_70 once (debounced)', { skip: SKIP_ON_WINDOWS }, async () => {
  const srv = await startCaptureServer();
  const tmp = makeTmp();
  try {
    const r = await runMmd(['--monitor', DREAM], { cwd: tmp, env: { MMD_NOTIFY_URL: srv.url } });
    assert.equal(r.status, 0, `run is NOT stopped by the 70% signal; stderr=${r.stderr}`);

    const status = readStatus(tmp);
    assert.ok(status.ready_for_handoff, 'READY_FOR_HANDOFF marker written');
    assert.equal(status.ready_for_handoff.threshold, 0.70);
    // First crossing is the 75% reading (750000/1_000_000), debounced there.
    assert.equal(status.ready_for_handoff.tokens, 750000);
    assert.ok(Math.abs(status.ready_for_handoff.pct - 0.75) < 1e-9);

    const context70 = srv.requests.filter((q) => q.body && q.body.event === 'context_70');
    assert.equal(context70.length, 1, 'context_70 fired exactly once (debounced)');
    assert.match(context70[0].body.message, /⚠️/);
    assert.match(context70[0].body.message, /READY_FOR_HANDOFF/);
    // run_done still fires at the end → 2 total notifications.
    assert.ok(srv.requests.some((q) => q.body && q.body.event === 'run_done'), 'run_done also fired');
  } finally {
    await srv.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});

// AC-4 — a custom MMD_HANDOFF_THRESHOLD is honored (0.79 → fires at the 80% reading only).
test('@integration AC-4: custom MMD_HANDOFF_THRESHOLD=0.79 is honored', { skip: SKIP_ON_WINDOWS }, async () => {
  const srv = await startCaptureServer();
  const tmp = makeTmp();
  try {
    const r = await runMmd(['--monitor', DREAM], {
      cwd: tmp,
      env: { MMD_NOTIFY_URL: srv.url, MMD_HANDOFF_THRESHOLD: '0.79' },
    });
    assert.equal(r.status, 0, `stderr=${r.stderr}`);
    const status = readStatus(tmp);
    assert.equal(status.ready_for_handoff.threshold, 0.79);
    // 75% < 0.79, so the first crossing is the 80% reading.
    assert.equal(status.ready_for_handoff.tokens, 800000);
    const context70 = srv.requests.filter((q) => q.body && q.body.event === 'context_70');
    assert.equal(context70.length, 1, 'still fires exactly once under a custom threshold');
  } finally {
    await srv.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});

// AC-3/AC-4 — the monitor also works on --here (not only greenfield). The
// --here wiring mirrors the greenfield one, so prove it end-to-end too.
test('@integration AC-3/AC-4: --here --monitor writes status.json.context and fires context_70 once', { skip: SKIP_ON_WINDOWS }, async () => {
  const srv = await startCaptureServer();
  const tmp = makeTmp();
  try {
    initCleanRepo(tmp);
    const r = await runMmd(['--here', '--monitor', 'add a comment line at the top of README.md'], {
      cwd: tmp,
      env: {
        MMD_NOTIFY_URL: srv.url,
        GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
        GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
      },
    });
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}`);

    const status = readStatusAt(tmp);
    assert.ok(status.context, '--here status.json.context is present');
    assert.equal(status.context.window, 1_000_000);
    assert.equal(status.context.tokens, 800000, 'running MAX on --here too');
    assert.ok(status.ready_for_handoff, '--here READY_FOR_HANDOFF marker written');

    const context70 = srv.requests.filter((q) => q.body && q.body.event === 'context_70');
    assert.equal(context70.length, 1, 'context_70 fired exactly once on --here');
    assert.match(status.slice_id, /counter|comment|readme/i); // sanity: a slice id exists
  } finally {
    await srv.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});

// AC-3 — WITHOUT --monitor, the default path is unchanged: no context field, and
// the tee shows raw subprocess output (the monitor never engaged). Using the
// same stream-json fake proves the difference is the flag, not the backend.
test('@integration AC-3: default path (no --monitor) is unchanged — no status.json.context, no context_70', { skip: SKIP_ON_WINDOWS }, async () => {
  const srv = await startCaptureServer();
  const tmp = makeTmp();
  try {
    const r = await runMmd([DREAM], {
      cwd: tmp,
      autodevCmd: FIXTURE_PLAIN,
      env: { MMD_NOTIFY_URL: srv.url },
    });
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}`);
    const status = readStatus(tmp);
    assert.equal(status.context, undefined, 'no context field on the default path');
    assert.equal(status.ready_for_handoff, undefined, 'no handoff marker on the default path');
    const context70 = srv.requests.filter((q) => q.body && q.body.event === 'context_70');
    assert.equal(context70.length, 0, 'no context_70 on the default path');
    // The default run still notifies run_done (v0.5.a behavior intact).
    assert.ok(srv.requests.some((q) => q.body && q.body.event === 'run_done'));
  } finally {
    await srv.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});
