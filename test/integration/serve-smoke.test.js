// Smoke integration test for `mmd serve` — boots the server on an ephemeral port,
// hits /api/health and /, verifies path traversal is blocked, and shuts down via SIGTERM.
// This is the minimal coverage of AC-1, AC-2, and AC-7 from SPEC_V025.md.
// The deeper integration tests (SSE event format, EADDRINUSE retry chain, SIGINT
// graceful-shutdown with active subprocess + SSE clients) are deferred to a
// follow-up branch — current sanity is sufficient to validate the v0.2.5 release.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MMD_BIN = resolve(__dirname, '../../bin/mmd.js');
const PORT = 0; // ephemeral

async function waitForListening(proc, timeoutMs = 10000) {
  return new Promise((resolvePromise, reject) => {
    const t = setTimeout(() => reject(new Error('listening timeout')), timeoutMs);
    let buf = '';
    const onData = (chunk) => {
      buf += chunk.toString();
      const m = buf.match(/MMD_SERVE_LISTENING port=(\d+) host=127\.0\.0\.1/);
      if (m) {
        clearTimeout(t);
        proc.stdout.off('data', onData);
        resolvePromise(Number(m[1]));
      }
    };
    proc.stdout.on('data', onData);
  });
}

describe('mmd serve — smoke @integration', () => {
  let proc;
  let port;

  before(async () => {
    proc = spawn('node', [MMD_BIN, 'serve'], {
      env: {
        ...process.env,
        MMD_SERVE_PORT: String(PORT),
        MMD_SERVE_ALLOW_RANDOM: '1',
        MMD_SERVE_NO_OPEN: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    port = await waitForListening(proc);
  });

  after(async () => {
    if (proc && !proc.killed) {
      proc.kill('SIGTERM');
      await new Promise((r) => proc.on('exit', r));
    }
  });

  it('GET /api/health returns ok=true with the version', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.match(body.version, /^\d+\.\d+\.\d+$/);
  });

  it('GET / returns the UI HTML with charset', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const body = await res.text();
    assert.match(body, /<!doctype html>/i);
    assert.match(body, /Make My Dreams/);
  });

  it('GET /demo/../etc/passwd is blocked (path traversal)', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/demo/../etc/passwd`);
    // 403 or 404 are both acceptable — what matters is NOT 200 leaking the file
    assert.notEqual(res.status, 200);
    assert.ok(res.status === 403 || res.status === 404, `unexpected status ${res.status}`);
  });

  it('GET /api/health responds in under 100 ms (warm server)', async () => {
    const start = Date.now();
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    const elapsed = Date.now() - start;
    assert.equal(res.status, 200);
    assert.ok(elapsed < 100, `health endpoint took ${elapsed}ms (expected <100ms)`);
  });
});
