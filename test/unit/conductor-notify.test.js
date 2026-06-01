// @unit tests for lib/conductor/notify.js — Conductor Layer-6 notification
// fan-out (v0.5.a, SPEC_V05A AC-1 / AC-2 / AC-4).
//
// No real network is ever hit: sendNotification takes an injected fetchFn and
// every test passes a fake. buildNotification/shouldNotify are pure.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shouldNotify, buildNotification, sendNotification } from '../../lib/conductor/notify.js';

// ── AC-1: shouldNotify ─────────────────────────────────────────────────────

test('@unit AC-1: shouldNotify true iff MMD_NOTIFY_URL is a non-empty string', () => {
  assert.equal(shouldNotify({ MMD_NOTIFY_URL: 'https://ntfy.sh/topic' }), true);
  assert.equal(shouldNotify({}), false);
  assert.equal(shouldNotify({ MMD_NOTIFY_URL: '' }), false);
  assert.equal(shouldNotify({ MMD_NOTIFY_URL: '   ' }), false, 'whitespace-only is not a URL');
  assert.equal(shouldNotify({ MMD_NOTIFY_URL: undefined }), false);
  // Never throws on a missing/odd env.
  assert.equal(shouldNotify(), false);
  assert.equal(shouldNotify({ MMD_NOTIFY_URL: 123 }), false, 'non-string is not a URL');
});

// ── AC-1 / AC-4: buildNotification (shape + message + no fabrication) ────────

test('@unit AC-1: buildNotification returns the request descriptor with a JSON body', () => {
  const n = buildNotification({
    event: 'run_done',
    slice: 'slice/here-foo-123',
    state: 'done',
    summary: 'foo (v0.5.0)',
    env: { MMD_NOTIFY_URL: 'https://ntfy.sh/topic' },
  });
  assert.equal(n.url, 'https://ntfy.sh/topic');
  assert.equal(n.method, 'POST');
  assert.deepEqual(n.headers, { 'Content-Type': 'application/json' });
  assert.equal(typeof n.body, 'string');

  const parsed = JSON.parse(n.body);
  assert.deepEqual(
    Object.keys(parsed).sort(),
    ['event', 'message', 'slice', 'state', 'summary', 'ts'].sort(),
  );
  assert.equal(parsed.event, 'run_done');
  assert.equal(parsed.slice, 'slice/here-foo-123');
  assert.equal(parsed.state, 'done');
  assert.equal(parsed.summary, 'foo (v0.5.0)');
  // ts is a valid ISO timestamp (asserted by parseability, not a fixed value).
  assert.equal(typeof parsed.ts, 'string');
  assert.ok(!Number.isNaN(Date.parse(parsed.ts)), 'ts parses as a date');
});

test('@unit AC-1/AC-4: message is a human one-liner with ✅ for done', () => {
  const n = buildNotification({
    event: 'run_done',
    slice: 'slice/here-foo-123',
    state: 'done',
    summary: 'foo (v0.5.0)',
    env: { MMD_NOTIFY_URL: 'x' },
  });
  const { message } = JSON.parse(n.body);
  assert.match(message, /✅/);
  assert.match(message, /slice\/here-foo-123/);
  assert.match(message, /foo \(v0\.5\.0\)/);
  assert.match(message, /finished/);
});

test('@unit AC-1/AC-4: message uses ❌ + "failed" for run_failed', () => {
  const n = buildNotification({
    event: 'run_failed',
    slice: 'slice/here-bar-9',
    state: 'failed',
    summary: 'auto-dev exited 7',
    env: { MMD_NOTIFY_URL: 'x' },
  });
  const parsed = JSON.parse(n.body);
  assert.equal(parsed.event, 'run_failed');
  assert.match(parsed.message, /❌/);
  assert.match(parsed.message, /failed/);
  assert.match(parsed.message, /auto-dev exited 7/);
});

test('@unit AC-1: buildNotification never fabricates a summary (neutral phrase when absent)', () => {
  for (const summary of [undefined, '', '   ']) {
    const n = buildNotification({
      event: 'run_done',
      slice: 's',
      state: 'done',
      summary,
      env: { MMD_NOTIFY_URL: 'x' },
    });
    const parsed = JSON.parse(n.body);
    // A fixed neutral phrase — NOT an invented description of the run.
    assert.equal(parsed.summary, 'no details available');
    assert.match(parsed.message, /no details available/);
  }
});

