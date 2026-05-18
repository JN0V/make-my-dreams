// lib/skills/qa/invoke-claude.js — thin wrapper over
// lib/skills/_common/invoke-claude.js for the gStack `qa` skill (SPEC_V02G
// AC-2). Mirrors lib/skills/ship/invoke-claude.js so future skills follow the
// same pattern.

import {
  invokeClaudeSkill,
  skillLogPath,
  buildSkillEnv,
  buildSkillArgs,
} from '../_common/invoke-claude.js';

export const buildQaEnv = (parentEnv = process.env) => buildSkillEnv('qa', parentEnv);
export const buildQaArgs = (prompt) => buildSkillArgs(prompt);
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
    heartbeatIntervalMs: opts.heartbeatIntervalMs ?? 0,
  });
}
