// lib/state.js — .mmd/ filesystem layout + status.json read/write + decisions log
// SRP (constitution §I.S): owns the state-file layout under <demoDir>/.mmd/
// and the repo-root .gitignore verification.
//
// Public API:
//   - ensureLayout(demoDir)                            -> creates .mmd/{shared,local/runs,local/reality-checks}
//   - readStatus(demoDir)                              -> Promise<Status|null>  (null on ENOENT; rename+null on corrupt JSON; rethrows other errors)
//   - writeStatus(demoDir, payload)                    -> writes status.json and triggers audit line on state change
//   - appendDecision(demoDir, slug, old, new, reason?) -> append-only decisions.log
//   - ensureGitignore(repoRoot)                        -> verify/extend repoRoot/.gitignore for `.mmd/local/`
//
// Constitution: §VII (no silent catches — non-ENOENT errors propagate),
// §X (audit logging via decisions.log), §XII (writes confined to demoDir).

import { mkdir, readFile, writeFile, appendFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';

const SHARED_DIR = path.join('.mmd', 'shared');
const RUNS_DIR = path.join('.mmd', 'local', 'runs');
const REALITY_DIR = path.join('.mmd', 'local', 'reality-checks');
const STATUS_FILE = 'status.json';
const DECISIONS_FILE = 'decisions.log';

const GITIGNORE_PATTERN = '.mmd/local/';
const GITIGNORE_HEADER = '# MMD v0.1 — auto-managed by `mmd <dream>`';

/**
 * @typedef {Object} StatusTask
 * @property {string} id
 * @property {'pending'|'in_progress'|'done'|'failed'} state
 * @property {string} [log]
 *
 * @typedef {Object} Status
 * @property {string} slice_id              Slug of the dream — primary key.
 * @property {string} dream                 Verbatim dream string — used by AC-7 to detect slug collisions.
 * @property {'pending'|'in_progress'|'done'|'failed'} state
 * @property {string} created_at            ISO-8601 UTC timestamp.
 * @property {string} updated_at            ISO-8601 UTC timestamp.
 * @property {StatusTask[]} tasks
 * @property {string} [reason]              Optional free-text — surfaced into decisions.log when set.
 */

/**
 * Idempotently create the .mmd subtree under demoDir.
 * Safe to call multiple times.
 */
export async function ensureLayout(demoDir) {
  await mkdir(path.join(demoDir, SHARED_DIR), { recursive: true });
  await mkdir(path.join(demoDir, RUNS_DIR), { recursive: true });
  await mkdir(path.join(demoDir, REALITY_DIR), { recursive: true });
}

/**
 * Read .mmd/shared/status.json.
 *  - Returns null on ENOENT (fresh demoDir).
 *  - On corrupt JSON: renames to status.json.corrupt-<ts>, writes a warning to stderr, returns null.
 *  - Any other error (EACCES, EISDIR, ...) is re-thrown per constitution §VII (no silent catch).
 *
 * @returns {Promise<Status|null>}
 */
export async function readStatus(demoDir) {
  const statusPath = path.join(demoDir, SHARED_DIR, STATUS_FILE);
  let raw;
  try {
    raw = await readFile(statusPath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err; // EACCES / EISDIR / etc. — surface loudly
  }
  try {
    return JSON.parse(raw);
  } catch (parseErr) {
    // Defensive recovery: keep forensic copy, warn loudly, return null so caller proceeds fresh.
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const corruptPath = `${statusPath}.corrupt-${ts}`;
    await rename(statusPath, corruptPath);
    process.stderr.write(
      `[mmd] WARNING: status.json was malformed (${parseErr.message}); ` +
        `renamed to ${path.basename(corruptPath)} and proceeding fresh\n`
    );
    return null;
  }
}

/**
 * Persist status.json to disk.
 *  - Reads existing status to detect state transitions and append a decisions.log line.
 *  - Surfaces EACCES/EISDIR from the read step (per constitution §VII).
 */
export async function writeStatus(demoDir, payload) {
  let existing = null;
  try {
    existing = await readStatus(demoDir);
  } catch (err) {
    // ENOENT can't actually surface here (readStatus already absorbs it).
    // Any other code (EACCES/EISDIR/...) propagates — F2-round-3.
    if (err && err.code === 'ENOENT') {
      existing = null;
    } else {
      throw err;
    }
  }
  if (!existing || existing.state !== payload.state) {
    await appendDecision(
      demoDir,
      payload.slice_id,
      existing?.state ?? '(initial)',
      payload.state,
      payload.reason ?? ''
    );
  }
  const statusPath = path.join(demoDir, SHARED_DIR, STATUS_FILE);
  await writeFile(statusPath, JSON.stringify(payload, null, 2), 'utf8');
}

/**
 * Append a single state-transition line to <demoDir>/.mmd/shared/decisions.log.
 * Atomic per POSIX O_APPEND semantics (safe for concurrent appenders).
 * Constitution §X (Audit Logging) — every business action recorded.
 */
export async function appendDecision(demoDir, slug, oldState, newState, reason) {
  const dir = path.join(demoDir, SHARED_DIR);
  // ensureLayout is the documented happy-path, but be defensive: create parent if missing.
  await mkdir(dir, { recursive: true });
  const logPath = path.join(dir, DECISIONS_FILE);
  const line =
    `${new Date().toISOString()} ${slug} ${oldState} -> ${newState}` +
    (reason ? ` [reason: ${reason}]` : '') +
    '\n';
  await appendFile(logPath, line, { encoding: 'utf8' });
}

/**
 * Verify or extend repoRoot/.gitignore so that `.mmd/local/` is ignored.
 *
 *  - No-op unless repoRoot/.git exists (any type) OR repoRoot/.gitignore exists.
 *    Rationale: do NOT create surprise .gitignore files in arbitrary cwd (Party Mode #3 / Winston).
 *  - Idempotent: only appends the pattern when absent.
 *  - Never overwrites existing entries.
 */
export async function ensureGitignore(repoRoot) {
  const gitignorePath = path.join(repoRoot, '.gitignore');
  const gitDirPath = path.join(repoRoot, '.git');

  let hasGit = false;
  try {
    await stat(gitDirPath);
    hasGit = true;
  } catch (err) {
    if (err && err.code !== 'ENOENT') throw err;
  }

  let hasGitignore = false;
  let existingContent = '';
  try {
    existingContent = await readFile(gitignorePath, 'utf8');
    hasGitignore = true;
  } catch (err) {
    if (err && err.code !== 'ENOENT') throw err;
  }

  if (!hasGit && !hasGitignore) {
    // Silent no-op per Winston: never create .gitignore in a non-git directory.
    return;
  }

  // Pattern already present? Idempotent no-op.
  const lines = existingContent.split('\n');
  const alreadyPresent = lines.some((l) => l.trim() === GITIGNORE_PATTERN);
  if (alreadyPresent) return;

  const sep = existingContent.length === 0 || existingContent.endsWith('\n') ? '' : '\n';
  const addition = `${sep}\n${GITIGNORE_HEADER}\n${GITIGNORE_PATTERN}\n`;
  // If file was empty/new, drop the leading blank line.
  const finalAddition = existingContent.length === 0
    ? `${GITIGNORE_HEADER}\n${GITIGNORE_PATTERN}\n`
    : addition;
  await writeFile(
    gitignorePath,
    existingContent + finalAddition,
    { encoding: 'utf8', flag: 'w' }
  );
}
