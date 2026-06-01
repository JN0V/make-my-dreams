// @integration tests for v0.4.a `mmd --sealed` — the sealed-test oracle end to
// end (SPEC_V04A AC-3, AC-4). Drives the real `mmd` CLI binary with a FAKE
// claude (MMD_AUTODEV_CMD) that branches tester-vs-coder on the prompt marker
// and simulates a "good" coder, a "tampering" coder, and an empty-seal tester.
//
// CRITICAL (recursion guard, per test/integration/mmd.test.js): every test sets
// MMD_AUTODEV_CMD to the fixture so the real claude is NEVER invoked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import path from 'node:path';

import { buildSubprocessEnv } from '../../lib/invoke-autodev.js';
import { slugify } from '../../lib/parse-dream.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');
const FIXTURE = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-claude-sealed.sh');

const SKIP_ON_WINDOWS = platform() === 'win32';

// L-007: never hardcode the slugifier's output — ask slugify for it.
const DREAM = 'a counter app with plus and minus buttons';
const SLUG = slugify(DREAM);

function makeTmp() {
  return mkdtempSync(path.join(tmpdir(), 'mmd-sealed-'));
}

function runMmd(args, opts = {}) {
  const env = {
    ...buildSubprocessEnv(process.env),
    MMD_AUTODEV_CMD: FIXTURE,
    MMD_REALITY_CHECK_BACKEND: 'skip',
    // No TTY in spawnSync → Dream Catcher dialogue is skipped automatically.
    ...(opts.env || {}),
  };
  return spawnSync('node', [MMD, ...args], {
    cwd: opts.cwd,
    env,
    encoding: 'utf8',
    timeout: 60000,
  });
}

function readStatus(cwd) {
  const p = path.join(cwd, 'demo', SLUG, '.mmd', 'shared', 'status.json');
  return JSON.parse(readFileSync(p, 'utf8'));
}

// AC-3 + AC-4 — happy path: tester → seal → good coder → verify intact → re-run pass.
test('@integration v0.4.a AC-4: --sealed good coder → seal intact, sealed tests pass, blast radius logged', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    const r = runMmd(['--sealed', DREAM], { cwd: tmp });
    assert.equal(r.status, 0, `expected exit 0; got ${r.status}; stderr=${r.stderr}`);

    // The flow ran through all phases.
    assert.match(r.stdout, /TESTER: deriving acceptance tests/);
    assert.match(r.stdout, /SEAL: 1 test file\(s\) hashed/);
    assert.match(r.stdout, /VERIFY: seal intact/);
    assert.match(r.stdout, /sealed tests PASS/);

    // The coder produced the app, and the sealed test survived untouched.
    const demoDir = path.join(tmp, 'demo', SLUG);
    assert.ok(existsSync(path.join(demoDir, 'index.html')), 'coder should write index.html');
    assert.ok(
      existsSync(path.join(demoDir, '.mmd', 'shared', 'sealed-tests', 'acceptance.test.js')),
      'sealed test must still exist',
    );

    // status.json: done + blast_radius present.
    const status = readStatus(tmp);
    assert.equal(status.state, 'done');
    assert.ok(status.blast_radius, 'status.json must carry blast_radius');
    assert.ok(Array.isArray(status.blast_radius.changed));
    assert.ok(Array.isArray(status.blast_radius.importers));
    assert.ok(Array.isArray(status.blast_radius.transitive), 'v0.4.c: blast_radius carries the transitive closure');
    assert.ok(status.blast_radius.changed.includes('index.html'), 'changed should include the app file');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// AC-4 — the whole point: a coder that rewrites the sealed oracle is caught.
test('@integration v0.4.a AC-4: --sealed tampering coder → non-zero exit naming the tampered file', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    const r = runMmd(['--sealed', DREAM], { cwd: tmp, env: { MMD_FAKE_SEALED_TAMPER: '1' } });
    assert.notEqual(r.status, 0, `expected non-zero exit; stderr=${r.stderr}`);
    assert.equal(r.status, 6, `expected exit 6 (sealed-pipeline failure); got ${r.status}`);

    // The tampered file is NAMED in the error (anti-P-04 — loud, specific).
    assert.match(r.stderr, /SEAL BROKEN/);
    assert.match(r.stderr, /tampered:\s+acceptance\.test\.js/);
    assert.match(r.stderr, /NOT done/);

    // The slice is NOT marked done.
    const status = readStatus(tmp);
    assert.equal(status.state, 'failed');
    assert.match(status.reason, /SEAL BROKEN/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// AC-3 — honest reporting: a tester that writes nothing aborts (no silent pass).
test('@integration v0.4.a AC-3: --sealed empty seal (tester wrote nothing) → explicit abort, no silent pass', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    const r = runMmd(['--sealed', DREAM], { cwd: tmp, env: { MMD_FAKE_SEALED_TESTER_EMPTY: '1' } });
    assert.equal(r.status, 6, `expected exit 6; got ${r.status}; stderr=${r.stderr}`);
    assert.match(r.stderr, /empty seal/i);
    assert.match(r.stderr, /wrote no test files/i);

    // The coder must NOT have run (we aborted at the seal step) — no index.html.
    const demoDir = path.join(tmp, 'demo', SLUG);
    assert.ok(!existsSync(path.join(demoDir, 'index.html')), 'coder must not run after an empty seal');

    const status = readStatus(tmp);
    assert.equal(status.state, 'failed');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// The default (no --sealed) greenfield path is unchanged: no sealed-tests dir,
// no blast_radius, no sealed step output (byte-for-byte behaviour preserved).
test('@integration v0.4.a AC-4: default path (no --sealed) is unchanged — no sealed artifacts', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    // Reuse the same fixture; without the SEALED ORACLE marker it takes the
    // coder branch and just writes index.html (the plain greenfield contract).
    const r = runMmd([DREAM], { cwd: tmp });
    assert.equal(r.status, 0, `expected exit 0; got ${r.status}; stderr=${r.stderr}`);
    assert.doesNotMatch(r.stdout, /Sealed step/);

    const demoDir = path.join(tmp, 'demo', SLUG);
    assert.ok(!existsSync(path.join(demoDir, '.mmd', 'shared', 'sealed-tests')), 'no sealed-tests dir on the default path');

    const status = readStatus(tmp);
    assert.equal(status.state, 'done');
    assert.equal(status.blast_radius, undefined, 'no blast_radius on the default path');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
