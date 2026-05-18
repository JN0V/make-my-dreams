// lib/skills/document-release/validate-input.js — pre-flight checks for
// `mmd document-release` (SPEC_V02G AC-4 + AC-5).
//
// SRP (universal.md §I.S): resolves the <from> and <to> refs into concrete
// commits via git. Does NOT spawn claude, does NOT write any output file.
//
// Exit-code contract (per SPEC_V02G AC-4):
//   3 — cwd is not a git repo / git unavailable
//   4 — `<from>` or `<to>` is not a real ref (or default `<from>` cannot be
//        derived because the repo has no tags yet)
//
// Security (security.md §I.A03): spawn('git', args[], shell=false). Refs
// flow into argv-elements only — never into a shell string.

// AC-5 gate bypass for document-release is structural: bin/mmd.js dispatches
// 'document-release' BEFORE checkGate() runs. The vestigial
// `skipDiscoveryGate` export was removed in v0.2.g per F5 (Phase-4 review).
//
// F9 (Phase-4 review): runGit was duplicated across 4 validators; now lives
// in lib/skills/_common/git.js (DRY per universal.md §III).

import { runGit } from '../_common/git.js';

/**
 * Pure predicate: refuse refs with shell-suspicious shapes. Even though we
 * already spawn with shell=false, defense-in-depth (F8 Phase-4 review) rejects
 * any character that would be dangerous in a shell context — guards against a
 * future regression where the spawn config drifts to `shell: true`.
 *
 * Rejected:
 *   - empty string / non-string
 *   - leading dash `-`        (git would interpret as a flag)
 *   - whitespace              (\s — spaces, tabs, newlines)
 *   - shell metacharacters    `;` `|` `&` `$` `` ` `` `<` `>`
 *   - control characters      `\r` `\n` `\0`
 *
 * @param {string} ref
 * @returns {boolean}
 */
export function isSuspiciousRef(ref) {
  if (typeof ref !== 'string' || ref.length === 0) return true;
  if (ref.startsWith('-')) return true;
  if (/\s/.test(ref)) return true;
  // F8: shell-metacharacter + control-char blocklist.
  // eslint-disable-next-line no-control-regex
  if (/[;|&$`<>\r\n\0]/.test(ref)) return true;
  return false;
}

/**
 * Validate that cwd is a git repo, resolve `from` and `to` refs to commit
 * SHAs. When `from` is null, default it to `git describe --tags --abbrev=0`
 * (last tag). When `to` is null, default it to `HEAD`.
 *
 * @param {string} cwd
 * @param {{ from?: string|null, to?: string|null }} [opts]
 * @returns {Promise<
 *   | { ok: true, fromRef: string, toRef: string, fromSha: string, toSha: string }
 *   | { ok: false, exitCode: 3|4, message: string }
 * >}
 */
export async function validateDocumentReleaseTarget(cwd, opts = {}) {
  if (typeof cwd !== 'string' || cwd.length === 0) {
    return { ok: false, exitCode: 3, message: 'mmd document-release: internal error — cwd is required' };
  }

  const inside = await runGit(['rev-parse', '--is-inside-work-tree'], cwd);
  if (!inside.ok) {
    return {
      ok: false,
      exitCode: 3,
      message:
        `mmd document-release requires the current directory to be a git ` +
        `repository, but git could not run: ${inside.error.message}. ` +
        `Install git or cd into a git repo first.`,
    };
  }
  if (inside.code !== 0 || inside.stdout.trim() !== 'true') {
    return {
      ok: false,
      exitCode: 3,
      message:
        'mmd document-release requires the current directory to be a git ' +
        'repository (run `git init` or cd into one).',
    };
  }

  let fromRef = opts && typeof opts.from === 'string' && opts.from.length > 0 ? opts.from : null;
  let toRef = opts && typeof opts.to === 'string' && opts.to.length > 0 ? opts.to : null;

  // Default fromRef = `git describe --tags --abbrev=0`.
  if (fromRef === null) {
    const desc = await runGit(['describe', '--tags', '--abbrev=0'], cwd);
    if (!desc.ok) {
      return {
        ok: false,
        exitCode: 4,
        message: `mmd document-release: could not auto-detect last tag: ${desc.error.message}`,
      };
    }
    if (desc.code !== 0) {
      return {
        ok: false,
        exitCode: 4,
        message:
          'mmd document-release: no tags found in this repo — ' +
          'pass <from> explicitly (e.g. `mmd document-release HEAD~10 HEAD`).',
      };
    }
    fromRef = desc.stdout.trim();
    if (!fromRef) {
      return {
        ok: false,
        exitCode: 4,
        message: 'mmd document-release: auto-detected last tag was empty — pass <from> explicitly.',
      };
    }
  }

  if (toRef === null) toRef = 'HEAD';

  // Refuse suspicious shapes BEFORE handing the ref to git rev-parse.
  if (isSuspiciousRef(fromRef)) {
    return {
      ok: false,
      exitCode: 4,
      message: `mmd document-release: refusing suspicious <from> ref: '${fromRef}'`,
    };
  }
  if (isSuspiciousRef(toRef)) {
    return {
      ok: false,
      exitCode: 4,
      message: `mmd document-release: refusing suspicious <to> ref: '${toRef}'`,
    };
  }

  // Validate each ref via `git rev-parse --verify <ref>^{commit}` — fails if
  // the ref doesn't exist OR doesn't resolve to a commit object (e.g. a
  // dangling tag pointing to a tree).
  const fromRev = await runGit(['rev-parse', '--verify', `${fromRef}^{commit}`], cwd);
  if (!fromRev.ok || fromRev.code !== 0) {
    return {
      ok: false,
      exitCode: 4,
      message:
        `mmd document-release: <from> ref '${fromRef}' is not a valid commit: ` +
        `${fromRev.ok ? fromRev.stderr.trim() || 'unknown error' : fromRev.error.message}`,
    };
  }
  const fromSha = fromRev.stdout.trim();

  const toRev = await runGit(['rev-parse', '--verify', `${toRef}^{commit}`], cwd);
  if (!toRev.ok || toRev.code !== 0) {
    return {
      ok: false,
      exitCode: 4,
      message:
        `mmd document-release: <to> ref '${toRef}' is not a valid commit: ` +
        `${toRev.ok ? toRev.stderr.trim() || 'unknown error' : toRev.error.message}`,
    };
  }
  const toSha = toRev.stdout.trim();

  return { ok: true, fromRef, toRef, fromSha, toSha };
}
