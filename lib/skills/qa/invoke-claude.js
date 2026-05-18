// lib/skills/qa/invoke-claude.js — thin wrapper over
// lib/skills/_common/invoke-claude.js for the gStack `qa` skill (SPEC_V02G
// AC-2). Mirrors lib/skills/ship/invoke-claude.js so future skills follow the
// same pattern.

import {
  invokeClaudeSkill,
  skillLogPath,
  buildSkillEnv,
} from '../_common/invoke-claude.js';

// F10 (Phase-4 review): the wrapper-level `buildQaArgs` re-export was a
// dry-run-only duplicate of `buildSkillArgs`. Callers now import
// `buildSkillArgs` from `_common/invoke-claude.js` directly — single source
// of truth.
export const buildQaEnv = (parentEnv = process.env) => buildSkillEnv('qa', parentEnv);
export const qaLogPath = (repoRoot, now) => skillLogPath(repoRoot, 'qa', now);

/**
 * Spawn `claude -p` for the qa skill. Resolves the command (default 'claude',
 * override via MMD_QA_CMD) and the env at the wrapper level — the _common
 * layer stays env-free for testability.
 *
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
export async function invokeClaudeQa(opts) {
  if (!opts || typeof opts !== 'object') {
    throw new TypeError('invokeClaudeQa: opts must be an object');
  }
  const command = opts.command || process.env.MMD_QA_CMD || 'claude';
  const env = opts.envOverride || buildQaEnv(process.env);
  return invokeClaudeSkill({
    skillName: 'qa',
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
