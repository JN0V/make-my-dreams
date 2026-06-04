// @unit tests for lib/conductor/checkpoint.js — the externalized phase
// checkpoint + handoff primitives that make the auto-dev orchestrator
// resumable (SPEC_V012A AC-1, ADR-050).
//
// Real fs is used against a fresh tmp dir for round-trip; throwing fakes are
// injected to prove the NEVER-throws contract. decideResume/isResumable are pure.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  writeCheckpoint,
  readCheckpoint,
  writeHandoffNote,
  isResumable,
  decideResume,
  checkpointPath,
  handoffDir,
} from '../../lib/conductor/checkpoint.js';

function tmp() {
  return mkdtempSync(path.join(os.tmpdir(), 'mmd-checkpoint-'));
}

// ── AC-1: checkpoint round-trips ────────────────────────────────────────────

test('@unit AC-1: a valid checkpoint round-trips (write → read same fields)', () => {
  const dir = tmp();
  try {
    const ok = writeCheckpoint(dir, { lastCompletedPhase: 2, specFrozen: true, specPath: '.mmd/shared/slice.md' });
    assert.equal(ok, true);
    assert.ok(existsSync(checkpointPath(dir)), 'checkpoint.json written under .mmd/local/');
    const cp = readCheckpoint(dir);
    assert.deepEqual(cp, { lastCompletedPhase: 2, specFrozen: true, specPath: '.mmd/shared/slice.md' });
    // on-disk format is snake_case (what the LLM heredoc writes)
    const onDisk = JSON.parse(readFileSync(checkpointPath(dir), 'utf8'));
    assert.equal(onDisk.last_completed_phase, 2);
    assert.equal(onDisk.spec_frozen, true);
    assert.equal(onDisk.spec_path, '.mmd/shared/slice.md');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@unit AC-1: readCheckpoint reads a hand-authored snake_case checkpoint (LLM heredoc format)', () => {
  const dir = tmp();
  try {
    const target = checkpointPath(dir);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify({ last_completed_phase: 1, spec_frozen: false, spec_path: null }));
    const cp = readCheckpoint(dir);
    assert.deepEqual(cp, { lastCompletedPhase: 1, specFrozen: false, specPath: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── AC-1: missing/malformed → null (never throws) ───────────────────────────

test('@unit AC-1: readCheckpoint returns null on a missing checkpoint (never throws)', () => {
  const dir = tmp();
  try {
    assert.equal(readCheckpoint(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@unit AC-1: readCheckpoint returns null on malformed JSON (never throws)', () => {
  const dir = tmp();
  try {
    const target = checkpointPath(dir);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, '{ this is not json ');
    assert.equal(readCheckpoint(dir), null);
    // a JSON array is not a checkpoint object
    writeFileSync(target, '[1,2,3]');
    assert.equal(readCheckpoint(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── AC-1: writeHandoffNote writes handoff/<n>.md ────────────────────────────

test('@unit AC-1: writeHandoffNote writes handoff/<n>.md with the given text', () => {
  const dir = tmp();
  try {
    const ok = writeHandoffNote(dir, 2, '# Phase 2 done\nspec frozen at slice.md; next: Phase 3 implement.');
    assert.equal(ok, true);
    const notePath = path.join(handoffDir(dir), '2.md');
    assert.ok(existsSync(notePath));
    assert.match(readFileSync(notePath, 'utf8'), /Phase 2 done/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── AC-1: isResumable boundaries ────────────────────────────────────────────

test('@unit AC-1: isResumable is true iff 1 ≤ lastCompletedPhase < totalPhases', () => {
  const total = { totalPhases: 4 };
  assert.equal(isResumable({ lastCompletedPhase: 0 }, total), false, '0 = nothing done → fresh, not resumable');
  assert.equal(isResumable({ lastCompletedPhase: 1 }, total), true);
  assert.equal(isResumable({ lastCompletedPhase: 3 }, total), true);
  assert.equal(isResumable({ lastCompletedPhase: 4 }, total), false, '=totalPhases → complete, not resumable');
  assert.equal(isResumable({ lastCompletedPhase: 5 }, total), false, '>totalPhases → not resumable');
  // never throws on junk
  assert.equal(isResumable(null, total), false);
  assert.equal(isResumable(undefined, total), false);
  assert.equal(isResumable({}, total), false);
  assert.equal(isResumable({ lastCompletedPhase: 2 }, {}), false, 'missing totalPhases → false');
  assert.equal(isResumable({ lastCompletedPhase: 'x' }, total), false);
});

// ── AC-1: NEVER throws even when fs throws ──────────────────────────────────

test('@unit AC-1: write/read/handoff never throw when the injected fs throws', () => {
  const throwingFs = {
    mkdirSync() { throw new Error('boom'); },
    writeFileSync() { throw new Error('boom'); },
    readFileSync() { throw new Error('boom'); },
  };
  assert.doesNotThrow(() => {
    assert.equal(writeCheckpoint('/nope', { lastCompletedPhase: 1 }, { fs: throwingFs }), false);
    assert.equal(readCheckpoint('/nope', { fs: throwingFs }), null);
    assert.equal(writeHandoffNote('/nope', 1, 'x', { fs: throwingFs }), false);
  });
});

// ── AC-4: decideResume — the pure resume decision ───────────────────────────

test('@unit AC-4: decideResume — resumable + dead process + not done → relaunch', () => {
  const d = decideResume({
    checkpoint: { lastCompletedPhase: 2 },
    totalPhases: 4,
    processAlive: false,
    statusState: 'in_progress',
  });
  assert.equal(d.action, 'relaunch');
  assert.match(d.reason, /phase 3/);
});

test('@unit AC-4: decideResume — no checkpoint → none (no fabricated continuation)', () => {
  const d = decideResume({ checkpoint: null, totalPhases: 4 });
  assert.equal(d.action, 'none');
  assert.match(d.reason, /no resumable run/i);
});

test('@unit AC-4: decideResume — complete checkpoint (all phases done) → complete', () => {
  const d = decideResume({ checkpoint: { lastCompletedPhase: 4 }, totalPhases: 4, statusState: 'done' });
  assert.equal(d.action, 'complete');
  assert.match(d.reason, /nothing to resume/i);
});

test('@unit AC-4: decideResume — resumable but status done → complete (no relaunch)', () => {
  const d = decideResume({ checkpoint: { lastCompletedPhase: 2 }, totalPhases: 4, statusState: 'done' });
  assert.equal(d.action, 'complete');
});

test('@unit AC-4: decideResume — resumable but a live process → none (avoid double run)', () => {
  const d = decideResume({ checkpoint: { lastCompletedPhase: 2 }, totalPhases: 4, processAlive: true });
  assert.equal(d.action, 'none');
  assert.match(d.reason, /live/i);
});
