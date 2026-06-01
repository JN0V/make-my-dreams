// @integration tests for v0.4.d — the LLM-as-judge behavioral oracle inside the
// sealed pipeline (SPEC_V04D AC-3, AC-4, AC-2 spawn fallback). Drives the real
// `mmd` CLI binary with the SAME fake claude the other sealed tests use
// (test/fixtures/fake-claude-sealed.sh), which now also branches on the judge
// marker ("BEHAVIORAL JUDGE") and emits a deterministic tagged verdict.
//
// The point under test is P-09: the sealed tests PASS in every case here (the
// deterministic gate is green), and the OUTCOME is decided by the judge —
//   MET (default) → slice done;
//   NOT-MET       → exit 7, the not-met AC named, slice NOT done;
//   unparseable   → uncertain → exit 7 (never a fabricated pass);
//   judge spawn failure → uncertain → exit 7.
//
// CRITICAL (recursion guard): every test sets MMD_AUTODEV_CMD to the fixture so
// the real claude is NEVER invoked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import path from 'node:path';

import { buildSubprocessEnv } from '../../lib/invoke-autodev.js';
import { slugify } from '../../lib/parse-dream.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');
const FIXTURE = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-claude-sealed.sh');

const SKIP_ON_WINDOWS = platform() === 'win32';

const DREAM = 'a counter app with plus and minus buttons';
const SLUG = slugify(DREAM);

function makeTmp() {
  return mkdtempSync(path.join(tmpdir(), 'mmd-sealed-judge-'));
}

function runMmd(args, opts = {}) {
  const env = {
    ...buildSubprocessEnv(process.env),
    MMD_AUTODEV_CMD: FIXTURE,
    MMD_REALITY_CHECK_BACKEND: 'skip',
    ...(opts.env || {}),
  };
  return spawnSync('node', [MMD, ...args], {
    cwd: opts.cwd, env, encoding: 'utf8', timeout: 60000,
  });
}

function readStatus(cwd) {
  const p = path.join(cwd, 'demo', SLUG, '.mmd', 'shared', 'status.json');
  return JSON.parse(readFileSync(p, 'utf8'));
}

// AC-3 — happy path: tests green + judge OVERALL: MET → slice done, judge logged.
test('@integration v0.4.d AC-3: --sealed judge MET → slice done, status.json.judge.overall === met', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    const r = runMmd(['--sealed', DREAM], { cwd: tmp });
    assert.equal(r.status, 0, `expected exit 0; got ${r.status}; stderr=${r.stderr}`);

    // The judge step ran AFTER the deterministic test gate and graded MET.
    assert.match(r.stdout, /sealed tests PASS/);
    assert.match(r.stdout, /JUDGE — grading the implementation against WHAT WAS ASKED/);
    assert.match(r.stdout, /JUDGE — OVERALL: MET/);

    const status = readStatus(tmp);
    assert.equal(status.state, 'done');
    assert.ok(status.judge, 'status.json must carry the judge verdict on a clean run');
    assert.equal(status.judge.overall, 'met');
    assert.ok(Array.isArray(status.judge.verdicts) && status.judge.verdicts.length >= 1);
    // BLAST still ran after the judge passed (judge sits BEFORE blast).
    assert.ok(status.blast_radius, 'blast radius is still logged after a MET judge');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// AC-4 — the whole point of P-09: tests PASS but the judge finds a behavioral
// gap → exit 7, the not-met AC named, slice NOT done.
test('@integration v0.4.d AC-4: --sealed judge NOT-MET → exit 7, named AC, slice not done', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    const r = runMmd(['--sealed', DREAM], { cwd: tmp, env: { MMD_FAKE_JUDGE_NOTMET: '1' } });
    assert.equal(r.status, 7, `expected exit 7 (behavioral-gap); got ${r.status}; stderr=${r.stderr}`);

    // The deterministic gate still passed — this is a BEHAVIORAL gap, not a test failure.
    assert.match(r.stdout, /sealed tests PASS/);
    assert.match(r.stderr, /BEHAVIORAL GAP/);
    assert.match(r.stderr, /OVERALL: not-met/);
    // The specific not-met AC + reason is printed (loud, specific — like anti-P-04).
    assert.match(r.stderr, /AC 2: not-met — .*minus button is missing/);
    assert.match(r.stderr, /NOT done/);
    // Exit 7 is distinct from the tamper exit 6 (named in the message for the human).
    assert.match(r.stderr, /Exit 7 \(behavioral-gap\)/);

    const status = readStatus(tmp);
    assert.equal(status.state, 'failed');
    assert.ok(status.judge, 'the failed status records the judge verdict');
    assert.equal(status.judge.overall, 'not-met');
    assert.equal(status.judge.verdicts.find((v) => v.ac === '2').status, 'not-met');
    // BLAST did NOT run — there should be no blast_radius on a gap exit.
    assert.equal(status.blast_radius, undefined, 'blast does not run after a behavioral gap');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// AC-4 — an unparseable judge reply falls back to uncertain → exit 7 (never a
// fabricated pass; the sacred fallback).
test('@integration v0.4.d AC-4: --sealed unparseable judge → uncertain → exit 7 (never a fabricated pass)', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    const r = runMmd(['--sealed', DREAM], { cwd: tmp, env: { MMD_FAKE_JUDGE_UNPARSEABLE: '1' } });
    assert.equal(r.status, 7, `expected exit 7; got ${r.status}; stderr=${r.stderr}`);
    assert.match(r.stderr, /BEHAVIORAL GAP/);
    assert.match(r.stderr, /OVERALL: uncertain/);

    const status = readStatus(tmp);
    assert.equal(status.state, 'failed');
    assert.equal(status.judge.overall, 'uncertain');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// AC-2 — honest fallback: the JUDGE process exits non-zero (a crash/timeout
// stand-in). The tester + coder succeed (the seam is shared, but only the judge
// branch honors MMD_FAKE_JUDGE_FAIL), so the deterministic gate passes and the
// JUDGE invocation is what fails → uncertain → exit 7, never a fabricated pass,
// never a thrown stack.
test('@integration v0.4.d AC-2: judge non-zero exit resolves to uncertain → exit 7, never a crash', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    const r = runMmd(['--sealed', DREAM], { cwd: tmp, env: { MMD_FAKE_JUDGE_FAIL: '1' } });
    assert.equal(r.status, 7, `expected exit 7 (uncertain gap); got ${r.status}; stderr=${r.stderr}`);
    // The deterministic gate passed — the JUDGE invocation is what failed.
    assert.match(r.stdout, /sealed tests PASS/);
    assert.match(r.stderr, /BEHAVIORAL GAP/);
    assert.match(r.stderr, /OVERALL: uncertain/);
    // No raw stack trace leaked — the failure was handled, not thrown.
    assert.doesNotMatch(r.stderr, /at Object\.<anonymous>|at async/, 'must not leak a raw stack trace');

    const status = readStatus(tmp);
    assert.equal(status.state, 'failed');
    assert.equal(status.judge.overall, 'uncertain');
    assert.match(status.judge.reason, /exited with code 3/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
