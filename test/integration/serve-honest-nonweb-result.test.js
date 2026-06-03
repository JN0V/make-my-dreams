// Tests for serve's honest non-web result surfacing (SPEC_V010A AC-5).
//
// With the generation prompt technology-agnostic, a finished build may not be a
// web app. buildPreviewResult reads the run descriptor and returns either a real
// preview URL (web build — unchanged) or an honest "browser preview not
// available yet" message naming the kind + run instruction (non-web build),
// instead of a phantom …/index.html link.
//
// Two layers: pure buildPreviewResult (@unit, deterministic) + an end-to-end SSE
// done event through the real server with a fake CLI / web fixture (@integration).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';

import { createServer, buildPreviewResult } from '../../lib/server.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const FAKE_CLI = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-autodev-cli.sh');
const FAKE_STREAMING = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-autodev-streaming.sh');

process.env.MMD_SERVE_ALLOW_RANDOM = '1';

/* ── pure buildPreviewResult (@unit) ─────────────────────────────────────────── */

function makeDemo({ descriptor, files } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-preview-'));
  if (descriptor !== undefined) {
    mkdirSync(path.join(dir, '.mmd', 'shared'), { recursive: true });
    writeFileSync(
      path.join(dir, '.mmd', 'shared', 'run.json'),
      typeof descriptor === 'string' ? descriptor : JSON.stringify(descriptor),
      'utf8',
    );
  }
  for (const [rel, content] of Object.entries(files || {})) {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf8');
  }
  return dir;
}
const demos = [];
function demo(opts) { const d = makeDemo(opts); demos.push(d); return d; }
test.after(() => { for (const d of demos) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ } } });

test('@unit AC-5: web-static descriptor + real index.html → previewable URL (unchanged shape)', () => {
  const dir = demo({
    descriptor: { kind: 'web-static', entry: 'index.html' },
    files: { 'index.html': '<h1>ok</h1>' },
  });
  const r = buildPreviewResult({ demoDir: dir, slug: 'my-app', port: 4322 });
  assert.equal(r.previewable, true);
  assert.equal(r.resultUrl, 'http://localhost:4322/demo/my-app/index.html');
});

test('@unit AC-5: back-compat bare index.html (no descriptor) → today\'s index.html URL', () => {
  const dir = demo({ files: { 'index.html': '<h1>ok</h1>' } });
  const r = buildPreviewResult({ demoDir: dir, slug: 'legacy', port: 4322 });
  assert.equal(r.previewable, true);
  assert.equal(r.resultUrl, 'http://localhost:4322/demo/legacy/index.html');
});

test('@unit AC-5: web-static with a nested entry → URL reflects the entry', () => {
  const dir = demo({
    descriptor: { kind: 'web-static', entry: 'public/index.html' },
    files: { 'public/index.html': '<h1>ok</h1>' },
  });
  const r = buildPreviewResult({ demoDir: dir, slug: 'nested', port: 4322 });
  assert.equal(r.previewable, true);
  assert.equal(r.resultUrl, 'http://localhost:4322/demo/nested/public/index.html');
});

test('@unit AC-5: cli build → not previewable, honest message, resultUrl null', () => {
  const dir = demo({ descriptor: { kind: 'cli', run: 'node rename.js <dir>' } });
  const r = buildPreviewResult({ demoDir: dir, slug: 'renamer', port: 4322 });
  assert.equal(r.previewable, false);
  assert.equal(r.resultUrl, null);
  assert.equal(r.kind, 'cli');
  assert.equal(r.runInstruction, 'node rename.js <dir>');
  assert.match(r.message, /Built a cli project/);
  assert.match(r.message, /browser preview not available/i);
  assert.match(r.message, /node rename\.js <dir>/);
});

