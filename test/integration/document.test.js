// test/integration/document.test.js — CLI-level tests for `mmdream document`
// (SPEC_V019A, the autonomous Documentalist orchestrator). We spawn the real
// bin/mmd.js child in a throwaway git repo so the dispatch wiring + the REUSED
// underlying capabilities (handover/readme block builders, the coherence
// detector + render, the SPEC archival planner, the coupling walk) and the
// auto-commit are covered end-to-end. Tagged @integration / @unit.
//
// L-016/L-019: every spawned child has a hard timeout. The orchestrator REUSES
// the existing builders/detectors/planners — these tests assert the OUTCOME
// (blocks refreshed + committed, dashboard written, SPEC archived, coupling
// reported, the three modes, the gate), not a re-implementation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseDocumentArgs, buildDocumentReport } from '../../bin/documentalist/document.js';

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

const HANDOVER = [
  '# Handover',
  '',
  '<!-- mmd:handover:state:start -->',
  'old',
  '<!-- mmd:handover:state:end -->',
  '',
].join('\n');

const README = [
  '# Readme',
  '',
  '<!-- mmd:readme:status:start -->',
  'old',
  '<!-- mmd:readme:status:end -->',
  '',
  '<!-- mmd:readme:changelog:start -->',
  'old',
  '<!-- mmd:readme:changelog:end -->',
  '',
].join('\n');

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 20000 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

function runDocument(cwd, args, extraEnv = {}) {
  return spawnSync('node', [MMD, 'document', ...args], {
    cwd, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, MMD_SKIP_SETUP: '1', MMD_SKIP_GROUNDING: '1', ...extraEnv },
  });
}

/**
 * A repo with the marker blocks, a roadmap, a shipped root SPEC, and (optionally)
 * a dangling code reference in the README to drive the --check gate.
 */
async function makeRepo({ withDrift = false, withSpec = true } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'mmd-document-'));
  await mkdir(path.join(dir, 'docs', 'adr'), { recursive: true });
  await mkdir(path.join(dir, 'lib'), { recursive: true });
  await writeFile(path.join(dir, 'MAKE_MY_DREAMS.md'), ROADMAP);
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture', version: '0.19.0' }));
  await writeFile(path.join(dir, 'docs', 'adr', '001-x.md'), '# ADR-001 — Adopt gStack\n');
  await writeFile(path.join(dir, 'docs', 'lessons-learned.md'), '## L-001 — a\n**Status**: active\n');
  await writeFile(path.join(dir, 'HANDOVER.md'), HANDOVER);
  const readmeBody = withDrift
    ? `${README}\nWe ship \`lib/does-not-exist.js\` for the thing.\n`
    : README;
  await writeFile(path.join(dir, 'README.md'), readmeBody);
  await writeFile(path.join(dir, 'lib', 'real.js'), 'export const x = 1;\n');
  if (withSpec) await writeFile(path.join(dir, 'SPEC_V01.md'), '# spec one\n');
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 't@t.t']);
  git(dir, ['config', 'user.name', 'T']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'baseline']);
  git(dir, ['tag', '-a', 'v0.19.0', '-m', 'v0.19.0']);
  return dir;
}

function logLines(dir) {
  return git(dir, ['log', '--oneline']).split('\n').map((s) => s.trim()).filter(Boolean);
}

// ── AC-1: orchestrates the four maintenance hats in one pass ─────────────────

