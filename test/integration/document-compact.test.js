// test/integration/document-compact.test.js — CLI-level tests for `mmd
// document-compact` (SPEC_V07C AC-2 + AC-3). We spawn the real bin/mmd.js child
// in a throwaway git repo so the dispatch wiring, the real fs + `git mv`, the
// index write, the reference rewrite, the --dry-run no-op, idempotency, and the
// honest failure paths are all covered end-to-end. Tagged @integration.
//
// We DELIBERATELY validate on FIXTURE repos, never the live MMD repo (SPEC §AC-4
// + hint #5: running it here would move this slice's own in-flight SPEC_V07C.md).
// L-016/L-019: every spawned child has a hard timeout.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm, mkdir, readFile, readdir } from 'node:fs/promises';
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

function runMmd(cwd, args, extraEnv = {}) {
  return spawnSync('node', [MMD, 'document-compact', ...args], {
    cwd, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, MMD_SKIP_SETUP: '1', MMD_SKIP_GROUNDING: '1', ...extraEnv },
  });
}

// A small fixture repo: three root SPECs + docs that reference them in every
// textual form the rewrite must cover.
async function makeRepo() {
  const dir = await mkdtemp(path.join(tmpdir(), 'mmd-compact-'));
  await mkdir(path.join(dir, 'docs'), { recursive: true });

  await writeFile(path.join(dir, 'SPEC_V01.md'), '# Make My Dreams — v0.1 Spec: the walking skeleton\n\nbody one\n');
  await writeFile(path.join(dir, 'SPEC_V03B.md'), '# Make My Dreams — v0.3.b Spec: the Dream Catcher\n\nbody two\n');
  await writeFile(path.join(dir, 'SPEC_V06A.md'), '# Make My Dreams — v0.6.a Spec: third-party readiness\n\nbody three\n');
  // A multi-digit-minor SPEC like MMD's real SPEC_V025.md (v0.2.5) — guards the
  // version parse against fabricating "v0.25" and mis-sorting it to the top.
  await writeFile(path.join(dir, 'SPEC_V025.md'), '# Make My Dreams — v0.2.5 Spec: mmd serve\n\nbody serve\n');

  // README references the SPECs as a link, an anchored link, and bare prose.
  await writeFile(
    path.join(dir, 'README.md'),
    [
      '# Project',
      '',
      'See [the skeleton](SPEC_V01.md) and [catcher](SPEC_V03B.md#goals).',
      'The readiness work is in SPEC_V06A.md (prose mention).',
      'A backticked form: [`SPEC_V01.md`](SPEC_V01.md).',
      'An unrelated file SPEC_V99Z.md does not move and must stay bare.',
      '',
    ].join('\n'),
  );
  // A doc that references nothing — must be left byte-for-byte untouched.
  await writeFile(path.join(dir, 'docs', 'untouched.md'), '# Untouched\n\nNo spec refs here.\n');
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture', version: '0.7.2' }));

  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 't@t.t']);
  git(dir, ['config', 'user.name', 'T']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'baseline']);
  return dir;
}

