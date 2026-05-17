// @unit tests for lib/ship/summary.js — SPEC_V02F AC-4 + AC-7.
// Pure function tests, no I/O.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatShipSummary, formatDryRun } from '../../lib/ship/summary.js';

const MIN_INFO = {
  branch: 'slice/here-foo-1779537600',
  baseBranch: 'main',
  sha: 'abc1234',
};

test('@unit formatShipSummary: emits the canonical header', () => {
  const s = formatShipSummary(MIN_INFO);
  assert.match(s, /mmd ship — summary/);
});

test('@unit formatShipSummary: includes branch + base + sha verbatim', () => {
  const s = formatShipSummary(MIN_INFO);
  assert.ok(s.includes(MIN_INFO.branch));
  assert.ok(s.includes(MIN_INFO.baseBranch));
  assert.ok(s.includes(MIN_INFO.sha));
});

test('@unit formatShipSummary: optional fields render as "-" when missing', () => {
  const s = formatShipSummary(MIN_INFO);
  assert.match(s, /Tag created\s*:\s*-/);
  assert.match(s, /PR URL\s*:\s*-/);
  assert.match(s, /Log file\s*:\s*-/);
});

test('@unit formatShipSummary: tag + PR URL render when supplied', () => {
  const s = formatShipSummary({
    ...MIN_INFO,
    tag: 'v0.2.3',
    prUrl: 'https://github.com/JN0V/mmd/pull/42',
  });
  assert.ok(s.includes('v0.2.3'));
  assert.ok(s.includes('github.com/JN0V/mmd/pull/42'));
});

test('@unit formatShipSummary: testsRun + testsPassed bool flags render', () => {
  const s = formatShipSummary({ ...MIN_INFO, testsRun: true, testsPassed: true });
  assert.match(s, /Tests run\s*:\s*yes \(passed: yes\)/);
  const s2 = formatShipSummary({ ...MIN_INFO, testsRun: true, testsPassed: false });
  assert.match(s2, /Tests run\s*:\s*yes \(passed: no\)/);
});

test('@unit formatShipSummary: subprocessExitCode renders', () => {
  const ok = formatShipSummary({ ...MIN_INFO, subprocessExitCode: 0 });
  assert.match(ok, /Subprocess\s*:\s*code=0/);
  const fail = formatShipSummary({ ...MIN_INFO, subprocessExitCode: 6 });
  assert.match(fail, /Subprocess\s*:\s*code=6/);
});

test('@unit formatShipSummary: subprocessSignal renders when present (overrides code)', () => {
  const s = formatShipSummary({ ...MIN_INFO, subprocessExitCode: null, subprocessSignal: 'SIGTERM' });
  assert.match(s, /signal=SIGTERM/);
});

test('@unit formatShipSummary: durationSeconds renders to 1 decimal', () => {
  const s = formatShipSummary({ ...MIN_INFO, durationSeconds: 12.345 });
  assert.match(s, /Duration\s*:\s*12\.3s/);
});

test('@unit formatShipSummary: auditOutput is included when provided', () => {
  const audit = '\n  pillar audit table here\n';
  const s = formatShipSummary({ ...MIN_INFO, auditOutput: audit });
  assert.match(s, /pillar audit \(scripts\/audit-pillars\.sh\)/);
  assert.ok(s.includes('pillar audit table here'));
});

test('@unit formatShipSummary: no auditOutput → "skipped" line printed', () => {
  const s = formatShipSummary(MIN_INFO);
  assert.match(s, /pillar audit:\s*skipped/);
});

test('@unit formatShipSummary: throws on non-object input', () => {
  assert.throws(() => formatShipSummary(null), TypeError);
  assert.throws(() => formatShipSummary('string'), TypeError);
});

test('@unit formatDryRun: emits the dry-run header', () => {
  const s = formatDryRun({
    prompt: 'fake',
    env: { PATH: '/x:/y' },
    command: 'claude',
    args: ['-p', '--output-format', 'text', 'fake'],
    branch: 'slice/foo',
    baseBranch: 'main',
    sha: 'abc',
  });
  assert.match(s, /dry-run/);
  assert.match(s, /no subprocess was spawned/i);
});

test('@unit formatDryRun: prompt body is included verbatim (indented)', () => {
  const prompt = 'line1\nline2 with content\nline3';
  const s = formatDryRun({
    prompt,
    env: {},
    command: 'claude',
    args: [],
    branch: 'slice/x',
    baseBranch: 'main',
    sha: 'abc',
  });
  assert.ok(s.includes('line1'));
  assert.ok(s.includes('line2 with content'));
  assert.ok(s.includes('line3'));
});

test('@unit formatDryRun: env keys printed sorted', () => {
  const s = formatDryRun({
    prompt: 'p',
    env: { Z: 'z', A: 'a', M: 'm' },
    command: 'claude',
    args: [],
    branch: 'slice/x',
    baseBranch: 'main',
    sha: 'abc',
  });
  const aIdx = s.indexOf('A=a');
  const mIdx = s.indexOf('M=m');
  const zIdx = s.indexOf('Z=z');
  assert.ok(aIdx > 0 && mIdx > aIdx && zIdx > mIdx, 'env keys should be sorted');
});

test('@unit formatDryRun: command + args printed as a quoted invocation', () => {
  const s = formatDryRun({
    prompt: 'p',
    env: {},
    command: 'claude',
    args: ['-p', 'foo'],
    branch: 'slice/x',
    baseBranch: 'main',
    sha: 'abc',
  });
  assert.match(s, /claude\s+"-p"\s+"foo"/);
});

test('@unit formatDryRun: throws on non-object input', () => {
  assert.throws(() => formatDryRun(null), TypeError);
});
