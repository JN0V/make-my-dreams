// lib/skills/ship/invoke-claude.js — thin wrapper over
// lib/skills/_common/invoke-claude.js for the gStack `ship` skill.
// Preserves the v0.2.f public API (invokeClaudeShip, shipLogPath,
// buildShipEnv, buildShipArgs) so existing call sites keep compiling.

import {
  invokeClaudeSkill,
  skillLogPath,
  buildSkillEnv,
  buildSkillArgs,
} from '../_common/invoke-claude.js';

export const buildShipEnv = (parentEnv = process.env) => buildSkillEnv('ship', parentEnv);
export const buildShipArgs = (prompt) => buildSkillArgs(prompt);
export const shipLogPath = (repoRoot, now) => skillLogPath(repoRoot, 'ship', now);

export async function invokeClaudeShip(opts) {
  if (!opts || typeof opts !== 'object') {
    throw new TypeError('invokeClaudeShip: opts must be an object');
  }
  const command = opts.command || process.env.MMD_SHIP_CMD || 'claude';
  const env = opts.envOverride || buildShipEnv(process.env);
  return invokeClaudeSkill({
    skillName: 'ship',
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
