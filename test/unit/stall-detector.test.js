// @unit tests for lib/conductor/stall-detector.js — SPEC_V02J AC-1.
//
// Exhaustive per AC-1: empty status, missing slice, fresh slice (no commits),
// commits within threshold, exceeding threshold, error pattern hit, multiple
// signals stacked. All deterministic via injected clock + fs + git.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  detectStall,
  resolveThresholds,
  DEFAULT_THRESHOLDS,
} from '../../lib/conductor/stall-detector.js';
import { unknownSignals } from '../../lib/conductor/stall-signals.js';

const NOW_MS = Date.parse('2026-05-18T10:00:00.000Z');
const NOW_SEC = Math.floor(NOW_MS / 1000);

/** Build a detectStall opts bundle with sensible injectable defaults. */
function opts(over = {}) {
  return {
    statusJsonPath: '/fake/status.json',
    sliceBranch: 'slice/x',
    repoRoot: '/fake/repo',
    now: () => NOW_MS,
    readFileFn: () => { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; },
    gitLastCommitEpochFn: () => null,
    // SPEC_V02N: default to a clean tree so existing cases stay hermetic (no
    // real `git status` spawn). AC-2 cases override this explicitly.
    gitWorktreeDirtyFn: () => false,
    readRunLogsFn: () => '',
    env: {},
    ...over,
  };
}

test('@unit detectStall throws on bad args', () => {
  assert.throws(() => detectStall(null), TypeError);
  assert.throws(() => detectStall({ sliceBranch: '', repoRoot: 'r' }), TypeError);
  assert.throws(() => detectStall({ sliceBranch: 's', repoRoot: '' }), TypeError);
});

test('@unit empty/missing status + no commits + no logs → not stalled', () => {
  const r = detectStall(opts());
  assert.equal(r.stalled, false);
  assert.deepEqual(r.signals, []);
  assert.equal(r.evidence.lastCommitAgeMin, null);
  assert.deepEqual(r.evidence.errors, []);
});

test('@unit fresh slice (no commits) does not raise no-commit-since-N-min', () => {
  const r = detectStall(opts({ gitLastCommitEpochFn: () => null }));
  assert.equal(r.signals.includes('no-commit-since-N-min'), false);
});

test('@unit commit within threshold → no no-commit signal', () => {
  const fiveMinAgo = NOW_SEC - 5 * 60;
  const r = detectStall(opts({ gitLastCommitEpochFn: () => fiveMinAgo }));
  assert.equal(r.signals.includes('no-commit-since-N-min'), false);
  assert.equal(r.evidence.lastCommitAgeMin, 5);
});

test('@unit commit exceeding threshold → no-commit-since-N-min', () => {
  const thirtyMinAgo = NOW_SEC - 30 * 60;
  const r = detectStall(opts({ gitLastCommitEpochFn: () => thirtyMinAgo }));
  assert.equal(r.stalled, true);
  assert.equal(r.signals.includes('no-commit-since-N-min'), true);
  assert.equal(r.evidence.lastCommitAgeMin, 30);
});

test('@unit state:failed → state-failed-explicit', () => {
  const r = detectStall(opts({
    readFileFn: () => JSON.stringify({ state: 'failed' }),
  }));
  assert.equal(r.signals.includes('state-failed-explicit'), true);
  assert.equal(r.evidence.state, 'failed');
});

test('@unit retry count above threshold → retry-count-exceeded', () => {
  const tasks = Array.from({ length: 4 }, (_, i) => ({ id: `t${i}`, state: 'failed' }));
  const r = detectStall(opts({
    readFileFn: () => JSON.stringify({ state: 'in_progress', tasks }),
  }));
  assert.equal(r.signals.includes('retry-count-exceeded'), true);
  assert.equal(r.evidence.retryCount, 4);
});

