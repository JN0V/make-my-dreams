// @unit tests for lib/discover/safe-write.js — adversarial path-traversal.
// Per testing.md §V: < 100ms total. Uses isolated tmp dirs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { assertSafeWritePath, isInside } from '../../lib/discover/safe-write.js';

async function tmp() {
  return await mkdtemp(path.join(os.tmpdir(), 'mmd-safewrite-'));
}

test('@unit isInside: pure predicate behaves correctly', () => {
  assert.equal(isInside('/a/b/c', '/a/b'), true);
  assert.equal(isInside('/a/b', '/a/b'), false);          // equality is NOT inside
  assert.equal(isInside('/a/bc', '/a/b'), false);         // prefix-only, no sep
  assert.equal(isInside('/a/b/c', '/a/b/c/d'), false);
  assert.equal(isInside(null, '/a/b'), false);
});

test('@unit assertSafeWritePath: write under <target>/.mmd/ is allowed', async () => {
  const t = await tmp();
  try {
    const p = path.join(t, '.mmd', 'shared', 'project-onboarder', 'scan.json');
    await assertSafeWritePath(t, p); // resolves silently
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit assertSafeWritePath: write to <target>/mmd-discovery-report.md is allowed', async () => {
  const t = await tmp();
  try {
    await assertSafeWritePath(t, path.join(t, 'mmd-discovery-report.md'));
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit assertSafeWritePath: write to <target>/docs/<new file> is allowed', async () => {
  const t = await tmp();
  try {
    const p = path.join(t, 'docs', 'adr', '008-foo.md');
    await assertSafeWritePath(t, p);
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit assertSafeWritePath: refuses to overwrite an existing docs/ file', async () => {
  const t = await tmp();
  try {
    const dir = path.join(t, 'docs');
    await mkdir(dir, { recursive: true });
    const p = path.join(dir, 'existing.md');
    await writeFile(p, '# existing', 'utf8');
    await assert.rejects(
      () => assertSafeWritePath(t, p),
      /already exists/,
    );
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit assertSafeWritePath: refuses a path outside target via ..', async () => {
  const t = await tmp();
  try {
    const escape = path.join(t, '..', 'outside.md');
    await assert.rejects(
      () => assertSafeWritePath(t, escape),
      /escapes target/,
    );
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit assertSafeWritePath: refuses an absolute path outside target', async () => {
  const t = await tmp();
  try {
    await assert.rejects(
      () => assertSafeWritePath(t, '/etc/passwd'),
      /escapes target|is not under/,
    );
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit assertSafeWritePath: refuses a write under <target> but outside allowed sinks', async () => {
  const t = await tmp();
  try {
    const bad = path.join(t, 'src', 'main.js');
    await assert.rejects(
      () => assertSafeWritePath(t, bad),
      /is not under/,
    );
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit assertSafeWritePath: refuses to write through a symlink at target', async () => {
  const t = await tmp();
  try {
    // Create a symlinked report path that points elsewhere.
    const realDest = await tmp();
    const reportPath = path.join(t, 'mmd-discovery-report.md');
    await symlink(path.join(realDest, 'evil.md'), reportPath);
    await assert.rejects(
      () => assertSafeWritePath(t, reportPath),
      /symlink/,
    );
    await rm(realDest, { recursive: true, force: true });
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit assertSafeWritePath: rejects empty/invalid args', async () => {
  await assert.rejects(() => assertSafeWritePath('', '/x'), /targetDir/);
  await assert.rejects(() => assertSafeWritePath('/x', ''), /candidatePath/);
});

test('@unit assertSafeWritePath: mustNotExist=true on .mmd/ rejects existing file', async () => {
  const t = await tmp();
  try {
    const dir = path.join(t, '.mmd', 'shared');
    await mkdir(dir, { recursive: true });
    const p = path.join(dir, 'exists.json');
    await writeFile(p, '{}', 'utf8');
    await assert.rejects(
      () => assertSafeWritePath(t, p, { mustNotExist: true }),
      /already exists/,
    );
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit assertSafeWritePath: writing to root file other than mmd-discovery-report.md is refused', async () => {
  const t = await tmp();
  try {
    const bad = path.join(t, 'README.md');
    await assert.rejects(
      () => assertSafeWritePath(t, bad),
      /is not under/,
    );
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});
