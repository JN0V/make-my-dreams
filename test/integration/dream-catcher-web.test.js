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

// Drive start → profile → level for an Autonome (one-synthesize) flow, returning
// {sessionId, scopeBody}. Mirrors the a-1 single-call path with the new level step.
async function startAutonome(baseUrl, dream, profile = 'Curieux') {
  const b1 = await (await post(baseUrl, '/api/catch/start', { dream })).json();
  await post(baseUrl, '/api/catch/answer', { sessionId: b1.sessionId, answer: profile });
  const scopeBody = await (await post(baseUrl, '/api/catch/answer', { sessionId: b1.sessionId, answer: 'Autonome' })).json();
  return { sessionId: b1.sessionId, scopeBody };
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

  // answer (profile) → advance to the level chooser (no synthesize yet)
  const rp = await post(ctx.baseUrl, '/api/catch/answer', { sessionId: b1.sessionId, answer: 'Enfant' });
  assert.equal(rp.status, 200);
  assert.equal((await rp.json()).next, 'level');

  // answer (level=Autonome) → autonomous synthesize → scope
  const r2 = await post(ctx.baseUrl, '/api/catch/answer', { sessionId: b1.sessionId, answer: 'Autonome' });
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

  const { sessionId, scopeBody: b2 } = await startAutonome(ctx.baseUrl, 'une appli pour dessiner', 'Curieux');

  process.env.MMD_AUTODEV_CMD = FAKE_STREAMING;
  await post(ctx.baseUrl, '/api/catch/confirm', { sessionId });
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

  const { scopeBody: b2 } = await startAutonome(ctx.baseUrl, 'build me a spaceship cockpit', 'Pro');
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

test('@integration AC-6 served UI exposes the full flow (profile → level → question → scope + edit)', async (t) => {
  const ctx = await bootServer({ MMD_AUTODEV_CMD: FAKE_ELICIT });
  t.after(async () => { await ctx.server.shutdown('test'); ctx.restoreEnv(); rmSync(ctx.tmp, { recursive: true, force: true }); });

  const html = await (await fetch(ctx.baseUrl + '/')).text();
  // 3 profile buttons
  assert.match(html, /data-profile="Enfant"/);
  assert.match(html, /data-profile="Curieux"/);
  assert.match(html, /data-profile="Pro"/);
  // 3 level buttons (the involvement dial)
  assert.match(html, /id="step-level"/);
  assert.match(html, /data-level="Autonome"/);
  assert.match(html, /data-level="Équilibré"/);
  assert.match(html, /data-level="Guidé"/);
  // one-question step
  assert.match(html, /id="step-question"/);
  assert.match(html, /id="question-input"/);
  // scope card + edit affordance
  assert.match(html, /id="step-scope"/);
  assert.match(html, /id="scope-go"/);
  assert.match(html, /id="scope-restart"/);
  assert.match(html, /id="scope-edit-toggle"/);
  assert.match(html, /id="scope-edit-save"/);
  assert.match(html, /id="scope-edit-text"/);

  const appJs = await (await fetch(ctx.baseUrl + '/app.js')).text();
  // The UI is wired to the catch endpoints (state-driven answer + edit).
  assert.match(appJs, /\/api\/catch\/start/);
  assert.match(appJs, /\/api\/catch\/answer/);
  assert.match(appJs, /\/api\/catch\/edit/);
  assert.match(appJs, /\/api\/catch\/confirm/);
});

/* ─────────── AC-5: all 3 levels + edit (a-2) ─────────── */

test('@integration Autonome: scope right after the level answer (one synthesize)', async (t) => {
  const ctx = await bootServer({ MMD_AUTODEV_CMD: FAKE_ELICIT, MMD_SERVE_RATE_LIMIT_PER_HOUR: '1000' });
  t.after(async () => { await ctx.server.shutdown('test'); ctx.restoreEnv(); rmSync(ctx.tmp, { recursive: true, force: true }); });
  const { scopeBody } = await startAutonome(ctx.baseUrl, 'une appli pour dessiner', 'Curieux');
  assert.equal(scopeBody.next, 'scope');
  assert.ok(scopeBody.scope.length > 0);
});

test('@integration Équilibré: one question then scope', async (t) => {
  const ctx = await bootServer({ MMD_AUTODEV_CMD: FAKE_ELICIT, MMD_SERVE_RATE_LIMIT_PER_HOUR: '1000' });
  t.after(async () => { await ctx.server.shutdown('test'); ctx.restoreEnv(); rmSync(ctx.tmp, { recursive: true, force: true }); });
  const b1 = await (await post(ctx.baseUrl, '/api/catch/start', { dream: 'une appli pour dessiner' })).json();
  await post(ctx.baseUrl, '/api/catch/answer', { sessionId: b1.sessionId, answer: 'Curieux' });
  const q = await (await post(ctx.baseUrl, '/api/catch/answer', { sessionId: b1.sessionId, answer: 'Équilibré' })).json();
  assert.equal(q.next, 'question');
  assert.equal(typeof q.question, 'string');
  const s = await (await post(ctx.baseUrl, '/api/catch/answer', { sessionId: b1.sessionId, answer: 'bleu' })).json();
  assert.equal(s.next, 'scope');
  assert.ok(s.scope.length > 0);
});

test('@integration Guidé: two questions then scope', async (t) => {
  const ctx = await bootServer({ MMD_AUTODEV_CMD: FAKE_ELICIT, MMD_SERVE_RATE_LIMIT_PER_HOUR: '1000' });
  t.after(async () => { await ctx.server.shutdown('test'); ctx.restoreEnv(); rmSync(ctx.tmp, { recursive: true, force: true }); });
  const b1 = await (await post(ctx.baseUrl, '/api/catch/start', { dream: 'un jeu' })).json();
  await post(ctx.baseUrl, '/api/catch/answer', { sessionId: b1.sessionId, answer: 'Pro' });
  const q1 = await (await post(ctx.baseUrl, '/api/catch/answer', { sessionId: b1.sessionId, answer: 'Guidé' })).json();
  assert.equal(q1.next, 'question');
  const q2 = await (await post(ctx.baseUrl, '/api/catch/answer', { sessionId: b1.sessionId, answer: 'plateforme' })).json();
  assert.equal(q2.next, 'question'); // still asking
  const s = await (await post(ctx.baseUrl, '/api/catch/answer', { sessionId: b1.sessionId, answer: 'solo' })).json();
  assert.equal(s.next, 'scope');
  assert.ok(s.scope.length > 0);
});

test('@integration /api/catch/edit replaces the scope (happy path)', async (t) => {
  const ctx = await bootServer({ MMD_AUTODEV_CMD: FAKE_ELICIT, MMD_SERVE_RATE_LIMIT_PER_HOUR: '1000' });
  t.after(async () => { await ctx.server.shutdown('test'); ctx.restoreEnv(); rmSync(ctx.tmp, { recursive: true, force: true }); });
  const { sessionId } = await startAutonome(ctx.baseUrl, 'une appli pour dessiner', 'Curieux');
  const edited = 'A hand-edited scope: one canvas and a save button only.';
  const r = await post(ctx.baseUrl, '/api/catch/edit', { sessionId, scope: edited });
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.next, 'scope');
  assert.equal(b.scope, edited);
});

