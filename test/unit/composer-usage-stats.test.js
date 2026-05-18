// @unit tests for lib/composer/usage-stats.js — SPEC_V02E AC-6.
//
// Strategy: seed a tmp dir with a fake .mmd/local/<*>-runs/ tree containing
// known composer.json files, then assert the aggregator returns the expected
// counts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  findComposerAudits,
  findComposerAuditsSync,
  aggregateComposerUsage,
  aggregateComposerUsageSync,
} from '../../lib/composer/usage-stats.js';

function seedAudits(root, audits) {
  for (const [subdir, files] of Object.entries(audits)) {
    const dir = path.join(root, '.mmd', 'local', subdir);
    mkdirSync(dir, { recursive: true });
    let i = 0;
    for (const audit of files) {
      const filePath = path.join(dir, `${Date.now()}-${i++}.composer.json`);
      writeFileSync(filePath, JSON.stringify(audit) + '\n', 'utf8');
    }
  }
}

test('@unit findComposerAudits: empty dir returns []', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'mmd-stats-empty-'));
  try {
    assert.deepEqual(await findComposerAudits(tmp), []);
    assert.deepEqual(findComposerAuditsSync(tmp), []);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@unit findComposerAudits: finds files recursively', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'mmd-stats-find-'));
  try {
    seedAudits(tmp, {
      'qa-runs': [{ injected_count: 1, matched: [{ id: 'L-001' }] }],
      'ship-runs': [{ injected_count: 0, matched: [] }],
    });
    const audits = await findComposerAudits(tmp);
    assert.equal(audits.length, 2);
    for (const p of audits) {
      assert.ok(p.endsWith('.composer.json'));
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@unit aggregateComposerUsage: tallies per-lesson counts', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'mmd-stats-agg-'));
  try {
    seedAudits(tmp, {
      'qa-runs': [
        { injected_count: 2, matched: [{ id: 'L-001' }, { id: 'L-003' }] },
        { injected_count: 1, matched: [{ id: 'L-001' }] },
      ],
      'ship-runs': [
        { injected_count: 0, matched: [] },
        { injected_count: 1, matched: [{ id: 'L-003' }] },
      ],
    });
    const stats = await aggregateComposerUsage(tmp);
    assert.equal(stats.totalRuns, 4);
    assert.equal(stats.autoInjectedRuns, 3);
    assert.equal(stats.totalInjections, 4);
    assert.equal(stats.perLessonCount['L-001'], 2);
    assert.equal(stats.perLessonCount['L-003'], 2);
    assert.equal(stats.avgInjectedPerRun, 1);
    // top is sorted desc by count, then by id asc when tied.
    assert.deepEqual(stats.top.map((t) => t.id), ['L-001', 'L-003']);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@unit aggregateComposerUsage: tolerates malformed JSON', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'mmd-stats-malformed-'));
  try {
    const dir = path.join(tmp, '.mmd', 'local', 'qa-runs');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'good.composer.json'), JSON.stringify({ matched: [{ id: 'L-1' }] }), 'utf8');
    writeFileSync(path.join(dir, 'bad.composer.json'), '{ not valid json', 'utf8');
    const stats = await aggregateComposerUsage(tmp);
    assert.equal(stats.totalRuns, 1, 'malformed file should be skipped silently');
    assert.equal(stats.perLessonCount['L-1'], 1);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@unit aggregateComposerUsageSync: parity with async aggregator', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'mmd-stats-sync-'));
  try {
    seedAudits(tmp, {
      'qa-runs': [{ injected_count: 1, matched: [{ id: 'L-007' }] }],
    });
    const stats = aggregateComposerUsageSync(tmp);
    assert.equal(stats.totalRuns, 1);
    assert.equal(stats.perLessonCount['L-007'], 1);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@unit aggregateComposerUsage: zero runs → all-zero defensive shape', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'mmd-stats-zero-'));
  try {
    const stats = await aggregateComposerUsage(tmp);
    assert.equal(stats.totalRuns, 0);
    assert.equal(stats.autoInjectedRuns, 0);
    assert.equal(stats.totalInjections, 0);
    assert.equal(stats.avgInjectedPerRun, 0);
    assert.deepEqual(stats.perLessonCount, {});
    assert.deepEqual(stats.top, []);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
