// @integration tests for `mmd ship` — AC-4 (real spawn) + AC-7 (audit hook).
//
// CRITICAL: never let a test invoke the real claude CLI. Every test that
// reaches invokeClaudeShip MUST set MMD_SHIP_CMD=<test/fixtures/fake-claude-ship.sh>.
//
// Strategy: temp git repo + fake-claude fixture. Asserts:
//   1. claude was spawned with the right argv shape (-p --output-format text <prompt>)
//   2. The subprocess env contained ~/.bun/bin in PATH
//   3. Output was tee'd to .mmd/local/ship-runs/<ts>.log
//   4. The summary mentions the branch, log file, audit table (AC-7)
//   5. Subprocess exit code is propagated as the mmd ship exit code

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildSubprocessEnv } from '../../lib/invoke-autodev.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');
const FAKE_CLAUDE = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-claude-ship.sh');

function makeShipReadyRepo(prefix = 'mmd-ship-fake-') {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  const git = (args) => {
    const r = spawnSync(
      'git',
      ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args],
      { cwd: dir, encoding: 'utf8' },
    );
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}\n${r.stdout}`);
  };
  git(['init', '-q', '-b', 'main']);
  git(['commit', '--allow-empty', '-m', 'init', '-q']);
  git(['checkout', '-q', '-b', 'slice/test-fake-ship-1779999999']);
  writeFileSync(path.join(dir, 'CHANGELOG.md'), '# changes\n');
  git(['add', 'CHANGELOG.md']);
  git(['commit', '-m', 'docs: seed changelog', '-q']);
  return dir;
}

function runMmd(args, opts = {}) {
  const baseEnv = buildSubprocessEnv(process.env);
  const env = {
    ...baseEnv,
    MMD_SHIP_CMD: opts.shipCmd ?? FAKE_CLAUDE,
    MMD_QUIET: '1',
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
    ...(opts.env || {}),
  };
  return spawnSync('node', [MMD, ...args], {
    cwd: opts.cwd,
    env,
    encoding: 'utf8',
    timeout: 30000,
  });
}

test('mmd ship (fake claude): exits 0 on a slice branch, spawns the fixture', () => {
  const dir = makeShipReadyRepo();
  try {
    const r = runMmd(['ship'], { cwd: dir });
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}\nstdout=${r.stdout}`);
    // The fixture announces itself in stdout via the ship summary tee.
    // Because MMD_QUIET=1 silences live tee, the fixture's stdout lives in
    // the log file only — verify there.
    const logsDir = path.join(dir, '.mmd', 'local', 'ship-runs');
    assert.ok(existsSync(logsDir), 'log dir missing');
    const logFiles = readdirSync(logsDir).filter((f) => f.endsWith('.log'));
    assert.equal(logFiles.length, 1, `expected one log file; got ${logFiles.length}`);
    const log = readFileSync(path.join(logsDir, logFiles[0]), 'utf8');
    assert.match(log, /SHIP-OK/, `log missing SHIP-OK marker; content=${log}`);
    // PATH must contain ~/.bun/bin (the fixture echoes PATH).
    assert.match(log, /PATH=[^\n]*\.bun\/bin/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mmd ship (fake claude): summary includes branch + sha + log path', () => {
  const dir = makeShipReadyRepo();
  try {
    const r = runMmd(['ship'], { cwd: dir });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /mmd ship — summary/i);
    assert.match(r.stdout, /slice\/test-fake-ship-1779999999/);
    assert.match(r.stdout, /Log file/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mmd ship (fake claude): AC-7 audit-pillars table appears in summary', () => {
  const dir = makeShipReadyRepo();
  try {
    // To make audit-pillars resolvable, we need the scripts/ dir + git binary
    // accessible — handled by the harness defaults. The audit will run
    // against `main..HEAD` which is empty-of-pillar-invocations in this temp
    // repo, so all rows should be NOT INVOKED (claim drift line).
    //
    // Set MMD_AUDIT_PATTERNS so the script finds patterns.json even when
    // the temp repo doesn't carry one (the runShip handler resolves the
    // audit-pillars.sh path relative to bin/ship.js, which IS the real
    // MMD repo's script — but it reads patterns from its own SCRIPT_DIR).
    const r = runMmd(['ship'], {
      cwd: dir,
      env: {
        // Tell audit-pillars.sh to use the real MMD repo's patterns file.
        MMD_AUDIT_PATTERNS: path.join(REPO_ROOT, 'scripts', 'audit-pillars.patterns.json'),
      },
    });
    assert.equal(r.status, 0, r.stderr);
    // The audit table renders even when all pillars are NOT INVOKED — its
    // presence in the summary is the AC-7 contract (the audit ran).
    assert.match(r.stdout, /pillar audit/i);
    // The pillar names should appear.
    assert.match(r.stdout, /gStack/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mmd ship (fake claude failing): propagates non-zero exit code', () => {
  const dir = makeShipReadyRepo();
  try {
    const r = runMmd(['ship'], {
      cwd: dir,
      env: { MMD_FAKE_SHIP_EXIT: '5' },
    });
    assert.equal(r.status, 5, `expected exit 5; stderr=${r.stderr}\nstdout=${r.stdout}`);
    // The summary STILL renders so the user can see what happened (AC-7
    // explicit — the audit is advisory, never gating).
    assert.match(r.stdout, /summary|Subprocess.*code=5/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mmd ship: missing claude binary exits 4 with clear message', () => {
  const dir = makeShipReadyRepo();
  try {
    const r = runMmd(['ship'], {
      cwd: dir,
      shipCmd: '/no/such/binary/at/all',
    });
    assert.equal(r.status, 4, `expected exit 4; stderr=${r.stderr}\nstdout=${r.stdout}`);
    assert.match(r.stderr, /not found|spawn|mmd ship/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mmd ship: fake-claude receives -p --output-format text <prompt>', () => {
  const dir = makeShipReadyRepo();
  try {
    const r = runMmd(['ship'], { cwd: dir });
    assert.equal(r.status, 0, r.stderr);
    const logsDir = path.join(dir, '.mmd', 'local', 'ship-runs');
    const logFiles = readdirSync(logsDir).filter((f) => f.endsWith('.log'));
    const log = readFileSync(path.join(logsDir, logFiles[0]), 'utf8');
    // Fixture echoes "fake-claude-ship: received prompt of N chars" — N > 100.
    const m = log.match(/received prompt of (\d+) chars/);
    assert.ok(m, `log missing prompt-char count; content=${log}`);
    assert.ok(parseInt(m[1], 10) > 100, `prompt too short: ${m[1]} chars`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
