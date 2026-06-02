// test/integration/secret-scan-cmd.test.js — CLI-level tests for `mmdream secret-scan`
// (SPEC_V091 AC-2 + AC-3). We spawn the real bin/mmd.js child in throwaway git
// repos so the dispatch wiring, the real git gather (ls-files / --cached / --since),
// binary skipping, gitignore skipping, the gate exit codes, and READ-ONLY behavior
// are covered end-to-end. Tagged @integration.
//
// Self-scan hygiene: planted secrets are assembled at RUNTIME and written into
// THROWAWAY repos (tmpdir), never into MMD's own tree — so this file plants no
// secret the scanner can match in its own bytes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');

// Secret builders (split so no contiguous token appears in THIS source file).
const awsKeyId = () => 'AKIA' + '1234567890ABCDEF';
const ghpToken = () => 'ghp_' + 'wxyz0123456789abcdefghijABCDEFGHIJKL';
const highEntropyVal = () => 'k3Jx9Qp2Lm7Vn4Rt8Wz1Yb6Dc0Fg5Hh';

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 20000 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

function runScan(cwd, args = [], extraEnv = {}) {
  return spawnSync('node', [MMD, 'secret-scan', ...args], {
    cwd, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, MMD_SKIP_SETUP: '1', MMD_SKIP_GROUNDING: '1', ...extraEnv },
  });
}

async function makeRepo() {
  const dir = await mkdtemp(path.join(tmpdir(), 'mmd-secretscan-'));
  git(dir, ['init']);
  git(dir, ['config', 'user.email', 't@t.t']);
  git(dir, ['config', 'user.name', 't']);
  return dir;
}

async function commitAll(dir, msg = 'c') {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', msg]);
}

