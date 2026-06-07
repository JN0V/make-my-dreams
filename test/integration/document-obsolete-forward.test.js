// test/integration/document-obsolete-forward.test.js — CLI-level tests for the
// v0.22.a obsolete-forward-narrative detection wired into `mmdream document`
// (SPEC_V022A AC-3 / AC-4 / AC-5). We spawn the real bin/mmd.js child in a
// throwaway git repo so the Step 5 wiring (detect → FLAG a prose sentence,
// DELETE a removable list item), the --check teeth, the --dry-run clean tree,
// and the precision (a real future item is NOT flagged) are covered end-to-end.
// We validate on FIXTURE repos, never the live MMD repo. Tagged @integration.

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

// A roadmap with a BUILT capability (Conductor — matched by a `conductor`
// subcommand/lib module below) at v0.5 and a genuinely-UNBUILT future item
// (Voice mode) at v0.30.
const ROADMAP = [
  '# Make My Dreams',
  '',
  '## 9. Roadmap',
  '',
  '### v0.5 — Conductor (orchestration + auto-handoff)',
  '### v0.30 — Voice mode (speak your dream)',
  '',
].join('\n');

// A concise README with:
//   • a stale forward PROSE sentence naming a past version (v0.5) → FLAGGED (not removable)
//   • a stale forward LIST ITEM naming only a past version → REMOVABLE (deleted)
//   • a genuinely-future LIST ITEM (v0.30, unbuilt) → NOT flagged, NOT deleted
function readmeWithForwardNarrative() {
  return [
    '# Fixture',
    '',
    '## Roadmap',
    '',
    'Next on the roadmap: then v0.5 Conductor and auto-handoff, finishing the orchestrator.',
    '',
    '- next: v0.5 Conductor polish',
    '- next: v0.30 voice mode',
    '',
    '## Status',
    '',
    '<!-- mmd:readme:status:start -->',
    'old',
    '<!-- mmd:readme:status:end -->',
    '',
    '## Changelog',
    '',
    '<!-- mmd:readme:changelog:start -->',
    '- v0.5.0',
    '<!-- mmd:readme:changelog:end -->',
    '',
  ].join('\n');
}

async function makeRepo() {
  const dir = await mkdtemp(path.join(tmpdir(), 'mmd-obsolete-fwd-'));
  await mkdir(path.join(dir, 'docs', 'adr'), { recursive: true });
  await mkdir(path.join(dir, 'lib', 'conductor'), { recursive: true });
  await mkdir(path.join(dir, 'bin'), { recursive: true });
  await writeFile(path.join(dir, 'MAKE_MY_DREAMS.md'), ROADMAP);
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture', version: '0.22.0' }));
  await writeFile(path.join(dir, 'docs', 'adr', '001-x.md'), '# ADR-001 — x\n');
  await writeFile(path.join(dir, 'docs', 'lessons-learned.md'), '## L-001 — a\n**Status**: active\n');
  // A `conductor` subcommand + lib module so reconcileRoadmap classifies Conductor BUILT.
  await writeFile(path.join(dir, 'lib', 'conductor', 'handoff.js'), '// conductor\n');
  await writeFile(path.join(dir, 'bin', 'mmd.js'),
    "// SUBCOMMANDS\nconst SUBCOMMANDS = ['conductor', 'document'];\n");
  await writeFile(path.join(dir, 'HANDOVER.md'),
    ['# Handover', '', '<!-- mmd:handover:state:start -->', 'old', '<!-- mmd:handover:state:end -->', ''].join('\n'));
  await writeFile(path.join(dir, 'README.md'), readmeWithForwardNarrative());
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 't@t.t']);
  git(dir, ['config', 'user.name', 'T']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'baseline']);
  git(dir, ['tag', '-a', 'v0.22.0', '-m', 'v0.22.0']);
  return dir;
}

// ── AC-3 / AC-5: --check fails (exit 1) on an obsolete-forward finding ───────

