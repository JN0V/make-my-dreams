// test/unit/readme-sync-changelog.test.js — pure builder unit tests for the
// README Changelog block (SPEC_V03D AC-3). The git runner is injected, so no
// real git is spawned. Tagged @unit.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildChangelog } from '../../lib/readme-sync/build-changelog.js';

// Fake runGit: returns the configured for-each-ref payload. The real builder
// asks for `for-each-ref --sort=-version:refname --format=...` — we match on the
// 'for-each-ref' prefix and hand back a TAB-separated tag\tsubject body.
function fakeGit(stdout, { ok = true, code = 0, stderr = '' } = {}) {
  return async (args) => {
    if (args[0] === 'for-each-ref') {
      return ok ? { ok: true, code, stdout, stderr } : { ok: false, error: new Error(stderr) };
    }
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };
}

test('@unit buildChangelog: one line per tag, newest-first, from annotation subjects', async () => {
  // The runner controls order (git --sort does the sorting); we feed newest-first.
  const stdout = [
    'v0.3.3\tLayer C: profile→constitution-module composer',
    'v0.3.2\tDream Catcher CLI surface + MMD_PROFILE threading',
    'v0.3.1\tDream Catcher involvement dial',
  ].join('\n') + '\n';
  const block = await buildChangelog({ runGit: fakeGit(stdout), repoRoot: '/repo' });
  const lines = block.split('\n');
  assert.equal(lines[0], '- **v0.3.3** — Layer C: profile→constitution-module composer');
  assert.equal(lines[1], '- **v0.3.2** — Dream Catcher CLI surface + MMD_PROFILE threading');
  assert.equal(lines[2], '- **v0.3.1** — Dream Catcher involvement dial');
});

test('@unit buildChangelog: a lightweight (non-annotated) tag renders (no annotation), not a crash', async () => {
  const stdout = 'v0.3.3\tannotated subject\nv0.0.1\t\n';
  const block = await buildChangelog({ runGit: fakeGit(stdout), repoRoot: '/repo' });
  assert.match(block, /- \*\*v0\.3\.3\*\* — annotated subject/);
  assert.match(block, /- \*\*v0\.0\.1\*\* — _\(no annotation\)_/);
});

test('@unit buildChangelog: an empty tag list yields an explicit no-tags line', async () => {
  const block = await buildChangelog({ runGit: fakeGit(''), repoRoot: '/repo' });
  assert.match(block, /No tags yet/);
});

test('@unit buildChangelog: a failing git call renders (unavailable: …), never crashes', async () => {
  const block = await buildChangelog({
    runGit: fakeGit('', { ok: false, stderr: 'git exploded' }),
    repoRoot: '/repo',
  });
  assert.match(block, /changelog unavailable: git exploded/);
});

test('@unit buildChangelog: a subject containing a tab keeps everything after the first tab', async () => {
  const stdout = 'v1.0.0\tsummary\twith tab\n';
  const block = await buildChangelog({ runGit: fakeGit(stdout), repoRoot: '/repo' });
  assert.match(block, /- \*\*v1\.0\.0\*\* — summary\twith tab/);
});
