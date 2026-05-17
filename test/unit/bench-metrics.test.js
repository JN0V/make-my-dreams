// test/unit/bench-metrics.test.js
// @unit — serializer + Phase 4 findings parser (SPEC_V02B AC-4).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { serializeMetrics, countPhase4Findings } from '../../lib/bench/metrics.js';

function validInput(overrides = {}) {
  return {
    dream_id: 'kid-01-drawing-camera-overlay',
    engine: 'standard',
    started_at: '2026-05-17T16:00:00.000Z',
    ended_at: '2026-05-17T16:42:18.000Z',
    duration_seconds: 2538,
    exit_code: 0,
    reality_check: {
      ran: true,
      passed: true,
      screenshot_path: 'bench/runs/r1/kid-01/screenshot.png',
      console_errors_count: 0,
    },
    commits_count: 7,
    phase4_findings_count: 3,
    log_path: 'bench/runs/r1/kid-01/run.log',
    ...overrides,
  };
}

test('@unit serializeMetrics: happy path returns AC-4 shape', () => {
  const out = serializeMetrics(validInput());
  // Spec AC-4 lists these keys verbatim — assert each one.
  assert.equal(out.dream_id, 'kid-01-drawing-camera-overlay');
  assert.equal(out.engine, 'standard');
  assert.equal(out.duration_seconds, 2538);
  assert.equal(out.exit_code, 0);
  assert.equal(out.reality_check.ran, true);
  assert.equal(out.reality_check.passed, true);
  assert.equal(out.reality_check.screenshot_path, 'bench/runs/r1/kid-01/screenshot.png');
  assert.equal(out.reality_check.console_errors_count, 0);
  assert.equal(out.commits_count, 7);
  assert.equal(out.phase4_findings_count, 3);
  assert.equal(out.log_path, 'bench/runs/r1/kid-01/run.log');
});

test('@unit serializeMetrics: asJSON returns string ending with newline', () => {
  const s = serializeMetrics({ ...validInput(), asJSON: true });
  assert.equal(typeof s, 'string');
  assert.ok(s.endsWith('\n'));
  // Round-trip safe.
  const parsed = JSON.parse(s);
  assert.equal(parsed.dream_id, 'kid-01-drawing-camera-overlay');
});

test('@unit serializeMetrics: phase4_findings_count can be null', () => {
  const out = serializeMetrics({ ...validInput(), phase4_findings_count: null });
  assert.equal(out.phase4_findings_count, null);
});

test('@unit serializeMetrics: missing required field throws', () => {
  const v = validInput();
  delete v.engine;
  assert.throws(() => serializeMetrics(v), /missing required field 'engine'/);
});

test('@unit serializeMetrics: rejects negative duration', () => {
  assert.throws(
    () => serializeMetrics(validInput({ duration_seconds: -1 })),
    /duration_seconds must be a non-negative number/,
  );
});

test('@unit serializeMetrics: rejects non-boolean reality_check.passed', () => {
  assert.throws(
    () => serializeMetrics(validInput({
      reality_check: { ran: true, passed: 'yes', console_errors_count: 0 },
    })),
    /reality_check.ran\/passed must be booleans/,
  );
});

test('@unit countPhase4Findings: returns 0 on log with no findings', () => {
  assert.equal(countPhase4Findings('## Phase 1\nnothing here\n'), 0);
});

test('@unit countPhase4Findings: counts ## Finding F1 / F2 / F12', () => {
  const log = [
    '## Phase 4: adversarial code review',
    '',
    '## Finding F1: missing CSP',
    'body',
    '## Finding F2: ENOENT swallowed',
    'body',
    '## Finding F12: race condition',
    'body',
  ].join('\n');
  assert.equal(countPhase4Findings(log), 3);
});

test('@unit countPhase4Findings: ignores `## Finding F1A` (strict word boundary)', () => {
  assert.equal(countPhase4Findings('## Finding F1A: rev marker\n'), 0);
});

test('@unit countPhase4Findings: returns null on null/undefined input (honest reporting per ai-coding.md §I)', () => {
  assert.equal(countPhase4Findings(null), null);
  assert.equal(countPhase4Findings(undefined), null);
});

test('@unit countPhase4Findings: accepts a Buffer input', () => {
  assert.equal(
    countPhase4Findings(Buffer.from('## Finding F7: x\n', 'utf8')),
    1,
  );
});
