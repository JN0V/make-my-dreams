// @integration tests for the v0.14.b abort seam in lib/invoke-autodev.js
// (SPEC_V014B AC-1, ADR-053). The HYBRID auto-handoff's ENFORCE backstop: a
// caller-supplied predicate checked on each monitor tick; on fire MMD terminates
// the child PROCESS GROUP (SIGTERM → SIGKILL) after a grace and resolves a
// distinct `{ aborted: 'handoff', code: null }`. When the predicate never fires
// or the child exits first, behavior is exactly as today.
//
// We call invokeAutodev DIRECTLY (not via bin/mmd.js) with MMD_AUTODEV_CMD →
// fake-claude-streamjson-alive.js, so no real claude / network is hit. The fake
// emits stream-json crossing 70% and either stays alive (so the enforce path has
// something to kill) or exits on its own (the control cases).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import path from 'node:path';

import { invokeAutodev } from '../../lib/invoke-autodev.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const FAKE_ALIVE = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-claude-streamjson-alive.js');
const SKIP_ON_WINDOWS = platform() === 'win32'; // POSIX process-group signalling

function makeTmp() {
  return mkdtempSync(path.join(tmpdir(), 'mmd-abort-'));
}

function baseArgs(tmp) {
  return {
    demoDir: tmp,
    dream: 'context-filling change',
    slug: 'abort-slice',
    logPath: path.join(tmp, 'run.log'),
    timeoutMs: 0, // no timeout — isolate the abort path (L-016)
    monitor: true,
    graceMs: 0, // terminate immediately on fire — keeps the test fast
  };
}

// ── AC-1: predicate fires → process group terminated + aborted result ────────

test('@integration AC-1: abort predicate fires → child terminated, resolves { aborted: "handoff", code: null }',
  { skip: SKIP_ON_WINDOWS }, async () => {
    const tmp = makeTmp();
    process.env.MMD_AUTODEV_CMD = FAKE_ALIVE;
    try {
      const r = await invokeAutodev({
        ...baseArgs(tmp),
        // The fake stays alive after crossing 70%, so only the enforce path ends it.
        // (MMD_FAKE_ALIVE rides the MMD_ allowlist into the child env.)
        // Predicate fires once the monitor reports >= 70%.
        abortPredicate: (ctx) => ctx && ctx.pct >= 0.70,
      });
      assert.equal(r.aborted, 'handoff', 'aborted result is the distinct handoff sentinel');
      assert.equal(r.code, null, 'code is null on an enforced abort');
    } finally {
      delete process.env.MMD_AUTODEV_CMD;
      rmSync(tmp, { recursive: true, force: true });
    }
  });

// Set MMD_FAKE_ALIVE for the stay-alive test via process.env (MMD_-prefixed so it
// survives buildSubprocessEnv's allowlist into the child).
test('@integration AC-1: a STILL-ALIVE agent over threshold is force-terminated (no orphan, aborted result)',
  { skip: SKIP_ON_WINDOWS }, async () => {
    const tmp = makeTmp();
    process.env.MMD_AUTODEV_CMD = FAKE_ALIVE;
    process.env.MMD_FAKE_ALIVE = '1';
    try {
      const started = Date.now();
      const r = await invokeAutodev({
        ...baseArgs(tmp),
        abortPredicate: (ctx) => ctx && ctx.pct >= 0.70,
      });
      assert.equal(r.aborted, 'handoff');
      assert.equal(r.code, null);
      // It resolved promptly (the fake would otherwise sleep forever) — proof the
      // enforce actually terminated the live process, not a timeout.
      assert.ok(Date.now() - started < 20000, 'enforce terminated the live agent promptly');
    } finally {
      delete process.env.MMD_AUTODEV_CMD;
      delete process.env.MMD_FAKE_ALIVE;
      rmSync(tmp, { recursive: true, force: true });
    }
  });

// ── AC-1: predicate never fires → behavior exactly as today ──────────────────

test('@integration AC-1: predicate never fires → normal { code: 0 } result (no abort)',
  { skip: SKIP_ON_WINDOWS }, async () => {
    const tmp = makeTmp();
    process.env.MMD_AUTODEV_CMD = FAKE_ALIVE; // exits on its own (no MMD_FAKE_ALIVE)
    try {
      const r = await invokeAutodev({
        ...baseArgs(tmp),
        abortPredicate: () => false, // never fires
      });
      assert.equal(r.code, 0, 'normal completion');
      assert.equal(r.aborted, undefined, 'no aborted flag when the predicate never fires');
    } finally {
      delete process.env.MMD_AUTODEV_CMD;
      rmSync(tmp, { recursive: true, force: true });
    }
  });

// ── AC-1: child exits first (cooperative) → normal result even if predicate true
// The fake exits on its own BEFORE the grace elapses. Even with a predicate that
// would fire, a child that exits first resolves normally — the Path A contract.

test('@integration AC-1: child exits first → normal result (cooperative path, never aborted)',
  { skip: SKIP_ON_WINDOWS }, async () => {
    const tmp = makeTmp();
    process.env.MMD_AUTODEV_CMD = FAKE_ALIVE; // exits on its own
    try {
      const r = await invokeAutodev({
        ...baseArgs(tmp),
        // A long grace: the fake exits well before it elapses, so even though the
        // predicate fires we resolve with the child's own exit (not aborted).
        graceMs: 10000,
        abortPredicate: (ctx) => ctx && ctx.pct >= 0.70,
      });
      assert.equal(r.code, 0, 'the child exited cleanly first');
      assert.equal(r.aborted, undefined, 'a cooperative exit during the grace is NOT an enforced abort');
    } finally {
      delete process.env.MMD_AUTODEV_CMD;
      rmSync(tmp, { recursive: true, force: true });
    }
  });

// ── AC-1: NO abort predicate → default path untouched (no detached, normal result)

test('@integration AC-1: without an abort predicate the spawn is unchanged (normal result)',
  { skip: SKIP_ON_WINDOWS }, async () => {
    const tmp = makeTmp();
    process.env.MMD_AUTODEV_CMD = FAKE_ALIVE; // exits on its own
    try {
      const r = await invokeAutodev({
        ...baseArgs(tmp),
        // no abortPredicate at all
      });
      assert.equal(r.code, 0);
      assert.equal(r.aborted, undefined);
    } finally {
      delete process.env.MMD_AUTODEV_CMD;
      rmSync(tmp, { recursive: true, force: true });
    }
  });
