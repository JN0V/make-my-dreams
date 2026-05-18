// @unit tests for lib/skills/document-release/validate-input.js — SPEC_V02G
// AC-4 (ref validation) + AC-5 (skipDiscoveryGate constant).
//
// We exercise validateDocumentReleaseTarget end-to-end against a real tmp
// git repo (faster than mocking all of git). Each test creates a fresh repo,
// runs the validator, asserts the typed result, and tears down.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  validateDocumentReleaseTarget,
  isSuspiciousRef,
  skipDiscoveryGate,
} from '../../lib/skills/document-release/validate-input.js';

function makeRepo(prefix = 'mmd-dr-validate-') {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  const git = (args) => {
    const r = spawnSync(
      'git',
      ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args],
      { cwd: dir, encoding: 'utf8' },
    );
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}\n${r.stdout}`);
    return r.stdout.trim();
  };
  git(['init', '-q', '-b', 'main']);
  return { dir, git };
}

// ─── skipDiscoveryGate constant (AC-5) ───────────────────────────────────

test('@unit AC-5 — skipDiscoveryGate is true for document-release (read-only/advisory)', () => {
  assert.equal(skipDiscoveryGate, true);
});

// ─── isSuspiciousRef (pure predicate) ────────────────────────────────────

test('@unit isSuspiciousRef: empty / non-string → true', () => {
  assert.equal(isSuspiciousRef(''), true);
  assert.equal(isSuspiciousRef(null), true);
  assert.equal(isSuspiciousRef(undefined), true);
  assert.equal(isSuspiciousRef(123), true);
});

test('@unit isSuspiciousRef: leading dash → true (would be parsed as a git flag)', () => {
  assert.equal(isSuspiciousRef('-foo'), true);
  assert.equal(isSuspiciousRef('--evil'), true);
});

test('@unit isSuspiciousRef: whitespace → true', () => {
  assert.equal(isSuspiciousRef('v0.2 .4'), true);
  assert.equal(isSuspiciousRef('v0.2.4\n'), true);
});

test('@unit isSuspiciousRef: normal refs → false', () => {
  assert.equal(isSuspiciousRef('HEAD'), false);
  assert.equal(isSuspiciousRef('v0.2.4'), false);
  assert.equal(isSuspiciousRef('main'), false);
  assert.equal(isSuspiciousRef('feat/foo'), false);
  assert.equal(isSuspiciousRef('deadbeef'), false);
});

// ─── validateDocumentReleaseTarget ───────────────────────────────────────

test('@unit AC-4 — non-git cwd exits 3', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-dr-nogit-'));
  try {
    const r = await validateDocumentReleaseTarget(dir);
    assert.equal(r.ok, false);
    assert.equal(r.exitCode, 3);
    assert.match(r.message, /git repository/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@unit AC-4 — empty cwd → exit 3 with internal error message', async () => {
  const r = await validateDocumentReleaseTarget('');
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 3);
});

test('@unit AC-4 — no tags + no <from> → exit 4 with concrete hint', async () => {
  const { dir, git } = makeRepo();
  try {
    git(['commit', '--allow-empty', '-m', 'init', '-q']);
    const r = await validateDocumentReleaseTarget(dir);
    assert.equal(r.ok, false);
    assert.equal(r.exitCode, 4);
    assert.match(r.message, /no tags found|auto-detect/);
    assert.match(r.message, /pass <from>/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@unit AC-4 — invalid <from> ref → exit 4', async () => {
  const { dir, git } = makeRepo();
  try {
    git(['commit', '--allow-empty', '-m', 'init', '-q']);
    const r = await validateDocumentReleaseTarget(dir, { from: 'no-such-ref-xyz' });
    assert.equal(r.ok, false);
    assert.equal(r.exitCode, 4);
    assert.match(r.message, /<from>.*not a valid commit|no-such-ref-xyz/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@unit AC-4 — invalid <to> ref → exit 4', async () => {
  const { dir, git } = makeRepo();
  try {
    git(['commit', '--allow-empty', '-m', 'init', '-q']);
    git(['tag', 'v0.0.1']);
    const r = await validateDocumentReleaseTarget(dir, { to: 'no-such-target' });
    assert.equal(r.ok, false);
    assert.equal(r.exitCode, 4);
    assert.match(r.message, /<to>.*not a valid commit|no-such-target/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@unit AC-4 — suspicious <from> ref → exit 4 (rejected before git rev-parse)', async () => {
  const { dir, git } = makeRepo();
  try {
    git(['commit', '--allow-empty', '-m', 'init', '-q']);
    const r = await validateDocumentReleaseTarget(dir, { from: '-evil' });
    assert.equal(r.ok, false);
    assert.equal(r.exitCode, 4);
    assert.match(r.message, /suspicious/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@unit AC-4 — valid <from> tag + default <to>=HEAD resolves to two SHAs', async () => {
  const { dir, git } = makeRepo();
  try {
    git(['commit', '--allow-empty', '-m', 'init', '-q']);
    git(['tag', 'v0.0.1']);
    git(['commit', '--allow-empty', '-m', 'next', '-q']);
    const r = await validateDocumentReleaseTarget(dir);
    assert.equal(r.ok, true);
    assert.equal(r.fromRef, 'v0.0.1');
    assert.equal(r.toRef, 'HEAD');
    assert.match(r.fromSha, /^[a-f0-9]{40}$/);
    assert.match(r.toSha, /^[a-f0-9]{40}$/);
    assert.notEqual(r.fromSha, r.toSha);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@unit AC-4 — explicit <from> <to> refs both honored', async () => {
  const { dir, git } = makeRepo();
  try {
    const c1 = (() => { git(['commit', '--allow-empty', '-m', 'c1', '-q']); return git(['rev-parse', 'HEAD']); })();
    const c2 = (() => { git(['commit', '--allow-empty', '-m', 'c2', '-q']); return git(['rev-parse', 'HEAD']); })();
    const r = await validateDocumentReleaseTarget(dir, { from: c1, to: c2 });
    assert.equal(r.ok, true);
    assert.equal(r.fromSha, c1);
    assert.equal(r.toSha, c2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@unit AC-4 — HEAD as <from> and HEAD~1 as ... is rejected if no parent', async () => {
  // Edge case: a freshly-init repo with one commit has no HEAD~1.
  const { dir, git } = makeRepo();
  try {
    git(['commit', '--allow-empty', '-m', 'only-commit', '-q']);
    const r = await validateDocumentReleaseTarget(dir, { from: 'HEAD~1', to: 'HEAD' });
    assert.equal(r.ok, false);
    assert.equal(r.exitCode, 4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
