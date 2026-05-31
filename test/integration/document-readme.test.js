// test/integration/document-readme.test.js — CLI-level tests for `mmd
// document-readme` (SPEC_V03D AC-4 + AC-5 + AC-6 end-to-end). We spawn the real
// bin/mmd.js child in a throwaway git repo with a temp README fixture so the
// dispatch wiring (bin/mmd.js -> bin/documentalist/document-readme.js), the real
// git/fs derivation, the two-marker rewrite, and the drift report are all
// covered. Tagged @integration.
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

const STATUS_START = '<!-- mmd:readme:status:start -->';
const STATUS_END = '<!-- mmd:readme:status:end -->';
const CHANGELOG_START = '<!-- mmd:readme:changelog:start -->';
const CHANGELOG_END = '<!-- mmd:readme:changelog:end -->';

// README fixture: human prose around BOTH marker pairs. The prose mentions
// `mmd serve` so the drift report has something documented; it deliberately
// omits some subcommands so the report is non-empty (AC-5) — that's expected.
const README = [
  '# Fixture Project',
  '',
  '> intro prose that must survive byte-for-byte',
  '',
  '## Status',
  '',
  STATUS_START,
  '- **Version**: `0.0.0` (stale)',
  '- **Tests**: 1 passing (stale hand-count)',
  STATUS_END,
  '',
  '## Changelog',
  '',
  CHANGELOG_START,
  '- **v0.0.0** — stale placeholder',
  CHANGELOG_END,
  '',
  '## Usage',
  '',
  'Run `mmd serve` to start. irreplaceable human notes here.',
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
  const dir = await mkdtemp(path.join(tmpdir(), 'mmd-doc-readme-'));
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  await writeFile(path.join(dir, 'README.md'), README, 'utf8');
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
  // One LIGHTWEIGHT tag (exercises the (no annotation) path) + two ANNOTATED
  // tags, each on its OWN commit so `git describe` resolves the latest tag
  // deterministically (v1.2.3) rather than tie-breaking same-commit tags.
  git(dir, ['tag', 'v0.9.0']); // lightweight (no annotation)
  git(dir, ['commit', '-q', '--allow-empty', '-m', 'second commit']);
  git(dir, ['tag', '-a', 'v1.0.0', '-m', 'v1.0.0 — first release']);
  git(dir, ['commit', '-q', '--allow-empty', '-m', 'third commit']);
  git(dir, ['tag', '-a', 'v1.2.3', '-m', 'v1.2.3 — second release']);
  return dir;
}

function run(cwd, args) {
  return spawnSync('node', [MMD, 'document-readme', ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 30000,
  });
}

test('@integration document-readme --dry-run prints the rewrite but writes NOTHING', async () => {
  const dir = await makeRepo();
  try {
    const before = await readFile(path.join(dir, 'README.md'), 'utf8');
    const beforeStat = await stat(path.join(dir, 'README.md'));
    const r = run(dir, ['--tests', '1268', '--dry-run']);
    assert.equal(r.status, 0, r.stderr);
    // stdout carries the full rewritten file with the refreshed blocks
    assert.match(r.stdout, /\*\*Version\*\*: `1\.2\.3`/);
    assert.match(r.stdout, /\*\*Latest tag\*\*: `v1\.2\.3`/);
    assert.match(r.stdout, /\*\*Active lessons\*\*: 1 active/); // milestone excluded
    assert.match(r.stdout, /\*\*Tests\*\*: 1268 passing/);
    // changelog newest-first from annotations
    assert.match(r.stdout, /- \*\*v1\.2\.3\*\* — v1\.2\.3 — second release/);
    assert.match(r.stdout, /- \*\*v1\.0\.0\*\* — v1\.0\.0 — first release/);
    assert.match(r.stdout, /- \*\*v0\.9\.0\*\* — _\(no annotation\)_/);
    // disk is untouched (AC-6)
    const after = await readFile(path.join(dir, 'README.md'), 'utf8');
    assert.equal(after, before);
    const afterStat = await stat(path.join(dir, 'README.md'));
    assert.equal(afterStat.mtimeMs, beforeStat.mtimeMs);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration document-readme (write) refreshes both blocks, preserves prose, is idempotent', async () => {
  const dir = await makeRepo();
  try {
    const r1 = run(dir, ['--tests', '42']);
    assert.equal(r1.status, 0, r1.stderr);
    const written = await readFile(path.join(dir, 'README.md'), 'utf8');
    // stale mechanical values are gone; intent prose survives
    assert.ok(!written.includes('0.0.0` (stale)'));
    assert.ok(!written.includes('stale placeholder'));
    assert.match(written, /\*\*Version\*\*: `1\.2\.3`/);
    assert.match(written, /\*\*Active lessons\*\*: 1 active/);
    assert.match(written, /irreplaceable human notes here/);
    assert.match(written, /intro prose that must survive byte-for-byte/);
    // outside-marker bytes preserved exactly vs the original fixture
    const statusRe = /<!-- mmd:readme:status:start -->[\s\S]*?<!-- mmd:readme:status:end -->/;
    const changelogRe = /<!-- mmd:readme:changelog:start -->[\s\S]*?<!-- mmd:readme:changelog:end -->/;
    const norm = (s) => s.replace(statusRe, 'S').replace(changelogRe, 'C');
    assert.equal(norm(README), norm(written));
    // idempotency: second identical run yields a byte-identical file
    const r2 = run(dir, ['--tests', '42']);
    assert.equal(r2.status, 0, r2.stderr);
    const written2 = await readFile(path.join(dir, 'README.md'), 'utf8');
    assert.equal(written2, written);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration document-readme prints a doc-drift report (informational, exit 0, no README write)', async () => {
  const dir = await makeRepo();
  try {
    // The fixture documents `mmd serve` but NOT e.g. `mmd bench`/`mmd handover`,
    // so the drift report must be non-empty AND list bench. It must still exit 0
    // and must NOT add the drifted names to the README (writes nothing for drift).
    const r = run(dir, ['--tests', '1']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Doc-drift report:/);
    assert.match(r.stdout, /subcommand: mmd bench/);
    const written = await readFile(path.join(dir, 'README.md'), 'utf8');
    // the drift report content is NOT written into the README
    assert.ok(!written.includes('Doc-drift report'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration document-readme with a missing marker pair → exit 4 and prints the block', async () => {
  const dir = await makeRepo();
  try {
    // Drop the changelog markers only; status markers remain.
    const noChangelog = README
      .replace(CHANGELOG_START, '')
      .replace(CHANGELOG_END, '');
    await writeFile(path.join(dir, 'README.md'), noChangelog, 'utf8');
    const r = run(dir, ['--tests', '5']);
    assert.equal(r.status, 4);
    assert.match(r.stderr, /missing the Changelog marker/);
    assert.match(r.stderr, /mmd:readme:changelog:start/);
    // the derived block is printed for the user to place
    assert.match(r.stderr, /- \*\*v1\.2\.3\*\*/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration document-readme --help exits 0', () => {
  const out = execFileSync('node', [MMD, 'document-readme', '--help'], { encoding: 'utf8' });
  assert.match(out, /mmd document-readme/);
});

test('@integration document-readme rejects an unknown flag with exit 2', async () => {
  const dir = await makeRepo();
  try {
    const r = run(dir, ['--bogus']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /unknown document-readme arg/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
