// Tests for lib/invoke-autodev.js
// CRITICAL: never let a test invoke the real claude CLI. We always set MMD_AUTODEV_CMD.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { invokeAutodev, buildSubprocessEnv } from '../../lib/invoke-autodev.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const FIXTURE_OK = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-autodev.sh');
const FIXTURE_FAIL = path.join(REPO_ROOT, 'test', 'fixtures', 'failing-autodev.sh');
const FIXTURE_ENV = path.join(REPO_ROOT, 'test', 'fixtures', 'echo-env.sh');

function makeTmp() {
  const tmp = mkdtempSync(path.join(tmpdir(), 'mmd-inv-'));
  return tmp;
}

test('invokeAutodev with fake-autodev.sh returns code 0 and logs subprocess output', async () => {
  const tmp = makeTmp();
  try {
    process.env.MMD_AUTODEV_CMD = FIXTURE_OK;
    const logPath = path.join(tmp, 'run.log');
    const r = await invokeAutodev({
      demoDir: tmp,
      dream: 'a dream',
      slug: 'a-dream',
      promptParts: { dream: 'a dream', slug: 'a-dream', demoDir: tmp },
      logPath,
      timeoutMs: 10000,
    });
    assert.equal(r.code, 0);
    assert.ok(existsSync(logPath));
    const log = readFileSync(logPath, 'utf8');
    assert.match(log, /fake-autodev/);
    assert.ok(existsSync(path.join(tmp, 'index.html')), 'fixture should have created index.html in cwd');
  } finally {
    delete process.env.MMD_AUTODEV_CMD;
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('invokeAutodev resolves (does not throw) when subprocess exits non-zero', async () => {
  const tmp = makeTmp();
  try {
    process.env.MMD_AUTODEV_CMD = FIXTURE_FAIL;
    const logPath = path.join(tmp, 'run.log');
    const r = await invokeAutodev({
      demoDir: tmp,
      dream: 'a dream',
      slug: 'a-dream',
      promptParts: { dream: 'a dream', slug: 'a-dream', demoDir: tmp },
      logPath,
      timeoutMs: 10000,
    });
    assert.notEqual(r.code, 0);
  } finally {
    delete process.env.MMD_AUTODEV_CMD;
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('invokeAutodev rejects with mmdExitCode === 4 when executable is missing', async () => {
  const tmp = makeTmp();
  try {
    process.env.MMD_AUTODEV_CMD = '/no/such/path/definitely-does-not-exist';
    let caught = null;
    try {
      await invokeAutodev({
        demoDir: tmp,
        dream: 'a dream',
        slug: 'a-dream',
        promptParts: { dream: 'a dream', slug: 'a-dream', demoDir: tmp },
        logPath: path.join(tmp, 'run.log'),
        timeoutMs: 10000,
      });
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, 'expected a rejection');
    assert.equal(caught.mmdExitCode, 4);
  } finally {
    delete process.env.MMD_AUTODEV_CMD;
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('invokeAutodev rejects with mmdExitCode === 5 when cwd is missing', async () => {
  const missingCwd = path.join(tmpdir(), 'mmd-inv-missing-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  try {
    process.env.MMD_AUTODEV_CMD = FIXTURE_OK;
    let caught = null;
    try {
      await invokeAutodev({
        demoDir: missingCwd,
        dream: 'a dream',
        slug: 'a-dream',
        promptParts: { dream: 'a dream', slug: 'a-dream', demoDir: missingCwd },
        logPath: path.join(tmpdir(), 'unused.log'),
        timeoutMs: 10000,
      });
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, 'expected a rejection');
    assert.equal(caught.mmdExitCode, 5);
    assert.equal(caught.path, path.resolve(missingCwd));
  } finally {
    delete process.env.MMD_AUTODEV_CMD;
  }
});

test('buildSubprocessEnv allowlist strips arbitrary secrets but keeps PATH/HOME', () => {
  const parentEnv = {
    PATH: '/usr/bin',
    HOME: '/home/test',
    AWS_SECRET_ACCESS_KEY: 'sentinel-secret-do-not-leak',
    GITHUB_TOKEN: 'sentinel-github-token',
    MMD_AUTODEV_CMD: '/bin/true',
    CLAUDE_CONFIG: 'something',
  };
  const out = buildSubprocessEnv(parentEnv);
  assert.equal(out.PATH, '/usr/bin');
  assert.equal(out.HOME, '/home/test');
  assert.equal(out.MMD_AUTODEV_CMD, '/bin/true');
  assert.equal(out.CLAUDE_CONFIG, 'something');
  assert.equal(out.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(out.GITHUB_TOKEN, undefined);
});

test('env allowlist actually strips secrets when spawning subprocess (echo-env fixture)', async () => {
  const tmp = makeTmp();
  try {
    process.env.MMD_AUTODEV_CMD = FIXTURE_ENV;
    const sentinel = 'sentinel-' + Date.now();
    process.env.AWS_SECRET_ACCESS_KEY = sentinel;
    const capturePath = path.join(tmp, 'env.txt');
    const logPath = path.join(tmp, 'run.log');
    const r = await invokeAutodev({
      demoDir: tmp,
      dream: capturePath, // echo-env uses arg 1 as capture path
      slug: 'env',
      promptParts: { dream: capturePath, slug: 'env', demoDir: tmp },
      logPath,
      timeoutMs: 10000,
      // Override args entirely to call fixture with a single-arg capture path.
      // We rely on the production behavior: non-claude commands receive prompt as single arg.
    });
    assert.equal(r.code, 0);
    assert.ok(existsSync(capturePath), 'env capture file should exist');
    const envDump = readFileSync(capturePath, 'utf8');
    assert.ok(!envDump.includes(sentinel),
      'AWS_SECRET_ACCESS_KEY (sentinel) must NOT appear in subprocess env');
    assert.match(envDump, /PATH=/);
  } finally {
    delete process.env.MMD_AUTODEV_CMD;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('invokeAutodev validates MMD_AUTODEV_CMD points to an executable path', async () => {
  const tmp = makeTmp();
  try {
    // Create a non-executable file
    const { writeFileSync, chmodSync } = await import('node:fs');
    const nonExec = path.join(tmp, 'not-exec.sh');
    writeFileSync(nonExec, '#!/bin/sh\necho hi\n');
    chmodSync(nonExec, 0o644); // no x bit
    process.env.MMD_AUTODEV_CMD = nonExec;
    let caught = null;
    try {
      await invokeAutodev({
        demoDir: tmp,
        dream: 'a',
        slug: 'a',
        promptParts: { dream: 'a', slug: 'a', demoDir: tmp },
        logPath: path.join(tmp, 'run.log'),
        timeoutMs: 5000,
      });
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, 'expected rejection for non-exec path');
    assert.match(caught.message, /executable|MMD_AUTODEV_CMD/i);
  } finally {
    delete process.env.MMD_AUTODEV_CMD;
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('invokeAutodev passes args as array (no shell injection on dream containing shell metas)', async () => {
  const tmp = makeTmp();
  try {
    process.env.MMD_AUTODEV_CMD = FIXTURE_OK;
    const dirty = 'normal dream"; rm -rf /; echo "';
    const r = await invokeAutodev({
      demoDir: tmp,
      dream: dirty,
      slug: 'x',
      promptParts: { dream: dirty, slug: 'x', demoDir: tmp },
      logPath: path.join(tmp, 'run.log'),
      timeoutMs: 5000,
    });
    assert.equal(r.code, 0);
    // index.html should have been created by stub, NOT a rm side effect.
    assert.ok(existsSync(path.join(tmp, 'index.html')));
  } finally {
    delete process.env.MMD_AUTODEV_CMD;
    rmSync(tmp, { recursive: true, force: true });
  }
});