test('@integration /api/catch/edit rejects outside SCOPE state (409) + empty scope (400)', async (t) => {
  const ctx = await bootServer({ MMD_AUTODEV_CMD: FAKE_ELICIT, MMD_SERVE_RATE_LIMIT_PER_HOUR: '1000' });
  t.after(async () => { await ctx.server.shutdown('test'); ctx.restoreEnv(); rmSync(ctx.tmp, { recursive: true, force: true }); });
  // Before reaching scope: still in 'profile' → 409.
  const b1 = await (await post(ctx.baseUrl, '/api/catch/start', { dream: 'draw' })).json();
  const tooEarly = await post(ctx.baseUrl, '/api/catch/edit', { sessionId: b1.sessionId, scope: 'something long enough' });
  assert.equal(tooEarly.status, 409);
  // Reach scope, then an empty scope edit → 400.
  const { sessionId } = await startAutonome(ctx.baseUrl, 'a different drawing dream', 'Curieux');
  const empty = await post(ctx.baseUrl, '/api/catch/edit', { sessionId, scope: '   ' });
  assert.equal(empty.status, 400);
});

test('@integration edited scope is the one launched by confirm', async (t) => {
  const ctx = await bootServer({ MMD_AUTODEV_CMD: FAKE_ELICIT, MMD_SERVE_RATE_LIMIT_PER_HOUR: '1000' });
  t.after(async () => { await ctx.server.shutdown('test'); ctx.restoreEnv(); rmSync(ctx.tmp, { recursive: true, force: true }); });
  const { sessionId } = await startAutonome(ctx.baseUrl, 'une appli pour dessiner', 'Curieux');
  const edited = 'Launch this exact edited scope: a tiny note-taking app.';
  await post(ctx.baseUrl, '/api/catch/edit', { sessionId, scope: edited });

  process.env.MMD_AUTODEV_CMD = FAKE_STREAMING;
  await post(ctx.baseUrl, '/api/catch/confirm', { sessionId });
  process.env.MMD_AUTODEV_CMD = FAKE_ELICIT;

  const demoDir = path.join(ctx.tmp, 'demo');
  const slugs = readdirSync(demoDir);
  assert.equal(slugs.length, 1);
  const statusPath = path.join(demoDir, slugs[0], '.mmd', 'shared', 'status.json');
  const status = JSON.parse(readFileSync(statusPath, 'utf8'));
  assert.equal(status.dream, edited); // confirm launched the EDITED scope
});

