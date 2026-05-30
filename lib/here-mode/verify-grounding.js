// lib/here-mode/verify-grounding.js — pure prompt-grounding verifier (SPEC_V02H AC-2).
//
// SRP (universal.md §I.S): given a list of repo-relative paths, a base SHA and
// a repo root, decide which of those paths do NOT exist on the base SHA. It
// does this by asking git `cat-file -e <baseSha>:<file>` per file and reporting
// the subset that exited non-zero.
//
// Purity / testability (mirrors lib/conductor/stall-detector.js): the git
// runner is INJECTABLE (`runGit`), defaulting to a real spawnSync. Tests drive
// the function with a mock runner returning configurable exit codes per file —
// no real git, no real repo needed for the @unit layer.
//
// Pure shape (AC-2): NO process.exit, NO console writes. It returns
// `{ missing: string[] }` and lets the caller (lib/here-mode.js) decide what to
// do (exit 6 with a friendly message, or skip). Failure honesty (universal.md
// §VI): a git invocation that cannot run at all is treated as "missing" — we
// never silently pass a file we could not verify.

import { spawnSync } from 'node:child_process';

/**
 * Default git runner: returns the exit code of `git <args>` run in `cwd`.
 *
 * Never throws. A spawn failure (git missing, ENOENT) or a signal kill yields a
 * non-zero code so the file is conservatively reported missing rather than
 * silently treated as present.
 *
 * @param {string[]} args git arguments (e.g. ['cat-file','-e','<sha>:<file>'])
 * @param {string} cwd repo root to run in
 * @returns {{ code: number }}
 */
function defaultRunGit(args, cwd) {
  try {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 5000 });
    // status is null when the process was killed by a signal or failed to
    // spawn — treat that as a non-zero (unverifiable → missing) result.
    if (r.error || r.status === null) return { code: 1 };
    return { code: r.status };
  } catch {
    return { code: 1 };
  }
}

/**
 * Verify that each file exists on the given base SHA.
 *
 * @param {{
 *   files: string[],
 *   baseSha: string,
 *   repoRoot: string,
 *   runGit?: (args: string[], cwd: string) => ({ code: number } | Promise<{ code: number }>),
 * }} opts
 * @returns {Promise<{ missing: string[] }>} the subset of `files` that do not
 *   exist on `baseSha` (in input order). `{ missing: [] }` when all exist.
 */
export async function verifyGrounding({ files, baseSha, repoRoot, runGit = defaultRunGit }) {
  if (!Array.isArray(files)) {
    throw new TypeError('verifyGrounding: files must be an array');
  }
  if (typeof baseSha !== 'string' || baseSha.length === 0) {
    throw new TypeError('verifyGrounding: baseSha must be a non-empty string');
  }
  if (typeof repoRoot !== 'string' || repoRoot.length === 0) {
    throw new TypeError('verifyGrounding: repoRoot must be a non-empty string');
  }

  const missing = [];
  for (const file of files) {
    // `git cat-file -e <sha>:<path>` exits 0 iff the object exists; non-zero
    // (typically 128) when the path is absent on that tree. One fork per file —
    // fine for the typical 1-3 refs (SPEC_V02H §5 perf note).
    const result = await runGit(['cat-file', '-e', `${baseSha}:${file}`], repoRoot);
    const code = result && typeof result.code === 'number' ? result.code : 1;
    if (code !== 0) missing.push(file);
  }
  return { missing };
}
