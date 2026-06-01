// test/integration/document-review-drift.test.js — CLI-level tests for the
// v0.7.b Drift / conformance section of `mmd document-review` (SPEC_V07B AC-3/AC-4).
//
// We spawn the real bin/mmd.js child in a throwaway git repo built to exercise
// BOTH faces of AC-4:
//   • RECALL — a deliberately DANGLING reference (a doc cites a file / subcommand
//     / ADR that does not exist) is flagged with the right doc:line.
//   • PRECISION — the repo's VALID references (real file, real subcommand, real
//     ADR) are NOT flagged.
// Plus the READ-ONLY CONTRACT (only docs/coherence-review.md changes) and the
// --with-claude semantic-drift fallback. Every spawned child has a hard timeout
// (L-016/L-019). Tagged @integration.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm, mkdir, readFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');

const ROADMAP = [
  '# Make My Dreams',
  '',
  '## 9. MVP-first Roadmap',
  '',
  '### v0.3 — Dream Catcher conversational CLI  *(3–4 days)*',
  '',
].join('\n');

// A minimal bin/mmd.js so realSubcommands() finds a `serve` dispatch in the
// fixture (proves the dispatch-derived authority path runs end-to-end).
const FIXTURE_BIN = [
  '#!/usr/bin/env node',
  "if (rawArgs[0] === 'serve') {}",
  "if (rawArgs[0] === 'discover') {}",
  '',
].join('\n');

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 20000 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

function runMmd(cwd, args, extraEnv = {}) {
  return spawnSync('node', [MMD, 'document-review', ...args], {
    cwd, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, MMD_SKIP_SETUP: '1', MMD_SKIP_GROUNDING: '1', ...extraEnv },
  });
}

// Build a fixture repo whose README carries BOTH a valid ref set (precision) and
// a planted dangling ref set (recall).
async function makeRepo() {
  const dir = await mkdtemp(path.join(tmpdir(), 'mmd-drift-'));
  await mkdir(path.join(dir, 'docs', 'adr'), { recursive: true });
  await mkdir(path.join(dir, 'lib', 'documentalist'), { recursive: true });
  await mkdir(path.join(dir, 'bin'), { recursive: true });

  await writeFile(path.join(dir, 'MAKE_MY_DREAMS.md'), ROADMAP);
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture', version: '0.7.0' }));
  await writeFile(path.join(dir, 'bin', 'mmd.js'), FIXTURE_BIN);
  // A real lib file the README will (validly) reference.
  await writeFile(path.join(dir, 'lib', 'documentalist', 'inventory.js'), '// real\n');
  await writeFile(path.join(dir, 'docs', 'adr', '001-x.md'), '# ADR-001 — Adopt gStack\n');
  await writeFile(path.join(dir, 'docs', 'lessons-learned.md'), '## L-001 — a\n**Status**: active\n');
  await writeFile(path.join(dir, 'SPEC_V01.md'), 'spec one\n');

  // README: line-numbered so we can assert exact doc:line for the planted refs.
  const readme = [
    '# Fixture readme', // 1
    '', // 2
    'Valid file: `lib/documentalist/inventory.js` exists here.', // 3
    'Valid subcommand: `mmd serve` works.', // 4
    'Valid ADR: ADR-001 is recorded.', // 5
    '', // 6
    'DANGLING file: `lib/ghost/missing.js` is gone.', // 7
    'DANGLING subcommand: `mmd teleport` was never built.', // 8
    'DANGLING adr: ADR-404 has no file.', // 9
  ].join('\n');
  await writeFile(path.join(dir, 'README.md'), readme);

  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 't@t.t']);
  git(dir, ['config', 'user.name', 'T']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'baseline']);
  return dir;
}

