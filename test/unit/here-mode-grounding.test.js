// @unit tests for checkPromptGrounding (lib/here-mode.js) — SPEC_V02H AC-3 + AC-4.
//
// The pre-check sequence is exercised by driving the (pure) extractor via the
// dream text and injecting the git runner used by the verifier. No real git.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkPromptGrounding } from '../../lib/here-mode.js';

/** runGit mock: files in `present` exist (code 0); everything else missing. */
function runnerWithPresent(present, calls) {
  const set = new Set(present);
  return (args, cwd) => {
    if (calls) calls.push({ args, cwd });
    const file = args[2].split(':').slice(1).join(':');
    return { code: set.has(file) ? 0 : 1 };
  };
}

test('@unit checkPromptGrounding: no documented refs → ok, files [] (no git calls)', async () => {
  const calls = [];
  const out = await checkPromptGrounding({
    dream: 'refactor the parser and add a banner',
    baseSha: 'abc',
    repoRoot: '/r',
    env: {},
    runGit: runnerWithPresent([], calls),
  });
  assert.deepEqual(out, { ok: true, files: [] });
  assert.equal(calls.length, 0);
});

test('@unit checkPromptGrounding: all refs grounded → ok with files list', async () => {
  const out = await checkPromptGrounding({
    dream: 'implement SPEC_V02H.md per docs/lessons-learned.md',
    baseSha: 'abc',
    repoRoot: '/r',
    env: {},
    runGit: runnerWithPresent(['SPEC_V02H.md', 'docs/lessons-learned.md']),
  });
  assert.equal(out.ok, true);
  assert.deepEqual(out.files, ['SPEC_V02H.md', 'docs/lessons-learned.md']);
  assert.ok(!('missing' in out));
});

test('@unit checkPromptGrounding: missing ref → ok:false, exit 6, message lists the file', async () => {
  const out = await checkPromptGrounding({
    dream: 'implement v9.9.9 per SPEC_V99X.md',
    baseSha: 'deadbee',
    repoRoot: '/r',
    baseBranch: 'main',
    env: {},
    runGit: runnerWithPresent([]),
  });
  assert.equal(out.ok, false);
  assert.equal(out.exitCode, 6);
  assert.deepEqual(out.missing, ['SPEC_V99X.md']);
  assert.match(out.message, /Prompt-grounding failed \(per L-015\)/);
  assert.match(out.message, /SPEC_V99X\.md/);
  assert.match(out.message, /main @ deadbee/);
  assert.match(out.message, /MMD_SKIP_GROUNDING=1/);
});

test('@unit checkPromptGrounding: partial — only missing files block (exit 6)', async () => {
  const out = await checkPromptGrounding({
    dream: 'use SPEC_V02H.md and docs/ghost.md',
    baseSha: 'sha',
    repoRoot: '/r',
    env: {},
    runGit: runnerWithPresent(['SPEC_V02H.md']),
  });
  assert.equal(out.ok, false);
  assert.deepEqual(out.missing, ['docs/ghost.md']);
});

test('@unit checkPromptGrounding: uses non-main baseBranch in the message (honesty, L-009)', async () => {
  const out = await checkPromptGrounding({
    dream: 'per SPEC_V99X.md',
    baseSha: 'sha123',
    repoRoot: '/r',
    baseBranch: 'release',
    env: {},
    runGit: runnerWithPresent([]),
  });
  assert.match(out.message, /release @ sha123/);
  assert.match(out.message, /commit them to release first/);
});

test('@unit checkPromptGrounding: MMD_SKIP_GROUNDING=1 bypasses entirely (no git calls)', async () => {
  const calls = [];
  const out = await checkPromptGrounding({
    dream: 'implement v9.9.9 per SPEC_V99X.md', // would be missing
    baseSha: 'sha',
    repoRoot: '/r',
    env: { MMD_SKIP_GROUNDING: '1' },
    runGit: runnerWithPresent([], calls),
  });
  assert.equal(out.ok, true);
  assert.equal(out.skipped, true);
  assert.match(out.warning, /MMD_SKIP_GROUNDING=1/);
  assert.match(out.warning, /at user's risk/);
  assert.equal(calls.length, 0, 'escape hatch must not call git');
});

test('@unit checkPromptGrounding: MMD_SKIP_GROUNDING other values do NOT bypass', async () => {
  const out = await checkPromptGrounding({
    dream: 'per SPEC_V99X.md',
    baseSha: 'sha',
    repoRoot: '/r',
    env: { MMD_SKIP_GROUNDING: '0' },
    runGit: runnerWithPresent([]),
  });
  assert.equal(out.ok, false);
  assert.equal(out.exitCode, 6);
});

test('@unit checkPromptGrounding: input validation throws TypeError', async () => {
  await assert.rejects(
    () => checkPromptGrounding({ dream: '', baseSha: 'sha', repoRoot: '/r' }),
    /dream must be a non-empty string/,
  );
  await assert.rejects(
    () => checkPromptGrounding({ dream: 'x', baseSha: '', repoRoot: '/r' }),
    /baseSha must be a non-empty string/,
  );
  await assert.rejects(
    () => checkPromptGrounding({ dream: 'x', baseSha: 'sha', repoRoot: '' }),
    /repoRoot must be a non-empty string/,
  );
});
