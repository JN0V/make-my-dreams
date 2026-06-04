// test/integration/document-review-check.test.js — CLI-level tests for the
// v0.18.0 `--check` GATE (SPEC_V018A AC-5). We spawn the real bin/mmd.js child in
// throwaway repos to assert the gate contract: drift → exit 1, clean → exit 0,
// argv → 2, not-a-git → 5; the gate still WRITES docs/coherence-review.md; and
// the PLAIN run (no --check) stays report-only + read-only beyond the dashboard.
// Every spawned child has a hard timeout (L-016/L-019). Tagged @integration.

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

const ROADMAP = [
  '# Make My Dreams',
  '',
  '## 9. MVP-first Roadmap',
  '',
  '### v0.3 — Dream Catcher conversational CLI  *(3–4 days)*',
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

function initGit(dir) {
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 't@t.t']);
  git(dir, ['config', 'user.name', 'T']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'baseline']);
}

// A CLEAN fixture: no dangling refs, no stale facts/promises/deprecated surface.
async function makeCleanRepo() {
  const dir = await mkdtemp(path.join(tmpdir(), 'mmd-check-clean-'));
  await mkdir(path.join(dir, 'docs', 'adr'), { recursive: true });
  await writeFile(path.join(dir, 'MAKE_MY_DREAMS.md'), ROADMAP);
  await writeFile(path.join(dir, 'package.json'), '{"version":"0.18.0"}');
  await writeFile(path.join(dir, 'README.md'), '# clean\n\nNothing claimed here.\n');
  await writeFile(path.join(dir, 'docs', 'adr', '001-x.md'), '# ADR-001 — x\n');
  initGit(dir);
  return dir;
}

// A DRIFTY fixture: a planted dangling ref.
async function makeDriftyRepo() {
  const dir = await mkdtemp(path.join(tmpdir(), 'mmd-check-drift-'));
  await mkdir(path.join(dir, 'docs', 'adr'), { recursive: true });
  await writeFile(path.join(dir, 'MAKE_MY_DREAMS.md'), ROADMAP);
  await writeFile(path.join(dir, 'package.json'), '{"version":"0.18.0"}');
  // A dangling ADR reference (unambiguous drift, independent of repoTopDirs).
  await writeFile(path.join(dir, 'README.md'), '# drift\n\nSee ADR-404 for the rationale.\n');
  await writeFile(path.join(dir, 'docs', 'adr', '001-x.md'), '# ADR-001 — x\n');
  initGit(dir);
  return dir;
}

test('@integration check: drift → exit 1, and the dashboard is still written', async () => {
  const dir = await makeDriftyRepo();
  try {
    const r = runMmd(dir, ['--check']);
    assert.equal(r.status, 1, `expected gate failure, got ${r.status}: ${r.stderr}`);
    assert.match(r.stderr, /document-review --check: FAIL/);
    assert.match(r.stderr, /conformance drift/);
    // The dashboard is written even when the gate fails.
    assert.ok(existsSync(path.join(dir, 'docs', 'coherence-review.md')), 'dashboard written on gate fail');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration check: clean → exit 0, PASS message, dashboard written', async () => {
  const dir = await makeCleanRepo();
  try {
    const r = runMmd(dir, ['--check']);
    assert.equal(r.status, 0, `expected clean pass, got ${r.status}: ${r.stderr}`);
    assert.match(r.stdout, /document-review --check: PASS/);
    const report = await readFile(path.join(dir, 'docs', 'coherence-review.md'), 'utf8');
    assert.match(report, /# MMD Coherence Review/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration check: the roadmap heuristic does NOT gate (advisory only)', async () => {
  // A repo with NO drift but an unbuilt/unknown roadmap capability must still
  // PASS — the noisy heuristic is advisory, never a gate (SPEC_V018A AC-5).
  const dir = await mkdtemp(path.join(tmpdir(), 'mmd-check-heuristic-'));
  try {
    await mkdir(path.join(dir, 'docs', 'adr'), { recursive: true });
    await writeFile(path.join(dir, 'MAKE_MY_DREAMS.md'), [
      '## 9. Roadmap', '',
      '### v0.99 — Telepathic dream ingestion  *(1 day)*', // unbuilt — but advisory
      '',
    ].join('\n'));
    await writeFile(path.join(dir, 'package.json'), '{"version":"0.18.0"}');
    await writeFile(path.join(dir, 'README.md'), '# clean\n\nNothing claimed.\n');
    await writeFile(path.join(dir, 'docs', 'adr', '001-x.md'), '# ADR-001 — x\n');
    initGit(dir);

    const r = runMmd(dir, ['--check']);
    assert.equal(r.status, 0, 'an unbuilt roadmap capability must not fail the gate');
    assert.match(r.stdout, /PASS/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration check: --check writes ONLY docs/coherence-review.md (read-only beyond the dashboard)', async () => {
  const dir = await makeDriftyRepo();
  try {
    const r = runMmd(dir, ['--check']);
    assert.equal(r.status, 1);
    const status = git(dir, ['status', '--porcelain']);
    const changed = status.split('\n').map((l) => l.slice(3)).filter(Boolean);
    assert.deepEqual(changed, ['docs/coherence-review.md'], `--check must write only the dashboard: ${status}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration check: the PLAIN run (no --check) stays report-only — exit 0 even WITH drift', async () => {
  const dir = await makeDriftyRepo();
  try {
    const r = runMmd(dir, []); // no --check
    assert.equal(r.status, 0, 'the plain run must NOT gate, even with drift present');
    // And it is read-only beyond the dashboard (the unchanged v0.7.a contract).
    const status = git(dir, ['status', '--porcelain']);
    const changed = status.split('\n').map((l) => l.slice(3)).filter(Boolean);
    assert.deepEqual(changed, ['docs/coherence-review.md']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration check: not a git repo → exit 5 (gate contract, mirrors secret-scan/deps-gate)', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mmd-check-nogit-'));
  try {
    await mkdir(path.join(dir, 'docs', 'adr'), { recursive: true });
    await writeFile(path.join(dir, 'MAKE_MY_DREAMS.md'), ROADMAP);
    await writeFile(path.join(dir, 'package.json'), '{"version":"0.18.0"}');
    await writeFile(path.join(dir, 'README.md'), '# x\n');
    // NO git init.
    const r = runMmd(dir, ['--check']);
    assert.equal(r.status, 5, `expected exit 5 outside a git repo, got ${r.status}: ${r.stderr}`);
    assert.match(r.stderr, /needs a git repo/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration check: --check + --since (or --dry-run) → argv error exit 2', async () => {
  const dir = await makeCleanRepo();
  try {
    const since = runMmd(dir, ['--check', '--since', 'HEAD']);
    assert.equal(since.status, 2);
    assert.match(since.stderr, /--check cannot be combined with --since/);

    const dry = runMmd(dir, ['--check', '--dry-run']);
    assert.equal(dry.status, 2);
    assert.match(dry.stderr, /--check cannot be combined with --dry-run/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration check: --help lists --check', async () => {
  const dir = await makeCleanRepo();
  try {
    const r = runMmd(dir, ['--help']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /--check/);
    assert.match(r.stdout, /conformance drift/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
