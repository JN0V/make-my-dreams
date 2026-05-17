// test/integration/server.test.js — in-process integration tests for lib/server.js.
// Constitution: testing.md §V — every test name carries an @integration tag.
//
// Strategy: boot a server with port:0 (ephemeral) inside each test, exercise
// HTTP routes via fetch/http, then `server.shutdown('test')` in t.after.
// Uses MMD_SERVE_ALLOW_RANDOM=1 to allow port 0 (the parser would otherwise reject).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';

import { createServer } from '../../lib/server.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const FAKE_STREAMING = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-autodev-streaming.sh');
const STATUS_MIN_PATH = path.join(REPO_ROOT, 'test', 'fixtures', 'status-minimal.json');
const STATUS_ENR_PATH = path.join(REPO_ROOT, 'test', 'fixtures', 'status-enriched.json');

process.env.MMD_SERVE_ALLOW_RANDOM = '1';

/**
 * Boot a fresh server with an isolated cwd. Returns { server, baseUrl, port, tmp }.
 * Caller MUST `await server.shutdown(...)` and `rmSync(tmp,…)` in t.after.
 */
async function bootServer(extraEnv = {}) {
  const tmp = mkdtempSync(path.join(tmpdir(), 'mmd-srv-'));
  const prevEnv = {};
  for (const [k, v] of Object.entries(extraEnv)) {
    prevEnv[k] = process.env[k];
    process.env[k] = v;
  }
  const server = await createServer({ port: 0, explicitPort: false, cwd: tmp });
  const addr = server.address();
  const port = addr.port;
  const baseUrl = `http://127.0.0.1:${port}`;
  function restoreEnv() {
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  return { server, baseUrl, port, tmp, restoreEnv };
}

/** Open an SSE stream via plain node:http and collect events until terminal or timeout. */
function collectSse(url, opts = {}) {
  const { timeoutMs = 5000 } = opts;
  return new Promise((resolve, reject) => {
    const events = [];
    let buffer = '';
    let resolved = false;
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname, port: u.port, path: u.pathname,
        method: 'GET',
        headers: { Accept: 'text/event-stream' },
      },
      (res) => {
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          buffer += chunk;
          let idx;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            for (const line of block.split('\n')) {
              if (line.startsWith('data: ')) {
                try {
                  const payload = JSON.parse(line.slice('data: '.length));
                  events.push(payload);
                  if (
                    payload.type === 'done' ||
                    payload.type === 'error' ||
                    payload.type === 'server_shutdown'
                  ) {
                    if (!resolved) {
                      resolved = true;
                      req.destroy();
                      resolve(events);
                    }
                  }
                } catch { /* ignore non-JSON data lines */ }
              }
            }
          }
        });
        res.on('end', () => { if (!resolved) { resolved = true; resolve(events); } });
        res.on('error', (err) => { if (!resolved) { resolved = true; reject(err); } });
      },
    );
    req.on('error', (err) => { if (!resolved) { resolved = true; reject(err); } });
    req.setTimeout(timeoutMs, () => {
      if (!resolved) {
        resolved = true;
        req.destroy();
        resolve(events);
      }
    });
    req.end();
  });
}

/* ───────────────────────── tests ───────────────────────── */

