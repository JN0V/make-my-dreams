// lib/bench/aggregate.js — build summary.json + deterministic report.md.
//
// Spec: SPEC_V02B AC-5 — report.md is deterministic ("auto-generated,
// deterministic — no LLM call"), summary.json is the machine-readable
// counterpart with aggregate stats.
//
// SRP: pure transformations only. The caller (run-one orchestrator) is
// responsible for writing the strings to disk. Determinism is a constitution
// requirement (observability.md §IV) — given the same metrics + meta inputs,
// this module emits byte-identical output. Tests assert that explicitly.

/**
 * Build the summary.json payload.
 *
 * @param {object} args
 * @param {Array} args.metrics      per-dream metrics (cf serializeMetrics shape)
 * @param {string} args.engine      engine used for the run
 * @param {string} args.mmd_version mmd version at run time
 * @param {string} args.mmd_git_sha mmd git short SHA at run time
 * @param {string} args.run_id      stable run identifier (used in filenames)
 * @param {string} args.started_at  ISO-8601 run start
 * @param {string} args.ended_at    ISO-8601 run end
 * @returns {object}
 */
export function buildSummary({
  metrics,
  engine,
  mmd_version,
  mmd_git_sha,
  run_id,
  started_at,
  ended_at,
}) {
  if (!Array.isArray(metrics)) {
    throw new TypeError('buildSummary: metrics must be an array');
  }
  const totalDuration = metrics.reduce((acc, m) => acc + (m.duration_seconds || 0), 0);
  const realityChecksRun = metrics.filter((m) => m.reality_check && m.reality_check.ran).length;
  const realityChecksPassed = metrics.filter(
    (m) => m.reality_check && m.reality_check.passed,
  ).length;
  const dreamsPassed = metrics.filter(
    (m) => m.exit_code === 0 && m.reality_check && m.reality_check.passed,
  ).length;
  return {
    run_id,
    mmd_version,
    mmd_git_sha,
    engine,
    started_at,
    ended_at,
    total_duration_seconds: Number(totalDuration.toFixed(3)),
    dreams_total: metrics.length,
    dreams_passed: dreamsPassed,
    dreams_failed: metrics.length - dreamsPassed,
    reality_check: {
      runs: realityChecksRun,
      passed: realityChecksPassed,
      pass_rate:
        realityChecksRun > 0 ? Number((realityChecksPassed / realityChecksRun).toFixed(3)) : null,
    },
    per_dream: metrics.map((m) => ({
      dream_id: m.dream_id,
      duration_seconds: m.duration_seconds,
      exit_code: m.exit_code,
      reality_check_passed: !!(m.reality_check && m.reality_check.passed),
      commits_count: m.commits_count,
      phase4_findings_count: m.phase4_findings_count ?? null,
    })),
  };
}

/**
 * Format a duration in human terms (deterministic — no locale).
 * @param {number} seconds
 * @returns {string}  e.g. "0s", "42s", "2m 18s", "1h 03m 04s"
 */
function fmtDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return `${m}m ${String(r).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${String(rm).padStart(2, '0')}m ${String(r).padStart(2, '0')}s`;
}

/**
 * Build the human-readable report.md. Deterministic given the same summary
 * (AC-5). The table follows the spec:
 *   dream-id × engine × duration × pass/fail × notable findings
 *
 * @param {ReturnType<typeof buildSummary>} summary
 * @returns {string}
 */
export function buildReportMd(summary) {
  const lines = [];
  lines.push(`# mmd bench — run ${summary.run_id}`);
  lines.push('');
  lines.push(`- MMD version: \`${summary.mmd_version}\``);
  lines.push(`- MMD git SHA: \`${summary.mmd_git_sha}\``);
  lines.push(`- Engine: \`${summary.engine}\``);
  lines.push(`- Started: ${summary.started_at}`);
  lines.push(`- Ended:   ${summary.ended_at}`);
  lines.push(`- Total duration: ${fmtDuration(summary.total_duration_seconds)}`);
  lines.push('');
  lines.push('## Per-dream results');
  lines.push('');
  lines.push('| Dream id | Engine | Duration | Exit | Reality check | Phase 4 findings |');
  lines.push('|---|---|---|---|---|---|');
  for (const d of summary.per_dream) {
    const pass = d.exit_code === 0 && d.reality_check_passed;
    const rcCell = d.reality_check_passed ? 'pass' : 'fail';
    const findings = d.phase4_findings_count === null ? 'n/a' : String(d.phase4_findings_count);
    lines.push(
      `| \`${d.dream_id}\` | ${summary.engine} | ${fmtDuration(d.duration_seconds)} | ${d.exit_code} | ${rcCell} | ${findings} | ${pass ? '' : ''}`.replace(
        / \| $/,
        ' |',
      ),
    );
  }
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  const rcRate =
    summary.reality_check.pass_rate === null
      ? 'n/a'
      : `${Math.round(summary.reality_check.pass_rate * 100)}%`;
  lines.push(
    `${summary.dreams_passed}/${summary.dreams_total} dreams passed. ` +
      `Reality-check pass rate: ${rcRate} ` +
      `(${summary.reality_check.passed}/${summary.reality_check.runs} runs).`,
  );
  lines.push('');
  if (summary.dreams_failed === 0) {
    lines.push('All dreams green — no regressions surfaced by this bench.');
  } else {
    const failed = summary.per_dream
      .filter((d) => !(d.exit_code === 0 && d.reality_check_passed))
      .map((d) => d.dream_id);
    lines.push(`Failing dreams: ${failed.map((f) => `\`${f}\``).join(', ')}.`);
  }
  lines.push('');
  return lines.join('\n');
}