test('@integration F1: a concurrent answer hits the single-in-flight synthesize guard (409)', async (t) => {
  const ctx = await bootServer({
    MMD_AUTODEV_CMD: FAKE_ELICIT,
    MMD_FAKE_ELICIT_SLEEP: '0.4', // hold the first synthesize open
    MMD_SERVE_RATE_LIMIT_PER_HOUR: '1000',
  });
  t.after(async () => { await ctx.server.shutdown('test'); ctx.restoreEnv(); rmSync(ctx.tmp, { recursive: true, force: true }); });

  // The DoS the guard prevents is a loop of start[new session]+answer(level)
  // spawning unbounded claude processes — so use TWO distinct sessions, each
  // walked to the LEVEL step (where the Autonome answer triggers the synthesize).
  const b1 = await (await post(ctx.baseUrl, '/api/catch/start', { dream: 'une appli pour dessiner' })).json();
  const b2 = await (await post(ctx.baseUrl, '/api/catch/start', { dream: 'un jeu de plateforme' })).json();
  await post(ctx.baseUrl, '/api/catch/answer', { sessionId: b1.sessionId, answer: 'Curieux' });
  await post(ctx.baseUrl, '/api/catch/answer', { sessionId: b2.sessionId, answer: 'Pro' });
  // Fire the first level answer (holds the synthesize open via the sleep) without awaiting.
  const p1 = post(ctx.baseUrl, '/api/catch/answer', { sessionId: b1.sessionId, answer: 'Autonome' });
  // small delay so p1 sets the synthesizing flag before p2 arrives
  await new Promise((r) => setTimeout(r, 80));
  const r2 = await post(ctx.baseUrl, '/api/catch/answer', { sessionId: b2.sessionId, answer: 'Autonome' });
  assert.equal(r2.status, 409);
  assert.equal((await r2.json()).error, 'synthesize_in_progress');
  const r1 = await p1;
  assert.equal(r1.status, 200); // the first one still completes
});

