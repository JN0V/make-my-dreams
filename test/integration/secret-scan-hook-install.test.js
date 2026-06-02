// test/integration/secret-scan-hook-install.test.js — @integration coverage for
// the OPT-IN secret-scan pre-commit hook materialization in install-mmd.sh
// (SPEC_V091 AC-4). We extract the sentinel-bounded block and run it in isolation
// against a temp TARGET (the same strategy as install-mmd.test.js's Phase 0/6),
// so we never invoke the heavyweight full installer.
//
// The headline contracts: (1) the sample is ALWAYS materialized (non-active),
// (2) it is byte-idempotent across runs, (3) the active .git/hooks/pre-commit is
// NOT created by default (opt-in), (4) MMD_INSTALL_SECRET_HOOK=1 installs it, and
// (5) an existing pre-commit hook is NEVER clobbered.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const INSTALLER = path.join(REPO_ROOT, 'install-mmd.sh');

const BEGIN = '# >>> MMD_SECRET_SCAN_HOOK_MATERIALIZE_BEGIN';
const END = '# >>> MMD_SECRET_SCAN_HOOK_MATERIALIZE_END';

/** Extract the sentinel-bounded hook block into a runnable temp script. */
function extractHookBlock() {
  const src = readFileSync(INSTALLER, 'utf8');
  const startIdx = src.indexOf(BEGIN);
  const endIdx = src.indexOf(END);
  assert.ok(startIdx >= 0 && endIdx >= 0, 'secret-scan hook sentinels must be present in install-mmd.sh');
  const block = src.slice(startIdx, endIdx + END.length);
  const script = `#!/usr/bin/env bash
set -euo pipefail
ok()   { printf "OK %s\\n" "$1"; }
warn() { printf "WARN %s\\n" "$1"; }
info() { printf "INFO %s\\n" "$1"; }
TARGET="$1"
${block}
exit 0
`;
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-hookblock-'));
  const scriptPath = path.join(dir, 'block.sh');
  writeFileSync(scriptPath, script);
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function runBlock(target, env = {}) {
  const script = extractHookBlock();
  return spawnSync('bash', [script, target], {
    encoding: 'utf8',
    timeout: 20000,
    env: { ...process.env, ...env },
  });
}

test('@integration the sample hook is materialized (non-active) by default', () => {
  const target = mkdtempSync(path.join(tmpdir(), 'mmd-hooktarget-'));
  try {
    mkdirSync(path.join(target, '.git', 'hooks'), { recursive: true });
    const r = runBlock(target);
    assert.equal(r.status, 0, r.stdout + r.stderr);

    const sample = path.join(target, '.mmd', 'hooks', 'pre-commit');
    assert.ok(existsSync(sample), 'sample hook must be materialized');
    const body = readFileSync(sample, 'utf8');
    assert.match(body, /mmd secret-scan --staged/);

    // Opt-in: the ACTIVE hook must NOT exist by default.
    assert.ok(!existsSync(path.join(target, '.git', 'hooks', 'pre-commit')), 'active hook must not be installed by default');
    assert.match(r.stdout, /OPT-IN and NOT enabled/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('@integration materialization is byte-idempotent across runs', () => {
  const target = mkdtempSync(path.join(tmpdir(), 'mmd-hooktarget-'));
  try {
    runBlock(target);
    const sample = path.join(target, '.mmd', 'hooks', 'pre-commit');
    const first = readFileSync(sample, 'utf8');
    runBlock(target);
    const second = readFileSync(sample, 'utf8');
    assert.equal(first, second, 're-run must produce a byte-identical sample');
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('@integration MMD_INSTALL_SECRET_HOOK=1 installs the active hook into .git/hooks', () => {
  const target = mkdtempSync(path.join(tmpdir(), 'mmd-hooktarget-'));
  try {
    mkdirSync(path.join(target, '.git', 'hooks'), { recursive: true });
    const r = runBlock(target, { MMD_INSTALL_SECRET_HOOK: '1' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const active = path.join(target, '.git', 'hooks', 'pre-commit');
    assert.ok(existsSync(active), 'active hook must be installed when opted in');
    assert.match(readFileSync(active, 'utf8'), /mmd secret-scan --staged/);
    assert.match(r.stdout, /ACTIVE/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('@integration an existing pre-commit hook is never clobbered', () => {
  const target = mkdtempSync(path.join(tmpdir(), 'mmd-hooktarget-'));
  try {
    const hooksDir = path.join(target, '.git', 'hooks');
    mkdirSync(hooksDir, { recursive: true });
    const existing = path.join(hooksDir, 'pre-commit');
    writeFileSync(existing, '#!/bin/sh\necho my own hook\n');
    const r = runBlock(target, { MMD_INSTALL_SECRET_HOOK: '1' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    // The user's hook must be untouched.
    assert.match(readFileSync(existing, 'utf8'), /my own hook/);
    assert.match(r.stdout, /NOT overwriting/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