test('@integration document-compact --dry-run: prints the plan, changes NOTHING', async () => {
  const dir = await makeRepo();
  try {
    const r = runMmd(dir, ['--dry-run']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Would archive 4 SPEC_V\*\.md → docs\/specs\//);
    // F3: dry-run reports the real rewrite blast radius (N refs across K files).
    assert.match(r.stdout, /rewrite \d+ references? across \d+ files?/);
    assert.match(r.stdout, /SPEC_V01\.md → docs\/specs\/SPEC_V01\.md/);
    assert.match(r.stdout, /Nothing changed \(dry-run\)/);

    // Clean tree — the headline of dry-run.
    assert.equal(git(dir, ['status', '--porcelain']).trim(), '', 'dry-run must leave a clean tree');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration document-compact: real run moves + indexes + rewrites (history preserved)', async () => {
  const dir = await makeRepo();
  try {
    const r = runMmd(dir, []);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Archived 4 SPEC_V\*\.md → docs\/specs\//);
    assert.match(r.stdout, /Wrote docs\/specs\/INDEX\.md \(4 entries, newest-first\)/);
    assert.match(r.stdout, /Rewrote \d+ references .* across \d+ file/);

    // Files physically moved.
    const rootFiles = await readdir(dir);
    assert.ok(!rootFiles.includes('SPEC_V01.md'), 'SPEC should have left the root');
    const archived = await readdir(path.join(dir, 'docs', 'specs'));
    assert.deepEqual(
      archived.filter((f) => f.startsWith('SPEC_')).sort(),
      ['SPEC_V01.md', 'SPEC_V025.md', 'SPEC_V03B.md', 'SPEC_V06A.md'],
    );

    // INDEX newest-first: v0.6.a > v0.3.b > v0.2.5 > v0.1 (V025 must NOT lead).
    const index = await readFile(path.join(dir, 'docs', 'specs', 'INDEX.md'), 'utf8');
    assert.match(index, /# Archived SPECs/);
    assert.match(index, /\*\*v0\.2\.5\*\*/); // honest version, not "v0.25"
    assert.doesNotMatch(index, /v0\.25\b/);
    const o6 = index.indexOf('SPEC_V06A.md');
    const o3 = index.indexOf('SPEC_V03B.md');
    const o25 = index.indexOf('SPEC_V025.md');
    const o1 = index.indexOf('SPEC_V01.md');
    assert.ok(o6 < o3 && o3 < o25 && o25 < o1, `index not newest-first:\n${index}`);

    // References rewritten in README, in every form, anchor preserved.
    const readme = await readFile(path.join(dir, 'README.md'), 'utf8');
    assert.match(readme, /\[the skeleton\]\(docs\/specs\/SPEC_V01\.md\)/);
    assert.match(readme, /\[catcher\]\(docs\/specs\/SPEC_V03B\.md#goals\)/);
    assert.match(readme, /in docs\/specs\/SPEC_V06A\.md \(prose mention\)/);
    assert.match(readme, /\[`docs\/specs\/SPEC_V01\.md`\]\(docs\/specs\/SPEC_V01\.md\)/);
    // The non-moved SPEC stays bare.
    assert.match(readme, /SPEC_V99Z\.md does not move and must stay bare/);
    assert.doesNotMatch(readme, /docs\/specs\/SPEC_V99Z/);

    // A ref-free doc is untouched.
    const untouched = await readFile(path.join(dir, 'docs', 'untouched.md'), 'utf8');
    assert.equal(untouched, '# Untouched\n\nNo spec refs here.\n');

    // git sees the rename (R) — confirms `git mv`, not a delete+add.
    const status = git(dir, ['status', '--porcelain']);
    assert.match(status, /R..?SPEC_V01\.md -> docs\/specs\/SPEC_V01\.md/);

    // History preserved — after the operator commits the staged renames,
    // `git log --follow` on a moved SPEC reaches the pre-move baseline (AC-4).
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'archive specs']);
    const log = git(dir, ['log', '--follow', '--oneline', '--', 'docs/specs/SPEC_V01.md']);
    assert.match(log, /baseline/, 'git log --follow should reach the pre-move history');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration document-compact: second run is a clean no-op (idempotent)', async () => {
  const dir = await makeRepo();
  try {
    assert.equal(runMmd(dir, []).status, 0);
    // Commit the first archival so the tree is clean before the second run.
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'archive specs']);

    const r2 = runMmd(dir, []);
    assert.equal(r2.status, 0, r2.stderr);
    assert.match(r2.stdout, /Nothing to archive — no SPEC_V\*\.md at the repo root\. \(no-op\)/);
    assert.match(r2.stdout, /4 SPEC\(s\) already under docs\/specs\//);
    // No-op → clean tree.
    assert.equal(git(dir, ['status', '--porcelain']).trim(), '', 'second run must change nothing');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration document-compact: integrity — no dangling root SPEC link after the run', async () => {
  const dir = await makeRepo();
  try {
    assert.equal(runMmd(dir, []).status, 0);
    const readme = await readFile(path.join(dir, 'README.md'), 'utf8');
    // No link target points at a bare moved root SPEC anymore.
    assert.doesNotMatch(readme, /\]\(SPEC_V01\.md/);
    assert.doesNotMatch(readme, /\]\(SPEC_V03B\.md/);
    assert.doesNotMatch(readme, /\]\(SPEC_V06A\.md/);
    // And no doubled prefix anywhere.
    assert.doesNotMatch(readme, /docs\/specs\/docs\/specs/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration document-compact: rewrite is idempotent across two real runs', async () => {
  const dir = await makeRepo();
  try {
    assert.equal(runMmd(dir, []).status, 0);
    const after1 = await readFile(path.join(dir, 'README.md'), 'utf8');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'archive']);
    // A new root SPEC appears; re-run should move only it and never double-prefix
    // the already-rewritten references.
    await writeFile(path.join(dir, 'SPEC_V07A.md'), '# Make My Dreams — v0.7.a Spec: coherence review\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'new spec']);

    const r = runMmd(dir, []);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Archived 1 SPEC_V\*\.md/);
    const after2 = await readFile(path.join(dir, 'README.md'), 'utf8');
    // The previously-rewritten refs are unchanged (no docs/specs/docs/specs/).
    assert.equal(after2, after1, 'already-prefixed refs must be untouched on re-run');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration document-compact: a moved SPEC keeps its BARE sibling cross-reference', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mmd-compact-xref-'));
  try {
    // SPEC_V07C references its predecessor SPEC_V07B as a bare sibling link.
    await writeFile(path.join(dir, 'SPEC_V07B.md'), '# Make My Dreams — v0.7.b Spec: drift\n');
    await writeFile(
      path.join(dir, 'SPEC_V07C.md'),
      '# Make My Dreams — v0.7.c Spec: compaction\n\nThis extends [the drift detector](SPEC_V07B.md).\n',
    );
    git(dir, ['init', '-q']);
    git(dir, ['config', 'user.email', 't@t.t']);
    git(dir, ['config', 'user.name', 'T']);
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'baseline']);

    assert.equal(runMmd(dir, []).status, 0);
    // After the move, BOTH specs sit in docs/specs/. The cross-ref must stay
    // bare (sibling-relative still resolves) — NOT rewritten to docs/specs/.
    const moved = await readFile(path.join(dir, 'docs', 'specs', 'SPEC_V07C.md'), 'utf8');
    assert.match(moved, /\[the drift detector\]\(SPEC_V07B\.md\)/);
    assert.doesNotMatch(moved, /docs\/specs\/SPEC_V07B/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration document-compact: non-git repo → honest exit 5, nothing changed', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mmd-compact-nogit-'));
  try {
    await writeFile(path.join(dir, 'SPEC_V01.md'), '# Make My Dreams — v0.1 Spec\n');
    const r = runMmd(dir, []);
    assert.equal(r.status, 5, r.stdout);
    assert.match(r.stderr, /not a git repository/);
    // SPEC still at root — not half-applied.
    assert.ok((await readdir(dir)).includes('SPEC_V01.md'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration document-compact: untracked root SPEC → exit 6 before any mutation', async () => {
  const dir = await makeRepo();
  try {
    // A brand-new, uncommitted SPEC at root: tracked check must refuse up front.
    await writeFile(path.join(dir, 'SPEC_V08A.md'), '# Make My Dreams — v0.8.a Spec: untracked\n');
    const r = runMmd(dir, []);
    assert.equal(r.status, 6, r.stdout);
    assert.match(r.stderr, /not git-tracked/);
    assert.match(r.stderr, /SPEC_V08A\.md/);
    // Never half-applied: docs/specs/ was not created, nothing moved.
    const rootFiles = await readdir(dir);
    assert.ok(rootFiles.includes('SPEC_V01.md'), 'no SPEC should have moved');
    assert.equal(git(dir, ['status', '--porcelain', 'docs']).trim(), '', 'archive dir must not be created');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration document-compact: --help → exit 0 with usage; unknown flag → exit 2', async () => {
  const dir = await makeRepo();
  try {
    const help = runMmd(dir, ['--help']);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /mmd document-compact/);
    assert.match(help.stdout, /--dry-run/);

    const bad = runMmd(dir, ['--bogus']);
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /unknown document-compact arg/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
