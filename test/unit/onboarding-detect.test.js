// @unit tests for lib/onboarding/detect.js — SPEC_V06A AC-2.
// detectMmdSetup(targetDir) → {ready, missing[]}: fs reads only, never throws,
// names the absent pieces in plain language.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  detectMmdSetup,
  CONSTITUTION_REL,
  AUTODEV_WORKFLOW_REL,
  ADV_COMMAND_REL,
} from '../../lib/onboarding/detect.js';

function tmpRepo() {
  return mkdtempSync(path.join(tmpdir(), 'mmd-detect-'));
}

function touch(dir, rel, body = 'x') {
  const full = path.join(dir, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, body, 'utf8');
}

test('@unit detectMmdSetup: fully set-up repo (constitution + workflow) → ready', () => {
  const dir = tmpRepo();
  try {
    touch(dir, CONSTITUTION_REL);
    touch(dir, AUTODEV_WORKFLOW_REL);
    const r = detectMmdSetup(dir);
    assert.equal(r.ready, true);
    assert.deepEqual(r.missing, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@unit detectMmdSetup: ready via the adv slash-command alone (no _bmad workflow file)', () => {
  const dir = tmpRepo();
  try {
    touch(dir, CONSTITUTION_REL);
    touch(dir, ADV_COMMAND_REL);
    const r = detectMmdSetup(dir);
    assert.equal(r.ready, true, JSON.stringify(r));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@unit detectMmdSetup: bare repo → not ready, both pieces named', () => {
  const dir = tmpRepo();
  try {
    const r = detectMmdSetup(dir);
    assert.equal(r.ready, false);
    assert.equal(r.missing.length, 2);
    assert.ok(r.missing.some((m) => m.includes(CONSTITUTION_REL)));
    assert.ok(r.missing.some((m) => m.includes(AUTODEV_WORKFLOW_REL) || m.includes(ADV_COMMAND_REL)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@unit detectMmdSetup: constitution present, workflow missing → names only the workflow', () => {
  const dir = tmpRepo();
  try {
    touch(dir, CONSTITUTION_REL);
    const r = detectMmdSetup(dir);
    assert.equal(r.ready, false);
    assert.equal(r.missing.length, 1);
    assert.ok(r.missing[0].includes(AUTODEV_WORKFLOW_REL));
    assert.ok(!r.missing[0].includes(CONSTITUTION_REL));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@unit detectMmdSetup: workflow present, constitution missing → names only the constitution', () => {
  const dir = tmpRepo();
  try {
    touch(dir, AUTODEV_WORKFLOW_REL);
    const r = detectMmdSetup(dir);
    assert.equal(r.ready, false);
    assert.equal(r.missing.length, 1);
    assert.ok(r.missing[0].includes(CONSTITUTION_REL));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@unit detectMmdSetup: a directory at the constitution path does NOT count as the file', () => {
  const dir = tmpRepo();
  try {
    // Create .specify/memory/constitution.md as a DIRECTORY — must not satisfy.
    mkdirSync(path.join(dir, CONSTITUTION_REL), { recursive: true });
    touch(dir, AUTODEV_WORKFLOW_REL);
    const r = detectMmdSetup(dir);
    assert.equal(r.ready, false);
    assert.ok(r.missing[0].includes(CONSTITUTION_REL));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@unit detectMmdSetup: non-existent / odd path → not ready, never throws', () => {
  assert.doesNotThrow(() => detectMmdSetup('/nonexistent-path-xyz-9999'));
  const r = detectMmdSetup('/nonexistent-path-xyz-9999');
  assert.equal(r.ready, false);
  assert.equal(r.missing.length, 2);

  // Degenerate inputs must not throw either.
  assert.doesNotThrow(() => detectMmdSetup(undefined));
  assert.doesNotThrow(() => detectMmdSetup(42));
  assert.equal(detectMmdSetup(null).ready, false);
});