test('@integration GET / serves index.html with text/html', async (t) => {
  const ctx = await bootServer();
  t.after(async () => {
    await ctx.server.shutdown('test');
    ctx.restoreEnv();
    rmSync(ctx.tmp, { recursive: true, force: true });
  });
  const res = await fetch(ctx.baseUrl + '/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /^text\/html/);
  const body = await res.text();
  assert.match(body, /<title>Make My Dreams<\/title>/);
});

test('@integration GET /api/health returns {ok:true, version}', async (t) => {
  const ctx = await bootServer();
  t.after(async () => {
    await ctx.server.shutdown('test');
    ctx.restoreEnv();
    rmSync(ctx.tmp, { recursive: true, force: true });
  });
  const res = await fetch(ctx.baseUrl + '/api/health');
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.equal(typeof json.version, 'string');
});

test('@integration GET /favicon.svg returns inline SVG', async (t) => {
  const ctx = await bootServer();
  t.after(async () => {
    await ctx.server.shutdown('test');
    ctx.restoreEnv();
    rmSync(ctx.tmp, { recursive: true, force: true });
  });
  const res = await fetch(ctx.baseUrl + '/favicon.svg');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/svg+xml');
});

test('@integration security headers present on / response (AC-9)', async (t) => {
  const ctx = await bootServer();
  t.after(async () => {
    await ctx.server.shutdown('test');
    ctx.restoreEnv();
    rmSync(ctx.tmp, { recursive: true, force: true });
  });
  const res = await fetch(ctx.baseUrl + '/');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  const csp = res.headers.get('content-security-policy') || '';
  assert.match(csp, /^default-src 'self'/, `expected strict CSP, got: ${csp}`);
});

test('@integration server.address() binds 127.0.0.1 IPv4 (AC-8)', async (t) => {
  const ctx = await bootServer();
  t.after(async () => {
    await ctx.server.shutdown('test');
    ctx.restoreEnv();
    rmSync(ctx.tmp, { recursive: true, force: true });
  });
  const addr = ctx.server.address();
  assert.equal(addr.address, '127.0.0.1');
  assert.equal(addr.family, 'IPv4');
});

/* ── POST /api/dream validation ─────────────────────────────────────────── */

async function postDream(baseUrl, body, headerOverrides = {}) {
  const port = new URL(baseUrl).port;
  const defaultHeaders = {
    'Content-Type': 'application/json',
    'Origin': `http://127.0.0.1:${port}`,
    'Host': `127.0.0.1:${port}`,
  };
  // fetch always sets Host; we override via lower-level http if needed for the wrong-host test.
  const headers = { ...defaultHeaders, ...headerOverrides };
  return fetch(baseUrl + '/api/dream', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

test('@integration POST /api/dream missing Origin → 403 forbidden_origin', async (t) => {
  const ctx = await bootServer();
  t.after(async () => {
    await ctx.server.shutdown('test');
    ctx.restoreEnv();
    rmSync(ctx.tmp, { recursive: true, force: true });
  });
  // Use plain http to avoid fetch auto-adding an Origin header.
  const port = ctx.port;
  const body = JSON.stringify({ dream: 'x' });
  const res = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port, path: '/api/dream', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (r) => {
      let buf = '';
      r.setEncoding('utf8');
      r.on('data', (c) => { buf += c; });
      r.on('end', () => resolve({ status: r.statusCode, body: buf }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
  assert.equal(res.status, 403);
  assert.match(res.body, /forbidden_origin/);
});

test('@integration POST /api/dream wrong Origin → 403 forbidden_origin', async (t) => {
  const ctx = await bootServer();
  t.after(async () => {
    await ctx.server.shutdown('test');
    ctx.restoreEnv();
    rmSync(ctx.tmp, { recursive: true, force: true });
  });
  const res = await postDream(ctx.baseUrl, { dream: 'x' }, {
    Origin: 'http://evil.example.com',
  });
  assert.equal(res.status, 403);
  const json = await res.json();
  assert.equal(json.error, 'forbidden_origin');
});

test('@integration POST /api/dream wrong Host → 403 forbidden_host', async (t) => {
  const ctx = await bootServer();
  t.after(async () => {
    await ctx.server.shutdown('test');
    ctx.restoreEnv();
    rmSync(ctx.tmp, { recursive: true, force: true });
  });
  // Use plain http so we can send a custom Host header (fetch always sets it).
  const port = ctx.port;
  const body = JSON.stringify({ dream: 'x' });
  const res = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port, path: '/api/dream', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': `http://127.0.0.1:${port}`,
        'Host': 'evil.example.com:1234',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (r) => {
      let buf = '';
      r.setEncoding('utf8');
      r.on('data', (c) => { buf += c; });
      r.on('end', () => resolve({ status: r.statusCode, body: buf }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
  assert.equal(res.status, 403);
  assert.match(res.body, /forbidden_host/);
});

test('@integration POST /api/dream non-JSON Content-Type → 415 unsupported_media_type', async (t) => {
  const ctx = await bootServer();
  t.after(async () => {
    await ctx.server.shutdown('test');
    ctx.restoreEnv();
    rmSync(ctx.tmp, { recursive: true, force: true });
  });
  const res = await postDream(ctx.baseUrl, 'hi', { 'Content-Type': 'text/plain' });
  assert.equal(res.status, 415);
  const json = await res.json();
  assert.equal(json.error, 'unsupported_media_type');
});

test('@integration POST /api/dream body >4KB → 413 body_too_large', async (t) => {
  const ctx = await bootServer();
  t.after(async () => {
    await ctx.server.shutdown('test');
    ctx.restoreEnv();
    rmSync(ctx.tmp, { recursive: true, force: true });
  });
  const res = await postDream(ctx.baseUrl, { dream: 'x'.repeat(5000) });
  assert.equal(res.status, 413);
  const json = await res.json();
  assert.equal(json.error, 'body_too_large');
  assert.equal(json.max_bytes, 4096);
});

test('@integration POST /api/dream invalid JSON → 400 invalid_json', async (t) => {
  const ctx = await bootServer();
  t.after(async () => {
    await ctx.server.shutdown('test');
    ctx.restoreEnv();
    rmSync(ctx.tmp, { recursive: true, force: true });
  });
  const res = await postDream(ctx.baseUrl, '{not json');
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.error, 'invalid_json');
});

test('@integration POST /api/dream missing dream key → 400 dream_missing', async (t) => {
  const ctx = await bootServer();
  t.after(async () => {
    await ctx.server.shutdown('test');
    ctx.restoreEnv();
    rmSync(ctx.tmp, { recursive: true, force: true });
  });
  const res = await postDream(ctx.baseUrl, { other: 'value' });
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.error, 'dream_missing');
});

test('@integration POST /api/dream empty/whitespace dream → 400 dream_empty', async (t) => {
  const ctx = await bootServer();
  t.after(async () => {
    await ctx.server.shutdown('test');
    ctx.restoreEnv();
    rmSync(ctx.tmp, { recursive: true, force: true });
  });
  const res = await postDream(ctx.baseUrl, { dream: '   ' });
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.error, 'dream_empty');
});

test('@integration POST /api/dream dream length 501 → 400 dream_too_long', async (t) => {
  const ctx = await bootServer();
  t.after(async () => {
    await ctx.server.shutdown('test');
    ctx.restoreEnv();
    rmSync(ctx.tmp, { recursive: true, force: true });
  });
  const res = await postDream(ctx.baseUrl, { dream: 'a'.repeat(501) });
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.error, 'dream_too_long');
});

/* ── POST /api/dream happy path + SSE ────────────────────────────────────── */

test('@integration POST /api/dream happy path returns 202 jobId+streamUrl within 1 s (G13)', async (t) => {
  const ctx = await bootServer({
    MMD_AUTODEV_CMD: FAKE_STREAMING,
    MMD_FAKE_LINES: '2',
    MMD_FAKE_SLEEP: '0.01',
  });
  t.after(async () => {
    await ctx.server.shutdown('test');
    ctx.restoreEnv();
    rmSync(ctx.tmp, { recursive: true, force: true });
  });
  const start = Date.now();
  const res = await postDream(ctx.baseUrl, { dream: 'a tiny test dream for happy path' });
  const elapsed = Date.now() - start;
  assert.equal(res.status, 202, `expected 202, got ${res.status}`);
  assert.ok(elapsed < 1000, `POST took ${elapsed} ms (>1000 ms G13 budget)`);
  const json = await res.json();
  assert.match(json.jobId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.ok(json.streamUrl.startsWith('/api/dream/stream/'));
});

test('@integration SSE stream produces log+done events', async (t) => {
  const ctx = await bootServer({
    MMD_AUTODEV_CMD: FAKE_STREAMING,
    MMD_FAKE_LINES: '2',
    MMD_FAKE_SLEEP: '0.01',
  });
  t.after(async () => {
    await ctx.server.shutdown('test');
    ctx.restoreEnv();
    rmSync(ctx.tmp, { recursive: true, force: true });
  });
  const res = await postDream(ctx.baseUrl, { dream: 'tiny sse test app' });
  assert.equal(res.status, 202);
  const { streamUrl } = await res.json();
  const events = await collectSse(ctx.baseUrl + streamUrl, { timeoutMs: 5000 });
  const logs = events.filter((e) => e.type === 'log');
  const dones = events.filter((e) => e.type === 'done');
  assert.ok(logs.length >= 1, `expected ≥1 log event, got ${logs.length}: ${JSON.stringify(events)}`);
  assert.ok(dones.length >= 1, `expected ≥1 done event, got: ${JSON.stringify(events)}`);
  assert.equal(dones[0].exitCode, 0);
});

test('@integration POST while another in-flight → 409 another_dream_in_progress', async (t) => {
  const ctx = await bootServer({
    MMD_AUTODEV_CMD: FAKE_STREAMING,
    MMD_FAKE_LINES: '3',
    MMD_FAKE_SLEEP: '0.5',
  });
  t.after(async () => {
    await ctx.server.shutdown('test');
    ctx.restoreEnv();
    rmSync(ctx.tmp, { recursive: true, force: true });
  });
  const res1 = await postDream(ctx.baseUrl, { dream: 'slow dream one' });
  assert.equal(res1.status, 202);
  // Immediately fire a second POST before the first finishes.
  const res2 = await postDream(ctx.baseUrl, { dream: 'second concurrent dream' });
  assert.equal(res2.status, 409);
  const json = await res2.json();
  assert.equal(json.error, 'another_dream_in_progress');
});

/* ── GET /api/status/<slug> ─────────────────────────────────────────────── */

test('@integration GET /api/status/<unknown> → 404', async (t) => {
  const ctx = await bootServer();
  t.after(async () => {
    await ctx.server.shutdown('test');
    ctx.restoreEnv();
    rmSync(ctx.tmp, { recursive: true, force: true });
  });
  const res = await fetch(ctx.baseUrl + '/api/status/nonexistent-slug');
  assert.equal(res.status, 404);
});

test('@integration GET /api/status/<slug> round-trips status-minimal.json fixture', async (t) => {
  const ctx = await bootServer();
  t.after(async () => {
    await ctx.server.shutdown('test');
    ctx.restoreEnv();
    rmSync(ctx.tmp, { recursive: true, force: true });
  });
  const slug = 'foo-min';
  const sharedDir = path.join(ctx.tmp, 'demo', slug, '.mmd', 'shared');
  mkdirSync(sharedDir, { recursive: true });
  const fixture = readFileSync(STATUS_MIN_PATH, 'utf8');
  writeFileSync(path.join(sharedDir, 'status.json'), fixture);
  const res = await fetch(ctx.baseUrl + `/api/status/${slug}`);
  assert.equal(res.status, 200);
  const json = await res.json();
  const expected = JSON.parse(fixture);
  for (const k of Object.keys(expected)) {
    assert.deepEqual(json[k], expected[k], `field ${k} round-trip`);
  }
});

test('@integration GET /api/status/<slug> round-trips status-enriched.json fixture', async (t) => {
  const ctx = await bootServer();
  t.after(async () => {
    await ctx.server.shutdown('test');
    ctx.restoreEnv();
    rmSync(ctx.tmp, { recursive: true, force: true });
  });
  const slug = 'foo-enr';
  const sharedDir = path.join(ctx.tmp, 'demo', slug, '.mmd', 'shared');
  mkdirSync(sharedDir, { recursive: true });
  const fixture = readFileSync(STATUS_ENR_PATH, 'utf8');
  writeFileSync(path.join(sharedDir, 'status.json'), fixture);
  const res = await fetch(ctx.baseUrl + `/api/status/${slug}`);
  assert.equal(res.status, 200);
  const json = await res.json();
  const expected = JSON.parse(fixture);
  assert.equal(json.current_phase, expected.current_phase);
  assert.equal(json.progress_percent, expected.progress_percent);
  assert.deepEqual(json.last_log_lines, expected.last_log_lines);
  assert.equal(json.heartbeat_at, expected.heartbeat_at);
  assert.equal(json.heartbeat_interval_seconds, expected.heartbeat_interval_seconds);
});

/* ── GET /demo/<slug>/* static + path-traversal end-to-end ───────────────── */

test('@integration GET /demo/<slug>/index.html serves with relaxed (demo) CSP', async (t) => {
  const ctx = await bootServer();
  t.after(async () => {
    await ctx.server.shutdown('test');
    ctx.restoreEnv();
    rmSync(ctx.tmp, { recursive: true, force: true });
  });
  const slug = 'demo-app';
  const demoDir = path.join(ctx.tmp, 'demo', slug);
  mkdirSync(demoDir, { recursive: true });
  writeFileSync(path.join(demoDir, 'index.html'), '<!doctype html><title>x</title>');
  const res = await fetch(`${ctx.baseUrl}/demo/${slug}/index.html`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /^text\/html/);
  const csp = res.headers.get('content-security-policy') || '';
  assert.match(csp, /'unsafe-inline'/, `expected relaxed CSP with 'unsafe-inline', got: ${csp}`);
});

test('@integration GET /demo/../etc/passwd → blocked (4xx)', async (t) => {
  const ctx = await bootServer();
  t.after(async () => {
    await ctx.server.shutdown('test');
    ctx.restoreEnv();
    rmSync(ctx.tmp, { recursive: true, force: true });
  });
  // fetch normalizes /demo/../etc/passwd → /etc/passwd, so we use plain http to
  // send the raw URL preserving the .. segment.
  const port = ctx.port;
  const status = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port, method: 'GET',
      path: '/demo/../etc/passwd',
    }, (r) => {
      r.resume();
      r.on('end', () => resolve(r.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
  // Per documented impl divergence (test/unit/path-traversal.test.js): impl
  // returns 415 here because path.posix.normalize collapses .. and .passwd
  // is not in the MIME allowlist. Either 403 or 415 is acceptable as "blocked".
  assert.ok(status === 403 || status === 415, `expected 4xx (blocked), got ${status}`);
});

test('@integration GET /demo/foo/payload.exe → 415 unsupported_file_type', async (t) => {
  const ctx = await bootServer();
  t.after(async () => {
    await ctx.server.shutdown('test');
    ctx.restoreEnv();
    rmSync(ctx.tmp, { recursive: true, force: true });
  });
  const res = await fetch(ctx.baseUrl + '/demo/foo/payload.exe');
  assert.equal(res.status, 415);
});

/* ── AC-9 CORS ───────────────────────────────────────────────────────────── */

test('@integration AC-9 CORS: POST echoes the exact allowed Origin (never *)', async (t) => {
  const ctx = await bootServer({
    MMD_AUTODEV_CMD: FAKE_STREAMING,
    MMD_FAKE_LINES: '1',
    MMD_FAKE_SLEEP: '0.01',
  });
  t.after(async () => {
    await ctx.server.shutdown('test');
    ctx.restoreEnv();
    rmSync(ctx.tmp, { recursive: true, force: true });
  });
  const port = ctx.port;
  const origin = `http://127.0.0.1:${port}`;
  const res = await postDream(ctx.baseUrl, { dream: 'cors echo test' }, { Origin: origin });
  // Accept either the 202 happy path or rate-limit if some preceding test polluted state;
  // either way the CORS header must echo the origin (NEVER '*').
  const acao = res.headers.get('access-control-allow-origin');
  assert.equal(acao, origin, `expected ACAO to echo Origin "${origin}", got "${acao}"`);
  assert.notEqual(acao, '*');
});
