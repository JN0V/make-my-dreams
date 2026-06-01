// @integration tests for v0.4.b `mmd --here --sealed` — the sealed-test oracle
// applied to MMD's own brownfield-in-place surface (SPEC_V04B AC-3, AC-4). The
// pipeline is the SAME surface-agnostic runSealedPipeline the greenfield path
// uses; only the CODER differs (a --here coder on the slice branch). These tests
// drive the real `mmd` CLI binary with the SAME fake claude the greenfield
// sealed tests use (test/fixtures/fake-claude-sealed.sh): it branches
// tester-vs-coder on the "SEALED ORACLE" marker, so it serves both surfaces.
//
// CRITICAL (recursion guard, per test/integration/mmd.test.js): every test sets
// MMD_AUTODEV_CMD to the fixture so the real claude is NEVER invoked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import path from 'node:path';

import { buildSubprocessEnv } from '../../lib/invoke-autodev.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');
const FIXTURE = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-claude-sealed.sh');

const SKIP_ON_WINDOWS = platform() === 'win32';

function makeTmp() {
  return mkdtempSync(path.join(tmpdir(), 'mmd-sealed-here-'));
}

/** Run `git` synchronously inside cwd, asserting success. */
function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${r.stderr}`);
  return r.stdout;
}

/** Clean git repo at `dir`, one commit, on branch `main`. */
function initCleanRepo(dir) {
  mkdirSync(dir, { recursive: true });
  git(['init', '-q', '-b', 'main'], dir);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init', '-q'], dir);
  return dir;
}

function runMmd(args, opts = {}) {
  const env = {
    ...buildSubprocessEnv(process.env),
    MMD_AUTODEV_CMD: FIXTURE,
    MMD_REALITY_CHECK_BACKEND: 'skip',
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
    ...(opts.env || {}),
  };
  return spawnSync('node', [MMD, ...args], {
    cwd: opts.cwd, env, encoding: 'utf8', timeout: 60000,
  });
}

function readHereStatus(cwd) {
  return JSON.parse(readFileSync(path.join(cwd, '.mmd', 'shared', 'status.json'), 'utf8'));
}

// A dream with NO documented file references (so the prompt-grounding precheck
// passes) and no STOPWORD-only slug surprises.
const DREAM = 'introduce a friendly greeting feature';

// AC-3 + AC-4 — happy path: --here --sealed runs tester→seal→here-coder→verify
// intact→re-run pass→blast, on the slice branch, with status.json preserved.
test('@integration v0.4.b AC-3/AC-4: --here --sealed clean coder → seal intact, sealed tests pass, slice done', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    initCleanRepo(tmp);
    const baseSha = git(['rev-parse', 'HEAD'], tmp).trim();

    const r = runMmd(['--here', '--sealed', DREAM], { cwd: tmp });
    assert.equal(r.status, 0, `expected exit 0; got ${r.status}; stderr=${r.stderr}\nstdout=${r.stdout}`);

    // The --here mode announcement + the full sealed flow both ran.
    assert.match(r.stdout, /Mode: --here \(modifying current repo: /);
    assert.match(r.stdout, /Mode: --sealed \(sealed-test oracle/);
    assert.match(r.stdout, /TESTER: deriving acceptance tests/);
    assert.match(r.stdout, /SEAL: 1 test file\(s\) hashed/);
    assert.match(r.stdout, /VERIFY: seal intact/);
    assert.match(r.stdout, /sealed tests PASS/);
    assert.match(r.stdout, /\[OK\] Sealed changes applied on slice\/here-/);

    // It ran on the slice branch (never main), and the slice still exists.
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], tmp).trim();
    assert.match(branch, /^slice\/here-.*-\d+$/, `expected a slice branch, got ${branch}`);

    // The sealed dir lives in the target repo's gitignored .mmd/shared/.
    assert.ok(
      existsSync(path.join(tmp, '.mmd', 'shared', 'sealed-tests', 'acceptance.test.js')),
      'sealed test must still exist after a clean here-coder',
    );
    // NO demo/<slug>/ in --here mode.
    assert.equal(existsSync(path.join(tmp, 'demo')), false, 'demo/ must NOT exist in --here mode');

    // status.json: --here fields preserved AND the sealed/blast fields added.
    const status = readHereStatus(tmp);
    assert.equal(status.state, 'done');
    assert.equal(status.mode, 'here');
    assert.equal(status.slice_branch, branch);
    assert.equal(status.base_branch, 'main');
    assert.equal(status.base_sha, baseSha);
    assert.ok(status.sealed, 'status.json must carry sealed');
    assert.equal(status.sealed.sealed_files, 1);
    assert.ok(status.blast_radius, 'status.json must carry blast_radius');
    assert.ok(Array.isArray(status.blast_radius.changed));
    assert.ok(Array.isArray(status.blast_radius.importers));
    assert.ok(Array.isArray(status.blast_radius.transitive), 'v0.4.c: blast_radius carries the transitive closure');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// AC-4 — the whole point: a --here coder that rewrites the sealed oracle is
// caught — exit 6 naming the tampered file, slice NOT marked done (anti-P-04).
test('@integration v0.4.b AC-4: --here --sealed tampering coder → exit 6 naming the tampered file, slice not done', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    initCleanRepo(tmp);
    const r = runMmd(['--here', '--sealed', DREAM], { cwd: tmp, env: { MMD_FAKE_SEALED_TAMPER: '1' } });
    assert.equal(r.status, 6, `expected exit 6 (sealed-pipeline failure); got ${r.status}; stderr=${r.stderr}`);

    // The tampered file is NAMED in the error (anti-P-04 — loud, specific).
    assert.match(r.stderr, /SEAL BROKEN/);
    assert.match(r.stderr, /tampered:\s+acceptance\.test\.js/);
    assert.match(r.stderr, /NOT done/);

    // The slice is NOT marked done.
    const status = readHereStatus(tmp);
    assert.equal(status.state, 'failed');
    assert.match(status.reason, /SEAL BROKEN/);
    // --here identity fields are still present on the failed status.
    assert.equal(status.mode, 'here');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// AC-4 honesty — an empty seal (tester wrote nothing) aborts before the coder
// runs, identical contract to greenfield (no silent "sealed OK").
test('@integration v0.4.b AC-4: --here --sealed empty seal (tester wrote nothing) → explicit abort', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    initCleanRepo(tmp);
    const r = runMmd(['--here', '--sealed', DREAM], { cwd: tmp, env: { MMD_FAKE_SEALED_TESTER_EMPTY: '1' } });
    assert.equal(r.status, 6, `expected exit 6; got ${r.status}; stderr=${r.stderr}`);
    assert.match(r.stderr, /empty seal/i);
    assert.match(r.stderr, /wrote no test files/i);

    // The coder must NOT have run (we aborted at the seal step) — no index.html.
    assert.ok(!existsSync(path.join(tmp, 'index.html')), 'coder must not run after an empty seal');

    const status = readHereStatus(tmp);
    assert.equal(status.state, 'failed');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// Regression — plain `mmd --here` (no --sealed) is unchanged: no sealed-tests
// dir, no sealed/blast_radius fields, no sealed step output.
test('@integration v0.4.b: plain --here (no --sealed) is unchanged — no sealed artifacts', { skip: SKIP_ON_WINDOWS }, () => {
  const tmp = makeTmp();
  try {
    initCleanRepo(tmp);
    const r = runMmd(['--here', DREAM], { cwd: tmp });
    assert.equal(r.status, 0, `expected exit 0; got ${r.status}; stderr=${r.stderr}`);
    assert.doesNotMatch(r.stdout, /Sealed step/);
    assert.equal(
      existsSync(path.join(tmp, '.mmd', 'shared', 'sealed-tests')),
      false,
      'no sealed-tests dir on the plain --here path',
    );
    const status = readHereStatus(tmp);
    assert.equal(status.state, 'done');
    assert.equal(status.sealed, undefined, 'no sealed field on the plain --here path');
    assert.equal(status.blast_radius, undefined, 'no blast_radius on the plain --here path');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
