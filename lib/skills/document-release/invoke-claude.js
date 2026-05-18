// lib/skills/document-release/invoke-claude.js — thin wrapper over
// lib/skills/_common/invoke-claude.js for the gStack `document-release`
// skill (SPEC_V02G AC-4).
//
// Unlike qa/cso, the log path is a `.md` file (per AC-4: "skill writes its
// output to .mmd/local/document-release-runs/<ts>.md (markdown file the user
// can copy/edit)"). The subprocess log itself (stdout/stderr tee) is also
// stored under the same dir but with a -driver.log suffix to keep the two
// artifact kinds distinct — the .md file is the human-readable draft.

import path from 'node:path';
import { randomBytes } from 'node:crypto';

import {
  invokeClaudeSkill,
  skillLogPath,
  buildSkillEnv,
} from '../_common/invoke-claude.js';

export const buildDocumentReleaseEnv = (parentEnv = process.env) =>
  buildSkillEnv('document-release', parentEnv);

// F10 (Phase-4 review): the wrapper-level `buildDocumentReleaseArgs` re-export
// was a dry-run-only duplicate of `buildSkillArgs`. Callers now import
// `buildSkillArgs` from `_common/invoke-claude.js` directly.

/**
 * Per AC-4: the gStack skill writes the release-notes draft to a `.md` file
 * under `.mmd/local/document-release-runs/<ts>.md`. Compute that path here
 * so both the prompt (so the LLM knows where to write) and the summary (so
 * the user knows where to read) agree on the same location.
 *
 * Subprocess stdout/stderr is tee'd to a separate `<ts>-driver.log` next to
 * the markdown draft (kept so the user can review what the LLM actually
 * received and emitted on stderr).
 *
 * @param {string} repoRoot
 * @param {() => Date} [now]
 * @returns {{ outputPath: string, logPath: string }}
 */
export function documentReleasePaths(repoRoot, now = () => new Date()) {
  if (typeof repoRoot !== 'string' || repoRoot.length === 0) {
    throw new TypeError('documentReleasePaths: repoRoot must be a non-empty string');
  }
  const ts = now().toISOString().replace(/[:.]/g, '-');
  // F15 (Phase-4 review): same-process rapid reruns can produce identical
  // `${ts}-${pid}` filenames; a 2-byte hex suffix prevents accidental
  // collision. Both the markdown draft and the driver log share the SAME
  // random suffix so a `<base>.md` / `<base>-driver.log` pair stays
  // discoverable as belonging to the same invocation.
  const rnd = randomBytes(2).toString('hex');
  const dir = path.join(repoRoot, '.mmd', 'local', 'document-release-runs');
  return {
    outputPath: path.join(dir, `${ts}-${process.pid}-${rnd}.md`),
    logPath: path.join(dir, `${ts}-${process.pid}-${rnd}-driver.log`),
  };
}

/**
 * Log path helper for parity with qa/cso/ship — delegates to the _common
 * `skillLogPath` so test helpers don't have to know the document-release
 * directory layout.
 *
 * @param {string} repoRoot
 * @param {() => Date} [now]
 * @returns {string}
 */
export const documentReleaseLogPath = (repoRoot, now) =>
  skillLogPath(repoRoot, 'document-release', now);

/**
 * @param {{
 *   prompt: string,
 *   cwd: string,
 *   logPath: string,
 *   timeoutMs?: number,
 *   quiet?: boolean,
 *   heartbeatIntervalMs?: number,
 *   command?: string,
 *   envOverride?: Record<string,string>,
 * }} opts
 * @returns {Promise<{ code: number|null, signal: string|null, logPath: string, durationSeconds: number }>}
 */
export async function invokeClaudeDocumentRelease(opts) {
  if (!opts || typeof opts !== 'object') {
    throw new TypeError('invokeClaudeDocumentRelease: opts must be an object');
  }
  const command = opts.command || process.env.MMD_DOCUMENT_RELEASE_CMD || 'claude';
  const env = opts.envOverride || buildDocumentReleaseEnv(process.env);
  return invokeClaudeSkill({
    skillName: 'document-release',
    command,
    prompt: opts.prompt,
    env,
    cwd: opts.cwd,
    logPath: opts.logPath,
    timeoutMs: opts.timeoutMs,
    quiet: opts.quiet,
    // F13 (Phase-4 review): match _common default (60_000) so programmatic
    // callers don't silently lose the heartbeat. To DISABLE, pass 0 explicitly.
    heartbeatIntervalMs: opts.heartbeatIntervalMs ?? 60_000,
  });
}
