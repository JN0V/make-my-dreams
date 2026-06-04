// test/integration/serve-context-gauge.test.js — v0.5.c: surface the live
// context monitor in `mmd serve`. Covers AC-1 (/api/status exposes .context),
// AC-2 (the opt-in --monitor arg threading), and AC-4 (back-compat / opt-in
// safety). Per testing.md §V every test name carries an @integration tag.
//
// The spawn never hits real claude/network: tests use the MMD_AUTODEV_CMD seam
// (a bash fixture) and/or the exported pure helper buildMmdAutodevArgs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createServer, buildMmdAutodevArgs } from '../../lib/server.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const FAKE_ARGECHO = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-autodev-argecho.sh');
const STATUS_CTX_PATH = path.join(REPO_ROOT, 'test', 'fixtures', 'status-context.json');
const STATUS_MIN_PATH = path.join(REPO_ROOT, 'test', 'fixtures', 'status-minimal.json');

process.env.MMD_SERVE_ALLOW_RANDOM = '1';

async function bootServer(extraEnv = {}) {
  const tmp = mkdtempSync(path.join(tmpdir(), 'mmd-gauge-'));
  const prevEnv = {};
  for (const [k, v] of Object.entries(extraEnv)) {
    prevEnv[k] = process.env[k];
    process.env[k] = v;
  }
  const server = await createServer({ port: 0, explicitPort: false, cwd: tmp });
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  function restoreEnv() {
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  return { server, baseUrl, port, tmp, restoreEnv };
}

function postDream(baseUrl, body) {
  const port = new URL(baseUrl).port;
  return fetch(baseUrl + '/api/dream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': `http://127.0.0.1:${port}`,
      'Host': `127.0.0.1:${port}`,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** Poll for a file to appear with content, up to timeoutMs. The fixture is
 *  written by a real `node bin/mmd.js` spawn that competes for CPU with the rest
 *  of the (concurrent) suite, so the deadline is generous to avoid a flake. */
async function waitForFile(file, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(file)) {
      const txt = readFileSync(file, 'utf8');
      if (txt.length > 0) return txt;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

function writeStatusFixture(tmp, slug, fixturePath) {
  const sharedDir = path.join(tmp, 'demo', slug, '.mmd', 'shared');
  mkdirSync(sharedDir, { recursive: true });
  writeFileSync(path.join(sharedDir, 'status.json'), readFileSync(fixturePath, 'utf8'));
}

/* ── AC-1: /api/status exposes .context ─────────────────────────────────── */

test('@integration AC-1 /api/status includes context (+ ready_for_handoff folded to boolean)', async (t) => {
  const ctx = await bootServer();
  t.after(async () => {
    await ctx.server.shutdown('test');
    ctx.restoreEnv();
    rmSync(ctx.tmp, { recursive: true, force: true });
  });
  const slug = 'context-app';
  writeStatusFixture(ctx.tmp, slug, STATUS_CTX_PATH);
  const res = await fetch(ctx.baseUrl + `/api/status/${slug}`);
  assert.equal(res.status, 200);
  const json = await res.json();
  // context block present with the monitor fields.
  assert.ok(json.context && typeof json.context === 'object');
  assert.equal(json.context.model, 'claude-opus-4-8[1m]');
  assert.equal(json.context.window, 1000000);
  assert.equal(json.context.tokens, 337000);
  assert.equal(json.context.pct, 0.337);
  assert.equal(json.context.estimated, false);
  // sibling ready_for_handoff object → folded into a boolean on context.
  assert.equal(json.context.ready_for_handoff, true);
  // rest of the status response unchanged (back-compat).
  assert.equal(json.current_phase, 'phase-2-implementation');
  assert.equal(json.progress_percent, 42);
});

test('@integration AC-1 ready_for_handoff false when status has no marker', async (t) => {
  const ctx = await bootServer();
  t.after(async () => {
    await ctx.server.shutdown('test');
    ctx.restoreEnv();
    rmSync(ctx.tmp, { recursive: true, force: true });
  });
  const slug = 'ctx-no-marker';
  const sharedDir = path.join(ctx.tmp, 'demo', slug, '.mmd', 'shared');
  mkdirSync(sharedDir, { recursive: true });
  writeFileSync(path.join(sharedDir, 'status.json'), JSON.stringify({
    slice_id: slug, state: 'in_progress',
    context: { model: 'm', window: 200000, tokens: 50000, pct: 0.25, estimated: true },
  }));
  const res = await fetch(ctx.baseUrl + `/api/status/${slug}`);
  const json = await res.json();
  assert.equal(json.context.ready_for_handoff, false);
  assert.equal(json.context.estimated, true);
});

test('@integration AC-1 status without context → context key omitted (back-compat)', async (t) => {
  const ctx = await bootServer();
  t.after(async () => {
    await ctx.server.shutdown('test');
    ctx.restoreEnv();
    rmSync(ctx.tmp, { recursive: true, force: true });
  });
  const slug = 'no-ctx-app';
  writeStatusFixture(ctx.tmp, slug, STATUS_MIN_PATH);
  const res = await fetch(ctx.baseUrl + `/api/status/${slug}`);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.ok(!('context' in json), 'context must be omitted when absent');
  // existing fields still round-trip.
  assert.equal(json.slice_id, 'tiny-test-app');
  assert.equal(json.state, 'in_progress');
});

test('@integration AC-1 malformed (non-object) context passes through without crash', async (t) => {
  const ctx = await bootServer();
  t.after(async () => {
    await ctx.server.shutdown('test');
    ctx.restoreEnv();
    rmSync(ctx.tmp, { recursive: true, force: true });
  });
  const slug = 'ctx-junk';
  const sharedDir = path.join(ctx.tmp, 'demo', slug, '.mmd', 'shared');
  mkdirSync(sharedDir, { recursive: true });
  writeFileSync(path.join(sharedDir, 'status.json'), JSON.stringify({
    slice_id: slug, state: 'in_progress', context: 'junk',
  }));
  const res = await fetch(ctx.baseUrl + `/api/status/${slug}`);
  assert.equal(res.status, 200);
  const json = await res.json();
  // not folded (not an object) — left as-is; the gauge helper treats it as "no context".
  assert.equal(json.context, 'junk');
});

/* ── AC-2: opt-in --monitor arg threading ───────────────────────────────── */

test('@integration v0.15.a AC-3 buildMmdAutodevArgs is [entry, --fresh, dream] — no monitor flag threaded', () => {
  const entry = '/abs/bin/mmd.js';
  // serve always rebuilds in demo/<slug>/ (the dir it polls/opens), so --fresh is
  // always present. The Conductor is default-on in the child, so NO --monitor is
  // threaded — the launch body needs no flag for the Conductor (SPEC_V015A AC-3).
  assert.deepEqual(buildMmdAutodevArgs(entry, 'my dream'), [entry, '--fresh', 'my dream']);
});

test('@integration v0.15.a AC-3 a legacy payload.monitor is accepted but ignored (no --monitor leaks)', async (t) => {
  const ctx = await bootServer({ MMD_AUTODEV_CMD: FAKE_ARGECHO });
  t.after(async () => {
    await ctx.server.shutdown('test');
    ctx.restoreEnv();
    rmSync(ctx.tmp, { recursive: true, force: true });
  });
  // A client still POSTing the retired `monitor` field must not error nor change
  // the launch — the Conductor is already on by default (back-compat).
  const res = await postDream(ctx.baseUrl, { dream: 'legacy monitor field dream', monitor: true });
  assert.equal(res.status, 202);
  const argv = await waitForFile(path.join(ctx.tmp, 'captured-argv.txt'));
  const lines = (argv || '').split('\n').filter(Boolean);
  assert.ok(!lines.includes('--monitor'), `legacy monitor field must not thread --monitor, got ${JSON.stringify(lines)}`);
});

test('@integration v0.15.a AC-3 serve launch carries NO --monitor / --output-format (Conductor default-on in the child)', async (t) => {
  const ctx = await bootServer({ MMD_AUTODEV_CMD: FAKE_ARGECHO });
  t.after(async () => {
    await ctx.server.shutdown('test');
    ctx.restoreEnv();
    rmSync(ctx.tmp, { recursive: true, force: true });
  });
  const res = await postDream(ctx.baseUrl, { dream: 'plain default dream build' });
  assert.equal(res.status, 202);
  const argv = await waitForFile(path.join(ctx.tmp, 'captured-argv.txt'));
  assert.ok(argv, 'captured-argv.txt should exist');
  const lines = argv.split('\n').filter(Boolean);
  assert.ok(!lines.includes('--monitor'), `expected NO --monitor, got ${JSON.stringify(lines)}`);
  assert.ok(!lines.some((l) => l.includes('--output-format')), 'no --output-format in default args');
});

test('@integration serve disables the build timeout (MMD_TIMEOUT_MS=0) — L-016, a 30-min default would kill a real build', async (t) => {
  const ctx = await bootServer({ MMD_AUTODEV_CMD: FAKE_ARGECHO });
  t.after(async () => {
    await ctx.server.shutdown('test');
    ctx.restoreEnv();
    rmSync(ctx.tmp, { recursive: true, force: true });
  });
  const res = await postDream(ctx.baseUrl, { dream: 'a build that would take longer than 30 min' });
  assert.equal(res.status, 202);
  const timeout = await waitForFile(path.join(ctx.tmp, 'captured-timeout.txt'));
  assert.equal((timeout || '').trim(), '0', 'serve must spawn the build with MMD_TIMEOUT_MS=0 (no 30-min kill)');
});

/* ── AC-4: served gauge asset present + wired ───────────────────────────── */

test('@integration AC-4 /gauge.js is served (the pure render helper asset)', async (t) => {
  const ctx = await bootServer();
  t.after(async () => {
    await ctx.server.shutdown('test');
    ctx.restoreEnv();
    rmSync(ctx.tmp, { recursive: true, force: true });
  });
  const res = await fetch(ctx.baseUrl + '/gauge.js');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /javascript/);
  const body = await res.text();
  assert.match(body, /renderGauge/);
});

test('@integration v0.15.a AC-3 index.html has NO monitor checkbox but keeps #context-gauge; app.js polls /api/status', async (t) => {
  const ctx = await bootServer();
  t.after(async () => {
    await ctx.server.shutdown('test');
    ctx.restoreEnv();
    rmSync(ctx.tmp, { recursive: true, force: true });
  });
  const html = await (await fetch(ctx.baseUrl + '/')).text();
  // The "Monitor context (advanced)" checkbox is RETIRED — the Conductor is
  // automatic, the gauge shows transparently (SPEC_V015A AC-3).
  assert.doesNotMatch(html, /id="monitor-toggle"/, 'monitor checkbox must be gone (transparent Conductor)');
  assert.match(html, /id="context-gauge"/, 'gauge element still present');
  assert.match(html, /gauge\.js/, 'gauge module script referenced');
  const appjs = await (await fetch(ctx.baseUrl + '/app.js')).text();
  assert.match(appjs, /\/api\/status\//, 'app.js polls /api/status');
  assert.match(appjs, /renderGauge|MMDGauge/, 'app.js renders the gauge');
  assert.doesNotMatch(appjs, /monitor-toggle/, 'app.js no longer references the retired checkbox');
});
