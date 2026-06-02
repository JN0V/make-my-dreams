// test/integration/handover-dry-run.test.js — CLI-level tests for `mmdream handover`
// (SPEC_V02P AC-5 + AC-3 end-to-end). We spawn the real bin/mmd.js child in a
// throwaway git repo so the dispatch wiring (bin/mmd.js -> bin/handover.js) and
// the real git/fs derivation are all covered. Tagged @integration.
//
// L-016/L-019: every spawned child has a hard timeout; no unbounded waits.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm, mkdir, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');

const MARKER_START = '<!-- mmd:handover:state:start -->';
const MARKER_END = '<!-- mmd:handover:state:end -->';

const INTENT = [
  '# HANDOVER',
  '',
  '> human intent prose that must survive byte-for-byte',
  '',
  '## State at handover',
  '',
  MARKER_START,
  '- **Latest tag**: `v0.0.0`',
  '- **Active lessons**: 99 (stale hand-count)',
  MARKER_END,
  '',
  '## What just shipped',
  '',
  'irreplaceable human notes',
  '',
].join('\n');

const LESSONS = [
  '## L-001 — alpha',
  '**Status**: active',
  '**Rule**: a',
  '**Keywords for matching**: x',
  '',
  '## L-002 — beta milestone',
  '**Status**: milestone',
  '**Rule**: b',
  '',
].join('\n');

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 20000 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

async function makeRepo() {
  const dir = await mkdtemp(path.join(tmpdir(), 'mmd-handover-'));
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  await writeFile(path.join(dir, 'HANDOVER.md'), INTENT, 'utf8');
  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture', version: '1.2.3' }, null, 2),
    'utf8',
  );
  await mkdir(path.join(dir, 'docs', 'adr'), { recursive: true });
  await writeFile(path.join(dir, 'docs', 'adr', '001-x.md'), '# x', 'utf8');
  await writeFile(path.join(dir, 'docs', 'adr', '002-y.md'), '# y', 'utf8');
  await writeFile(path.join(dir, 'docs', 'lessons-learned.md'), LESSONS, 'utf8');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'initial fixture commit']);
  git(dir, ['tag', 'v1.2.3']);
  return dir;
}

function runHandover(cwd, args) {
  return spawnSync('node', [MMD, 'handover', ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 30000,
  });
}

test('@integration handover --dry-run prints the rewrite but writes NOTHING', async () => {
  const dir = await makeRepo();
  try {
    const before = await readFile(path.join(dir, 'HANDOVER.md'), 'utf8');
    const beforeStat = await stat(path.join(dir, 'HANDOVER.md'));
    const r = runHandover(dir, ['--tests', '1055', '--dry-run']);
    assert.equal(r.status, 0, r.stderr);
    // stdout carries the full rewritten file with the refreshed block
    assert.match(r.stdout, /\*\*Latest tag\*\*: `v1\.2\.3`/);
    assert.match(r.stdout, /\*\*Version\*\*: `1\.2\.3`/);
    assert.match(r.stdout, /\*\*Active lessons\*\*: 1 \(L-001\)/); // milestone excluded
    assert.match(r.stdout, /\*\*Tests\*\*: 1055 passing/);
    // disk is untouched
    const after = await readFile(path.join(dir, 'HANDOVER.md'), 'utf8');
    assert.equal(after, before);
    const afterStat = await stat(path.join(dir, 'HANDOVER.md'));
    assert.equal(afterStat.mtimeMs, beforeStat.mtimeMs);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration handover (write) refreshes the block, preserves intent, is idempotent', async () => {
  const dir = await makeRepo();
  try {
    const r1 = runHandover(dir, ['--tests', '42']);
    assert.equal(r1.status, 0, r1.stderr);
    const written = await readFile(path.join(dir, 'HANDOVER.md'), 'utf8');
    // stale hand-count is gone; intent prose survives
    assert.ok(!written.includes('99 (stale hand-count)'));
    assert.match(written, /\*\*Active lessons\*\*: 1 \(L-001\)/);
    assert.match(written, /irreplaceable human notes/);
    assert.match(written, /human intent prose that must survive byte-for-byte/);
    // outside-marker bytes preserved exactly vs the original intent file
    const re = /<!-- mmd:handover:state:start -->[\s\S]*?<!-- mmd:handover:state:end -->/;
    assert.equal(INTENT.replace(re, 'X'), written.replace(re, 'X'));
    // idempotency: second identical run yields a byte-identical file
    const r2 = runHandover(dir, ['--tests', '42']);
    assert.equal(r2.status, 0, r2.stderr);
    const written2 = await readFile(path.join(dir, 'HANDOVER.md'), 'utf8');
    assert.equal(written2, written);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration handover with missing markers → exit 4 and prints the block', async () => {
  const dir = await makeRepo();
  try {
    await writeFile(path.join(dir, 'HANDOVER.md'), '# no markers here\n', 'utf8');
    const r = runHandover(dir, ['--tests', '5']);
    assert.equal(r.status, 4);
    assert.match(r.stderr, /missing the state marker/);
    assert.match(r.stderr, /mmd:handover:state:start/);
    // the derived block is printed for the user to place
    assert.match(r.stderr, /\*\*Latest tag\*\*: `v1\.2\.3`/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration handover --help exits 0', () => {
  const out = execFileSync('node', [MMD, 'handover', '--help'], { encoding: 'utf8' });
  assert.match(out, /mmdream handover/);
});

test('@integration handover rejects an unknown flag with exit 2', async () => {
  const dir = await makeRepo();
  try {
    const r = runHandover(dir, ['--bogus']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /unknown handover arg/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
