// Tests for `mmd lessons match --context <subcommand>` — SPEC_V02L AC-5.
//
// Unit: parseLessonsArgs / normalizeContextSubcommand (pure).
// Integration: spawn `node bin/mmd.js lessons match … --context …` against the
// live lessons file and assert the strict-subset + summary-line contract.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { parseLessonsArgs, normalizeContextSubcommand } from '../../bin/lessons.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const BIN_MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');

function runMmd(args) {
  return spawnSync('node', [BIN_MMD, ...args], {
    cwd: REPO_ROOT,
    env: process.env,
    encoding: 'utf8',
    timeout: 15000,
  });
}

// ── Unit: argument parsing ────────────────────────────────────────────────

test('@unit normalizeContextSubcommand: hyphen + spaced forms', () => {
  assert.equal(normalizeContextSubcommand('mmd-qa'), 'mmd qa');
  assert.equal(normalizeContextSubcommand('mmd-document-release'), 'mmd document-release');
  assert.equal(normalizeContextSubcommand('mmd---here'), 'mmd --here');
  assert.equal(normalizeContextSubcommand('mmd qa'), 'mmd qa'); // already spaced → verbatim
  assert.equal(normalizeContextSubcommand('  mmd-cso '), 'mmd cso'); // trimmed
});

test('@unit parseLessonsArgs: --context extracted and normalized, not leaked into prompt', () => {
  const parsed = parseLessonsArgs(['match', 'git checkout', '--context', 'mmd-qa']);
  assert.equal(parsed.action, 'match');
  assert.equal(parsed.prompt, 'git checkout');
  assert.equal(parsed.context, 'mmd qa');
});

test('@unit parseLessonsArgs: --context before the prompt also works', () => {
  const parsed = parseLessonsArgs(['match', '--context', 'mmd-ship', 'git branch']);
  assert.equal(parsed.prompt, 'git branch');
  assert.equal(parsed.context, 'mmd ship');
});

test('@unit parseLessonsArgs: --context without value is a user error', () => {
  const parsed = parseLessonsArgs(['match', 'git', '--context']);
  assert.ok(parsed.error);
  assert.equal(parsed.error.exitCode, 2);
});

test('@unit parseLessonsArgs: --context outside match is rejected', () => {
  const parsed = parseLessonsArgs(['--context', 'mmd-qa']);
  assert.ok(parsed.error);
  assert.equal(parsed.error.exitCode, 2);
});

test('@unit parseLessonsArgs: --context with --show is rejected, not ignored (F1)', () => {
  const parsed = parseLessonsArgs(['--show', 'L-001', '--context', 'mmd-qa']);
  assert.ok(parsed.error, '--context + --show must error, not silently ignore the context');
  assert.equal(parsed.error.exitCode, 2);
});

// ── Integration: live CLI ─────────────────────────────────────────────────

test('@integration mmd lessons match --context: strict subset of un-contextual match', () => {
  const PROMPT = 'git checkout worktree branch concurrent';
  const full = runMmd(['lessons', 'match', PROMPT]);
  const ctx = runMmd(['lessons', 'match', PROMPT, '--context', 'mmd-qa']);
  assert.equal(full.status, 0, full.stderr);
  assert.equal(ctx.status, 0, ctx.stderr);

  const ids = (s) => (s.match(/^L-\d+ \|/gm) || []).map((m) => m.slice(0, 5));
  const fullIds = new Set(ids(full.stdout));
  const ctxIds = ids(ctx.stdout);
  for (const id of ctxIds) {
    assert.ok(fullIds.has(id), `${id} (context) must be in the un-contextual set`);
  }
  assert.ok(ctxIds.length <= fullIds.size, 'context result is a subset');
});

test('@integration mmd lessons match --context: prints the AC-5 summary line', () => {
  const r = runMmd(['lessons', 'match', 'git checkout', '--context', 'mmd-qa']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(
    r.stdout,
    /Filtered \d+ of \d+ \(context: mmd qa\)\. Showing top \d+ matched by keyword\./,
  );
});

test('@integration mmd lessons match --context mmd---here keeps --here lessons', () => {
  // L-003 (git, Applies to: mmd --here, mmd ship) survives the --here context.
  const r = runMmd(['lessons', 'match', 'git checkout worktree', '--context', 'mmd---here']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^L-003 \|/m);
  assert.match(r.stdout, /context: mmd --here/);
});
