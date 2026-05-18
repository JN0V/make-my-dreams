// lib/skills/cso/validate-input.js — pre-flight checks for `mmd cso`
// (SPEC_V02G AC-3 + AC-5). Same shape as lib/skills/qa/validate-input.js:
// read-only / advisory, no protected-branch refusal.
//
// SRP (universal.md §I.S): git probes only.
// DRY (universal.md §III): the git-runner now lives in
// lib/skills/_common/git.js (v0.2.g F9 — 4 copies was past the
// "duplication proven" threshold).

// AC-5 gate bypass for cso is structural: bin/mmd.js dispatches 'cso' BEFORE
// checkGate() runs. The vestigial `skipDiscoveryGate` export was removed in
// v0.2.g per F5 (Phase-4 adversarial review) — never read by any caller.
//
// F9 (Phase-4 review): runGit was duplicated across 4 validators; now lives
// in lib/skills/_common/git.js (DRY per universal.md §III).

import { runGit } from '../_common/git.js';

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
