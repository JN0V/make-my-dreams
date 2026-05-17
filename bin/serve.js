#!/usr/bin/env node
// bin/serve.js — `mmd serve` CLI subcommand entrypoint (v0.2.5).
// SRP (constitution §I.S): env parsing + lifecycle (boot, browser-open, shutdown).
// All HTTP routing / SSE / spawning lives in lib/server.js.
//
// Per SPEC_V025.md AC-1, AC-1b, AC-1c, AC-8.

import { env, stdout, stderr, exit, cwd } from 'node:process';
import { spawn } from 'node:child_process';
import { platform } from 'node:os';

import { createServer } from '../lib/server.js';

/**
 * Parse and validate MMD_SERVE_PORT per AC-1b.
 * Returns the validated port number or throws an Error with err.mmdExitCode=2.
 */
export function parseServePort(rawValue) {
  if (rawValue === undefined || rawValue === '') return 3000;
  const trimmed = String(rawValue).trim();
  // Reject non-integer / non-finite values.
  if (!/^\d+$/.test(trimmed) && !/^-\d+$/.test(trimmed)) {
    const e = new Error(
      `MMD_SERVE_PORT must be an integer between 1 and 65535 (got: "${rawValue}")`
    );
    e.mmdExitCode = 2;
    throw e;
  }
  const n = Number(trimmed);
  if (!Number.isInteger(n)) {
    const e = new Error(
      `MMD_SERVE_PORT must be an integer between 1 and 65535 (got: "${rawValue}")`
    );
    e.mmdExitCode = 2;
    throw e;
  }
  if (n === 0) {
    if (env.MMD_SERVE_ALLOW_RANDOM === '1') return 0;
    const e = new Error('Port 0 (random) requires MMD_SERVE_ALLOW_RANDOM=1.');
    e.mmdExitCode = 2;
    throw e;
  }
  if (n < 1 || n > 65535) {
    const e = new Error(
      `MMD_SERVE_PORT must be an integer between 1 and 65535 (got: "${rawValue}")`
    );
    e.mmdExitCode = 2;
    throw e;
  }
  return n;
}

/**
 * Best-effort browser-open per AC-1. Swallows ENOENT (an absent opener is not a failure).
 * Returns true if the opener was spawned, false otherwise.
 */
export function tryOpenBrowser(url) {
  if (env.MMD_SERVE_NO_OPEN === '1') return false;
  let opener;
  const args = [];
  const plat = platform();
  if (plat === 'darwin') {
    opener = 'open';
    args.push(url);
  } else if (plat === 'win32') {
    // `start` is a cmd built-in, so spawn cmd with /c. First arg "" is the window title.
    opener = 'cmd';
    args.push('/c', 'start', '""', url);
  } else {
    opener = 'xdg-open';
    args.push(url);
  }
  try {
    const child = spawn(opener, args, { detached: true, stdio: 'ignore' });
    // Detach so the child does not keep our event loop alive.
    child.unref();
    // ENOENT surfaces asynchronously via 'error' — swallow it (best-effort).
    child.on('error', () => {
      // Documented: opener absence is not a failure. Print the URL.
      stderr.write(`(could not auto-open browser; visit ${url} manually)\n`);
    });
    return true;
  } catch (err) {
    // Spawn-throw is rare (ENOENT typically arrives via 'error' event), but if it happens:
    stderr.write(`(could not auto-open browser: ${err.message}; visit ${url} manually)\n`);
    return false;
  }
}

/**
 * Entry point. Returns an exit code.
 */
export async function runServe(/* args */) {
  let requestedPort;
  try {
    requestedPort = parseServePort(env.MMD_SERVE_PORT);
  } catch (err) {
    stderr.write(`error: ${err.message}\n`);
    return err.mmdExitCode ?? 2;
  }
  const explicitPort = env.MMD_SERVE_PORT !== undefined && env.MMD_SERVE_PORT !== '';

  // AC-1: announce intent (the listening line comes later, on the `listening` event).
  stdout.write(`Starting Make My Dreams server on http://localhost:${requestedPort || '<random>'}\n`);

  let server;
  try {
    server = await createServer({
      port: requestedPort,
      explicitPort,
      cwd: cwd(),
    });
  } catch (err) {
    stderr.write(`error: ${err.message}\n`);
    return err.mmdExitCode ?? 3;
  }

  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : requestedPort;
  const url = `http://localhost:${port}/`;
  tryOpenBrowser(url);

  // Graceful shutdown (AC-1c).
  let shuttingDown = false;
  const onSignal = (sig) => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.shutdown(sig).then(() => {
      stdout.write('À bientôt ! / Bye!\n');
      exit(0);
    }).catch((err) => {
      stderr.write(`shutdown error: ${err.message}\n`);
      exit(1);
    });
  };
  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('SIGTERM', () => onSignal('SIGTERM'));

  // Keep the event loop alive — the server's listening socket already does this,
  // but resolve a never-settling promise so the dispatcher (bin/mmd.js) doesn't exit.
  return new Promise(() => {});
}

// Allow direct invocation (`node bin/serve.js`) as well as dispatch from bin/mmd.js.
if (import.meta.url === `file://${process.argv[1]}`) {
  runServe(process.argv.slice(2))
    .then((code) => { if (typeof code === 'number') exit(code); })
    .catch((err) => {
      stderr.write(`fatal: ${err.stack || err.message || String(err)}\n`);
      exit(99);
    });
}