test('@integration F2: confirm is rate-limited (429) once the bucket is exhausted', async (t) => {
  const ctx = await bootServer({
    MMD_AUTODEV_CMD: FAKE_STREAMING,
    MMD_SERVE_RATE_LIMIT_PER_HOUR: '1', // one successful run fills the bucket
    MMD_FAKE_LINES: '1',
    MMD_FAKE_SLEEP: '0',
  });
  t.after(async () => { await ctx.server.shutdown('test'); ctx.restoreEnv(); rmSync(ctx.tmp, { recursive: true, force: true }); });

  // Exhaust the bucket via a legacy run that exits 0 (recordSuccess fires on exit).
  await post(ctx.baseUrl, '/api/dream', { dream: 'fill the rate bucket once' });
  // Wait until the bucket records the success AND the in-flight job clears.
  for (let i = 0; i < 100; i++) {
    const s = ctx.server._state();
    if (s.rateLimit.used >= 1 && s.inflightJobId === null) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(ctx.server._state().rateLimit.used, 1);

  // Now run the Dream Catcher flow to a scope, then confirm → 429.
  process.env.MMD_AUTODEV_CMD = FAKE_ELICIT;
  const { sessionId } = await startAutonome(ctx.baseUrl, 'une appli pour dessiner', 'Curieux');
  const r = await post(ctx.baseUrl, '/api/catch/confirm', { sessionId });
  assert.equal(r.status, 429);
  assert.equal((await r.json()).error, 'rate_limited');

  // F3: the session was NOT consumed — it is still retryable.
  assert.equal(ctx.server._state().catchSessionCount, 1);
});

test('@integration catch routes reject non-JSON (415) and oversized bodies (413)', async (t) => {
  const ctx = await bootServer({ MMD_AUTODEV_CMD: FAKE_ELICIT });
  t.after(async () => { await ctx.server.shutdown('test'); ctx.restoreEnv(); rmSync(ctx.tmp, { recursive: true, force: true }); });

  const notJson = await post(ctx.baseUrl, '/api/catch/start', 'dream=x', { 'Content-Type': 'text/plain' });
  assert.equal(notJson.status, 415);

  const huge = JSON.stringify({ dream: 'x'.repeat(5000) }); // > MAX_BODY_BYTES (4096)
  const tooBig = await post(ctx.baseUrl, '/api/catch/start', huge);
  assert.equal(tooBig.status, 413);
});

test('@integration N2: confirm refuses a slug that already has a demo build (409 duplicate_dream)', async (t) => {
  const ctx = await bootServer({ MMD_AUTODEV_CMD: FAKE_ELICIT, MMD_SERVE_RATE_LIMIT_PER_HOUR: '1000' });
  t.after(async () => { await ctx.server.shutdown('test'); ctx.restoreEnv(); rmSync(ctx.tmp, { recursive: true, force: true }); });

  // Pre-create a demo dir for the slug the fixture's canned scope will produce.
  // The Curious fixture scope is the English one starting "A small drawing app";
  // run the flow once to discover the slug, then a second flow must 409.
  const first = await startAutonome(ctx.baseUrl, 'une appli pour dessiner', 'Curieux');
  process.env.MMD_AUTODEV_CMD = FAKE_STREAMING;
  await post(ctx.baseUrl, '/api/catch/confirm', { sessionId: first.sessionId });
  // wait for in-flight to clear
  for (let i = 0; i < 100; i++) {
    if (ctx.server._state().inflightJobId === null) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  process.env.MMD_AUTODEV_CMD = FAKE_ELICIT;

  // Second identical flow → same scope → same slug → duplicate.
  const second = await startAutonome(ctx.baseUrl, 'une appli pour dessiner', 'Curieux');
  const r = await post(ctx.baseUrl, '/api/catch/confirm', { sessionId: second.sessionId });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error, 'duplicate_dream');
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
