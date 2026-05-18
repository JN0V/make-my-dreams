// lib/ship/summary.js — pure formatting of the post-ship summary block
// (SPEC_V02F AC-4 final paragraph + AC-7 audit inclusion).
//
// SRP: no I/O, no spawn, no env access. Caller passes a plain object, we
// return a string ready for stdout.write.

/**
 * Format the final summary printed after `mmd ship` completes.
 *
 * The shape is deliberately tolerant: any field absent or null renders as a
 * "-" placeholder so the summary stays readable even when the ship skill
 * succeeded but did not produce (for example) a PR URL.
 *
 * @param {{
 *   branch: string,
 *   baseBranch: string,
 *   sha: string,
 *   shipped?: boolean,
 *   merged?: boolean,
 *   tag?: string | null,
 *   prUrl?: string | null,
 *   testsRun?: boolean,
 *   testsPassed?: boolean | null,
 *   subprocessExitCode?: number | null,
 *   subprocessSignal?: string | null,
 *   logPath?: string | null,
 *   auditOutput?: string | null,
 *   durationSeconds?: number | null,
 * }} info
 * @returns {string}
 */
export function formatShipSummary(info) {
  if (!info || typeof info !== 'object') {
    throw new TypeError('formatShipSummary: info must be an object');
  }
  const f = (v) => (v === undefined || v === null || v === '' ? '-' : v);
  const bool = (v) => (v === true ? 'yes' : v === false ? 'no' : '-');
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

  const header = [
    '',
    '═══ mmd ship — summary ═══',
    `  Branch shipped  : ${f(info.branch)}`,
    `  Base merged     : ${f(info.baseBranch)}`,
    `  Branch tip SHA  : ${f(info.sha)}`,
    `  Tag created     : ${f(info.tag)}`,
    `  PR URL          : ${f(info.prUrl)}`,
    `  Tests run       : ${bool(info.testsRun)} (passed: ${bool(info.testsPassed)})`,
    `  Subprocess      : ${exitPart}`,
    `  Duration        : ${dur}`,
    `  Log file        : ${f(info.logPath)}`,
  ];

  const audit = info.auditOutput
    ? [
      '',
      '── pillar audit (scripts/audit-pillars.sh) ──',
      info.auditOutput.trimEnd(),
    ]
    : ['', '── pillar audit: skipped (script unavailable or audit failed) ──'];

  return [...header, ...audit, ''].join('\n');
}

/**
 * Format the `--dry-run` preview: the prompt, the env vars that would be set,
 * and the planned subprocess command. Pure — no spawn, no env read.
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
export function formatDryRun(info) {
  if (!info || typeof info !== 'object') {
    throw new TypeError('formatDryRun: info must be an object');
  }
  const envLines = Object.keys(info.env || {})
    .sort()
    .map((k) => `    ${k}=${info.env[k]}`);

  return [
    '',
    '═══ mmd ship --dry-run — preview (no subprocess spawned) ═══',
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
    info.prompt
      .split('\n')
      .map((l) => `  ${l}`)
      .join('\n'),
    '  ──────',
    '',
    'Pre-checks PASSED. No subprocess was spawned (dry-run). Exit 0.',
    '',
  ].join('\n');
}
