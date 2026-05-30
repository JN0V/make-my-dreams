// @unit tests for countTestFiles (lib/discover/scan.js) — SPEC_V02K AC-2, L-017.
// Recursive, bounded-depth, gitignore-standard-aware, symlink-safe counting of
// test files across the conventional test directories.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { countTestFiles } from '../../lib/discover/scan.js';

async function tmp() {
  return await mkdtemp(path.join(os.tmpdir(), 'mmd-walk-'));
}

test('@unit countTestFiles: counts nested test files across conventions', async () => {
  const t = await tmp();
  try {
    await mkdir(path.join(t, 'test', 'unit'), { recursive: true });
    await mkdir(path.join(t, 'test', 'integration'), { recursive: true });
    await mkdir(path.join(t, 'test', 'e2e'), { recursive: true });
    await mkdir(path.join(t, 'tests'), { recursive: true });
    await mkdir(path.join(t, '__tests__'), { recursive: true });
    await writeFile(path.join(t, 'test', 'unit', 'foo.test.js'), '', 'utf8');
    await writeFile(path.join(t, 'test', 'integration', 'bar.test.js'), '', 'utf8');
    await writeFile(path.join(t, 'test', 'e2e', 'baz.test.js'), '', 'utf8');
    await writeFile(path.join(t, 'tests', 'qux_test.py'), '', 'utf8');
    await writeFile(path.join(t, '__tests__', 'quux.spec.ts'), '', 'utf8');
    const r = await countTestFiles(t);
    assert.equal(r.count, 5);
    assert.ok(r.dirs.includes('test'));
    assert.ok(r.dirs.includes('tests'));
    assert.ok(r.dirs.includes('__tests__'));
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit countTestFiles: matches all spec extensions, ignores non-tests', async () => {
  const t = await tmp();
  try {
    await mkdir(path.join(t, 'test'), { recursive: true });
    const tests = [
      'a.test.js', 'b.spec.ts', 'c.test.jsx', 'd.spec.tsx',
      'e.test.py', 'f.spec.rs', 'g.test.go', 'h_test.py', 'i_test.go',
    ];
    for (const n of tests) await writeFile(path.join(t, 'test', n), '', 'utf8');
    // Must NOT count:
    await writeFile(path.join(t, 'test', 'helper.js'), '', 'utf8');
    await writeFile(path.join(t, 'test', 'README.md'), '', 'utf8');
    await writeFile(path.join(t, 'test', 'data_test.txt'), '', 'utf8'); // _test but .txt
    const r = await countTestFiles(t);
    assert.equal(r.count, tests.length);
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit countTestFiles: skips node_modules and respects the depth bound', async () => {
  const t = await tmp();
  try {
    // node_modules under a test dir must never be counted.
    await mkdir(path.join(t, 'test', 'node_modules', 'pkg'), { recursive: true });
    await writeFile(path.join(t, 'test', 'node_modules', 'pkg', 'dep.test.js'), '', 'utf8');
    // depth 1 (counted)
    await writeFile(path.join(t, 'test', 'real.test.js'), '', 'utf8');
    // test(1)/a(2)/b(3)/c(4): file at depth 4 counted
    await mkdir(path.join(t, 'test', 'a', 'b', 'c', 'd'), { recursive: true });
    await writeFile(path.join(t, 'test', 'a', 'b', 'c', 'ok.test.js'), '', 'utf8');
    // depth 5: must NOT be counted
    await writeFile(path.join(t, 'test', 'a', 'b', 'c', 'd', 'deep.test.js'), '', 'utf8');
    const r = await countTestFiles(t);
    assert.equal(r.count, 2);
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit countTestFiles: no test dirs → count 0, dirs empty', async () => {
  const t = await tmp();
  try {
    await mkdir(path.join(t, 'src'), { recursive: true });
    await writeFile(path.join(t, 'src', 'index.js'), '', 'utf8');
    const r = await countTestFiles(t);
    assert.equal(r.count, 0);
    assert.deepEqual(r.dirs, []);
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});
