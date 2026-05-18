// lib/skills/qa/validate-input.js — pre-flight checks for `mmd qa`
// (SPEC_V02G AC-2 + AC-5). Mirrors lib/skills/ship/validate-branch.js but
// WITHOUT the protected-branch refusal — qa is read-only / advisory, so it
// is legitimate to run from main or master too.
//
// SRP (universal.md §I.S): owns git probes (repo? current branch? HEAD SHA?)
// only. Does NOT spawn claude. Does NOT touch the filesystem outside git.
//
// Security (security.md §I.A03): every git call uses spawn with args-array,
// shell=false (delegated to lib/skills/_common/git.js#runGit since v0.2.g F9).

// AC-5 gate bypass for qa is structural: bin/mmd.js dispatches 'qa' BEFORE
// checkGate() runs in main(). The previous `skipDiscoveryGate` export was a
// vestigial marker never read by any caller and was removed in v0.2.g per F5
// (Phase-4 adversarial review) — KISS / YAGNI per universal.md §II.
//
// F9 (Phase-4 review): runGit was duplicated across 4 validators; now lives
// in lib/skills/_common/git.js (DRY per universal.md §III).

import { runGit } from '../_common/git.js';

/**
 * Verify cwd is a git repo, resolve target branch + tip SHA. Unlike
 * validateShipTarget, this does NOT enforce protected-branch / prefix
 * rules — qa is advisory and may legitimately run from main.
 *
 * Exit codes (per spec §2 contract for qa):
 *   2 — user error: branch contains suspicious characters (F14 review)
 *   3 — environment error: not a git repo, git unavailable, empty HEAD
 *
 * @param {string} cwd
 * @param {{ branch?: string|null, baseBranch?: string }} [opts]
 * @returns {Promise<
 *   | { ok: true, branch: string, baseBranch: string, sha: string }
 *   | { ok: false, exitCode: 2|3, message: string }
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
    // F14 (Phase-4 review): a user-supplied branch with suspicious characters
    // is a USER ERROR (exit 2), not an environment error (exit 3). Exit 3 is
    // reserved for "git unavailable / no repo / empty HEAD" — situations the
    // user can't fix by changing their input.
    return {
      ok: false,
      exitCode: 2,
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
