// lib/skills/qa/validate-input.js — pre-flight checks for `mmd qa`
// (SPEC_V02G AC-2 + AC-5). Mirrors lib/skills/ship/validate-branch.js but
// WITHOUT the protected-branch refusal — qa is read-only / advisory, so it
// is legitimate to run from main or master too.
//
// SRP (universal.md §I.S): owns git probes (repo? current branch? HEAD SHA?)
// only. Does NOT spawn claude. Does NOT touch the filesystem outside git.
//
// Security (security.md §I.A03): every git call uses spawn with args-array,
// shell=false.

import { spawn } from 'node:child_process';

/**
 * AC-5: qa is a read-only / advisory command. The Project Onboarder
 * discovery gate (checkGate) does NOT apply. Exposed as a module-level
 * constant so bin/mmd.js (or any future gate-aware dispatcher) can
 * structurally consult it.
 */
export const skipDiscoveryGate = true;

/**
 * Minimal git runner. Same shape as lib/skills/ship/validate-branch.js#runGit.
 * Never rejects — returns a typed result.
 *
 * @param {string[]} args
 * @param {string} cwd
 * @returns {Promise<
 *   | { ok: true,  code: number|null, stdout: string, stderr: string }
 *   | { ok: false, error: Error, stderr: string }
 * >}
 */
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

/**
 * Verify cwd is a git repo, resolve target branch + tip SHA. Unlike
 * validateShipTarget, this does NOT enforce protected-branch / prefix
 * rules — qa is advisory and may legitimately run from main.
 *
 * Exit codes (per spec §2 contract for qa):
 *   3 — cwd is not a git repo / cannot resolve current branch or HEAD
 *
 * @param {string} cwd
 * @param {{ branch?: string|null, baseBranch?: string }} [opts]
 * @returns {Promise<
 *   | { ok: true, branch: string, baseBranch: string, sha: string }
 *   | { ok: false, exitCode: 3, message: string }
 * >}
 */
export async function validateQaTarget(cwd, opts = {}) {
  if (typeof cwd !== 'string' || cwd.length === 0) {
    return { ok: false, exitCode: 3, message: 'mmd qa: internal error — cwd is required' };
  }

  const inside = await runGit(['rev-parse', '--is-inside-work-tree'], cwd);
  if (!inside.ok) {
    return {
      ok: false,
      exitCode: 3,
      message:
        `mmd qa requires the current directory to be a git repository, ` +
        `but git could not run: ${inside.error.message}. ` +
        `Install git or cd into a git repo first.`,
    };
  }
  if (inside.code !== 0 || inside.stdout.trim() !== 'true') {
    return {
      ok: false,
      exitCode: 3,
      message:
        'mmd qa requires the current directory to be a git repository ' +
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
        message: `mmd qa: could not read current branch: ${
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
        'mmd qa: current branch is empty — detached HEAD? ' +
        'Checkout a branch or pass <branch> explicitly.',
    };
  }
  if (/\s/.test(branch) || branch.startsWith('-')) {
    return {
      ok: false,
      exitCode: 3,
      message: `mmd qa: refusing branch with suspicious characters: '${branch}'`,
    };
  }

  const rev = await runGit(['rev-parse', 'HEAD'], cwd);
  if (!rev.ok || rev.code !== 0) {
    return {
      ok: false,
      exitCode: 3,
      message: `mmd qa: could not read HEAD SHA: ${
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
