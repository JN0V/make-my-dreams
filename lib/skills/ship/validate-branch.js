// lib/ship/validate-branch.js — pre-flight checks for `mmd ship` (SPEC_V02F AC-3).
//
// SRP: owns git-status / branch-protection probes only. It does not invoke
// claude, does not write logs. Every failure returns a typed result so the
// caller can map it to spec'd exit codes (3 = not a git repo, 4 = protected
// branch).
//
// Security (security.md §I.A03): every git invocation goes through spawn
// with an args-array, shell=false. We never interpolate branch names into a
// command string. Branch names provided by the user (via `mmd ship <branch>`)
// flow into argv-array elements — safe even with adversarial input.
//
// Public API:
//   - PROTECTED_BRANCHES                (constant)
//   - ALLOWED_BRANCH_PREFIXES           (constant)
//   - isProtectedBranch(name)           -> boolean
//   - isAllowedBranchPrefix(name)       -> boolean
//   - validateBranchName(name)          -> { ok, exitCode?, message? }   (pure)
//   - validateShipTarget(cwd, opts?)    -> Promise<{ ok, branch?, base?, sha?, exitCode?, message? }>

import { spawn } from 'node:child_process';

/** Branches MMD refuses to ship FROM directly. */
export const PROTECTED_BRANCHES = Object.freeze(['main', 'master']);

/** Branch-name prefixes MMD recognizes as ship-eligible. */
export const ALLOWED_BRANCH_PREFIXES = Object.freeze([
  'slice/',
  'feat/',
  'fix/',
  'docs/',
  'chore/',
  'refactor/',
  'test/',
]);

/**
 * Pure predicate: is `name` in the protected list?
 *
 * @param {string} name
 * @returns {boolean}
 */
export function isProtectedBranch(name) {
  if (typeof name !== 'string') return false;
  return PROTECTED_BRANCHES.includes(name);
}

/**
 * Pure predicate: does `name` start with one of the allowed prefixes?
 *
 * @param {string} name
 * @returns {boolean}
 */
export function isAllowedBranchPrefix(name) {
  if (typeof name !== 'string' || name.length === 0) return false;
  return ALLOWED_BRANCH_PREFIXES.some((p) => name.startsWith(p));
}

/**
 * Pure validation of a branch name. Used by both the bare `mmd ship` path
 * (where the branch comes from `git branch --show-current`) and the explicit
 * `mmd ship <branch>` path (where the user provides it).
 *
 * Rules:
 *   - Non-empty string (else exit 4 — usage error class per error-handling.md §II).
 *   - No whitespace, no leading dash (defensive, even though our spawn is shell-safe).
 *   - Not in PROTECTED_BRANCHES (exit 4).
 *   - Starts with one of ALLOWED_BRANCH_PREFIXES (exit 4 with explanation).
 *
 * @param {string} name
 * @returns {{ ok: true, name: string } | { ok: false, exitCode: 4, message: string }}
 */
export function validateBranchName(name) {
  if (typeof name !== 'string' || name.length === 0) {
    return {
      ok: false,
      exitCode: 4,
      message: 'mmd ship: branch name is empty (run from a checked-out branch or pass <branch>).',
    };
  }
  if (/\s/.test(name) || name.startsWith('-')) {
    return {
      ok: false,
      exitCode: 4,
      message: `mmd ship: refusing branch with suspicious characters: '${name}'`,
    };
  }
  if (isProtectedBranch(name)) {
    return {
      ok: false,
      exitCode: 4,
      message:
        `mmd ship: '${name}' is a protected branch — refusing to ship FROM it. ` +
        `Create a slice/* or feat/* branch and re-run.`,
    };
  }
  if (!isAllowedBranchPrefix(name)) {
    return {
      ok: false,
      exitCode: 4,
      message:
        `mmd ship: branch '${name}' does not match an allowed prefix (` +
        `${ALLOWED_BRANCH_PREFIXES.join(', ')}). ` +
        `Rename the branch or override (future).`,
    };
  }
  return { ok: true, name };
}

/**
 * Minimal git runner — same shape as lib/here-mode.js#runGit. Always
 * shell=false, returns a typed result, never rejects.
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
        const err = new Error(`git terminated by signal: ${signal}`);
        settle({ ok: false, error: err, stderr });
        return;
      }
      settle({ ok: true, code, stdout, stderr });
    });
  });
}

/**
 * AC-3 entry point — verify cwd is a git repo, resolve the branch to ship
 * (defaulting to `git branch --show-current` when `opts.branch` is omitted),
 * validate it against the protection list, and capture base + tip SHA for
 * downstream prompt construction.
 *
 * Exit-code contract per SPEC_V02F AC-3:
 *   - exit 3 : cwd is not a git repo (or git is missing)
 *   - exit 4 : branch is empty / protected / not on an allowed prefix
 *
 * The base branch defaults to 'main' (overridable via `opts.baseBranch`) —
 * the spec leaves this implicit; we pick 'main' to match every existing MMD
 * slice today.
 *
 * @param {string} cwd
 * @param {{ branch?: string|null, baseBranch?: string }} [opts]
 * @returns {Promise<
 *   | { ok: true, branch: string, baseBranch: string, sha: string }
 *   | { ok: false, exitCode: 3|4, message: string }
 * >}
 */
export async function validateShipTarget(cwd, opts = {}) {
  if (typeof cwd !== 'string' || cwd.length === 0) {
    return {
      ok: false,
      exitCode: 3,
      message: 'mmd ship: internal error — cwd is required',
    };
  }

  // 1. git repo? rev-parse --is-inside-work-tree is the canonical probe.
  const inside = await runGit(['rev-parse', '--is-inside-work-tree'], cwd);
  if (!inside.ok) {
    return {
      ok: false,
      exitCode: 3,
      message:
        `mmd ship requires the current directory to be a git repository, ` +
        `but git could not run: ${inside.error.message}. ` +
        `Install git or cd into a git repo first.`,
    };
  }
  if (inside.code !== 0 || inside.stdout.trim() !== 'true') {
    return {
      ok: false,
      exitCode: 3,
      message:
        'mmd ship requires the current directory to be a git repository ' +
        '(run `git init` or cd into one).',
    };
  }

  // 2. resolve branch — caller-provided or `git branch --show-current`.
  let branch = opts && typeof opts.branch === 'string' ? opts.branch : null;
  if (!branch) {
    const cur = await runGit(['branch', '--show-current'], cwd);
    if (!cur.ok || cur.code !== 0) {
      return {
        ok: false,
        exitCode: 3,
        message: `mmd ship: could not read current branch: ${
          cur.ok ? cur.stderr.trim() || 'unknown error' : cur.error.message
        }`,
      };
    }
    branch = cur.stdout.trim();
  }

  // 3. branch-name guard (protected / prefix / shape).
  const check = validateBranchName(branch);
  if (!check.ok) return check;

  // 4. capture tip SHA for the prompt.
  const rev = await runGit(['rev-parse', 'HEAD'], cwd);
  if (!rev.ok || rev.code !== 0) {
    return {
      ok: false,
      exitCode: 3,
      message: `mmd ship: could not read HEAD SHA: ${
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
