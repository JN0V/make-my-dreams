// lib/skills/document-release/summary.js — summary + dry-run formatters for
// `mmd document-release` (SPEC_V02G AC-4).
//
// Unlike qa/cso, the post-run summary highlights the markdown OUTPUT PATH
// the user should review/edit.

/**
 * @param {{
 *   fromRef: string,
 *   toRef: string,
 *   fromSha: string,
 *   toSha: string,
 *   outputPath: string,
 *   subprocessExitCode?: number | null,
 *   subprocessSignal?: string | null,
 *   logPath?: string | null,
 *   durationSeconds?: number | null,
 * }} info
 * @returns {string}
 */
export function formatDocumentReleaseSummary(info) {
  if (!info || typeof info !== 'object') {
    throw new TypeError('formatDocumentReleaseSummary: info must be an object');
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
    '═══ mmd document-release — summary ═══',
    `  From ref       : ${f(info.fromRef)} (${f((info.fromSha || '').slice(0, 7))})`,
    `  To ref         : ${f(info.toRef)} (${f((info.toSha || '').slice(0, 7))})`,
    `  Draft written  : ${f(info.outputPath)}`,
    `  Subprocess     : ${exitPart}`,
    `  Duration       : ${dur}`,
    `  Log file       : ${f(info.logPath)}`,
    '',
    `Next: review ${f(info.outputPath)} and copy/edit into your release notes.`,
    '',
  ].join('\n');
}

/**
 * @param {{
 *   prompt: string,
 *   env: Record<string, string>,
 *   command: string,
 *   args: string[],
 *   fromRef: string,
 *   toRef: string,
 *   fromSha: string,
 *   toSha: string,
 *   outputPath: string,
 * }} info
 * @returns {string}
 */
export function formatDocumentReleaseDryRun(info) {
  if (!info || typeof info !== 'object') {
    throw new TypeError('formatDocumentReleaseDryRun: info must be an object');
  }
  const envLines = Object.keys(info.env || {}).sort().map((k) => `    ${k}=${info.env[k]}`);
  return [
    '',
    '═══ mmd document-release --dry-run — preview (no subprocess spawned) ═══',
    `  From       : ${info.fromRef} (${(info.fromSha || '').slice(0, 7)})`,
    `  To         : ${info.toRef} (${(info.toSha || '').slice(0, 7)})`,
    `  Output to  : ${info.outputPath}`,
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