test('@unit AC-4: payload carries run metadata only — no secrets/env/file contents', () => {
  const n = buildNotification({
    event: 'run_done',
    slice: 'slice/x',
    state: 'done',
    summary: 'ok',
    env: { MMD_NOTIFY_URL: 'https://example/notify', SECRET_TOKEN: 'hunter2', PATH: '/usr/bin' },
  });
  const parsed = JSON.parse(n.body);
  // Only the contracted metadata keys are present.
  assert.deepEqual(
    Object.keys(parsed).sort(),
    ['event', 'message', 'slice', 'state', 'summary', 'ts'].sort(),
  );
  // The serialized body never leaks the secret or unrelated env.
  assert.ok(!n.body.includes('hunter2'), 'no secret token in body');
  assert.ok(!n.body.includes('SECRET_TOKEN'), 'no env var names in body');
  assert.ok(!n.body.includes('/usr/bin'), 'no PATH in body');
});

test('@unit AC-1: buildNotification is pure and never throws on missing input', () => {
  // No args at all — must not throw, must still produce a valid descriptor.
  const n = buildNotification();
  assert.equal(n.method, 'POST');
  assert.equal(n.url, '');
  const parsed = JSON.parse(n.body);
  assert.equal(parsed.event, 'run_done', 'unknown/missing event falls back to run_done');
  assert.equal(parsed.slice, '(unknown slice)');
  assert.equal(parsed.summary, 'no details available');

  // Does not mutate its argument object.
  const args = { event: 'run_done', slice: 's', state: 'done', summary: 'ok', env: { MMD_NOTIFY_URL: 'x' } };
  const snapshot = JSON.stringify(args);
  buildNotification(args);
  assert.equal(JSON.stringify(args), snapshot, 'arguments are not mutated');
});

// ── AC-2: sendNotification (best-effort, never throws) ──────────────────────

test('@unit AC-2: 2xx resolves { ok: true, status }', async () => {
  const fetchFn = async () => ({ status: 204 });
  const r = await sendNotification({ url: 'x', method: 'POST', headers: {}, body: '{}' }, { fetchFn });
  assert.deepEqual(r, { ok: true, status: 204 });
});

test('@unit AC-2: non-2xx resolves { ok: false, status }', async () => {
  const fetchFn = async () => ({ status: 500 });
  const r = await sendNotification({ url: 'x' }, { fetchFn });
  assert.deepEqual(r, { ok: false, status: 500 });
});

test('@unit AC-2: a thrown/rejected fetchFn resolves { ok: false, error } (never throws)', async () => {
  const fetchFn = async () => {
    throw new Error('ECONNREFUSED');
  };
  const r = await sendNotification({ url: 'x' }, { fetchFn });
  assert.equal(r.ok, false);
  assert.equal(typeof r.error, 'string');
  assert.match(r.error, /ECONNREFUSED/);
});

test('@unit AC-2: a fetchFn that throws synchronously is still caught', async () => {
  const fetchFn = () => {
    throw new Error('sync boom');
  };
  const r = await sendNotification({ url: 'x' }, { fetchFn });
  assert.equal(r.ok, false);
  assert.match(r.error, /sync boom/);
});

test('@unit AC-2: exceeding timeoutMs resolves { ok: false, error: "timeout" } without blocking', async () => {
  // A fetchFn that never resolves — only the timeout can settle the race.
  const fetchFn = () => new Promise(() => {});
  const started = Date.now();
  const r = await sendNotification({ url: 'x' }, { fetchFn, timeoutMs: 50 });
  const elapsed = Date.now() - started;
  assert.deepEqual(r, { ok: false, error: 'timeout' });
  assert.ok(elapsed < 1000, `settled promptly at the timeout (took ${elapsed}ms)`);
});

test('@unit AC-2: timeout aborts the in-flight request (AbortController wired)', async () => {
  let abortSeen = false;
  const fetchFn = (_url, opts) =>
    new Promise((_resolve, reject) => {
      if (opts && opts.signal) {
        opts.signal.addEventListener('abort', () => {
          abortSeen = true;
          reject(new Error('aborted'));
        });
      }
    });
  const r = await sendNotification({ url: 'x' }, { fetchFn, timeoutMs: 30 });
  assert.deepEqual(r, { ok: false, error: 'timeout' });
  assert.equal(abortSeen, true, 'the request was aborted on timeout');
});