test('@integration a clean repo exits 0', async () => {
  const dir = await makeRepo();
  try {
    await writeFile(path.join(dir, 'app.js'), 'export const add = (a, b) => a + b;\n');
    await commitAll(dir);
    const r = runScan(dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /no secrets found/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration a planted high-confidence secret exits non-zero with the right rule + redacted snippet', async () => {
  const dir = await makeRepo();
  try {
    const secret = awsKeyId();
    await writeFile(path.join(dir, 'config.js'), `const key = "${secret}";\n`);
    await commitAll(dir);
    const r = runScan(dir);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /aws-access-key-id/);
    assert.match(r.stdout, /GATE TRIGGERED/);
    // REDACTION: the full secret must NOT appear anywhere in the output.
    assert.ok(!r.stdout.includes(secret), 'output must not echo the full secret');
    assert.match(r.stdout, /AKIA\*+/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration each secret format is caught across languages (.py/.rs/.env/.yaml/.txt)', async () => {
  const dir = await makeRepo();
  try {
    await writeFile(path.join(dir, 'a.py'), `aws = "${awsKeyId()}"\n`);
    await writeFile(path.join(dir, 'b.rs'), `let gh = "${ghpToken()}";\n`);
    await writeFile(path.join(dir, 'c.env'), `AWS_KEY=${awsKeyId()}\n`);
    await writeFile(path.join(dir, 'd.yaml'), `token: "${ghpToken()}"\n`);
    await writeFile(path.join(dir, 'e.txt'), `aws ${awsKeyId()}\n`);
    await commitAll(dir);
    const r = runScan(dir);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    for (const f of ['a.py', 'b.rs', 'c.env', 'd.yaml', 'e.txt']) {
      assert.match(r.stdout, new RegExp(f.replace('.', '\\.')), `expected a finding in ${f}`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration a placeholder example value is NOT flagged', async () => {
  const dir = await makeRepo();
  try {
    await writeFile(path.join(dir, 'config.js'), 'const key = "AKIA' + 'IOSFODNN7EXAMPLE";\n');
    await writeFile(path.join(dir, 'readme.md'), 'set token = "your-token-here" before running\n');
    await commitAll(dir);
    const r = runScan(dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration an inline mmd-secret-ok marker suppresses the finding', async () => {
  const dir = await makeRepo();
  try {
    await writeFile(
      path.join(dir, 'fixture.js'),
      `const k = "${awsKeyId()}"; // mmd-secret-ok known test fixture\n`,
    );
    await commitAll(dir);
    const r = runScan(dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration gitignored files are skipped', async () => {
  const dir = await makeRepo();
  try {
    await writeFile(path.join(dir, '.gitignore'), 'secrets.env\n');
    await writeFile(path.join(dir, 'secrets.env'), `AWS_KEY=${awsKeyId()}\n`);
    await writeFile(path.join(dir, 'app.js'), 'export const ok = 1;\n');
    await commitAll(dir);
    const r = runScan(dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration binary files are skipped', async () => {
  const dir = await makeRepo();
  try {
    // A binary blob that happens to contain a secret-like byte sequence.
    const buf = Buffer.concat([Buffer.from([0, 1, 2, 3, 0]), Buffer.from(`AKIA${'1234567890ABCDEF'}`)]);
    await writeFile(path.join(dir, 'blob.bin'), buf);
    await writeFile(path.join(dir, 'app.js'), 'export const ok = 1;\n');
    await commitAll(dir);
    const r = runScan(dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /binary skipped/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration --staged scans ONLY the staged version, not the working tree', async () => {
  const dir = await makeRepo();
  try {
    // Working tree has a secret, but it is NOT staged → --staged must be clean.
    await writeFile(path.join(dir, 'seed.js'), 'export const ok = 1;\n');
    await commitAll(dir);
    await writeFile(path.join(dir, 'leak.js'), `const k = "${awsKeyId()}";\n`);
    const unstaged = runScan(dir, ['--staged']);
    assert.equal(unstaged.status, 0, 'unstaged secret must not trip --staged');

    // Now stage it → --staged gates.
    git(dir, ['add', 'leak.js']);
    const staged = runScan(dir, ['--staged']);
    assert.equal(staged.status, 1, staged.stdout + staged.stderr);
    assert.match(staged.stdout, /aws-access-key-id/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration --since scans files changed since a ref', async () => {
  const dir = await makeRepo();
  try {
    await writeFile(path.join(dir, 'base.js'), 'export const ok = 1;\n');
    await commitAll(dir, 'base');
    const baseSha = git(dir, ['rev-parse', 'HEAD']).trim();
    await writeFile(path.join(dir, 'new.js'), `const k = "${awsKeyId()}";\n`);
    await commitAll(dir, 'add leak');
    const r = runScan(dir, ['--since', baseSha]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /new\.js/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration a generic high-entropy assignment is advisory (medium) — does NOT gate', async () => {
  const dir = await makeRepo();
  try {
    await writeFile(path.join(dir, 'config.js'), `const apiKey = "${highEntropyVal()}";\n`);
    await commitAll(dir);
    const r = runScan(dir);
    assert.equal(r.status, 0, 'medium-only finding must not gate: ' + r.stdout);
    assert.match(r.stdout, /advisory/);
    assert.match(r.stdout, /generic-high-entropy/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration READ-ONLY: a scan changes no tracked file', async () => {
  const dir = await makeRepo();
  try {
    await writeFile(path.join(dir, 'config.js'), `const key = "${awsKeyId()}";\n`);
    await commitAll(dir);
    runScan(dir); // gate trips, but it must write nothing
    const status = git(dir, ['status', '--porcelain']);
    assert.equal(status.trim(), '', `secret-scan must be read-only; git status: ${status}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration --staged and --since together is a usage error (exit 2)', async () => {
  const dir = await makeRepo();
  try {
    await writeFile(path.join(dir, 'app.js'), 'export const ok = 1;\n');
    await commitAll(dir);
    const r = runScan(dir, ['--staged', '--since', 'HEAD']);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /mutually exclusive/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@integration --help exits 0 and a non-git dir exits 5', async () => {
  const help = runScan(REPO_ROOT, ['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /mmdream secret-scan/);

  const dir = await mkdtemp(path.join(tmpdir(), 'mmd-secretscan-nogit-'));
  try {
    const r = runScan(dir);
    assert.equal(r.status, 5, r.stdout + r.stderr);
    assert.match(r.stderr, /git repo/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
