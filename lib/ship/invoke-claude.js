// lib/ship/invoke-claude.js — spawn `claude -p` with PATH forced to include
// ~/.bun/bin, tee output to .mmd/local/ship-runs/<ts>.log (SPEC_V02F AC-4).
//
// Per docs/lessons-learned.md L-012: gStack skills require bun, and bun
// lives at $HOME/.bun/bin/bun. Non-interactive subprocesses do not inherit
// the user's interactive PATH, so we MUST prepend $HOME/.bun/bin explicitly
// in env.PATH before spawning claude. The shim bin/mmd also does this for
// the parent process; this module guarantees the same for the child.
//
// Security (security.md §I.A03): spawn with args-array, shell=false. The
// prompt is passed as a single argv element — no shell interpolation. The
// env passed to the subprocess is allowlist-filtered via
// lib/invoke-autodev.js#buildSubprocessEnv to avoid leaking secrets.
//
// Observability (observability.md): all subprocess stdout/stderr is tee'd to
// .mmd/local/ship-runs/<timestamp>.log. The log path is returned so callers
// can include it in their summary.

import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { buildSubprocessEnv } from '../invoke-autodev.js';

/**
 * Build the env object to pass to spawn() for a ship invocation.
 *
 * 1. Start from the allowlisted parent env (PATH, HOME, MMD_*, CLAUDE_*, ...).
 * 2. Prepend $HOME/.bun/bin to PATH — guarantees claude -p can resolve bun.
 *
 * Pure-ish (depends only on its argument). Exported for unit testability.
 *
 * @param {NodeJS.ProcessEnv} [parentEnv]
 * @returns {Record<string, string>}
 */
export function buildShipEnv(parentEnv = process.env) {
  const env = buildSubprocessEnv(parentEnv);
  const home = env.HOME || parentEnv.HOME || os.homedir();
  const bunBin = path.join(home, '.bun', 'bin');
  const existingPath = env.PATH || parentEnv.PATH || '';
  // Idempotent: only prepend if not already at the very front.
  if (!existingPath.startsWith(bunBin + path.delimiter) && existingPath !== bunBin) {
    env.PATH = existingPath ? `${bunBin}${path.delimiter}${existingPath}` : bunBin;
  } else {
    env.PATH = existingPath;
  }
  return env;
}

/**
 * Build the argv list passed to spawn(). Exported for tests.
 *
 * The contract matches the SPEC_V02F AC-4 invocation:
 *   claude -p --output-format text "<prompt>"
 *
 * @param {string} prompt
 * @returns {string[]}
 */
export function buildShipArgs(prompt) {
  if (typeof prompt !== 'string' || prompt.length === 0) {
    throw new TypeError('buildShipArgs: prompt must be a non-empty string');
  }
  return ['-p', '--output-format', 'text', prompt];
}

/**
 * Compute the log path for a ship run. Pure-ish (depends on Date by default,
 * deterministic when `now` is injected).
 *
 * @param {string} repoRoot
 * @param {() => Date} [now]
 * @returns {string} absolute path
 */
export function shipLogPath(repoRoot, now = () => new Date()) {
  const ts = now().toISOString().replace(/[:.]/g, '-');
  return path.join(repoRoot, '.mmd', 'local', 'ship-runs', `${ts}-${process.pid}.log`);
}

/**
 * Spawn `claude -p --output-format text "<prompt>"` with PATH=$HOME/.bun/bin:$PATH
 * and tee its stdout/stderr to the log path.
 *
 * Resolves with `{ code, signal, logPath, durationSeconds }`. Per L-006 we do
 * NOT translate exit-code null (timeout/killed) into a rejection — the caller
 * decides what to do based on the git state.
 *
 * @param {{
 *   prompt: string,
 *   cwd: string,
 *   logPath: string,
 *   timeoutMs?: number,
 *   quiet?: boolean,
 *   command?: string,       // override for tests (default: 'claude')
 *   envOverride?: Record<string, string>, // override for tests
 * }} opts
 * @returns {Promise<{
 *   code: number | null,
 *   signal: string | null,
 *   logPath: string,
 *   durationSeconds: number,
 * }>}
 */