test('@integration drift: planted dangling refs are flagged with doc:line (recall)', async () => {
  const dir = await makeRepo();
  try {
    const r = runMmd(dir, []);
    assert.equal(r.status, 0, r.stderr);
    const report = await readFile(path.join(dir, 'docs', 'coherence-review.md'), 'utf8');

    assert.match(report, /## Drift \/ conformance/);
    // Each planted dangling ref, at its exact line.
    assert.match(report, /README\.md:7 → `lib\/ghost\/missing\.js` — file not found/);
    assert.match(report, /README\.md:8 → `mmd teleport` — 'teleport' is not a known subcommand/);
    assert.match(report, /README\.md:9 → `ADR-404` — no docs\/adr\/404/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration drift: VALID refs are NOT flagged (precision — no crying wolf)', async () => {
  const dir = await makeRepo();
  try {
    const r = runMmd(dir, []);
    assert.equal(r.status, 0, r.stderr);
    const report = await readFile(path.join(dir, 'docs', 'coherence-review.md'), 'utf8');

    // The valid file / subcommand / ADR must appear NOWHERE in a dangling line.
    const driftSection = report.slice(report.indexOf('## Drift / conformance'));
    assert.ok(!/inventory\.js` — file not found/.test(driftSection), 'valid file not flagged');
    assert.ok(!/`mmd serve`/.test(driftSection), 'valid subcommand not flagged');
    assert.ok(!/`ADR-001`/.test(driftSection), 'valid ADR not flagged');
    // Summary line reports a non-zero, bounded drift count.
    assert.match(r.stdout, /Drift: 3 dangling references · \d+ stale facts/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration drift: READ-ONLY — only docs/coherence-review.md changes (incl. the drift scan)', async () => {
  const dir = await makeRepo();
  try {
    const r = runMmd(dir, []);
    assert.equal(r.status, 0, r.stderr);
    const status = git(dir, ['status', '--porcelain']);
    const changed = status.split('\n').map((l) => l.slice(3)).filter(Boolean);
    assert.deepEqual(changed, ['docs/coherence-review.md'], `unexpected changes: ${status}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration drift: a clean repo reports "No dangling references" honestly', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mmd-drift-clean-'));
  try {
    await mkdir(path.join(dir, 'docs', 'adr'), { recursive: true });
    await writeFile(path.join(dir, 'MAKE_MY_DREAMS.md'), ROADMAP);
    await writeFile(path.join(dir, 'package.json'), '{"version":"0.7.0"}');
    await writeFile(path.join(dir, 'README.md'), '# clean\n\nNothing claimed here.\n');
    await writeFile(path.join(dir, 'docs', 'adr', '001-x.md'), '# ADR-001 — x\n');
    git(dir, ['init', '-q']);
    git(dir, ['config', 'user.email', 't@t.t']);
    git(dir, ['config', 'user.name', 'T']);
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'baseline']);

    const r = runMmd(dir, []);
    assert.equal(r.status, 0, r.stderr);
    const report = await readFile(path.join(dir, 'docs', 'coherence-review.md'), 'utf8');
    assert.match(report, /✅ No dangling references/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration drift: --with-claude semantic drift renders from the seam', async () => {
  const dir = await makeRepo();
  const fake = path.join(dir, 'fake-claude-ok.sh');
  await writeFile(fake, '#!/bin/sh\necho "- ADR-001 may describe a flow that drifted"\n');
  await chmod(fake, 0o755);
  try {
    const r = runMmd(dir, ['--with-claude'], { MMD_DOCUMENT_REVIEW_CMD: fake });
    assert.equal(r.status, 0, r.stderr);
    const report = await readFile(path.join(dir, 'docs', 'coherence-review.md'), 'utf8');
    assert.match(report, /### Semantic drift/);
    assert.match(report, /may describe a flow that drifted/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration drift: --with-claude failure → honest semantic-drift fallback, no fabrication', async () => {
  const dir = await makeRepo();
  try {
    const r = runMmd(dir, ['--with-claude'], { MMD_DOCUMENT_REVIEW_CMD: '/no/such/claude-xyz' });
    assert.equal(r.status, 0, r.stderr);
    const report = await readFile(path.join(dir, 'docs', 'coherence-review.md'), 'utf8');
    assert.match(report, /### Semantic drift/);
    assert.match(report, /LLM drift check unavailable/);
    assert.match(report, /no semantic-conformance verdict was fabricated/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
