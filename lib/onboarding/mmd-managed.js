// lib/onboarding/mmd-managed.js — the pure predicate behind the discover→--here
// friction fix (SPEC_V06B AC-3).
//
// SRP (universal.md §I.S): owns ONLY the question "is this dirty path one MMD
// itself manages (so a tree dirtied only by it counts as clean), or a real user
// file (so the guard must still refuse)?". No git, no fs — it operates on the
// strings `git status --porcelain` already produced, so it is exhaustively
// unit-testable and shared between the first-run setup preflight and any future
// caller.
//
// The friction it fixes (v0.6.a surfaced): `mmdream discover` writes `.mmd/`,
// `mmd-discovery-report.md`, and a `.gitignore` block. That dirties the tree, so
// the documented "run discover, read the suggestions, then `mmdream --here`" flow
// tripped the first-run guard's dirty-tree veto (exit 4) and forced a manual
// stash. We treat ONLY those MMD-managed paths as clean.
//
// Safety / F7 intact (universal.md §VI honesty): the predicate is deliberately
// narrow. ANY non-MMD dirty path makes the whole tree "not clean", so the guard
// still refuses (exit 4) and the post-setup `git add -A` can never sweep a
// user's uncommitted work into the setup commit.

/**
 * The exact set of repo-root paths MMD's own discover/setup steps create or
 * touch. A porcelain path is MMD-managed iff it equals one of these, or (for
 * `.mmd/`) lives under it.
 *
 * @type {readonly string[]}
 */
export const MMD_MANAGED_PATHS = Object.freeze([
  '.mmd',
  'mmd-discovery-report.md',
  '.gitignore',
]);

/**
 * Parse the path out of a single `git status --porcelain[=v1]` line.
 *
 * Porcelain v1 format: a 2-char XY status, a space, then the path. A rename is
 * `R  old -> new`; we take the destination (the path that now exists on disk).
 * Paths with spaces/odd chars may be quoted by git ("…") — we strip the quotes
 * for the comparison (the predicate only needs the logical path, not a
 * shell-safe one).
 *
 * @param {string} line  one porcelain line
 * @returns {string|null}  the path, or null for an empty/unparseable line
 */
export function porcelainPath(line) {
  if (typeof line !== 'string') return null;
  const trimmedEnd = line.replace(/[\r\n]+$/, '');
  if (trimmedEnd.trim().length === 0) return null;
  // Drop the 2-char XY code + the following space. Porcelain always pads the
  // status to two columns then a single space before the path.
  let rest = trimmedEnd.slice(3);
  // Rename/copy: "old -> new" — keep the destination.
  const arrow = rest.indexOf(' -> ');
  if (arrow !== -1) rest = rest.slice(arrow + 4);
  rest = rest.trim();
  // git quotes paths with special chars; strip the surrounding quotes.
  if (rest.startsWith('"') && rest.endsWith('"') && rest.length >= 2) {
    rest = rest.slice(1, -1);
  }
  return rest.length > 0 ? rest : null;
}

/**
 * Is this dirty path one MMD manages?
 *
 * True iff the path is `.gitignore`, `mmd-discovery-report.md`, `.mmd` itself,
 * or anything under `.mmd/`. Normalizes a leading `./` and trailing `/`. Any
 * other path (a real user file) is NOT MMD-managed.
 *
 * @param {string} p  a repo-relative path (e.g. from porcelainPath)
 * @returns {boolean}
 */
export function isMmdManagedPath(p) {
  if (typeof p !== 'string' || p.length === 0) return false;
  let norm = p.replace(/^\.\//, '').replace(/\/+$/, '');
  if (norm.length === 0) return false;
  if (norm === '.mmd' || norm.startsWith('.mmd/')) return true;
  return norm === 'mmd-discovery-report.md' || norm === '.gitignore';
}

/**
 * Is a working tree (given its full `git status --porcelain` output) clean
 * once MMD-managed paths are filtered out?
 *
 * Returns true iff EVERY non-empty porcelain line names an MMD-managed path.
 * An empty/whitespace-only string is trivially clean. A single non-MMD dirty
 * line → false (F7: the guard must still refuse so it cannot sweep user work).
 *
 * @param {string} porcelainOutput  the raw stdout of `git status --porcelain`
 * @returns {boolean}
 */
export function isTreeCleanIgnoringMmd(porcelainOutput) {
  if (typeof porcelainOutput !== 'string') return true;
  const lines = porcelainOutput.split('\n');
  for (const line of lines) {
    const p = porcelainPath(line);
    if (p === null) continue; // blank line
    if (!isMmdManagedPath(p)) return false;
  }
  return true;
}
