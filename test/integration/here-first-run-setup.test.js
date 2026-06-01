// @integration tests for the v0.6.a first-run setup guard — SPEC_V06A AC-3.
//
// runFirstRunSetup orchestrates the guard with INJECTED deps (confirmFn,
// runnerFn, detectFn) so we drive yes/no/auto/skip/ready and assert the runner
// is/isn't called and the right exit code is returned — WITHOUT shelling out to
// install-mmd.sh or needing a real TTY. This is the behavioral core the thin
// bin/mmd.js wiring delegates to.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runFirstRunSetup, EXIT_SETUP } from '../../lib/onboarding/setup.js';

// A capturing harness: records out/err writes and whether the runner ran.
function harness({ ready, confirm, runnerCode = 0, runnerThrows = false, runnerSignal = null } = {}) {
  const calls = { runner: 0, confirm: 0 };
  const out = [];
  const err = [];
  return {
    calls,
    out,
    err,
    opts: {
      targetDir: '/tmp/fake-target',
      detectFn: () => ({ ready, missing: ready ? [] : ['the project constitution (.specify/memory/constitution.md)', 'the MMD auto-dev workflow (…)'] }),
      confirmFn: async () => {
        calls.confirm += 1;
        return confirm;
      },
      runnerFn: async () => {
        calls.runner += 1;
        if (runnerThrows) throw new Error('spawn ENOENT');
        return runnerSignal ? { code: runnerCode, signal: runnerSignal } : { code: runnerCode };
      },
      cheatsheetFn: () => 'CHEATSHEET-MARKER',
      out: (s) => out.push(s),
      err: (s) => err.push(s),
    },
  };
}

test('@integration guard: already ready → no-op, runner not called, ok', async () => {
  const h = harness({ ready: true });
  const r = await runFirstRunSetup({ ...h.opts, tty: true, env: {} });
  assert.deepEqual(r, { ok: true, action: 'ready' });
  assert.equal(h.calls.runner, 0);
  assert.equal(h.calls.confirm, 0);
  // No cheat-sheet on a ready repo.
  assert.ok(!h.out.join('').includes('CHEATSHEET-MARKER'));
});

test('@integration guard: TTY + yes → runner called, cheat-sheet printed, proceed', async () => {
  const h = harness({ ready: false, confirm: true, runnerCode: 0 });
  const r = await runFirstRunSetup({ ...h.opts, tty: true, env: {} });
  assert.equal(r.ok, true);
  assert.equal(r.action, 'setup-ran');
  assert.equal(h.calls.confirm, 1);
  assert.equal(h.calls.runner, 1);
  assert.ok(h.out.join('').includes('CHEATSHEET-MARKER'), 'cheat-sheet must print after setup');
});

test('@integration guard: TTY + no → exit 8, runner NOT called, never inert', async () => {
  const h = harness({ ready: false, confirm: false });
  const r = await runFirstRunSetup({ ...h.opts, tty: true, env: {} });
  assert.equal(r.ok, false);
  assert.equal(r.action, 'declined');
  assert.equal(r.exitCode, EXIT_SETUP);
  assert.equal(r.exitCode, 8);
  assert.equal(h.calls.runner, 0);
  assert.match(h.err.join(''), /install-mmd\.sh/);
});

test('@integration guard: non-TTY → auto-run (no confirm), proceed', async () => {
  const h = harness({ ready: false, confirm: false /* ignored */, runnerCode: 0 });
  const r = await runFirstRunSetup({ ...h.opts, tty: false, env: {} });
  assert.equal(r.ok, true);
  assert.equal(r.action, 'setup-ran');
  assert.equal(h.calls.confirm, 0, 'must NOT prompt on a non-TTY');
  assert.equal(h.calls.runner, 1);
  assert.match(h.out.join(''), /not a TTY/);
});

test('@integration guard: non-TTY + runner fails (non-zero) → exit 8, never proceed', async () => {
  const h = harness({ ready: false, runnerCode: 2 });
  const r = await runFirstRunSetup({ ...h.opts, tty: false, env: {} });
  assert.equal(r.ok, false);
  assert.equal(r.action, 'failed');
  assert.equal(r.exitCode, 8);
  assert.match(h.err.join(''), /exited with code 2/);
});

test('@integration guard: runner killed by a signal → exit 8, signal surfaced (F3)', async () => {
  const h = harness({ ready: false, runnerCode: 1, runnerSignal: 'SIGTERM' });
  const r = await runFirstRunSetup({ ...h.opts, tty: false, env: {} });
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 8);
  assert.match(h.err.join(''), /terminated by SIGTERM/);
});

test('@integration guard: runner throws → exit 8, reported honestly', async () => {
  const h = harness({ ready: false, confirm: true, runnerThrows: true });
  const r = await runFirstRunSetup({ ...h.opts, tty: true, env: {} });
  assert.equal(r.ok, false);
  assert.equal(r.action, 'failed');
  assert.equal(r.exitCode, 8);
  assert.match(h.err.join(''), /failed to start/);
});

test('@integration guard: preflight veto (dirty tree) → abort exit 4, runner NOT called', async () => {
  // F7: a not-ready repo whose tree is already dirty must NOT have setup run
  // (else the post-setup commit would sweep the user's uncommitted work).
  const h = harness({ ready: false, confirm: true });
  const r = await runFirstRunSetup({
    ...h.opts,
    tty: true,
    env: {},
    preflightFn: () => ({ ok: false, exitCode: 4, message: 'error: dirty tree (exit 4)\n' }),
  });
  assert.equal(r.ok, false);
  assert.equal(r.action, 'blocked');
  assert.equal(r.exitCode, 4);
  assert.equal(h.calls.runner, 0, 'setup must not write on a dirty tree');
  assert.equal(h.calls.confirm, 0, 'must not even prompt before the preflight passes');
  assert.match(h.err.join(''), /dirty tree/);
});

test('@integration guard: preflight ok → setup proceeds normally', async () => {
  const h = harness({ ready: false, confirm: true, runnerCode: 0 });
  const r = await runFirstRunSetup({ ...h.opts, tty: true, env: {}, preflightFn: () => ({ ok: true }) });
  assert.equal(r.ok, true);
  assert.equal(r.action, 'setup-ran');
  assert.equal(h.calls.runner, 1);
});

test('@integration guard: MMD_SKIP_SETUP=1 → bypass with a warning, runner not called', async () => {
  const h = harness({ ready: false });
  const r = await runFirstRunSetup({ ...h.opts, tty: true, env: { MMD_SKIP_SETUP: '1' } });
  assert.equal(r.ok, true);
  assert.equal(r.action, 'bypassed');
  assert.equal(h.calls.runner, 0);
  assert.equal(h.calls.confirm, 0);
  assert.match(h.err.join(''), /MMD_SKIP_SETUP=1/);
});

test('@integration guard: skip is honored even on a NOT-ready repo (escape hatch precedence)', async () => {
  // Bypass must short-circuit BEFORE detect so a known-unset-up repo can still
  // be forced through (mirrors MMD_SKIP_GROUNDING).
  const h = harness({ ready: false, confirm: false });
  const r = await runFirstRunSetup({ ...h.opts, tty: false, env: { MMD_SKIP_SETUP: '1' } });
  assert.equal(r.action, 'bypassed');
  assert.equal(h.calls.runner, 0);
});