test('@integration document: runs all four steps + writes the coherence dashboard + unified report', async () => {
  const dir = await makeRepo();
  try {
    const r = runDocument(dir, []);
    assert.equal(r.status, 0, r.stderr);
    // Unified report mentions every step (universal §VII — human-readable first).
    assert.match(r.stdout, /Step 1 — Mechanical blocks refreshed/);
    assert.match(r.stdout, /Step 2 — Coherence drift dashboard/);
    assert.match(r.stdout, /Step 3 — SPEC archival/);
    assert.match(r.stdout, /Step 4 — Doc↔code↔ADR coupling/);
    assert.match(r.stdout, /Summary: 4 steps completed/);
    // The dashboard was written (step 2 reuses document-review's detector + render).
    assert.ok(existsSync(path.join(dir, 'docs', 'coherence-review.md')), 'dashboard written');
    const dash = await readFile(path.join(dir, 'docs', 'coherence-review.md'), 'utf8');
    assert.match(dash, /# MMD Coherence Review/);
    // Step 1 actually refreshed the blocks (the derived State block replaced "old").
    const handover = await readFile(path.join(dir, 'HANDOVER.md'), 'utf8');
    assert.match(handover, /Latest tag.*v0\.19\.0/);
    // Step 3 archived the shipped SPEC into docs/specs/.
    assert.ok(existsSync(path.join(dir, 'docs', 'specs', 'SPEC_V01.md')), 'SPEC archived');
    assert.ok(existsSync(path.join(dir, 'docs', 'specs', 'INDEX.md')), 'archive index written');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── AC-2: auto-commit + --no-commit / --dry-run ──────────────────────────────

test('@integration document: default mode auto-commits the lossless work (blocks + archival)', async () => {
  const dir = await makeRepo();
  try {
    const r = runDocument(dir, []);
    assert.equal(r.status, 0, r.stderr);
    const log = logLines(dir);
    // baseline + the two lossless auto-commits.
    assert.ok(log.some((l) => /refresh mechanical blocks and coherence dashboard/.test(l)), `missing blocks commit: ${log}`);
    assert.ok(log.some((l) => /archive 1 shipped SPEC into docs\/specs\//.test(l)), `missing archival commit: ${log}`);
    // Clean tree after default mode (everything lossless was committed).
    assert.equal(git(dir, ['status', '--porcelain']).trim(), '', 'tree must be clean after default commit');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration document: --dry-run previews + leaves a CLEAN tree (no write, no commit)', async () => {
  const dir = await makeRepo();
  try {
    const before = logLines(dir).length;
    const r = runDocument(dir, ['--dry-run']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /would archive 1 root SPEC_V\*\.md/);
    assert.match(r.stdout, /preview only \(--dry-run/);
    // Clean tree — the headline AC-2/AC-5 safety property.
    assert.equal(git(dir, ['status', '--porcelain']).trim(), '', `--dry-run must write nothing`);
    assert.equal(logLines(dir).length, before, 'no new commit under --dry-run');
    assert.ok(!existsSync(path.join(dir, 'docs', 'coherence-review.md')), 'no dashboard written under --dry-run');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration document: --no-commit writes the changes but creates NO commit', async () => {
  const dir = await makeRepo();
  try {
    const before = logLines(dir).length;
    const r = runDocument(dir, ['--no-commit']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /not committed \(--no-commit/);
    // Dashboard written + tree dirty, but no new commit.
    assert.ok(existsSync(path.join(dir, 'docs', 'coherence-review.md')), 'dashboard written under --no-commit');
    assert.notEqual(git(dir, ['status', '--porcelain']).trim(), '', '--no-commit must leave the tree dirty');
    assert.equal(logLines(dir).length, before, 'no new commit under --no-commit');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── AC-3: --check gate (teeth), read-only ────────────────────────────────────

test('@integration document --check: drift → exit 1, NO commit', async () => {
  const dir = await makeRepo({ withDrift: true });
  try {
    const before = logLines(dir).length;
    const r = runDocument(dir, ['--check']);
    assert.equal(r.status, 1, `expected gate fail, got ${r.status}: ${r.stdout}`);
    assert.match(r.stderr, /document --check: FAIL/);
    assert.match(r.stderr, /dangling/);
    // No commit in --check mode (read-only gate).
    assert.equal(logLines(dir).length, before, '--check must not commit');
    // No SPEC archival in --check mode (read-only beyond the dashboards).
    assert.ok(!existsSync(path.join(dir, 'docs', 'specs', 'SPEC_V01.md')), '--check must not archive');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration document --check: clean → exit 0', async () => {
  const dir = await makeRepo({ withDrift: false, withSpec: false });
  try {
    const r = runDocument(dir, ['--check']);
    assert.equal(r.status, 0, `expected clean pass, got ${r.status}: ${r.stderr}`);
    assert.match(r.stdout, /document --check: PASS — no conformance drift/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration document --check: not a git repo → exit 5', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mmd-document-nogit-'));
  try {
    await writeFile(path.join(dir, 'package.json'), '{"version":"0.19.0"}');
    const r = runDocument(dir, ['--check']);
    assert.equal(r.status, 5, r.stdout);
    assert.match(r.stderr, /not a git repository/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration document: --help → exit 0; unknown flag → exit 2; contradictory modes → exit 2', async () => {
  const dir = await makeRepo();
  try {
    const help = runDocument(dir, ['--help']);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /mmdream document/);
    assert.match(help.stdout, /--check/);

    const bad = runDocument(dir, ['--bogus']);
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /unknown document arg/);

    const combo = runDocument(dir, ['--check', '--dry-run']);
    assert.equal(combo.status, 2);
    assert.match(combo.stderr, /--check cannot be combined with --dry-run/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── AC-4: the 4 maintenance commands are deprecated aliases (still work) ──────

test('@integration document: each deprecated alias warns on stderr AND still runs', async () => {
  const dir = await makeRepo();
  const run = (cmd, args) => spawnSync('node', [MMD, cmd, ...args], {
    cwd: dir, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, MMD_SKIP_SETUP: '1', MMD_SKIP_GROUNDING: '1' },
  });
  try {
    // --dry-run on each so they don't mutate; the notice still fires (it is after
    // arg parsing, before the work). Each must still produce its normal output.
    const ho = run('handover', ['--dry-run']);
    assert.match(ho.stderr, /\[DEPRECATED\] mmdream handover is deprecated/);
    assert.match(ho.stdout, /mmd:handover:state:start/); // still ran (printed the rewritten file)

    const rd = run('document-readme', ['--dry-run']);
    assert.match(rd.stderr, /\[DEPRECATED\] mmdream document-readme is deprecated/);

    const rv = run('document-review', ['--dry-run']);
    assert.match(rv.stderr, /\[DEPRECATED\] mmdream document-review is deprecated/);
    assert.match(rv.stdout, /# MMD Coherence Review/); // still ran

    const cp = run('document-compact', ['--dry-run']);
    assert.match(cp.stderr, /\[DEPRECATED\] mmdream document-compact is deprecated/);
    assert.match(cp.stdout, /Would archive 1 SPEC_V\*\.md/); // still ran
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration document: document-lessons + document-release are NOT deprecated', async () => {
  const dir = await makeRepo();
  const run = (cmd, args) => spawnSync('node', [MMD, cmd, ...args], {
    cwd: dir, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, MMD_SKIP_SETUP: '1', MMD_SKIP_GROUNDING: '1' },
  });
  try {
    const dl = run('document-lessons', ['--dry-run']);
    assert.doesNotMatch(`${dl.stdout}${dl.stderr}`, /\[DEPRECATED\]/, 'document-lessons must NOT be deprecated');

    const dr = run('document-release', ['--help']);
    assert.doesNotMatch(`${dr.stdout}${dr.stderr}`, /\[DEPRECATED\]/, 'document-release must NOT be deprecated');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── AC-5: pure helpers — never throw, deterministic ──────────────────────────

test('@unit parseDocumentArgs: defaults, modes, errors, never throws', () => {
  assert.deepEqual(parseDocumentArgs([]), { dryRun: false, check: false, noCommit: false, help: false, error: null });
  assert.equal(parseDocumentArgs(['--dry-run']).dryRun, true);
  assert.equal(parseDocumentArgs(['--check']).check, true);
  assert.equal(parseDocumentArgs(['--no-commit']).noCommit, true);
  assert.equal(parseDocumentArgs(['--help']).help, true);
  assert.equal(parseDocumentArgs(['-h']).help, true);

  // Unknown flag → exit 2.
  assert.equal(parseDocumentArgs(['--bogus']).error.exitCode, 2);
  // Contradictory combos → exit 2 (fail fast, error-handling §I).
  assert.equal(parseDocumentArgs(['--check', '--dry-run']).error.exitCode, 2);
  assert.equal(parseDocumentArgs(['--check', '--no-commit']).error.exitCode, 2);
  assert.equal(parseDocumentArgs(['--dry-run', '--no-commit']).error.exitCode, 2);

  // Non-array input → an error object, NEVER a throw.
  assert.doesNotThrow(() => parseDocumentArgs(null));
  assert.equal(parseDocumentArgs(null).error.exitCode, 2);
  assert.doesNotThrow(() => parseDocumentArgs(undefined));
});

test('@unit buildDocumentReport: assembles a human-readable report, never throws', () => {
  const parts = {
    mode: 'default',
    handover: { status: 'refreshed' },
    readme: { status: { status: 'refreshed' }, changelog: { status: 'unchanged' } },
    blocksCommit: { committed: true, reason: null },
    dashboard: { written: true, driftTotal: 0, drift: { dangling: [], staleFacts: [], deprecated: [], stalePromises: [] }, wall: null },
    archival: { moved: 2, refsRewritten: 3, filesChanged: 1, changedFiles: [], wall: null },
    archivalCommit: { committed: true, reason: null },
    coupling: 'No files changed this pass — nothing to couple.',
  };
  const report = buildDocumentReport(parts);
  assert.match(report, /autonomous Documentalist pass/);
  assert.match(report, /Step 1 — Mechanical blocks refreshed/);
  assert.match(report, /committed: "docs\(document\): refresh mechanical blocks and coherence dashboard"/);
  assert.match(report, /2 root SPEC_V\*\.md archived/);
  assert.match(report, /Summary: 4 steps completed, 2 auto-commits, 0 drift findings\./);

  // A wall-on-a-step is reported honestly (§VI), not a fabricated success.
  const wallParts = {
    ...parts,
    mode: 'no-commit',
    handover: { status: 'wall', detail: 'HANDOVER.md unreadable' },
    blocksCommit: null,
    dashboard: { written: false, driftTotal: 0, drift: { dangling: [], staleFacts: [], deprecated: [], stalePromises: [] }, wall: 'MAKE_MY_DREAMS.md unreadable' },
    archival: { moved: 0, refsRewritten: 0, filesChanged: 0, changedFiles: [], wall: null },
    archivalCommit: null,
  };
  assert.doesNotThrow(() => buildDocumentReport(wallParts));
  const wallReport = buildDocumentReport(wallParts);
  assert.match(wallReport, /wall: HANDOVER\.md unreadable/);
  assert.match(wallReport, /wall: MAKE_MY_DREAMS\.md unreadable/);
});
