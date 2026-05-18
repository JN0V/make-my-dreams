// lib/skills/cso/validate-input.js — pre-flight checks for `mmd cso`
// (SPEC_V02G AC-3 + AC-5). Same shape as lib/skills/qa/validate-input.js:
// read-only / advisory, no protected-branch refusal.
//
// SRP (universal.md §I.S): git probes only.
// DRY (universal.md §III): the git-runner shape is duplicated rather than
// abstracted — KISS, three call-sites of a 25-line helper is below the
// "duplication proven" threshold.

import { spawn } from 'node:child_process';

/**
 * AC-5: cso is read-only / advisory — bypass the discovery gate.
 */
export const skipDiscoveryGate = true;

function runGit(args, cwd) {
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
    const settle = (r) => { if (!settled) { settled = true; resolve(r); } };
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

/**
 * @param {string} cwd
 * @param {{ branch?: string|null, baseBranch?: string }} [opts]
 * @returns {Promise<
 *   | { ok: true, branch: string, baseBranch: string, sha: string }
 *   | { ok: false, exitCode: 3, message: string }
 * >}
 */
export async function validateCsoTarget(cwd, opts = {}) {
  if (typeof cwd !== 'string' || cwd.length === 0) {
    return { ok: false, exitCode: 3, message: 'mmd cso: internal error — cwd is required' };
  }
  const inside = await runGit(['rev-parse', '--is-inside-work-tree'], cwd);
  if (!inside.ok) {
    return {
      ok: false,
      exitCode: 3,
      message:
        `mmd cso requires the current directory to be a git repository, ` +
        `but git could not run: ${inside.error.message}. ` +
        `Install git or cd into a git repo first.`,
    };
  }
  if (inside.code !== 0 || inside.stdout.trim() !== 'true') {
    return {
      ok: false,
      exitCode: 3,
      message:
        'mmd cso requires the current directory to be a git repository ' +
        '(run `git init` or cd into one).',
    };
  }
  let branch = opts && typeof opts.branch === 'string' ? opts.branch : null;
  if (!branch) {
    const cur = await runGit(['branch', '--show-current'], cwd);
    if (!cur.ok || cur.code !== 0) {
      return {
        ok: false,
        exitCode: 3,
        message: `mmd cso: could not read current branch: ${
          cur.ok ? cur.stderr.trim() || 'unknown error' : cur.error.message
        }`,
      };
    }
    branch = cur.stdout.trim();
  }
  if (!branch || branch.length === 0) {
    return {
      ok: false,
      exitCode: 3,
      message:
        'mmd cso: current branch is empty — detached HEAD? ' +
        'Checkout a branch or pass <branch> explicitly.',
    };
  }
  if (/\s/.test(branch) || branch.startsWith('-')) {
    return {
      ok: false,
      exitCode: 3,
      message: `mmd cso: refusing branch with suspicious characters: '${branch}'`,
    };
  }
  const rev = await runGit(['rev-parse', 'HEAD'], cwd);
  if (!rev.ok || rev.code !== 0) {
    return {
      ok: false,
      exitCode: 3,
      message: `mmd cso: could not read HEAD SHA: ${
        rev.ok ? rev.stderr.trim() || 'unknown error' : rev.error.message
      }`,
    };
  }
  const sha = rev.stdout.trim();
  const baseBranch =
    (opts && typeof opts.baseBranch === 'string' && opts.baseBranch.length > 0)
      ? opts.baseBranch
      : 'main';
  return { ok: true, branch, baseBranch, sha };
}
