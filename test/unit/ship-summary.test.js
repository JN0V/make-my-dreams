// @unit tests for lib/ship/summary.js — pure formatters.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatShipSummary, formatDryRun } from '../../lib/ship/summary.js';

// --- formatShipSummary -----------------------------------------------------

const BASE_INFO = {
  branch: 'slice/here-add-banner-1779999999',
  baseBranch: 'main',
  sha: 'deadbeef1234567890abcdef0987654321aabbcc',
  subprocessExitCode: 0,
  subprocessSignal: null,
  logPath: '/tmp/mmd/.mmd/local/ship-runs/x.log',
  durationSeconds: 12.34,
  auditOutput: null,
};

test('@unit formatShipSummary: returns a multi-line string with the slice branch', () => {
  const out = formatShipSummary(BASE_INFO);
  assert.equal(typeof out, 'string');
  assert.ok(out.includes(BASE_INFO.branch));
  assert.ok(out.includes(BASE_INFO.baseBranch));
  assert.ok(out.includes(BASE_INFO.sha));
});

test('@unit formatShipSummary: includes the log path', () => {
  const out = formatShipSummary(BASE_INFO);
  assert.ok(out.includes(BASE_INFO.logPath));
});

test('@unit formatShipSummary: renders duration with .toFixed(1) suffix', () => {
  const out = formatShipSummary(BASE_INFO);
  assert.match(out, /12\.3s/);
});

test('@unit formatShipSummary: nil tag/PR rendered as "-"', () => {
  const out = formatShipSummary({ ...BASE_INFO, tag: null, prUrl: undefined });
  assert.match(out, /Tag created\s*:\s*-/);
  assert.match(out, /PR URL\s*:\s*-/);
});

test('@unit formatShipSummary: tag value rendered verbatim', () => {
  const out = formatShipSummary({ ...BASE_INFO, tag: 'v0.2.3' });
  assert.match(out, /Tag created\s*:\s*v0\.2\.3/);
});

test('@unit formatShipSummary: subprocess code propagated as code=N', () => {
  const out = formatShipSummary({ ...BASE_INFO, subprocessExitCode: 7 });
  assert.match(out, /code=7/);
});

test('@unit formatShipSummary: subprocess signal takes precedence over code', () => {
  const out = formatShipSummary({
    ...BASE_INFO,
    subprocessExitCode: null,
    subprocessSignal: 'SIGTERM',
  });
  assert.match(out, /signal=SIGTERM/);
});

test('@unit formatShipSummary: null subprocess code rendered as code=-', () => {
  const out = formatShipSummary({ ...BASE_INFO, subprocessExitCode: null });
  assert.match(out, /code=-/);
});

test('@unit formatShipSummary: audit output is embedded after "── pillar audit ──"', () => {
  const audit = 'gStack       | INVOKED (3)        | abc1234      | /ship · /qa · mmd ship';
  const out = formatShipSummary({ ...BASE_INFO, auditOutput: audit });
  assert.match(out, /pillar audit/);
  assert.ok(out.includes(audit));
});

test('@unit formatShipSummary: missing audit rendered as "skipped"', () => {
  const out = formatShipSummary({ ...BASE_INFO, auditOutput: null });
  assert.match(out, /pillar audit.*skipped/i);
});

test('@unit formatShipSummary: throws on non-object info', () => {
  assert.throws(() => formatShipSummary(null), TypeError);
  assert.throws(() => formatShipSummary('not an object'), TypeError);
});

// --- formatDryRun ----------------------------------------------------------

const DRY_RUN_INFO = {
  prompt: 'You are invoking the gStack ship skill.\nLine 2.\nLine 3.',
  env: { PATH: '/home/u/.bun/bin:/usr/bin', HOME: '/home/u', MMD_DREAM_MAX_LEN: '500' },
  command: 'claude',
  args: ['-p', '--output-format', 'text', 'PROMPT_PLACEHOLDER'],
  branch: 'slice/test',
  baseBranch: 'main',
  sha: 'deadbeef',
};

test('@unit formatDryRun: returns a string with "dry-run" anchor and exit-0 note', () => {
  const out = formatDryRun(DRY_RUN_INFO);
  assert.equal(typeof out, 'string');
  assert.match(out, /dry-run/);
  assert.match(out, /Exit 0/);
});

test('@unit formatDryRun: lists env vars sorted', () => {
  const out = formatDryRun(DRY_RUN_INFO);
  // HOME should appear before PATH alphabetically.
  const homeIdx = out.indexOf('HOME=');
  const pathIdx = out.indexOf('PATH=');
  assert.ok(homeIdx > 0);
  assert.ok(pathIdx > homeIdx, 'HOME line should precede PATH line (sorted)');
});

test('@unit formatDryRun: includes the prompt verbatim', () => {
  const out = formatDryRun(DRY_RUN_INFO);
  for (const line of DRY_RUN_INFO.prompt.split('\n')) {
    assert.ok(out.includes(line), `dry-run output missing prompt line: ${line}`);
  }
});

test('@unit formatDryRun: shows the planned subprocess command + args', () => {
  const out = formatDryRun(DRY_RUN_INFO);
  assert.ok(out.includes('claude'));
  // args printed via JSON.stringify so they're easy to copy-paste.
  assert.ok(out.includes('"-p"'));
  assert.ok(out.includes('"--output-format"'));
  assert.ok(out.includes('"text"'));
});

test('@unit formatDryRun: shows the branch + base + sha', () => {
  const out = formatDryRun(DRY_RUN_INFO);
  assert.ok(out.includes(DRY_RUN_INFO.branch));
  assert.ok(out.includes(DRY_RUN_INFO.baseBranch));
  assert.ok(out.includes(DRY_RUN_INFO.sha));
});

test('@unit formatDryRun: throws on non-object info', () => {
  assert.throws(() => formatDryRun(null), TypeError);
});
