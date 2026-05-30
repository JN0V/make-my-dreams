// @unit tests for lib/here-mode/verify-grounding.js — SPEC_V02H AC-2.
//
// Drives verifyGrounding with an INJECTED mock runner returning configurable
// exit codes per file — no real git, no real repo. Per testing.md §V: < 100 ms.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { verifyGrounding } from '../../lib/here-mode/verify-grounding.js';

/**
 * Build a mock runGit that maps `<sha>:<file>` → exit code from a table.
 * Also records the exact args it was called with for argument-shape assertions.
 */
function mockRunner(codeByFile, calls) {
  return (args, cwd) => {
    if (calls) calls.push({ args, cwd });
    // args = ['cat-file', '-e', '<sha>:<file>']
    const spec = args[2] || '';
    const file = spec.includes(':') ? spec.slice(spec.indexOf(':') + 1) : spec;
    const code = Object.prototype.hasOwnProperty.call(codeByFile, file)
      ? codeByFile[file]
      : 0;
    return { code };
  };
}

test('@unit verifyGrounding: all files exist → { missing: [] }', async () => {
  const runGit = mockRunner({ 'SPEC_V02H.md': 0, 'README.md': 0 });
  const out = await verifyGrounding({
    files: ['SPEC_V02H.md', 'README.md'],
    baseSha: 'abc1234',
    repoRoot: '/repo',
    runGit,
  });
  assert.deepEqual(out, { missing: [] });
});

test('@unit verifyGrounding: missing file (non-zero exit) reported', async () => {
  const runGit = mockRunner({ 'SPEC_V99X.md': 128 });
  const out = await verifyGrounding({
    files: ['SPEC_V99X.md'],
    baseSha: 'abc1234',
    repoRoot: '/repo',
    runGit,
  });
  assert.deepEqual(out, { missing: ['SPEC_V99X.md'] });
});

test('@unit verifyGrounding: mixed — only the absent subset is returned, in input order', async () => {
  const runGit = mockRunner({
    'SPEC_V02H.md': 0,
    'docs/ghost.md': 128,
    'README.md': 0,
    'SPEC_V99X.md': 1,
  });
  const out = await verifyGrounding({
    files: ['SPEC_V02H.md', 'docs/ghost.md', 'README.md', 'SPEC_V99X.md'],
    baseSha: 'deadbee',
    repoRoot: '/repo',
    runGit,
  });
  assert.deepEqual(out, { missing: ['docs/ghost.md', 'SPEC_V99X.md'] });
});

test('@unit verifyGrounding: empty file list → { missing: [] } (no runner calls)', async () => {
  const calls = [];
  const runGit = mockRunner({}, calls);
  const out = await verifyGrounding({
    files: [],
    baseSha: 'abc1234',
    repoRoot: '/repo',
    runGit,
  });
  assert.deepEqual(out, { missing: [] });
  assert.equal(calls.length, 0);
});

test('@unit verifyGrounding: calls runGit with cat-file -e <sha>:<file> and repoRoot cwd', async () => {
  const calls = [];
  const runGit = mockRunner({ 'SPEC_V02H.md': 0 }, calls);
  await verifyGrounding({
    files: ['SPEC_V02H.md'],
    baseSha: 'abc1234',
    repoRoot: '/repo/root',
    runGit,
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ['cat-file', '-e', 'abc1234:SPEC_V02H.md']);
  assert.equal(calls[0].cwd, '/repo/root');
});

test('@unit verifyGrounding: awaits async runners', async () => {
  const runGit = async (args) => {
    const file = args[2].split(':')[1];
    return { code: file === 'gone.md' ? 1 : 0 };
  };
  const out = await verifyGrounding({
    files: ['here.md', 'gone.md'],
    baseSha: 'sha',
    repoRoot: '/r',
    runGit,
  });
  assert.deepEqual(out, { missing: ['gone.md'] });
});

test('@unit verifyGrounding: a runner result without a numeric code is treated as missing', async () => {
  const runGit = () => ({}); // malformed result
  const out = await verifyGrounding({
    files: ['x.md'],
    baseSha: 'sha',
    repoRoot: '/r',
    runGit,
  });
  assert.deepEqual(out, { missing: ['x.md'] });
});

test('@unit verifyGrounding: input validation throws TypeError', async () => {
  await assert.rejects(
    () => verifyGrounding({ files: 'nope', baseSha: 'sha', repoRoot: '/r' }),
    /files must be an array/,
  );
  await assert.rejects(
    () => verifyGrounding({ files: [], baseSha: '', repoRoot: '/r' }),
    /baseSha must be a non-empty string/,
  );
  await assert.rejects(
    () => verifyGrounding({ files: [], baseSha: 'sha', repoRoot: '' }),
    /repoRoot must be a non-empty string/,
  );
});
