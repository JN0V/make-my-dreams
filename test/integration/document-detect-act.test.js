// test/integration/document-detect-act.test.js — CLI-level tests for the v0.21.a
// conciseness/correction step of `mmdream document` (SPEC_V021A AC-4 / AC-4b / AC-5).
// We spawn the real bin/mmd.js child in a throwaway git repo so the Step 5 wiring,
// the MOVE (content-matched destination + truthful stub), the DELETE (precise
// excision), the --dry-run clean tree, and the --check teeth are covered
// end-to-end. We validate on FIXTURE repos, never the live MMD repo. Tagged
// @integration. L-016/L-019: every spawned child has a hard timeout.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');

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

const ROADMAP = [
  '# Make My Dreams',
  '',
  '## 9. Roadmap',
  '',
  '### v0.9 — Parallel Conductor + worktrees + Bundle E  *(2 weeks)*',
  '',
].join('\n');

/**
 * An over-budget CONCISE README with: a worktrees capability-lie (trailing
 * comma-clause), a ## History narrative, a ## Usage wall, a deprecated
 * `mmdream document-readme` usage line, and a marker-owned ## Changelog.
 */
function bigReadme() {
  const lines = [
    '# Fixture',
    '',
    '## What this is',
    '',
    'What it adds: feature a, feature b, local parallelization via git worktrees.',
    '',
    '## Status',
    '',
    '<!-- mmd:readme:status:start -->',
    'old status',
    '<!-- mmd:readme:status:end -->',
    '',
    '## History',
    '',
  ];
  for (let i = 1; i <= 120; i += 1) lines.push(`History narrative line ${i} with substantial words here.`);
  lines.push('', '## Usage', '');
  lines.push('```');
  lines.push('mmdream document-readme --tests 5   # refresh the blocks');
  lines.push('```');
  for (let i = 1; i <= 80; i += 1) lines.push(`Usage prose line ${i} describing how to do things.`);
  lines.push('', '## Changelog', '');
  lines.push('<!-- mmd:readme:changelog:start -->');
  lines.push('- **v0.1.0** — first release');
  lines.push('<!-- mmd:readme:changelog:end -->');
  lines.push('');
  return lines.join('\n');
}

async function makeRepo() {
  const dir = await mkdtemp(path.join(tmpdir(), 'mmd-detect-act-'));
  await mkdir(path.join(dir, 'docs', 'adr'), { recursive: true });
  await mkdir(path.join(dir, 'bin', 'documentalist'), { recursive: true });
  await writeFile(path.join(dir, 'MAKE_MY_DREAMS.md'), ROADMAP);
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture', version: '0.21.0' }));
  await writeFile(path.join(dir, 'docs', 'adr', '001-x.md'), '# ADR-001 — x\n');
  await writeFile(path.join(dir, 'docs', 'lessons-learned.md'), '## L-001 — a\n**Status**: active\n');
  await writeFile(path.join(dir, 'HANDOVER.md'),
    ['# Handover', '', '<!-- mmd:handover:state:start -->', 'old', '<!-- mmd:handover:state:end -->', ''].join('\n'));
  await writeFile(path.join(dir, 'README.md'), bigReadme());
  // A real [DEPRECATED] notice source so the deprecated set is DERIVED (AC-2).
  await writeFile(path.join(dir, 'bin', 'documentalist', 'document-readme.js'),
    "stderr.write('[DEPRECATED] mmdream document-readme is deprecated — use: mmdream document');\n");
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 't@t.t']);
  git(dir, ['config', 'user.name', 'T']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'baseline']);
  git(dir, ['tag', '-a', 'v0.21.0', '-m', 'v0.21.0']);
  return dir;
}

// ── AC-5: --dry-run previews + leaves a CLEAN tree ──────────────────────────

