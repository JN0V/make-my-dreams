// lib/skills/cso/summary.js — summary + dry-run formatters for `mmd cso`
// (SPEC_V02G AC-3). Mirrors lib/skills/qa/summary.js.
//
// F1 (Phase-4 adversarial review): dry-run env values are filtered through
// redactSensitiveEnv so ANTHROPIC_API_KEY / *_TOKEN / *_SECRET never leak.

import { redactSensitiveEnv } from '../_common/redact-env.js';

/**
 * @param {{
 *   branch: string,
 *   baseBranch: string,
 *   sha: string,
 *   subprocessExitCode?: number | null,
 *   subprocessSignal?: string | null,
 *   logPath?: string | null,
 *   durationSeconds?: number | null,
 * }} info
 * @returns {string}
 */
export function formatCsoSummary(info) {
  if (!info || typeof info !== 'object') {
    throw new TypeError('formatCsoSummary: info must be an object');
  }
  const f = (v) => (v === undefined || v === null || v === '' ? '-' : v);
  const dur =
    typeof info.durationSeconds === 'number' && Number.isFinite(info.durationSeconds)
      ? `${info.durationSeconds.toFixed(1)}s`
      : '-';
  const exitPart =
    info.subprocessSignal
      ? `signal=${info.subprocessSignal}`
      : info.subprocessExitCode === null || info.subprocessExitCode === undefined
        ? 'code=-'
        : `code=${info.subprocessExitCode}`;
  return [
    '',
    '═══ mmd cso — summary ═══',
    `  Branch audited  : ${f(info.branch)}`,
    `  Base            : ${f(info.baseBranch)}`,
    `  Branch tip SHA  : ${f(info.sha)}`,
    `  Subprocess      : ${exitPart}`,
    `  Duration        : ${dur}`,
    `  Log file        : ${f(info.logPath)}`,
    '',
    'Note: mmd cso is read-only / advisory — no commits / no pushes were made.',
    '',
  ].join('\n');
}

/**
 * @param {{
 *   prompt: string,
 *   env: Record<string, string>,
 *   command: string,
 *   args: string[],
 *   branch: string,
 *   baseBranch: string,
 *   sha: string,
 * }} info
 * @returns {string}
 */
export function formatCsoDryRun(info) {
  if (!info || typeof info !== 'object') {
    throw new TypeError('formatCsoDryRun: info must be an object');
  }
  const safeEnv = redactSensitiveEnv(info.env);
  const envLines = Object.keys(safeEnv).sort().map((k) => `    ${k}=${safeEnv[k]}`);
  return [
    '',
    '═══ mmd cso --dry-run — preview (no subprocess spawned) ═══',
    `  Branch     : ${info.branch}`,
    `  Base       : ${info.baseBranch}`,
    `  Branch SHA : ${info.sha}`,
    '',
    '  Planned subprocess command:',
    `    ${info.command} ${info.args.map((a) => JSON.stringify(a)).join(' ')}`,
    '',
    '  Subprocess env (allowlisted):',
    ...envLines,
    '',
    '  Prompt:',
    '  ──────',
    info.prompt.split('\n').map((l) => `  ${l}`).join('\n'),
    '  ──────',
    '',
    'Pre-checks PASSED. No subprocess was spawned (dry-run). Exit 0.',
    '',
  ].join('\n');
}
