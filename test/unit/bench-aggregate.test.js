// test/unit/bench-aggregate.test.js
// @unit — report.md + summary.json shape and determinism (SPEC_V02B AC-5).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildSummary, buildReportMd } from '../../lib/bench/aggregate.js';

const SAMPLE_METRICS = [
  {
    dream_id: 'kid-01',
    engine: 'standard',
    duration_seconds: 120,
    exit_code: 0,
    reality_check: { ran: true, passed: true, screenshot_path: null, console_errors_count: 0 },
    commits_count: 3,
    phase4_findings_count: 2,
    log_path: 'x',
  },
  {
    dream_id: 'kid-02',
    engine: 'standard',
    duration_seconds: 45,
    exit_code: 0,
    reality_check: { ran: true, passed: false, screenshot_path: null, console_errors_count: 4 },
    commits_count: 2,
    phase4_findings_count: null,
    log_path: 'y',
  },
];

const SAMPLE_META = {
  engine: 'standard',
  mmd_version: '0.2.2',
  mmd_git_sha: 'abc1234',
  run_id: '2026-05-17T16-00-00-xyz789',
  started_at: '2026-05-17T16:00:00.000Z',
  ended_at: '2026-05-17T16:02:45.000Z',
};

test('@unit buildSummary: AC-5 fields are present and counted', () => {
  const s = buildSummary({ metrics: SAMPLE_METRICS, ...SAMPLE_META });
  assert.equal(s.run_id, SAMPLE_META.run_id);
  assert.equal(s.mmd_version, '0.2.2');
  assert.equal(s.mmd_git_sha, 'abc1234');
  assert.equal(s.engine, 'standard');
  assert.equal(s.dreams_total, 2);
  assert.equal(s.dreams_passed, 1);
  assert.equal(s.dreams_failed, 1);
  assert.equal(s.total_duration_seconds, 165);
  assert.equal(s.reality_check.runs, 2);
  assert.equal(s.reality_check.passed, 1);
  assert.equal(s.reality_check.pass_rate, 0.5);
  assert.equal(s.per_dream.length, 2);
});

test('@unit buildSummary: empty metrics array is well-typed', () => {
  const s = buildSummary({ metrics: [], ...SAMPLE_META });
  assert.equal(s.dreams_total, 0);
  assert.equal(s.dreams_passed, 0);
  assert.equal(s.dreams_failed, 0);
  assert.equal(s.reality_check.runs, 0);
  assert.equal(s.reality_check.pass_rate, null);
});

test('@unit buildSummary: rejects non-array metrics', () => {
  assert.throws(
    () => buildSummary({ metrics: 'nope', ...SAMPLE_META }),
    /metrics must be an array/,
  );
});

test('@unit buildReportMd: contains the AC-5 table headings + a summary paragraph', () => {
  const s = buildSummary({ metrics: SAMPLE_METRICS, ...SAMPLE_META });
  const md = buildReportMd(s);
  assert.match(md, /^# mmd bench — run /m);
  assert.match(md, /\| Dream id \| Engine \| Duration \| Exit \| Reality check \| Phase 4 findings \|/);
  assert.match(md, /`kid-01`/);
  assert.match(md, /`kid-02`/);
  assert.match(md, /## Summary/);
  assert.match(md, /1\/2 dreams passed/);
  assert.match(md, /Failing dreams: `kid-02`/);
});

test('@unit buildReportMd: all-green run prints the no-regression line', () => {
  const allGreen = SAMPLE_METRICS.map((m, i) => ({
    ...m,
    reality_check: { ...m.reality_check, passed: true, console_errors_count: 0 },
  }));
  const s = buildSummary({ metrics: allGreen, ...SAMPLE_META });
  const md = buildReportMd(s);
  assert.match(md, /All dreams green/);
});

test('@unit buildReportMd: deterministic — same inputs produce byte-identical output (AC-5)', () => {
  const s1 = buildSummary({ metrics: SAMPLE_METRICS, ...SAMPLE_META });
  const s2 = buildSummary({ metrics: SAMPLE_METRICS, ...SAMPLE_META });
  assert.equal(buildReportMd(s1), buildReportMd(s2));
});

test('@unit buildReportMd: phase4_findings_count null renders as "n/a" (honesty per ai-coding.md §I)', () => {
  const s = buildSummary({ metrics: SAMPLE_METRICS, ...SAMPLE_META });
  const md = buildReportMd(s);
  // kid-02's findings_count was null -> "n/a" in the row.
  assert.match(md, /\| `kid-02` \|[^|]+\|[^|]+\|[^|]+\|[^|]+\| n\/a \|/);
});
