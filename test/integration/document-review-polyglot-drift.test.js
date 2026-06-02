// test/integration/document-review-polyglot-drift.test.js — CLI-level proof that
// the v0.8.2 Documentalist drift detector is POLYGLOT (constitution §VIII).
//
// The v0.7.b drift detector used to see code references only under
// lib|bin|test|docs/ ending in .js|.md — so on a Python/Rust/Go repo a doc citing
// src/foo.py or src/main.rs was INVISIBLE and the detector was blind. We spawn the
// real bin/mmd.js child in a throwaway git repo whose stack is Python + Rust (no
// JS source) and assert BOTH faces of the §VIII fix:
//   • RECALL — a doc citing a MISSING repo-rooted source file (src/foo.py,
//     src/main.rs) IS flagged dangling, at its exact doc:line.
//   • PRECISION — a doc citing an EXISTING non-JS source file (src/real_module.py)
//     is NOT flagged, and a NON-rooted / slash-joined token is NOT a new false
//     positive (the repo-rooted + mid-path-extension guards).
// Every spawned child has a hard timeout (L-016/L-019). Tagged @integration.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm, mkdir, readFile } from 'node:fs/promises';
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

function runMmd(cwd, args = []) {
  return spawnSync('node', [MMD, 'document-review', ...args], {
    cwd, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, MMD_SKIP_SETUP: '1', MMD_SKIP_GROUNDING: '1' },
  });
}

// A Python + Rust repo (NO JavaScript source) — the case the old JS-only matcher
// was blind to. Real top-level dirs: src/. The README carries a valid ref set
// (precision) and a planted dangling ref set (recall), line-numbered for exact
// doc:line assertions.
async function makePolyglotRepo() {
  const dir = await mkdtemp(path.join(tmpdir(), 'mmd-poly-drift-'));
  await mkdir(path.join(dir, 'src'), { recursive: true });
  await mkdir(path.join(dir, 'docs', 'adr'), { recursive: true });

  await writeFile(path.join(dir, 'MAKE_MY_DREAMS.md'), ROADMAP);
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture', version: '0.8.0' }));
  // Real Python + Rust source the README will (validly) reference.
  await writeFile(path.join(dir, 'src', 'real_module.py'), '# real\ndef f():\n    return 1\n');
  await writeFile(path.join(dir, 'src', 'lib.rs'), '// real\npub fn f() {}\n');
  await writeFile(path.join(dir, 'docs', 'adr', '001-x.md'), '# ADR-001 — x\n');

  const readme = [
    '# Polyglot fixture readme', // 1
    '', // 2
    'Valid Python file: src/real_module.py exists here.', // 3
    'Valid Rust file: src/lib.rs is present too.', // 4
    '', // 5
    'DANGLING python: src/foo.py is gone.', // 6
    'DANGLING rust: src/main.rs was removed.', // 7
    '', // 8
    'A non-rooted shorthand adapters/javascript.py is NOT a claim about this repo.', // 9
    'A slash-joined list README.md/CONTRIBUTING.md is prose, not a path.', // 10
  ].join('\n');
  await writeFile(path.join(dir, 'README.md'), readme);

  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 't@t.t']);
  git(dir, ['config', 'user.name', 'T']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'baseline']);
  return dir;
}

test('@integration polyglot-drift: a MISSING repo-rooted .py/.rs ref is flagged (recall — §VIII)', async () => {
  const dir = await makePolyglotRepo();
  try {
    const r = runMmd(dir);
    assert.equal(r.status, 0, r.stderr);
    const report = await readFile(path.join(dir, 'docs', 'coherence-review.md'), 'utf8');

    assert.match(report, /## Drift \/ conformance/);
    assert.match(report, /README\.md:6 → `src\/foo\.py` — file not found/);
    assert.match(report, /README\.md:7 → `src\/main\.rs` — file not found/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration polyglot-drift: an EXISTING non-JS source file is NOT flagged (precision)', async () => {
  const dir = await makePolyglotRepo();
  try {
    const r = runMmd(dir);
    assert.equal(r.status, 0, r.stderr);
    const report = await readFile(path.join(dir, 'docs', 'coherence-review.md'), 'utf8');
    const driftSection = report.slice(report.indexOf('## Drift / conformance'));

    assert.ok(!/real_module\.py` — file not found/.test(driftSection), 'existing .py not flagged');
    assert.ok(!/lib\.rs` — file not found/.test(driftSection), 'existing .rs not flagged');
    // Non-rooted shorthand + slash-joined list are NOT new false positives.
    assert.ok(!/adapters\/javascript\.py/.test(driftSection), 'non-rooted shorthand not flagged');
    assert.ok(!/CONTRIBUTING\.md` — file not found/.test(driftSection), 'slash-joined list not flagged');
    // Exactly the two planted dangling refs (recall) — nothing more (precision).
    assert.match(r.stdout, /Drift: 2 dangling references/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration polyglot-drift: READ-ONLY — only docs/coherence-review.md changes', async () => {
  const dir = await makePolyglotRepo();
  try {
    const r = runMmd(dir);
    assert.equal(r.status, 0, r.stderr);
    const status = git(dir, ['status', '--porcelain']);
    const changed = status.split('\n').map((l) => l.slice(3)).filter(Boolean);
    assert.deepEqual(changed, ['docs/coherence-review.md'], `unexpected changes: ${status}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
