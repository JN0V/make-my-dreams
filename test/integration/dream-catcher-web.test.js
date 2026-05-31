// test/integration/dream-catcher-web.test.js — SPEC_V03A1 AC-4 + AC-5.
// In-process integration tests for the Dream Catcher web flow:
//   POST /api/catch/start → /api/catch/answer → /api/catch/confirm → SSE.
// Uses the fake-claude elicitation fixture (MMD_AUTODEV_CMD) + the streaming
// fake auto-dev — the real claude is never invoked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createServer } from '../../lib/server.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const FAKE_ELICIT = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-claude-elicit.sh');
const FAKE_STREAMING = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-autodev-streaming.sh');

process.env.MMD_SERVE_ALLOW_RANDOM = '1';

async function bootServer(extraEnv = {}) {
  const tmp = mkdtempSync(path.join(tmpdir(), 'mmd-catch-'));
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

function post(baseUrl, pathname, body, headerOverrides = {}) {
  const port = new URL(baseUrl).port;
  const headers = {
    'Content-Type': 'application/json',
    Origin: `http://127.0.0.1:${port}`,
    Host: `127.0.0.1:${port}`,
    ...headerOverrides,
  };
  return fetch(baseUrl + pathname, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

test('@integration full flow: start → answer → confirm returns {jobId, streamUrl}', async (t) => {
  const ctx = await bootServer({
    MMD_AUTODEV_CMD: FAKE_ELICIT,
    MMD_SERVE_RATE_LIMIT_PER_HOUR: '1000',
  });
  t.after(async () => { await ctx.server.shutdown('test'); ctx.restoreEnv(); rmSync(ctx.tmp, { recursive: true, force: true }); });

  // start
  const r1 = await post(ctx.baseUrl, '/api/catch/start', { dream: 'une appli pour dessiner' });
  assert.equal(r1.status, 200);
  const b1 = await r1.json();
  assert.equal(b1.next, 'profile');
  assert.equal(typeof b1.sessionId, 'string');

  // answer (profile) → autonomous synthesize
  const r2 = await post(ctx.baseUrl, '/api/catch/answer', { sessionId: b1.sessionId, answer: 'Enfant' });
  assert.equal(r2.status, 200);
  const b2 = await r2.json();
  assert.equal(b2.next, 'scope');
  assert.equal(b2.profile, 'Kid');
  assert.equal(b2.fallback, false);
  assert.ok(b2.scope.length > 0);

  // Now point the launch at the streaming fake auto-dev for confirm.
  process.env.MMD_AUTODEV_CMD = FAKE_STREAMING;
  const r3 = await post(ctx.baseUrl, '/api/catch/confirm', { sessionId: b1.sessionId });
  assert.equal(r3.status, 202);
  const b3 = await r3.json();
  assert.equal(typeof b3.jobId, 'string');
  assert.match(b3.streamUrl, /^\/api\/dream\/stream\//);
  process.env.MMD_AUTODEV_CMD = FAKE_ELICIT;
});

test('@integration confirm writes status.json {dream:scope, profile} and archives the dialogue', async (t) => {
  const ctx = await bootServer({ MMD_AUTODEV_CMD: FAKE_ELICIT, MMD_SERVE_RATE_LIMIT_PER_HOUR: '1000' });
  t.after(async () => { await ctx.server.shutdown('test'); ctx.restoreEnv(); rmSync(ctx.tmp, { recursive: true, force: true }); });

  const b1 = await (await post(ctx.baseUrl, '/api/catch/start', { dream: 'une appli pour dessiner' })).json();
  const b2 = await (await post(ctx.baseUrl, '/api/catch/answer', { sessionId: b1.sessionId, answer: 'Curieux' })).json();

  process.env.MMD_AUTODEV_CMD = FAKE_STREAMING;
  await post(ctx.baseUrl, '/api/catch/confirm', { sessionId: b1.sessionId });
  process.env.MMD_AUTODEV_CMD = FAKE_ELICIT;

  // status.json carries the scope as the dream + the chosen profile (AC-3/AC-4).
  // The server slugifies the SCOPE; read whatever demo/<slug> it created.
  const demoDir = path.join(ctx.tmp, 'demo');
  const slugs = readdirSync(demoDir);
  assert.equal(slugs.length, 1);
  const statusPath = path.join(demoDir, slugs[0], '.mmd', 'shared', 'status.json');
  assert.ok(existsSync(statusPath), 'status.json should exist');
  const status = JSON.parse(readFileSync(statusPath, 'utf8'));
  assert.equal(status.dream, b2.scope);
  assert.equal(status.profile, 'Curious');

  // dialogue archived under .mmd/local/dream-catcher/<ts>.md
  const archiveDir = path.join(ctx.tmp, '.mmd', 'local', 'dream-catcher');
  assert.ok(existsSync(archiveDir), 'archive dir should exist');
  const archives = readdirSync(archiveDir).filter((f) => f.endsWith('.md'));
  assert.equal(archives.length, 1);
  const archive = readFileSync(path.join(archiveDir, archives[0]), 'utf8');
  assert.match(archive, /Profile: Curious/);
  assert.match(archive, /une appli pour dessiner/);
});

test('@integration honest fallback: BMAD failure → verbatim dream as scope, fallback flag true', async (t) => {
  const ctx = await bootServer({
    MMD_AUTODEV_CMD: FAKE_ELICIT,
    MMD_FAKE_ELICIT_EXIT: '5', // fixture crashes → elicit falls back
    MMD_SERVE_RATE_LIMIT_PER_HOUR: '1000',
  });
  t.after(async () => { await ctx.server.shutdown('test'); ctx.restoreEnv(); rmSync(ctx.tmp, { recursive: true, force: true }); });

  const b1 = await (await post(ctx.baseUrl, '/api/catch/start', { dream: 'build me a spaceship cockpit' })).json();
  const r2 = await post(ctx.baseUrl, '/api/catch/answer', { sessionId: b1.sessionId, answer: 'Pro' });
  const b2 = await r2.json();
  assert.equal(b2.fallback, true);
  assert.equal(b2.scope, 'build me a spaceship cockpit'); // verbatim, never fabricated
});

test('@integration unknown session id → 404', async (t) => {
  const ctx = await bootServer({ MMD_AUTODEV_CMD: FAKE_ELICIT });
  t.after(async () => { await ctx.server.shutdown('test'); ctx.restoreEnv(); rmSync(ctx.tmp, { recursive: true, force: true }); });
  const r = await post(ctx.baseUrl, '/api/catch/answer', { sessionId: 'nope', answer: 'Kid' });
  assert.equal(r.status, 404);
});

test('@integration out-of-order: confirm before answer → 409 bad_session_state', async (t) => {
  const ctx = await bootServer({ MMD_AUTODEV_CMD: FAKE_ELICIT });
  t.after(async () => { await ctx.server.shutdown('test'); ctx.restoreEnv(); rmSync(ctx.tmp, { recursive: true, force: true }); });
  const b1 = await (await post(ctx.baseUrl, '/api/catch/start', { dream: 'draw stuff' })).json();
  const r = await post(ctx.baseUrl, '/api/catch/confirm', { sessionId: b1.sessionId });
  assert.equal(r.status, 409);
});

test('@integration start rejects empty dream (400) and wrong Origin (403)', async (t) => {
  const ctx = await bootServer({ MMD_AUTODEV_CMD: FAKE_ELICIT });
  t.after(async () => { await ctx.server.shutdown('test'); ctx.restoreEnv(); rmSync(ctx.tmp, { recursive: true, force: true }); });
  const empty = await post(ctx.baseUrl, '/api/catch/start', { dream: '   ' });
  assert.equal(empty.status, 400);
  const badOrigin = await post(ctx.baseUrl, '/api/catch/start', { dream: 'x' }, { Origin: 'http://evil.example.com' });
  assert.equal(badOrigin.status, 403);
});

test('@integration legacy POST /api/dream still works untouched', async (t) => {
  const ctx = await bootServer({ MMD_AUTODEV_CMD: FAKE_STREAMING, MMD_SERVE_RATE_LIMIT_PER_HOUR: '1000' });
  t.after(async () => { await ctx.server.shutdown('test'); ctx.restoreEnv(); rmSync(ctx.tmp, { recursive: true, force: true }); });
  const r = await post(ctx.baseUrl, '/api/dream', { dream: 'legacy oneshot dream path' });
  assert.equal(r.status, 202);
  const b = await r.json();
  assert.equal(typeof b.jobId, 'string');
  assert.match(b.streamUrl, /^\/api\/dream\/stream\//);
});