test('@unit retry count at threshold (==3) does NOT fire (strictly greater)', () => {
  const tasks = Array.from({ length: 3 }, (_, i) => ({ id: `t${i}`, state: 'failed' }));
  const r = detectStall(opts({
    readFileFn: () => JSON.stringify({ state: 'in_progress', tasks }),
  }));
  assert.equal(r.signals.includes('retry-count-exceeded'), false);
});

test('@unit duration > factor*budget → duration-exceeded-budget', () => {
  const r = detectStall(opts({
    readFileFn: () => JSON.stringify({
      state: 'in_progress',
      engine_metrics: { duration_seconds: 4000, budget_seconds: 1800 },
    }),
  }));
  assert.equal(r.signals.includes('duration-exceeded-budget'), true);
});

test('@unit duration just under factor*budget does NOT fire', () => {
  const r = detectStall(opts({
    readFileFn: () => JSON.stringify({
      state: 'in_progress',
      engine_metrics: { duration_seconds: 1800.6, budget_seconds: 1800 },
    }),
  }));
  assert.equal(r.signals.includes('duration-exceeded-budget'), false);
});

test('@unit error pattern in logs → error-pattern-matched', () => {
  const r = detectStall(opts({
    readRunLogsFn: () => 'phase 2\n[mmd] subprocess timed out\n',
  }));
  assert.equal(r.signals.includes('error-pattern-matched'), true);
  assert.match(r.evidence.errorPatternSample, /subprocess timed out/);
});

test('@unit clean logs → no error-pattern signal', () => {
  const r = detectStall(opts({ readRunLogsFn: () => 'phase 2: tests passing\n' }));
  assert.equal(r.signals.includes('error-pattern-matched'), false);
});

test('@unit heartbeat older than threshold → heartbeat-stale', () => {
  const staleHb = new Date(NOW_MS - 20 * 60 * 1000).toISOString();
  const r = detectStall(opts({
    readFileFn: () => JSON.stringify({ state: 'in_progress', heartbeat_at: staleHb }),
  }));
  assert.equal(r.signals.includes('heartbeat-stale'), true);
});

test('@unit multiple signals stacked + emitted in canonical enum order', () => {
  const thirtyMinAgo = NOW_SEC - 30 * 60;
  const tasks = Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, state: 'failed' }));
  const r = detectStall(opts({
    readFileFn: () => JSON.stringify({
      state: 'failed',
      tasks,
      engine_metrics: { duration_seconds: 5000, budget_seconds: 1800 },
    }),
    gitLastCommitEpochFn: () => thirtyMinAgo,
    readRunLogsFn: () => 'FATAL: boom\n',
  }));
  assert.equal(r.stalled, true);
  // canonical order
  assert.deepEqual(r.signals, [
    'no-commit-since-N-min',
    'retry-count-exceeded',
    'error-pattern-matched',
    'duration-exceeded-budget',
    'state-failed-explicit',
  ]);
  assert.deepEqual(unknownSignals(r.signals), []);
});

// ── SPEC_V02N AC-2: wip-uncommitted-since-N-min detection ───────────────────

test('@unit AC-2 dirty tree + stale commit → wip-uncommitted-since-N-min', () => {
  const thirtyMinAgo = NOW_SEC - 30 * 60;
  const r = detectStall(opts({
    gitLastCommitEpochFn: () => thirtyMinAgo,
    gitWorktreeDirtyFn: () => true,
  }));
  assert.equal(r.stalled, true);
  assert.equal(r.evidence.worktreeDirty, true);
  assert.equal(r.evidence.wipUncommittedMin, 30);
  assert.equal(r.signals.includes('wip-uncommitted-since-N-min'), true);
  // Both no-commit and wip fire (different remedies); each emitted once, in
  // canonical enum order (no-commit before wip).
  assert.deepEqual(r.signals, ['no-commit-since-N-min', 'wip-uncommitted-since-N-min']);
});

