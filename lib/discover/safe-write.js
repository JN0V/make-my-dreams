// lib/discover/safe-write.js — non-intrusion guard for the Project Onboarder.
//
// SRP (universal.md §I.S): one function — `assertSafeWritePath` — that decides
// whether a given write is permitted by the v0.2c non-intrusion invariant.
//
// Spec: SPEC_V02C §1 + §5 risks. The onboarder writes ONLY in:
//   (a) <targetDir>/.mmd/   (team-shared OR local — both gitignored or
//                            commit-on-purpose per §6.8; in any case below
//                            .mmd/ they belong to the onboarder)
//   (b) <targetDir>/mmd-discovery-report.md   (the root report)
//   (c) <targetDir>/docs/<NEW file>           (NEW files only — NEVER
//                                              overwriting an existing user
//                                              doc; checked at call time with
//                                              `mustNotExist: true`)
//
// Security (security.md §I.A03 + path-traversal defense): every candidate path
// is resolved + compared to the target dir with a path.sep boundary so that
// `..` sequences and absolute-path escapes are rejected loudly. This mirrors
// the pattern in bin/mmd.js for `--fresh` (refuse to rm outside ./demo/).
//
// Callers MUST use `assertSafeWritePath` BEFORE every fs.writeFile / fs.mkdir
// / fs.copyFile in lib/discover/*. The function throws a typed Error so the
// failure path is unmissable (it cannot be silently swallowed by an `await`
// with no try/catch).

import { resolve, sep } from 'node:path';
import { lstat } from 'node:fs/promises';

/**
 * Pure-ish check: is `candidatePath` an allowed write under `targetDir`?
 *
 * Throws (does not return a boolean) so callers get a stack trace pointing at
 * the offending line — defensive programming per error-handling.md §I.
 *
 * Rules:
 *  - candidatePath MUST resolve to a path under absolute(targetDir).
 *  - It must EITHER live under <targetDir>/.mmd/, OR be exactly
 *    <targetDir>/mmd-discovery-report.md, OR be under <targetDir>/docs/.
 *  - When `mustNotExist: true` is passed, the path is additionally required
 *    to NOT yet exist on disk (the "NEW files only" rule for docs/).
 *  - Symlinks at the candidate path (or any intermediate component the caller
 *    has materialized) are rejected — they're the canonical brownfield bypass.
 *
 * @param {string} targetDir         absolute path to the target repo root
 * @param {string} candidatePath     absolute path the caller wants to write to
 * @param {object} [opts]
 * @param {boolean} [opts.mustNotExist]  reject if the file already exists
 * @returns {Promise<void>}          resolves silently on success
 * @throws  {Error}                  with a descriptive message on any violation
 */
export async function assertSafeWritePath(targetDir, candidatePath, opts = {}) {
  if (typeof targetDir !== 'string' || targetDir.length === 0) {
    throw new Error('assertSafeWritePath: targetDir must be a non-empty string');
  }
  if (typeof candidatePath !== 'string' || candidatePath.length === 0) {
    throw new Error('assertSafeWritePath: candidatePath must be a non-empty string');
  }

  const absTarget = resolve(targetDir);
  const absCandidate = resolve(candidatePath);

  // Boundary check: candidate MUST be strictly inside targetDir. The path.sep
  // suffix prevents the classic "/foo" + "/foobar" prefix-match bypass.
  if (!isInside(absCandidate, absTarget)) {
    throw new Error(
      `non-intrusion violation: write path '${absCandidate}' escapes target '${absTarget}'`,
    );
  }

  const mmdRoot = absTarget + sep + '.mmd' + sep;
  const reportPath = absTarget + sep + 'mmd-discovery-report.md';
  const docsRoot = absTarget + sep + 'docs' + sep;

  const underMmd = absCandidate.startsWith(mmdRoot);
  const isReport = absCandidate === reportPath;
  const underDocs = absCandidate.startsWith(docsRoot);

  if (!(underMmd || isReport || underDocs)) {
    throw new Error(
      `non-intrusion violation: '${absCandidate}' is not under .mmd/, ` +
      `docs/, or the root mmd-discovery-report.md`,
    );
  }

  // Symlink defense: if the candidate already exists as a symlink, refuse to
  // write through it (could redirect anywhere on the FS). Same defense as
  // bin/mmd.js's --fresh path.
  const lst = await lstat(absCandidate).catch(() => null);
  if (lst && lst.isSymbolicLink()) {
    throw new Error(
      `non-intrusion violation: refusing to write through symlink at '${absCandidate}'`,
    );
  }

  // Docs/ "NEW files only" rule: if we're writing under docs/, the file MUST
  // NOT already exist (the onboarder never overwrites existing user docs).
  // The .mmd/ tree is owned by the onboarder so overwrites there are fine.
  if (underDocs || opts.mustNotExist) {
    if (lst && !lst.isSymbolicLink()) {
      // lst is a regular file or directory — both are an "already exists" violation.
      throw new Error(
        `non-intrusion violation: '${absCandidate}' already exists — ` +
        `the onboarder never overwrites existing user files (docs/ is NEW-only)`,
      );
    }
  }
}

/**
 * Pure predicate: is `child` strictly inside `parent`? Used internally by
 * assertSafeWritePath and exported for tests + the gate module.
 *
 * @param {string} child   absolute path
 * @param {string} parent  absolute path
 * @returns {boolean}
 */
export function isInside(child, parent) {
  if (typeof child !== 'string' || typeof parent !== 'string') return false;
  if (child === parent) return false; // equality is not "inside"
  return child.startsWith(parent + sep);
}