test('@integration document --dry-run: detects but changes NOTHING (clean tree)', async () => {
  const dir = await makeRepo();
  try {
    const r = runDocument(dir, ['--dry-run']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Step 5 — Conciseness/);
    assert.match(r.stdout, /capability-lie/);
    // No files changed at all — clean tree (the dry-run contract).
    const porcelain = git(dir, ['status', '--porcelain']).trim();
    assert.equal(porcelain, '', `dry-run left a dirty tree:\n${porcelain}`);
    assert.ok(!existsSync(path.join(dir, 'CHANGELOG.md')), 'no CHANGELOG.md written on dry-run');
    assert.ok(!existsSync(path.join(dir, 'docs', 'readme-history.md')), 'no history sibling on dry-run');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── AC-5: --check fails (exit 1) on a capability-lie / deprecated-surface ────

test('@integration document --check: exits 1 on a capability-lie + deprecated-surface finding', async () => {
  const dir = await makeRepo();
  try {
    const r = runDocument(dir, ['--check']);
    assert.equal(r.status, 1, `expected exit 1, got ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /FAIL/);
    assert.match(r.stderr, /capability-lie/);
    // --check is read-only beyond the dashboard: README/CHANGELOG untouched.
    assert.ok(!existsSync(path.join(dir, 'CHANGELOG.md')), '--check never moves the changelog');
    const readme = await readFile(path.join(dir, 'README.md'), 'utf8');
    assert.match(readme, /worktrees/, '--check does not delete (read-only)');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── AC-4 + AC-5: default MOVES surplus + DELETES false/deprecated + commits ──

test('@integration document (default): moves surplus losslessly, deletes the worktrees lie, commits', async () => {
  const dir = await makeRepo();
  try {
    const before = (await readFile(path.join(dir, 'README.md'), 'utf8')).split('\n').length;
    const r = runDocument(dir, []);
    assert.equal(r.status, 0, r.stderr);
    const readme = await readFile(path.join(dir, 'README.md'), 'utf8');
    const after = readme.split('\n').length;
    assert.ok(after < before, `README should shrink (${before} → ${after})`);

    // CONTENT-MATCHED-DESTINATION invariant (THE bug fix):
    //   History → docs/readme-history.md with a "for the full history" stub.
    assert.ok(existsSync(path.join(dir, 'docs', 'readme-history.md')), 'history sibling created');
    assert.match(readme, /See \[History\]\(docs\/readme-history\.md\) for the full history\./);
    assert.doesNotMatch(
      readme.split('## History')[1]?.split('##')[0] || '',
      /changelog/i,
      'the History stub must NOT mention "changelog"',
    );

    //   The genuine changelog → CHANGELOG.md (NOT a history file).
    assert.ok(existsSync(path.join(dir, 'CHANGELOG.md')), 'CHANGELOG.md created');
    const changelog = await readFile(path.join(dir, 'CHANGELOG.md'), 'utf8');
    // The mechanical-refresh ran BEFORE the move, so the changelog block reflects
    // the repo's real tags (v0.21.0) — proof the refresh follows the marker to
    // CHANGELOG.md (SPEC §4: maintained at its new location, not stuck inline).
    assert.match(changelog, /v0\.21\.0/, 'CHANGELOG.md holds the freshly-refreshed changelog content');
    assert.match(changelog, /mmd:readme:changelog/, 'CHANGELOG.md carries the markers (refresh follows)');
    assert.match(readme, /See \[CHANGELOG\.md\]\(CHANGELOG\.md\) for the full changelog\./);

    // LOSSLESS: the moved History content is byte-present in its sibling.
    const history = await readFile(path.join(dir, 'docs', 'readme-history.md'), 'utf8');
    assert.match(history, /History narrative line 1 with substantial words here\./);
    assert.match(history, /History narrative line 120 with substantial words here\./);

    // DELETE: the worktrees lie is gone, sentence still well-formed.
    assert.doesNotMatch(readme, /worktrees/);
    assert.match(readme, /What it adds: feature a, feature b\./);

    // Auto-commits landed (the lossless block/dashboard + the conciseness commit).
    const log = git(dir, ['log', '--oneline']);
    assert.match(log, /condense concise docs/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── AC-4: idempotent — a second run is a no-op (no new moves) ────────────────

test('@integration document (default): second run is idempotent (nothing new to move)', async () => {
  const dir = await makeRepo();
  try {
    runDocument(dir, []);
    const r2 = runDocument(dir, []);
    assert.equal(r2.status, 0, r2.stderr);
    assert.match(r2.stdout, /no surplus sections to move|within budget/);
    // No leftover dirty tree after the second run's commits (or nothing to commit).
    const porcelain = git(dir, ['status', '--porcelain']).trim();
    assert.equal(porcelain, '', `second run left a dirty tree:\n${porcelain}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── AC-4b: regenerated mechanical blocks name `mmdream document` ─────────────

test('@integration document: regenerated Status/State blocks name `mmdream document`, not deprecated aliases', async () => {
  const dir = await makeRepo();
  try {
    runDocument(dir, []);
    const handover = await readFile(path.join(dir, 'HANDOVER.md'), 'utf8');
    const readme = await readFile(path.join(dir, 'README.md'), 'utf8');
    // The State block's generated line names the current command.
    assert.match(handover, /by `mmdream document`/);
    assert.doesNotMatch(handover, /by `mmdream handover`/);
    // The README Status block's regenerated-by line names the current command.
    assert.match(readme, /regenerated by `mmdream document`/);
    assert.doesNotMatch(readme, /regenerated by `mmdream document-readme`/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── F1: the DERIVED deprecated set reaches ALL current-state docs (not just README) ──
// Regression for the F1 finding: scanDrift's checkDeprecatedSurface was called
// WITHOUT the derived set, so a deprecated command taught as PRIMARY in CLAUDE.md /
// HANDOVER.md (not in CONCISE_DOCS, only README is) sailed past the dashboard +
// the --check gate. The Step-5 conciseness scan only covers README; the drift scan
// must cover CLAUDE.md / HANDOVER.md with the SAME derived set (SPEC_V021A AC-2).

/** A minimal, marker-complete fixture so the only finding under test is the
 *  deprecated teaching we plant — no spurious mechanical-block walls. */
async function makeCleanRepo() {
  const dir = await mkdtemp(path.join(tmpdir(), 'mmd-f1-'));
  await mkdir(path.join(dir, 'docs', 'adr'), { recursive: true });
  await mkdir(path.join(dir, 'bin', 'documentalist'), { recursive: true });
  await writeFile(path.join(dir, 'MAKE_MY_DREAMS.md'), ROADMAP);
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture', version: '0.21.0' }));
  await writeFile(path.join(dir, 'docs', 'adr', '001-x.md'), '# ADR-001 — x\n');
  await writeFile(path.join(dir, 'docs', 'lessons-learned.md'), '## L-001 — a\n**Status**: active\n');
  await writeFile(path.join(dir, 'HANDOVER.md'),
    ['# Handover', '', '<!-- mmd:handover:state:start -->', 'old', '<!-- mmd:handover:state:end -->', ''].join('\n'));
  // A short, within-budget README with the full marker pair (so Step 1 + Step 5 are quiet).
  await writeFile(path.join(dir, 'README.md'), [
    '# Fixture', '', '## Quick start', '', 'Run `mmdream document` to maintain docs.', '',
    '## Status', '', '<!-- mmd:readme:status:start -->', 'old status', '<!-- mmd:readme:status:end -->', '',
    '## Changelog', '', '<!-- mmd:readme:changelog:start -->', '- **v0.1.0** — first release', '<!-- mmd:readme:changelog:end -->', '',
  ].join('\n'));
  // The real [DEPRECATED] notice source so `document-readme` is DERIVED-deprecated.
  await writeFile(path.join(dir, 'bin', 'documentalist', 'document-readme.js'),
    "stderr.write('[DEPRECATED] mmdream document-readme is deprecated — use: mmdream document');\n");
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 't@t.t']);
  git(dir, ['config', 'user.name', 'T']);
  return dir;
}

test('@integration F1 — document --check catches a deprecated command taught as primary in CLAUDE.md', async () => {
  const dir = await makeCleanRepo();
  try {
    // CLAUDE.md (a current-state truth doc, NOT in CONCISE_DOCS) teaches the
    // DERIVED-deprecated `mmdream document-readme` as the primary way to do a thing.
    await writeFile(path.join(dir, 'CLAUDE.md'),
      ['# Project memory', '', 'To refresh the README, run `mmdream document-readme --tests 5`.', ''].join('\n'));
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'baseline']);
    git(dir, ['tag', '-a', 'v0.21.0', '-m', 'v0.21.0']);

    const r = runDocument(dir, ['--check']);
    assert.equal(r.status, 1, `expected exit 1, got ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /FAIL/);
    // The dashboard drift scan (not the README-only Step 5) flagged the deprecated surface.
    assert.match(r.stderr, /deprecated-surface/);
    // --check is read-only beyond the dashboard — CLAUDE.md itself is never edited.
    const claude = await readFile(path.join(dir, 'CLAUDE.md'), 'utf8');
    assert.match(claude, /mmdream document-readme/, '--check does not edit CLAUDE.md (read-only)');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration F1 — document --check stays GREEN when CLAUDE.md teaches only the current command (precision)', async () => {
  const dir = await makeCleanRepo();
  try {
    // CLAUDE.md teaches the CURRENT `mmdream document` — no deprecated surface.
    await writeFile(path.join(dir, 'CLAUDE.md'),
      ['# Project memory', '', 'To refresh the docs, run `mmdream document`.', ''].join('\n'));
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'baseline']);
    git(dir, ['tag', '-a', 'v0.21.0', '-m', 'v0.21.0']);

    const r = runDocument(dir, ['--check']);
    assert.equal(r.status, 0, `expected clean exit 0, got ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /document --check: PASS/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── AC-4: REFERENCE-role doc is NEVER condensed ─────────────────────────────

test('@integration document: a long MAKE_MY_DREAMS.md (reference role) is left untouched by Step 5', async () => {
  const dir = await makeRepo();
  try {
    // Make the roadmap very long — a reference doc must NOT be moved/shrunk.
    const longRoadmap = [ROADMAP];
    for (let i = 0; i < 500; i += 1) longRoadmap.push(`roadmap detail line ${i}`);
    await writeFile(path.join(dir, 'MAKE_MY_DREAMS.md'), longRoadmap.join('\n'));
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'long roadmap']);
    const beforeLen = (await readFile(path.join(dir, 'MAKE_MY_DREAMS.md'), 'utf8')).length;
    runDocument(dir, []);
    const afterLen = (await readFile(path.join(dir, 'MAKE_MY_DREAMS.md'), 'utf8')).length;
    assert.equal(afterLen, beforeLen, 'a reference doc must not be condensed');
    assert.ok(!existsSync(path.join(dir, 'docs', 'make_my_dreams-roadmap.md')), 'no reference-doc sibling created');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