export async function invokeClaudeShip(opts) {
  if (!opts || typeof opts !== 'object') {
    throw new TypeError('invokeClaudeShip: opts must be an object');
  }
  const {
    prompt,
    cwd,
    logPath,
    timeoutMs,
    quiet = false,
    command = process.env.MMD_SHIP_CMD || 'claude',
    envOverride,
  } = opts;
  if (typeof prompt !== 'string' || prompt.length === 0) {
    throw new TypeError('invokeClaudeShip: prompt must be a non-empty string');
  }
  if (typeof cwd !== 'string' || cwd.length === 0) {
    throw new TypeError('invokeClaudeShip: cwd must be a non-empty string');
  }
  if (typeof logPath !== 'string' || logPath.length === 0) {
    throw new TypeError('invokeClaudeShip: logPath must be a non-empty string');
  }

  await mkdir(path.dirname(logPath), { recursive: true });

  const env = envOverride || buildShipEnv(process.env);
  const args = buildShipArgs(prompt);

  return new Promise((resolve, reject) => {
    let child;
    let logStream;
    let killTimer = null;
    let sigkillTimer = null;
    let settled = false;
    let timedOut = false;
    const startNs = process.hrtime.bigint();

    // Wait for the log stream to finish writing before resolving, otherwise
    // a caller that reads logPath synchronously after the promise resolves
    // may read a truncated file. This race surfaced under concurrent
    // node --test load (red-green per testing.md §III).
    const settle = (val) => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      if (sigkillTimer) clearTimeout(sigkillTimer);
      if (logStream) {
        logStream.once('finish', () => resolve(val));
        logStream.end();
      } else {
        resolve(val);
      }
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      if (sigkillTimer) clearTimeout(sigkillTimer);
      if (logStream) {
        logStream.once('finish', () => reject(err));
        logStream.end();
      } else {
        reject(err);
      }
    };

    try {
      logStream = createWriteStream(logPath, { flags: 'a' });
    } catch (err) {
      err.mmdExitCode = err.mmdExitCode ?? 99;
      reject(err);
      return;
    }

    try {
      child = spawn(command, args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
        shell: false,
      });
    } catch (err) {
      err.mmdExitCode = 4;
      err.message =
        `mmd ship: failed to spawn '${command}': ${err.message}. ` +
        `Install Claude Code or set MMD_SHIP_CMD to a test fixture.`;
      if (logStream) logStream.end();
      reject(err);
      return;
    }

    child.stdout.on('data', (chunk) => {
      if (!quiet) process.stdout.write(chunk);
      logStream.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      if (!quiet) process.stderr.write(chunk);
      logStream.write(chunk);
    });

    child.on('error', (err) => {
      if (err && err.code === 'ENOENT') {
        err.mmdExitCode = 4;
        err.message =
          `mmd ship: '${command}' not found on PATH. ` +
          `Install Claude Code or set MMD_SHIP_CMD to a test fixture.`;
      } else {
        err.mmdExitCode = err.mmdExitCode ?? 99;
      }
      fail(err);
    });

    if (typeof timeoutMs === 'number' && timeoutMs > 0) {
      killTimer = setTimeout(() => {
        timedOut = true;
        try { child.kill('SIGTERM'); } catch { /* already dead */ }
        sigkillTimer = setTimeout(() => {
          try { child.kill('SIGKILL'); } catch { /* already dead */ }
        }, 5000);
        try { logStream.write('\n[mmd ship] subprocess timed out\n'); }
        catch { /* stream closed */ }
      }, timeoutMs);
    }

    child.on('exit', (code, signal) => {
      const durationSeconds = Number(process.hrtime.bigint() - startNs) / 1e9;
      if (timedOut) {
        settle({ code: null, signal: signal || 'SIGTERM', logPath, durationSeconds });
        return;
      }
      settle({ code, signal, logPath, durationSeconds });
    });
  });
}
