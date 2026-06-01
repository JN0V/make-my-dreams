// test/integration/document-review-since.test.js — CLI-level tests for the
// v0.7.d staleness-on-diff mode `mmd document-review --since <ref>` (SPEC_V07D
// AC-3, AC-4). We spawn the real bin/mmd.js child in a throwaway git repo with a
// KNOWN coupling structure, change one file, and assert the report surfaces the
// genuine coupled neighbors — the test that imports it, the ADR that references
// it — ranked, advisory, on stdout, writing NOTHING. Tagged @integration.
//
// The two headline assertions (SPEC §6 DoD): (1) a changed lib file surfaces its
// importing test + referencing ADR as STRONG neighbors (the coupling a human
// otherwise chases manually after a break); (2) --since is READ-ONLY — the tree
// is clean after a run (it does NOT rewrite docs/coherence-review.md).
// L-016/L-019: every spawned child has a hard timeout.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
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

function runSince(cwd, ref) {
  return spawnSync('node', [MMD, 'document-review', '--since', ref], {
    cwd, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, MMD_SKIP_SETUP: '1', MMD_SKIP_GROUNDING: '1' },
  });
}

// A fixture repo with a KNOWN coupling graph:
//   lib/a.js          (changed in the test)
//   lib/b.js          imports ./a.js          → strong import neighbor of a
//   test/a.test.js    imports ../lib/a.js     → strong import neighbor of a
//   docs/adr/001-a.md references lib/a.js     → strong doc→code neighbor of a
//                     + links [[002-other]] and ADR-2 (doc↔doc)
//   docs/adr/002-other.md
//   lib/lonely.js     (nothing imports / references it — self-contained)
async function makeRepo() {
  const dir = await mkdtemp(path.join(tmpdir(), 'mmd-since-'));
  await mkdir(path.join(dir, 'lib'), { recursive: true });
  await mkdir(path.join(dir, 'test'), { recursive: true });
  await mkdir(path.join(dir, 'docs', 'adr'), { recursive: true });

  await writeFile(path.join(dir, 'lib', 'a.js'), 'export const a = 1;\n');
  await writeFile(path.join(dir, 'lib', 'b.js'), "import { a } from './a.js';\nexport const b = a + 1;\n");
  await writeFile(path.join(dir, 'test', 'a.test.js'), "import { a } from '../lib/a.js';\n// asserts a\n");
  await writeFile(path.join(dir, 'lib', 'lonely.js'), 'export const lonely = true;\n');
  await writeFile(
    path.join(dir, 'docs', 'adr', '001-a.md'),
    '# ADR-001 — a\n\nThe module lib/a.js does the thing. See also [[002-other]] and ADR-2.\n',
  );
  await writeFile(path.join(dir, 'docs', 'adr', '002-other.md'), '# ADR-002 — other\n');
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'fix', version: '0.7.3' }));
  await writeFile(path.join(dir, 'MAKE_MY_DREAMS.md'), '# MMD\n## 9. Roadmap\n');

  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 't@t.t']);
  git(dir, ['config', 'user.name', 'T']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'baseline']);
  return dir;
}

