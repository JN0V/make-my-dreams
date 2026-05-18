// lib/skills/_common/git.js — shared git runner for skill validators.
//
// F9 (Phase-4 adversarial review): the 25-line `runGit` helper was duplicated
// across qa / cso / document-release / ship validators (4 copies). DRY per
// `universal.md §III` — extracted once duplication was proven.
//
// SRP: spawn `git <args>` with shell=false and return a typed result. Never
// throws; the caller maps the result to its own exit-code contract.
//
// Security (security.md §I.A03): every git invocation goes through spawn
// with an args-array, shell=false. Branch names / refs flow into argv-array
// elements — safe even with adversarial input.

import { spawn } from 'node:child_process';

/**
 * Spawn `git <args>` in `cwd` and resolve with a typed result.
 *
 * @param {string[]} args
 * @param {string} cwd
 * @returns {Promise<
 *   | { ok: true,  code: number|null, stdout: string, stderr: string }
 *   | { ok: false, error: Error, stderr: string }
 * >}
 */
export function runGit(args, cwd) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('git', args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });
    } catch (err) {
      const wrapped = new Error(`failed to spawn git: ${err.message}`);
      wrapped.cause = err;
      resolve({ ok: false, error: wrapped, stderr: '' });
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const settle = (r) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', (err) => {
      const wrapped = new Error(`git invocation failed: ${err.message}`);
      wrapped.cause = err;
      settle({ ok: false, error: wrapped, stderr });
    });
    child.on('exit', (code, signal) => {
      if (signal) {
        settle({ ok: false, error: new Error(`git terminated by signal: ${signal}`), stderr });
        return;
      }
      settle({ ok: true, code, stdout, stderr });
    });
  });
}
