// @unit tests for the v0.13.a cooperative handoff-REQUEST marker primitives in
// lib/conductor/checkpoint.js (SPEC_V013A AC-2). The marker is the file the
// monitor writes at 70% and the orchestrator checks at a phase boundary; MMD
// clears it before each relaunch. Real fs against a tmp dir for round-trip;
// throwing fakes prove the NEVER-throws contract.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  writeHandoffRequest,
  readHandoffRequest,
  handoffRequested,
  clearHandoffRequest,
  handoffRequestPath,
} from '../../lib/conductor/checkpoint.js';

function tmp() {
  return mkdtempSync(path.join(os.tmpdir(), 'mmd-handoff-marker-'));
}

test('@unit AC-2: write → read round-trips, present in the run-local area', () => {
  const dir = tmp();
  try {
    assert.equal(handoffRequested(dir), false, 'absent before any write');
    const ok = writeHandoffRequest(dir, { pct: 0.72, threshold: 0.7, model: 'opus' });
    assert.equal(ok, true);
    assert.ok(existsSync(handoffRequestPath(dir)), 'marker written under .mmd/local/');
    assert.ok(handoffRequestPath(dir).includes(path.join('.mmd', 'local')));
    const payload = readHandoffRequest(dir);
    assert.equal(payload.pct, 0.72);
    assert.equal(payload.model, 'opus');
    assert.ok(payload.requested_at, 'stamps a requested_at');
    assert.equal(handoffRequested(dir), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@unit AC-2: idempotent — re-writing overwrites, never duplicates; presence stays single', () => {
  const dir = tmp();
  try {
    writeHandoffRequest(dir, { pct: 0.71 });
    writeHandoffRequest(dir, { pct: 0.85 });
    assert.equal(handoffRequested(dir), true);
    assert.equal(readHandoffRequest(dir).pct, 0.85, 'last write wins');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@unit AC-2: clearable, and clear is idempotent (clearing an absent marker is a no-op success)', () => {
  const dir = tmp();
  try {
    writeHandoffRequest(dir, {});
    assert.equal(handoffRequested(dir), true);
    assert.equal(clearHandoffRequest(dir), true);
    assert.equal(handoffRequested(dir), false, 'cleared');
    assert.equal(existsSync(handoffRequestPath(dir)), false);
    // Clearing again (already absent) is fine.
    assert.equal(clearHandoffRequest(dir), true);
    assert.equal(handoffRequested(dir), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@unit AC-2: readHandoffRequest returns null when absent (never a fabricated request)', () => {
  const dir = tmp();
  try {
    assert.equal(readHandoffRequest(dir), null);
    assert.equal(handoffRequested(dir), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@unit AC-2: a present-but-malformed marker still reads as requested (presence is the signal)', () => {
  const dir = tmp();
  try {
    // Write a valid marker, then corrupt the body via an injected fs read.
    writeHandoffRequest(dir, { pct: 0.7 });
    const badFs = {
      readFileSync: () => 'not json at all',
    };
    const payload = readHandoffRequest(dir, { fs: badFs });
    assert.deepEqual(payload, {}, 'malformed body → {} (still present)');
    assert.equal(handoffRequested(dir, { fs: badFs }), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@unit AC-2: marker primitives never throw on a hostile fs / payload', () => {
  const throwingFs = {
    mkdirSync: () => { throw new Error('boom'); },
    writeFileSync: () => { throw new Error('boom'); },
    readFileSync: () => { throw new Error('boom'); },
    rmSync: () => { throw new Error('boom'); },
  };
  assert.doesNotThrow(() => writeHandoffRequest('/x', {}, { fs: throwingFs }));
  assert.equal(writeHandoffRequest('/x', {}, { fs: throwingFs }), false);
  assert.equal(readHandoffRequest('/x', { fs: throwingFs }), null);
  assert.equal(clearHandoffRequest('/x', { fs: throwingFs }), false);
  // A circular payload must not defeat the write (presence matters).
  const dir = tmp();
  try {
    const circular = {};
    circular.self = circular;
    assert.doesNotThrow(() => writeHandoffRequest(dir, circular));
    assert.equal(handoffRequested(dir), true, 'marker present despite circular payload');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
