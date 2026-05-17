// @integration tests for AC-7 — Project Onboarder validation gate on
// `mmd --here` and the greenfield dream path. Uses isolated tmp git repos;
// never invokes the real auto-dev (we assert the gate fires BEFORE auto-dev
// would be reached).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

function makeBrownfield() {
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-gate-bf-'));
  writeFileSync(path.join(dir, 'package.json'), '{"name":"bf","version":"0.0.1"}');
  git(['init', '-q', '-b', 'main'], dir);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], dir);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], dir);
  return dir;
}

function runMmd(args, cwd) {
  return spawnSync('node', [MMD, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 30000,
    env: {
      ...process.env,
      // Defensive: keep test isolated from any real claude / autodev invocation.
      MMD_AUTODEV_CMD: '/bin/false',
      MMD_REALITY_CHECK_BACKEND: 'skip',
    },
  });
}

test('@integration AC-7: --here on brownfield without report → exit 5 + "no discovery report" message', () => {
  const dir = makeBrownfield();
  try {
    const r = runMmd(['--here', 'tiny change'], dir);
    assert.equal(r.status, 5);
    assert.match(r.stderr, /Brownfield project detected/);
    assert.match(r.stderr, /no discovery report/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration AC-7: --here with PENDING report → exit 5 + "pending discovery report"', () => {
  const dir = makeBrownfield();
  try {
    writeFileSync(
      path.join(dir, 'mmd-discovery-report.md'),
      '# MMD Discovery Report\n> Status: PENDING VALIDATION\n',
    );
    const r = runMmd(['--here', 'tiny change'], dir);
    assert.equal(r.status, 5);
    assert.match(r.stderr, /pending discovery report/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration AC-7: --here --skip-onboarding bypasses the gate (proceeds past gate)', () => {
  const dir = makeBrownfield();
  try {
    const r = runMmd(['--here', '--skip-onboarding', 'tiny change'], dir);
    // We expect the gate to NOT fire. The run will still fail later (because
    // MMD_AUTODEV_CMD=/bin/false), but the exit code must NOT be 5.
    assert.notEqual(r.status, 5, `expected to bypass gate, got exit 5. stderr: ${r.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration AC-7: --here on MMD itself (MAKE_MY_DREAMS.md present, no report) → gate does NOT fire', () => {
  const dir = makeBrownfield();
  try {
    writeFileSync(path.join(dir, 'MAKE_MY_DREAMS.md'), '# MMD\n');
    git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], dir);
    git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'add mmd marker'], dir);
    const r = runMmd(['--here', 'tiny change'], dir);
    assert.notEqual(r.status, 5, `gate should not fire on MMD self. stderr: ${r.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration AC-7: VALIDATED report clears the gate', () => {
  const dir = makeBrownfield();
  try {
    writeFileSync(
      path.join(dir, 'mmd-discovery-report.md'),
      '# MMD Discovery Report\n> Status: VALIDATED at 2026-05-17T00:00:00.000Z\n',
    );
    const r = runMmd(['--here', 'tiny change'], dir);
    assert.notEqual(r.status, 5, `gate should clear on VALIDATED. stderr: ${r.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration AC-7 full loop: discover → approve → --here works without --skip-onboarding', () => {
  const dir = makeBrownfield();
  try {
    const d1 = runMmd(['discover', '.'], dir);
    assert.equal(d1.status, 0, `discover failed: ${d1.stderr}`);
    assert.ok(existsSync(path.join(dir, 'mmd-discovery-report.md')));
    const d2 = runMmd(['discover', '--approve', '.'], dir);
    assert.equal(d2.status, 0, `approve failed: ${d2.stderr}`);
    // Now --here should pass the gate.
    const d3 = runMmd(['--here', 'tiny change'], dir);
    assert.notEqual(d3.status, 5, `gate still fired after approve. stderr: ${d3.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