test('@unit AC-2 negative: clean tree + stale commit → NO wip signal', () => {
  const thirtyMinAgo = NOW_SEC - 30 * 60;
  const r = detectStall(opts({
    gitLastCommitEpochFn: () => thirtyMinAgo,
    gitWorktreeDirtyFn: () => false,
  }));
  assert.equal(r.evidence.worktreeDirty, false);
  assert.equal(r.evidence.wipUncommittedMin, null);
  assert.equal(r.signals.includes('wip-uncommitted-since-N-min'), false);
  // A clean stale branch is the legitimate no-commit-since-N-min case.
  assert.equal(r.signals.includes('no-commit-since-N-min'), true);
});

test('@unit AC-2 boundary: dirty tree + fresh commit (< threshold) → NO wip signal', () => {
  const fiveMinAgo = NOW_SEC - 5 * 60;
  const r = detectStall(opts({
    gitLastCommitEpochFn: () => fiveMinAgo,
    gitWorktreeDirtyFn: () => true,
  }));
  assert.equal(r.evidence.worktreeDirty, true);
  assert.equal(r.evidence.wipUncommittedMin, 5); // derived, but under threshold
  assert.equal(r.signals.includes('wip-uncommitted-since-N-min'), false);
});

test('@unit AC-2 fresh branch (no commits) + dirty tree → NO wip signal, wipUncommittedMin null', () => {
  const r = detectStall(opts({
    gitLastCommitEpochFn: () => null,
    gitWorktreeDirtyFn: () => true,
  }));
  assert.equal(r.evidence.worktreeDirty, true);
  assert.equal(r.evidence.wipUncommittedMin, null);
  assert.equal(r.signals.includes('wip-uncommitted-since-N-min'), false);
});

test('@unit AC-2 gitWorktreeDirtyFn that throws → worktreeDirty null + errors entry (no crash)', () => {
  const thirtyMinAgo = NOW_SEC - 30 * 60;
  const r = detectStall(opts({
    gitLastCommitEpochFn: () => thirtyMinAgo,
    gitWorktreeDirtyFn: () => { throw new Error('git boom'); },
  }));
  assert.equal(r.evidence.worktreeDirty, null);
  assert.equal(r.evidence.wipUncommittedMin, null);
  assert.equal(r.signals.includes('wip-uncommitted-since-N-min'), false);
  assert.ok(r.evidence.errors.some((e) => /worktree-dirty lookup failed/.test(e)));
});

// ── SPEC_V02N AC-3: threshold + env override ────────────────────────────────

test('@unit AC-3 DEFAULT_THRESHOLDS.wipUncommittedMin === 15', () => {
  assert.equal(DEFAULT_THRESHOLDS.wipUncommittedMin, 15);
});

test('@unit AC-3 MMD_STALL_WIP_UNCOMMITTED_MIN=25 → resolved 25', () => {
  const t = resolveThresholds({ MMD_STALL_WIP_UNCOMMITTED_MIN: '25' });
  assert.equal(t.wipUncommittedMin, 25);
});

test('@unit AC-3 non-numeric/empty env falls back to default', () => {
  assert.equal(resolveThresholds({ MMD_STALL_WIP_UNCOMMITTED_MIN: 'abc' }).wipUncommittedMin, 15);
  assert.equal(resolveThresholds({ MMD_STALL_WIP_UNCOMMITTED_MIN: '' }).wipUncommittedMin, 15);
});

test('@unit AC-3 explicit thresholds arg beats env (defaults < env < arg)', () => {
  const t = resolveThresholds(
    { MMD_STALL_WIP_UNCOMMITTED_MIN: '25' },
    { wipUncommittedMin: 99 },
  );
  assert.equal(t.wipUncommittedMin, 99);
});

test('@unit AC-3 env threshold flows through detectStall (20 min commit, 15-min env)', () => {
  const twentyMinAgo = NOW_SEC - 20 * 60;
  const r = detectStall(opts({
    gitLastCommitEpochFn: () => twentyMinAgo,
    gitWorktreeDirtyFn: () => true,
    env: { MMD_STALL_WIP_UNCOMMITTED_MIN: '15' },
  }));
  assert.equal(r.signals.includes('wip-uncommitted-since-N-min'), true);
  assert.equal(r.evidence.wipUncommittedMin, 20);
});

