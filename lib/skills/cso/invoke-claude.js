// lib/skills/cso/invoke-claude.js — thin wrapper over
// lib/skills/_common/invoke-claude.js for the gStack `cso` skill (SPEC_V02G
// AC-3).

import {
  invokeClaudeSkill,
  skillLogPath,
  buildSkillEnv,
} from '../_common/invoke-claude.js';

// F10 (Phase-4 review): the wrapper-level `buildCsoArgs` re-export was a
// dry-run-only duplicate of `buildSkillArgs`. Callers now import
// `buildSkillArgs` from `_common/invoke-claude.js` directly.
export const buildCsoEnv = (parentEnv = process.env) => buildSkillEnv('cso', parentEnv);
export const csoLogPath = (repoRoot, now) => skillLogPath(repoRoot, 'cso', now);

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
export async function invokeClaudeCso(opts) {
  if (!opts || typeof opts !== 'object') {
    throw new TypeError('invokeClaudeCso: opts must be an object');
  }
  const command = opts.command || process.env.MMD_CSO_CMD || 'claude';
  const env = opts.envOverride || buildCsoEnv(process.env);
  return invokeClaudeSkill({
    skillName: 'cso',
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
