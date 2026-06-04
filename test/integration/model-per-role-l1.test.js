// @integration tests for v0.16.a AC-2 — L1 model-per-role wiring (SPEC_V016A,
// ADR-055). MMD's OWN `claude -p` calls (judge / sealed-tester / the unblock
// 5-Whys session) must pass `--model modelForRole(<role>, env)` to the spawn —
// honored because MMD owns each spawn (proven detached). These tests drive the
// real seams with FAKE claude fixtures that capture their argv, and assert the
// policy model rides on the spawned argv (default + per-role override).
//
// CRITICAL: every spawn uses a fixture (MMD_AUTODEV_CMD / MMD_UNBLOCK_CMD) so the
// real claude is NEVER invoked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import path from 'node:path';

import { buildSubprocessEnv } from '../../lib/invoke-autodev.js';
import { slugify } from '../../lib/parse-dream.js';
import { runFiveWhys } from '../../lib/conductor/five-whys.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');
const SEALED_FIXTURE = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-claude-sealed.sh');
const FIVEWHYS_FIXTURE = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-claude-five-whys.sh');
const SKIP_ON_WINDOWS = platform() === 'win32';

const DREAM = 'a counter app with plus and minus buttons';
const SLUG = slugify(DREAM);

// ── L1: judge + tester (sealed pipeline) ────────────────────────────────────

function runSealed(extraEnv, cwd) {
  const env = {
    ...buildSubprocessEnv(process.env),
    MMD_AUTODEV_CMD: SEALED_FIXTURE,
    MMD_REALITY_CHECK_BACKEND: 'skip',
    MMD_FAKE_SEALED_DUMP_ARGV: '1',
    ...extraEnv,
  };
  return spawnSync('node', [MMD, '--sealed', DREAM], { cwd, env, encoding: 'utf8', timeout: 60000 });
}

// Read a per-role argv dump (one token per line) the fixture wrote into the demo dir.
function readArgv(cwd, role) {
  const p = path.join(cwd, 'demo', SLUG, `argv-${role}.txt`);
  if (!existsSync(p)) return null;
  return readFileSync(p, 'utf8').split('\n').map((s) => s).filter((s) => s.length);
}

// Assert the argv carries `--model <expected>` as adjacent tokens.
function assertModel(tokens, expected, label) {
  assert.ok(tokens, `${label}: expected an argv dump`);
  const i = tokens.indexOf('--model');
  assert.ok(i >= 0, `${label}: argv should contain --model; got ${JSON.stringify(tokens)}`);
  assert.equal(tokens[i + 1], expected, `${label}: --model should be ${expected}`);
}

test('@integration AC-2: judge + tester spawn carry the DEFAULT policy model (sonnet)', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'mmd-l1-'));
  try {
    const r = runSealed({}, tmp);
    assert.equal(r.status, 0, `expected exit 0; got ${r.status}; stderr=${r.stderr}`);
    assertModel(readArgv(tmp, 'tester'), 'sonnet', 'tester');
    assertModel(readArgv(tmp, 'judge'), 'sonnet', 'judge');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration AC-2: MMD_MODEL_JUDGE / MMD_MODEL_TESTER override per role', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'mmd-l1-'));
  try {
    const r = runSealed({ MMD_MODEL_JUDGE: 'opus', MMD_MODEL_TESTER: 'haiku' }, tmp);
    assert.equal(r.status, 0, `expected exit 0; got ${r.status}; stderr=${r.stderr}`);
    assertModel(readArgv(tmp, 'tester'), 'haiku', 'tester (override)');
    assertModel(readArgv(tmp, 'judge'), 'opus', 'judge (override)');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── L1: the unblock 5-Whys session (runFiveWhys directly) ───────────────────

const STALL_CONTEXT = {
  sliceBranch: 'slice/demo',
  signals: ['no-commit-since-30-min'],
  evidence: { lastCommitAge: 1800 },
};

async function runUnblockArgv(env, dumpPath) {
  const tmp = mkdtempSync(path.join(tmpdir(), 'mmd-unblock-l1-'));
  try {
    await runFiveWhys({
      context: STALL_CONTEXT,
      repoRoot: tmp,
      claudePath: FIVEWHYS_FIXTURE,
      env: { ...process.env, MMD_FAKE_5WHYS_DUMP_ARGV: dumpPath, ...env },
      quiet: true,
    });
    return readFileSync(dumpPath, 'utf8').split('\n').filter((s) => s.length);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

test('@integration AC-2: the unblock 5-Whys spawn carries the DEFAULT policy model (sonnet), positional prompt preserved', { skip: SKIP_ON_WINDOWS }, async () => {
  const dump = path.join(mkdtempSync(path.join(tmpdir(), 'mmd-dump-')), 'argv.txt');
  const tokens = await runUnblockArgv({}, dump);
  // The strict -p / --output-format / text / prompt contract is preserved; the
  // model rides AFTER the prompt.
  assert.equal(tokens[0], '-p');
  assert.equal(tokens[1], '--output-format');
  assert.equal(tokens[2], 'text');
  assertModel(tokens, 'sonnet', 'unblock');
  // --model must come AFTER the positional prompt (token index 3).
  assert.ok(tokens.indexOf('--model') > 3, 'unblock: --model must follow the positional prompt');
});

test('@integration AC-2: MMD_MODEL_UNBLOCK overrides the unblock session model', async () => {
  const dump = path.join(mkdtempSync(path.join(tmpdir(), 'mmd-dump-')), 'argv.txt');
  const tokens = await runUnblockArgv({ MMD_MODEL_UNBLOCK: 'opus' }, dump);
  assertModel(tokens, 'opus', 'unblock (override)');
});
