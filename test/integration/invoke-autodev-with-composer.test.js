// @integration tests for SPEC_V02E AC-4: invoke-autodev wires the composer
// into every claude -p invocation.
//
// Strategy: run the real lib/invoke-autodev.js#invokeAutodev with the
// fake-autodev.sh fixture (no real claude). Verify that:
//   1. A composer.json sidecar is written next to the run log.
//   2. The run log's first line is the [composer] header.
//   3. MMD_COMPOSER_DISABLED=1 short-circuits cleanly.
//   4. A missing docs/lessons-learned.md file is a no-op (brownfield-safe).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { invokeAutodev } from '../../lib/invoke-autodev.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const FIXTURE_OK = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-autodev.sh');

function makeTmp() {
  return mkdtempSync(path.join(tmpdir(), 'mmd-composer-int-'));
}

test('@integration AC-4: composer.json is written next to the run log', async () => {
  const tmp = makeTmp();
  try {
    // Seed a lessons file with a single matchable lesson.
    const lessonsPath = path.join(tmp, 'docs', 'lessons-learned.md');
    mkdirSync(path.dirname(lessonsPath), { recursive: true });
    writeFileSync(
      lessonsPath,
      `# Lessons\n\n## L-001 — composer integration smoke test\n\n**Status**: active\n**Date**: 2026-05-18\n**Rule**: do not skip the composer integration test.\n**Keywords for matching**: dream, slug\n`,
      'utf8',
    );

    process.env.MMD_AUTODEV_CMD = FIXTURE_OK;
    const logPath = path.join(tmp, 'run.log');
    const r = await invokeAutodev({
      demoDir: tmp,
      dream: 'a dream',
      slug: 'a-dream',
      promptParts: { dream: 'a dream', slug: 'a-dream', demoDir: tmp },
      logPath,
      timeoutMs: 10000,
      lessonsPath,
    });
    assert.equal(r.code, 0);

    const auditPath = logPath.replace(/\.log$/, '.composer.json');
    assert.ok(existsSync(auditPath), `composer.json missing at ${auditPath}`);
    const audit = JSON.parse(readFileSync(auditPath, 'utf8'));
    assert.equal(audit.composer_version, 'v0.2e');
    assert.equal(audit.injected_count, 1, 'L-001 should match on "dream" keyword');
    assert.equal(audit.matched[0].id, 'L-001');
    assert.match(audit.lessons_file_sha, /^[0-9a-f]{12}$/);

    const logContents = readFileSync(logPath, 'utf8');
    assert.match(logContents, /^\[composer\] injected 1 lesson\(s\): L-001/);
  } finally {
    delete process.env.MMD_AUTODEV_CMD;
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration AC-4: missing lessons file is a no-op (brownfield-safe)', async () => {
  const tmp = makeTmp();
  try {
    process.env.MMD_AUTODEV_CMD = FIXTURE_OK;
    const logPath = path.join(tmp, 'run.log');
    const r = await invokeAutodev({
      demoDir: tmp,
      dream: 'a dream',
      slug: 'a-dream',
      promptParts: { dream: 'a dream', slug: 'a-dream', demoDir: tmp },
      logPath,
      timeoutMs: 10000,
      lessonsPath: path.join(tmp, 'docs', 'does-not-exist.md'),
    });
    assert.equal(r.code, 0);
    const auditPath = logPath.replace(/\.log$/, '.composer.json');
    assert.ok(existsSync(auditPath));
    const audit = JSON.parse(readFileSync(auditPath, 'utf8'));
    assert.equal(audit.missing, true);
    assert.equal(audit.injected_count, 0);
    const logContents = readFileSync(logPath, 'utf8');
    assert.match(logContents, /\[composer\] lessons file missing — no-op/);
  } finally {
    delete process.env.MMD_AUTODEV_CMD;
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration AC-4: MMD_COMPOSER_DISABLED=1 short-circuits', async () => {
  const tmp = makeTmp();
  try {
    // Seed lessons that WOULD match — but env disables composer.
    const lessonsPath = path.join(tmp, 'docs', 'lessons-learned.md');
    mkdirSync(path.dirname(lessonsPath), { recursive: true });
    writeFileSync(
      lessonsPath,
      `# Lessons\n\n## L-001 — would match\n\n**Status**: active\n**Rule**: x.\n**Keywords for matching**: dream\n`,
      'utf8',
    );

    process.env.MMD_AUTODEV_CMD = FIXTURE_OK;
    process.env.MMD_COMPOSER_DISABLED = '1';
    const logPath = path.join(tmp, 'run.log');
    const r = await invokeAutodev({
      demoDir: tmp,
      dream: 'a dream',
      slug: 'a-dream',
      promptParts: { dream: 'a dream', slug: 'a-dream', demoDir: tmp },
      logPath,
      timeoutMs: 10000,
      lessonsPath,
    });
    assert.equal(r.code, 0);
    const auditPath = logPath.replace(/\.log$/, '.composer.json');
    const audit = JSON.parse(readFileSync(auditPath, 'utf8'));
    assert.equal(audit.disabled, true);
    assert.equal(audit.injected_count, 0);
    const logContents = readFileSync(logPath, 'utf8');
    assert.match(logContents, /\[composer\] disabled via MMD_COMPOSER_DISABLED/);
  } finally {
    delete process.env.MMD_AUTODEV_CMD;
    delete process.env.MMD_COMPOSER_DISABLED;
    rmSync(tmp, { recursive: true, force: true });
  }
});
