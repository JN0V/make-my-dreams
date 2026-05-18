// lib/skills/qa/summary.js — pure formatting of the post-`mmd qa` summary
// + dry-run preview (SPEC_V02G AC-2).
//
// SRP: no I/O, no spawn, no env. Caller passes a plain object, we return a
// string ready for stdout.write. Mirrors lib/skills/ship/summary.js shape.
//
// F1 (Phase-4 adversarial review): the dry-run preview iterates info.env. Any
// secret-shaped key (ANTHROPIC_API_KEY, *_TOKEN, *_SECRET, ...) has its VALUE
// replaced by '<redacted>' via redactSensitiveEnv. Dry-run output ends up in
// bug reports / Slack / GitHub — we must not leak credentials there.

import { redactSensitiveEnv } from '../_common/redact-env.js';

/**
 * Format the summary printed after `mmd qa` completes.
 *
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
export function formatQaSummary(info) {
  if (!info || typeof info !== 'object') {
    throw new TypeError('formatQaSummary: info must be an object');
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
    '═══ mmd qa — summary ═══',
    `  Branch reviewed : ${f(info.branch)}`,
    `  Base            : ${f(info.baseBranch)}`,
    `  Branch tip SHA  : ${f(info.sha)}`,
    `  Subprocess      : ${exitPart}`,
    `  Duration        : ${dur}`,
    `  Log file        : ${f(info.logPath)}`,
    '',
    'Note: mmd qa is read-only / advisory — no commits / no pushes were made.',
    '',
  ].join('\n');
}

/**
 * Format the `--dry-run` preview. Pure — no spawn, no env read.
 *
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
export function formatQaDryRun(info) {
  if (!info || typeof info !== 'object') {
    throw new TypeError('formatQaDryRun: info must be an object');
  }
  const safeEnv = redactSensitiveEnv(info.env);
  const envLines = Object.keys(safeEnv).sort().map((k) => `    ${k}=${safeEnv[k]}`);
  return [
    '',
    '═══ mmd qa --dry-run — preview (no subprocess spawned) ═══',
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