test('@unit AC-5: non-web build with no descriptor and no index.html → honest message, run.json hint', () => {
  const dir = demo({ files: { 'README.md': '# lib' } });
  const r = buildPreviewResult({ demoDir: dir, slug: 'thing', port: 4322 });
  assert.equal(r.previewable, false);
  assert.equal(r.resultUrl, null);
  assert.equal(r.kind, null);
  assert.match(r.message, /Built a non-web project/);
  assert.match(r.message, /\.mmd\/shared\/run\.json/);
});

/* ── end-to-end SSE done event (@integration) ────────────────────────────────── */

async function bootServer(extraEnv = {}) {
  const tmp = mkdtempSync(path.join(tmpdir(), 'mmd-srv-nw-'));
  const prevEnv = {};
  for (const [k, v] of Object.entries(extraEnv)) { prevEnv[k] = process.env[k]; process.env[k] = v; }
  const server = await createServer({ port: 0, explicitPort: false, cwd: tmp });
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  function restoreEnv() {
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
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
    body: JSON.stringify(body),
  });
}

function collectSse(url, { timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const events = [];
    let buffer = '';
    let resolved = false;
    const u = new URL(url);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'GET', headers: { Accept: 'text/event-stream' } }, (res) => {
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
                if (payload.type === 'done' || payload.type === 'error' || payload.type === 'server_shutdown') {
                  if (!resolved) { resolved = true; req.destroy(); resolve(events); }
                }
              } catch { /* ignore */ }
            }
          }
        }
      });
      res.on('end', () => { if (!resolved) { resolved = true; resolve(events); } });
      res.on('error', (err) => { if (!resolved) { resolved = true; reject(err); } });
    });
    req.on('error', (err) => { if (!resolved) { resolved = true; reject(err); } });
    req.setTimeout(timeoutMs, () => { if (!resolved) { resolved = true; req.destroy(); resolve(events); } });
    req.end();
  });
}

test('@integration AC-5: a CLI build → done event is honest non-web (no phantom index.html link)', async (t) => {
  const ctx = await bootServer({ MMD_AUTODEV_CMD: FAKE_CLI });
  t.after(async () => { await ctx.server.shutdown('test'); ctx.restoreEnv(); rmSync(ctx.tmp, { recursive: true, force: true }); });
  const res = await postDream(ctx.baseUrl, { dream: 'a CLI that renames files in bulk' });
  assert.equal(res.status, 202);
  const { streamUrl } = await res.json();
  const events = await collectSse(ctx.baseUrl + streamUrl);
  const done = events.filter((e) => e.type === 'done').pop();
  assert.ok(done, `expected a done event, got: ${JSON.stringify(events)}`);
  assert.equal(done.exitCode, 0);
  assert.equal(done.previewable, false);
  assert.equal(done.resultUrl, null, 'no phantom index.html link for a non-web build');
  assert.equal(done.kind, 'cli');
  assert.match(done.message, /Built a cli project/);
  assert.match(done.message, /node rename\.js/);
});

test('@integration AC-5: a web build → done event keeps today\'s index.html resultUrl', async (t) => {
  const ctx = await bootServer({ MMD_AUTODEV_CMD: FAKE_STREAMING, MMD_FAKE_LINES: '1', MMD_FAKE_SLEEP: '0.01' });
  t.after(async () => { await ctx.server.shutdown('test'); ctx.restoreEnv(); rmSync(ctx.tmp, { recursive: true, force: true }); });
  const res = await postDream(ctx.baseUrl, { dream: 'a tiny web page that says hi' });
  assert.equal(res.status, 202);
  const { streamUrl, slug } = await res.json();
  const events = await collectSse(ctx.baseUrl + streamUrl);
  const done = events.filter((e) => e.type === 'done').pop();
  assert.ok(done, `expected a done event, got: ${JSON.stringify(events)}`);
  assert.equal(done.exitCode, 0);
  assert.equal(done.previewable, true);
  assert.equal(done.resultUrl, `http://localhost:${ctx.port}/demo/${encodeURIComponent(slug)}/index.html`);
});
