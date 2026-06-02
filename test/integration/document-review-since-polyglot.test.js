// test/integration/document-review-since-polyglot.test.js — CLI-level tests for
// the POLYGLOT code↔code edges of `mmd document-review --since <ref>` (SPEC_V081
// AC-4). The coherence graph's import edges now come from the polyglot import
// graph, so a Python-file diff surfaces Python coupling, and a diff touching a
// language with no import adapter (Rust) is honestly NOTED rather than silently
// omitting its coupling. Spawns the real bin/mmd.js child in throwaway git repos.
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

function initRepo(dir) {
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 't@t.t']);
  git(dir, ['config', 'user.name', 'T']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'baseline']);
}

function runSince(cwd, ref) {
  return spawnSync('node', [MMD, 'document-review', '--since', ref], {
    cwd, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, MMD_SKIP_SETUP: '1', MMD_SKIP_GROUNDING: '1' },
  });
}

test('@integration document-review --since: a Python-file diff surfaces Python code coupling (strong import)', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mmd-since-py-'));
  try {
    await mkdir(path.join(dir, 'svc'), { recursive: true });
    await writeFile(path.join(dir, 'svc', '__init__.py'), '');
    await writeFile(path.join(dir, 'svc', 'models.py'), 'class M:\n    pass\n');
    await writeFile(path.join(dir, 'svc', 'api.py'), 'from svc.models import M\n\ndef use():\n    return M()\n');
    await writeFile(path.join(dir, 'MAKE_MY_DREAMS.md'), '# MMD\n## 9. Roadmap\n');
    initRepo(dir);

    // Change ONLY svc/models.py — svc/api.py imports it and must surface.
    await writeFile(path.join(dir, 'svc', 'models.py'), 'class M:\n    x = 1\n');
    git(dir, ['commit', '-aqm', 'tweak models']);

    const r = runSince(dir, 'HEAD~1');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /→ review \(strong\): svc\/api\.py {3}\[imports\]/);
    // No un-analyzed note — Python IS adapted.
    assert.doesNotMatch(r.stdout, /not available — no import adapter/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration document-review --since: a Rust file in the diff is honestly noted as un-analyzed (no faked coupling)', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mmd-since-rs-'));
  try {
    await mkdir(path.join(dir, 'src'), { recursive: true });
    await writeFile(path.join(dir, 'src', 'lib.rs'), 'pub mod a;\n');
    await writeFile(path.join(dir, 'src', 'a.rs'), 'pub fn a() {}\n');
    await writeFile(path.join(dir, 'MAKE_MY_DREAMS.md'), '# MMD\n## 9. Roadmap\n');
    initRepo(dir);

    await writeFile(path.join(dir, 'src', 'a.rs'), 'pub fn a() -> u8 { 1 }\n');
    git(dir, ['commit', '-aqm', 'tweak rust']);

    const r = runSince(dir, 'HEAD~1');
    assert.equal(r.status, 0, r.stderr);
    // The honest §VIII note names the un-adapted stack — never a silent omission.
    assert.match(r.stdout, /code coupling for Rust is not available — no import adapter yet/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