test('@unit malformed status.json is captured in evidence.errors (no throw)', () => {
  const r = detectStall(opts({ readFileFn: () => '{ not json' }));
  assert.ok(r.evidence.errors.length >= 1);
  assert.match(r.evidence.errors[0], /malformed/);
});

test('@unit determinism: same inputs → identical output', () => {
  const o = opts({ gitLastCommitEpochFn: () => NOW_SEC - 30 * 60 });
  const a = detectStall(o);
  const b = detectStall(o);
  assert.deepEqual(a, b);
});

test('@unit detector is sub-100ms on injected inputs (perf budget)', () => {
  const o = opts({ gitLastCommitEpochFn: () => NOW_SEC - 30 * 60, readRunLogsFn: () => 'x'.repeat(8192) });
  const t0 = Date.now();
  detectStall(o);
  assert.ok(Date.now() - t0 < 100);
});

test('@unit resolveThresholds: env overrides defaults', () => {
  const t = resolveThresholds({ MMD_STALL_MIN_NOCOMMIT: '20', MMD_STALL_MAX_RETRIES: '7' });
  assert.equal(t.minNoCommitMin, 20);
  assert.equal(t.maxRetries, 7);
  assert.equal(t.durationBudgetFactor, DEFAULT_THRESHOLDS.durationBudgetFactor);
});

test('@unit resolveThresholds: explicit arg overrides env', () => {
  const t = resolveThresholds({ MMD_STALL_MIN_NOCOMMIT: '20' }, { minNoCommitMin: 99 });
  assert.equal(t.minNoCommitMin, 99);
});

test('@unit threshold arg flows through detectStall', () => {
  const eightMinAgo = NOW_SEC - 8 * 60;
  const r = detectStall(opts({
    gitLastCommitEpochFn: () => eightMinAgo,
    thresholds: { minNoCommitMin: 5 },
  }));
  assert.equal(r.signals.includes('no-commit-since-N-min'), true);
});

test('@unit fixture timeout-stall behaves as L-016 mirror', () => {
  const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
  const fixtureRoot = path.join(REPO_ROOT, 'test', 'fixtures', 'stuck-slices', 'timeout-stall');
  const statusPath = path.join(fixtureRoot, '.mmd', 'shared', 'status.json');
  const r = detectStall({
    statusJsonPath: statusPath,
    sliceBranch: 'slice/timeout-stall',
    repoRoot: fixtureRoot,
    now: () => Date.parse('2026-05-18T09:30:00.600Z'),
    gitLastCommitEpochFn: () => Math.floor(Date.parse('2026-05-18T08:50:00Z') / 1000),
    env: {},
  });
  assert.equal(r.stalled, true);
  assert.equal(r.evidence.state, 'failed');
  assert.equal(r.evidence.durationSeconds, 1800.6);
  assert.equal(r.signals.includes('state-failed-explicit'), true);
  assert.equal(r.signals.includes('error-pattern-matched'), true);
});

test('@unit fixture fresh-not-stalled is the negative control', () => {
  const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
  const fixtureRoot = path.join(REPO_ROOT, 'test', 'fixtures', 'stuck-slices', 'fresh-not-stalled');
  const statusPath = path.join(fixtureRoot, '.mmd', 'shared', 'status.json');
  const r = detectStall({
    statusJsonPath: statusPath,
    sliceBranch: 'slice/fresh',
    repoRoot: fixtureRoot,
    now: () => Date.parse('2026-05-18T12:01:30.000Z'),
    gitLastCommitEpochFn: () => Math.floor(Date.parse('2026-05-18T12:01:00Z') / 1000),
    readRunLogsFn: () => '',
    env: {},
  });
  assert.equal(r.stalled, false);
  assert.deepEqual(r.signals, []);
});
