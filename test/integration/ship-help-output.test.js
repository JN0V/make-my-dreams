// @integration tests — `mmd ship --help` snapshot regression per SPEC_V02G
// §5 commit ordering (F4 Option B) + F2 Phase-4 review (byte-identical
// snapshot, not just substring anchors).
//
// The snapshot fixture is `test/fixtures/ship-help.snapshot.txt`. To re-bless
// it after an intentional change:
//
//   UPDATE_SNAPSHOTS=1 node --test test/integration/ship-help-output.test.js
//
// The byte-identical check guards the F4 Option B contract: the help body
// MUST be stable across the v0.2.f → v0.2.g refactor when
// MMD_GSTACK_SKILLS_DIR is unset.
//
// An anchor-based sub-test is retained as a sanity net: if someone re-blesses
// the snapshot with garbage by accident, the anchor test catches obvious
// breakage (missing usage line, missing --help flag, ...).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { buildSubprocessEnv } from '../../lib/invoke-autodev.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');
const PKG = JSON.parse(
  readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'),
);
const SNAPSHOT_PATH = path.join(
  REPO_ROOT, 'test', 'fixtures', 'ship-help.snapshot.txt',
);

function runMmd(args, opts = {}) {
  const baseEnv = buildSubprocessEnv(process.env);
  // Force MMD_GSTACK_SKILLS_DIR unset for snapshot stability (the help output
  // doesn't reference it but the build-prompt's resolveSkillPath() module-load
  // constant would change shape if it were set).
  const env = { ...baseEnv, ...(opts.env || {}) };
  delete env.MMD_GSTACK_SKILLS_DIR;
  return spawnSync('node', [MMD, ...args], {
    cwd: REPO_ROOT,
    env,
    encoding: 'utf8',
    timeout: 10000,
  });
}

test('@smoke @integration mmd ship --help exits 0 and ends with the version footer', () => {
  const r = runMmd(['ship', '--help']);
  assert.equal(r.status, 0, r.stderr);
  // Per L-005 we read the version from package.json instead of hardcoding —
  // the same source bin/skills/ship.js reads.
  const expectedFooter = `mmd ${PKG.version}`;
  assert.ok(
    r.stdout.includes(expectedFooter),
    `expected footer '${expectedFooter}' in stdout; got: ${r.stdout}`,
  );
});

// F2 — byte-identical snapshot. Anchors are not enough: an accidental rewrite
// of the help text would still pass substring assertions but break user
// muscle memory / `mmd help ship` parsers. Re-bless with UPDATE_SNAPSHOTS=1.
test('@integration F2 — mmd ship --help is byte-identical to the snapshot', () => {
  const r = runMmd(['ship', '--help']);
  assert.equal(r.status, 0, r.stderr);
  if (process.env.UPDATE_SNAPSHOTS === '1') {
    writeFileSync(SNAPSHOT_PATH, r.stdout, 'utf8');
    return; // Re-blessed.
  }
  const expected = readFileSync(SNAPSHOT_PATH, 'utf8');
  assert.strictEqual(
    r.stdout,
    expected,
    `ship --help drifted from snapshot. ` +
    `Run UPDATE_SNAPSHOTS=1 node --test test/integration/ship-help-output.test.js ` +
    `to re-bless if intentional.`,
  );
});

// Sanity anchor net — even if someone re-blesses with garbage, this test
// catches obvious breakage (missing canonical lines).
test('@integration mmd ship --help contains the canonical anchors (sanity)', () => {
  const r = runMmd(['ship', '--help']);
  assert.equal(r.status, 0, r.stderr);
  for (const anchor of [
    'mmd ship',
    '--dry-run',
    '--help',
    '<branch>',
    '~/.claude/skills/gstack/ship/SKILL.md',
    'MMD_SHIP_TIMEOUT_MS',
    'MMD_SHIP_CMD',
    'MMD_QUIET',
  ]) {
    assert.ok(
      r.stdout.includes(anchor),
      `mmd ship --help must contain anchor '${anchor}'; got: ${r.stdout}`,
    );
  }
});

test('@integration H7 — buildShipPrompt output is stable when MMD_GSTACK_SKILLS_DIR is unset', async () => {
  // Byte-identity check for the prompt body — guards the F4 Option B
  // contract. The prompt is re-built twice from a fresh import each time;
  // the dynamic import + cache-bust ensure module-load-time env read is
  // exercised on both calls.
  delete process.env.MMD_GSTACK_SKILLS_DIR;
  const mod1 = await import(
    `../../lib/skills/ship/build-prompt.js?b=${Date.now()}-a`
  );
  const mod2 = await import(
    `../../lib/skills/ship/build-prompt.js?b=${Date.now()}-b`
  );
  const opts = {
    branch: 'slice/test-snapshot',
    baseBranch: 'main',
    sha: 'deadbeef',
    repoRoot: '/tmp/repo',
  };
  const a = mod1.buildShipPrompt(opts);
  const b = mod2.buildShipPrompt(opts);
  assert.equal(a, b);
  // The literal tilde-form path must appear (proving resolveSkillPath
  // returned the un-expanded form when env unset).
  assert.ok(
    a.includes('~/.claude/skills/gstack/ship/SKILL.md'),
    `prompt missing the canonical tilde-form path: ${a}`,
  );
});
