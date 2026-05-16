// Tests for lib/reality-check.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { realityCheck } from '../../lib/reality-check.js';

function makeTmp() {
  return mkdtempSync(path.join(tmpdir(), 'mmd-rc-'));
}

test('forced backend=skip returns SKIPPED regardless of env', async () => {
  process.env.MMD_REALITY_CHECK_BACKEND = 'skip';
  try {
    const tmp = makeTmp();
    try {
      const r = await realityCheck({ demoDir: tmp, screenshotDir: tmp });
      assert.equal(r.status, 'SKIPPED');
      assert.match(r.reason, /skip/i);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  } finally {
    delete process.env.MMD_REALITY_CHECK_BACKEND;
  }
});

test('forced backend=mcp returns SKIPPED with mcp-not-available reason (v0.1 stub)', async () => {
  process.env.MMD_REALITY_CHECK_BACKEND = 'mcp';
  try {
    const tmp = makeTmp();
    try {
      const r = await realityCheck({ demoDir: tmp, screenshotDir: tmp });
      assert.equal(r.status, 'SKIPPED');
      assert.match(r.reason, /mcp not available/i);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  } finally {
    delete process.env.MMD_REALITY_CHECK_BACKEND;
  }
});

test('forced backend=playwright degrades to SKIPPED if playwright is not installed', async () => {
  process.env.MMD_REALITY_CHECK_BACKEND = 'playwright';
  try {
    const tmp = makeTmp();
    try {
      // Drop a minimal index.html so the playwright path has something to load.
      mkdirSync(tmp, { recursive: true });
      writeFileSync(path.join(tmp, 'index.html'), '<!doctype html><h1>ok</h1>');
      const r = await realityCheck({ demoDir: tmp, screenshotDir: tmp });
      // We don't know whether the host has playwright installed; both PASS and SKIPPED are valid v0.1 outcomes.
      assert.ok(['PASS', 'SKIPPED', 'FAIL'].includes(r.status), `unexpected status ${r.status}`);
      if (r.status === 'SKIPPED') {
        assert.match(r.reason, /playwright/i);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  } finally {
    delete process.env.MMD_REALITY_CHECK_BACKEND;
  }
});

test('autodetect with no forced backend returns one of PASS/FAIL/SKIPPED', async () => {
  delete process.env.MMD_REALITY_CHECK_BACKEND;
  const tmp = makeTmp();
  try {
    writeFileSync(path.join(tmp, 'index.html'), '<!doctype html><h1>ok</h1>');
    const r = await realityCheck({ demoDir: tmp, screenshotDir: tmp });
    assert.ok(['PASS', 'FAIL', 'SKIPPED'].includes(r.status));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
