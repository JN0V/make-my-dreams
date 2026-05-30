// @unit tests for lib/composer/audit.js — SPEC_V02E AC-4, AC-6.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  composerJsonPathFor,
  buildComposerAudit,
  composerLogHeader,
  writeComposerAudit,
  writeComposerAuditSync,
} from '../../lib/composer/audit.js';

test('@unit composerJsonPathFor: replaces .log suffix with .composer.json', () => {
  assert.equal(composerJsonPathFor('/a/b/run.log'), '/a/b/run.composer.json');
});

test('@unit composerJsonPathFor: appends .composer.json when suffix is missing', () => {
  assert.equal(composerJsonPathFor('/a/b/run'), '/a/b/run.composer.json');
});

test('@unit composerJsonPathFor: throws on empty / non-string input', () => {
  assert.throws(() => composerJsonPathFor(''), TypeError);
  assert.throws(() => composerJsonPathFor(null), TypeError);
});

test('@unit buildComposerAudit: schema matches AC-4 contract', () => {
  const audit = buildComposerAudit(
    {
      composerVersion: 'v0.2e',
      lessonsFileSha: 'abc123def012',
      injectedLessons: [
        { id: 'L-003', score: 2, keywords_hit: ['git', 'worktree'], title: 't', rule: 'r' },
      ],
      elapsedMs: 7,
      totalActiveLessons: 12,
    },
    { ts: '2026-05-18T00:00:00.000Z' },
  );
  assert.equal(audit.composer_version, 'v0.2e');
  assert.equal(audit.lessons_file_sha, 'abc123def012');
  assert.equal(audit.injected_count, 1);
  assert.equal(audit.elapsed_ms, 7);
  assert.equal(audit.total_active_lessons, 12);
  assert.equal(audit.ts, '2026-05-18T00:00:00.000Z');
  assert.deepEqual(audit.matched[0], {
    id: 'L-003',
    score: 2,
    keywords_hit: ['git', 'worktree'],
    title: 't',
    rule: 'r',
  });
});

test('@unit buildComposerAudit: SPEC_V02L AC-7 context metrics mapped', () => {
  const audit = buildComposerAudit({
    composerVersion: 'v0.2e',
    injectedLessons: [{ id: 'L-001', score: 1, keywords_hit: ['x'], title: 't', rule: 'r' }],
    totalActiveLessons: 10,
    context: { subcommand: 'mmd qa' },
    filteredOutByContext: 4,
    matchedByKeyword: 3,
    injected: 1,
  });
  assert.deepEqual(audit.context, { subcommand: 'mmd qa' });
  assert.equal(audit.filtered_out_by_context, 4);
  assert.equal(audit.matched_by_keyword, 3);
  assert.equal(audit.injected, 1);
  // Invariant: injected ≤ matched_by_keyword ≤ active − filtered.
  assert.ok(audit.injected <= audit.matched_by_keyword);
  assert.ok(audit.matched_by_keyword <= audit.total_active_lessons - audit.filtered_out_by_context);
});

test('@unit buildComposerAudit: AC-7 fields default sanely with no context', () => {
  const audit = buildComposerAudit({
    injectedLessons: [{ id: 'L-001', score: 1, keywords_hit: ['x'], title: 't', rule: 'r' }],
  });
  assert.equal(audit.context, null);
  assert.equal(audit.filtered_out_by_context, 0);
  assert.equal(audit.matched_by_keyword, 1);
  assert.equal(audit.injected, 1);
});

test('@unit buildComposerAudit: disabled flag is preserved', () => {
  const audit = buildComposerAudit({ disabled: true });
  assert.equal(audit.disabled, true);
  assert.equal(audit.injected_count, 0);
});

test('@unit buildComposerAudit: missing flag is preserved', () => {
  const audit = buildComposerAudit({ missing: true });
  assert.equal(audit.missing, true);
  assert.equal(audit.injected_count, 0);
});

test('@unit composerLogHeader: formats injected match line', () => {
  const header = composerLogHeader({
    injectedLessons: [{ id: 'L-001' }, { id: 'L-003' }],
    lessonsFileSha: 'abc123def012',
  });
  assert.match(header, /^\[composer\] injected 2 lesson\(s\): L-001, L-003/);
  assert.match(header, /sha abc123def012/);
  assert.ok(header.endsWith('\n'));
});

test('@unit composerLogHeader: zero-match formats correctly', () => {
  const header = composerLogHeader({
    injectedLessons: [],
    lessonsFileSha: 'abc123def012',
  });
  assert.match(header, /^\[composer\] no lessons matched/);
});

test('@unit composerLogHeader: disabled emits MMD_COMPOSER_DISABLED hint', () => {
  const header = composerLogHeader({ disabled: true });
  assert.match(header, /MMD_COMPOSER_DISABLED/);
});

test('@unit composerLogHeader: missing emits no-op hint', () => {
  const header = composerLogHeader({ missing: true });
  assert.match(header, /missing — no-op/);
});

test('@unit writeComposerAudit: persists JSON next to log path (async)', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'mmd-audit-'));
  try {
    const logPath = path.join(tmp, 'run.log');
    const auditPath = await writeComposerAudit(logPath, {
      injectedLessons: [{ id: 'L-007', score: 1, keywords_hit: ['slug'], title: 't', rule: 'r' }],
      lessonsFileSha: 'deadbeefcafe',
      elapsedMs: 4,
    });
    assert.equal(auditPath, path.join(tmp, 'run.composer.json'));
    assert.ok(existsSync(auditPath));
    const parsed = JSON.parse(readFileSync(auditPath, 'utf8'));
    assert.equal(parsed.injected_count, 1);
    assert.equal(parsed.matched[0].id, 'L-007');
    assert.equal(parsed.lessons_file_sha, 'deadbeefcafe');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@unit writeComposerAuditSync: persists JSON next to log path (sync)', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'mmd-audit-sync-'));
  try {
    const logPath = path.join(tmp, 'sub', 'run.log');
    const auditPath = writeComposerAuditSync(logPath, { injectedLessons: [] });
    assert.ok(existsSync(auditPath), 'parent dir must be created (mkdirSync recursive)');
    const parsed = JSON.parse(readFileSync(auditPath, 'utf8'));
    assert.equal(parsed.injected_count, 0);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