test('@integration document --check: exits 1 on an obsolete forward-looking claim', async () => {
  const dir = await makeRepo();
  try {
    const r = runDocument(dir, ['--check']);
    assert.equal(r.status, 1, `expected exit 1, got ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /FAIL/);
    assert.match(r.stderr, /obsolete-forward/);
    assert.match(r.stdout, /OBSOLETE FORWARD/);
    // --check is read-only beyond the dashboard: README untouched.
    const readme = await readFile(path.join(dir, 'README.md'), 'utf8');
    assert.match(readme, /v0\.5 Conductor polish/, '--check does not delete (read-only)');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── AC-5: --dry-run detects but leaves a CLEAN tree ─────────────────────────

test('@integration document --dry-run: detects obsolete-forward but changes NOTHING', async () => {
  const dir = await makeRepo();
  try {
    const r = runDocument(dir, ['--dry-run']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /obsolete forward-looking claim/);
    const porcelain = git(dir, ['status', '--porcelain']).trim();
    assert.equal(porcelain, '', `dry-run left a dirty tree:\n${porcelain}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── AC-3 / AC-4: default DELETES the removable list item, FLAGS the prose, ───
//    and leaves the genuine future item untouched (precision) ────────────────

test('@integration document (default): deletes a removable obsolete-forward item, flags the prose, keeps the real future item', async () => {
  const dir = await makeRepo();
  try {
    const r = runDocument(dir, []);
    assert.equal(r.status, 0, r.stderr);
    const readme = await readFile(path.join(dir, 'README.md'), 'utf8');

    // REMOVABLE list item naming only a past version (v0.5) → deleted.
    assert.doesNotMatch(readme, /v0\.5 Conductor polish/, 'the removable past-version list item is deleted');

    // The genuinely-future item (v0.30 voice mode, unbuilt) → KEPT (precision, AC-4).
    assert.match(readme, /v0\.30 voice mode/, 'a real future item must NOT be deleted or flagged');

    // The multi-clause forward PROSE sentence → FLAGGED, NOT auto-rewritten (kept).
    assert.match(readme, /Next on the roadmap: then v0\.5 Conductor/, 'a prose sentence is flagged, never auto-cut');
    assert.match(r.stdout, /OBSOLETE FORWARD/);
    assert.match(r.stdout, /FLAGGED for review/);

    // Valid markdown sanity + a commit landed.
    const log = git(dir, ['log', '--oneline']);
    assert.match(log, /condense concise docs/);
    // Tree is clean after the auto-commits.
    const porcelain = git(dir, ['status', '--porcelain']).trim();
    assert.equal(porcelain, '', `default run left a dirty tree:\n${porcelain}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── AC-4: precision — a repo with ONLY a real future item → --check PASSES ───

test('@integration document --check: a repo with only a genuine future roadmap item is clean', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mmd-obsolete-fwd-clean-'));
  try {
    await mkdir(path.join(dir, 'docs', 'adr'), { recursive: true });
    await mkdir(path.join(dir, 'bin'), { recursive: true });
    await writeFile(path.join(dir, 'MAKE_MY_DREAMS.md'), ROADMAP);
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture', version: '0.22.0' }));
    await writeFile(path.join(dir, 'docs', 'adr', '001-x.md'), '# ADR-001 — x\n');
    await writeFile(path.join(dir, 'docs', 'lessons-learned.md'), '## L-001 — a\n**Status**: active\n');
    await writeFile(path.join(dir, 'bin', 'mmd.js'), "const SUBCOMMANDS = ['document'];\n");
    await writeFile(path.join(dir, 'HANDOVER.md'),
      ['# Handover', '', '<!-- mmd:handover:state:start -->', 'old', '<!-- mmd:handover:state:end -->', ''].join('\n'));
    await writeFile(path.join(dir, 'README.md'),
      ['# Fixture', '', '## Roadmap', '', '- next: v0.30 voice mode (speak your dream)', ''].join('\n'));
    git(dir, ['init', '-q']);
    git(dir, ['config', 'user.email', 't@t.t']);
    git(dir, ['config', 'user.name', 'T']);
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'baseline']);
    git(dir, ['tag', '-a', 'v0.22.0', '-m', 'v0.22.0']);

    const r = runDocument(dir, ['--check']);
    // The fixture has no dangling/stale facts, only a genuine future item → the
    // obsolete-forward check must NOT fire (precision). --check passes on it.
    assert.match(r.stdout, /0 obsolete forward-looking claims/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