test('@integration document-review --since: a changed lib file surfaces its importing test + referencing ADR (strong)', async () => {
  const dir = await makeRepo();
  try {
    // Change ONLY lib/a.js (its test + the ADR are NOT in the diff).
    await writeFile(path.join(dir, 'lib', 'a.js'), 'export const a = 2; // changed\n');
    git(dir, ['commit', '-aqm', 'tweak a']);

    const r = runSince(dir, 'HEAD~1');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /## Coupled changes/);
    assert.match(r.stdout, /Coupling ≠ certainty/, 'advisory framing present');
    assert.match(r.stdout, /Changed in this diff \(1 file\)/);

    // The genuine couplings, all STRONG, with their edge kind.
    assert.match(r.stdout, /→ review \(strong\): lib\/b\.js {3}\[imports\]/);
    assert.match(r.stdout, /→ review \(strong\): test\/a\.test\.js {3}\[imports\]/);
    assert.match(r.stdout, /→ review \(strong\): docs\/adr\/001-a\.md {3}\[doc→code ref\]/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration document-review --since: READ-ONLY — the tree is clean after a run (writes nothing)', async () => {
  const dir = await makeRepo();
  try {
    await writeFile(path.join(dir, 'lib', 'a.js'), 'export const a = 2;\n');
    git(dir, ['commit', '-aqm', 'tweak a']);

    const r = runSince(dir, 'HEAD~1');
    assert.equal(r.status, 0, r.stderr);
    // Nothing written — in particular NOT docs/coherence-review.md.
    const status = git(dir, ['status', '--porcelain']);
    assert.equal(status.trim(), '', `--since must write nothing, got: ${status}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration document-review --since: a self-contained change reports NO coupled neighbors', async () => {
  const dir = await makeRepo();
  try {
    // lib/lonely.js: nothing imports it, no doc references it.
    await writeFile(path.join(dir, 'lib', 'lonely.js'), 'export const lonely = false;\n');
    git(dir, ['commit', '-aqm', 'tweak lonely']);

    const r = runSince(dir, 'HEAD~1');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /1 changed file has no coupled neighbors/);
    // lonely is not listed with a neighbor arrow.
    assert.doesNotMatch(r.stdout, /lib\/lonely\.js\n {4}→/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration document-review --since: doc↔doc links couple ADRs (wiki + ADR-NNN)', async () => {
  const dir = await makeRepo();
  try {
    // Change ADR-002; ADR-001 links to it ([[002-other]] resolves to it, and ADR-2).
    await writeFile(path.join(dir, 'docs', 'adr', '002-other.md'), '# ADR-002 — other\n\nupdated\n');
    git(dir, ['commit', '-aqm', 'tweak adr2']);

    const r = runSince(dir, 'HEAD~1');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /→ review \(strong\): docs\/adr\/001-a\.md {3}\[doc↔doc link\]/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration document-review --since: a HUB SOURCE caps the flood + prints an honest suppressed-count note', async () => {
  // A hub doc that references MANY (> HUB_DEGREE = 12) lib files. Changing it
  // must NOT flood the report with 20 "strong" lines — cap to the top 12 + a note.
  const dir = await mkdtemp(path.join(tmpdir(), 'mmd-since-hub-'));
  try {
    await mkdir(path.join(dir, 'lib'), { recursive: true });
    const N = 20;
    const refs = [];
    for (let i = 0; i < N; i += 1) {
      const rel = `lib/mod-${String(i).padStart(2, '0')}.js`;
      await writeFile(path.join(dir, rel), `export const m${i} = ${i};\n`);
      refs.push(rel);
    }
    // HUB.md references every module → degree N (a hub source when changed).
    await writeFile(
      path.join(dir, 'HUB.md'),
      `# Hub\n\n${refs.map((r) => `- the module ${r} does a thing`).join('\n')}\n`,
    );
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'hub', version: '0.7.4' }));
    await writeFile(path.join(dir, 'MAKE_MY_DREAMS.md'), '# MMD\n## 9. Roadmap\n');

    git(dir, ['init', '-q']);
    git(dir, ['config', 'user.email', 't@t.t']);
    git(dir, ['config', 'user.name', 'T']);
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'baseline']);

    await writeFile(path.join(dir, 'HUB.md'), `# Hub (edited)\n\n${refs.map((r) => `- the module ${r} does a thing`).join('\n')}\n`);
    git(dir, ['commit', '-aqm', 'edit hub']);

    const r = runSince(dir, 'HEAD~1');
    assert.equal(r.status, 0, r.stderr);
    // Capped: exactly 12 "review (strong)" lines for HUB.md, not 20.
    const strongLines = (r.stdout.match(/→ review \(strong\):/g) || []).length;
    assert.equal(strongLines, 12, `expected 12 capped neighbors, got ${strongLines}\n${r.stdout}`);
    // Honest note naming the suppressed count + the hub-source reason.
    assert.match(r.stdout, /\+8 more direct neighbors suppressed \(hub source/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration document-review --since: a bad/unknown ref → honest non-zero (exit 5), no crash', async () => {
  const dir = await makeRepo();
  try {
    const r = runSince(dir, 'no-such-ref-xyz');
    assert.equal(r.status, 5, r.stdout + r.stderr);
    assert.match(r.stderr, /--since could not compute the diff/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration document-review --since: --since with no value → exit 2', async () => {
  const dir = await makeRepo();
  try {
    const r = spawnSync('node', [MMD, 'document-review', '--since'], {
      cwd: dir, encoding: 'utf8', timeout: 60000,
      env: { ...process.env, MMD_SKIP_SETUP: '1', MMD_SKIP_GROUNDING: '1' },
    });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /--since requires a git ref/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration document-review --since: not a git repo → exit 5 (honest)', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mmd-since-nogit-'));
  try {
    await writeFile(path.join(dir, 'package.json'), '{"version":"0.7.3"}');
    const r = runSince(dir, 'main');
    assert.equal(r.status, 5, r.stdout + r.stderr);
    assert.match(r.stderr, /Is this a git repo/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
