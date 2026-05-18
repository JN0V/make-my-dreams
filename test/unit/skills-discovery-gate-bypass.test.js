// @unit tests for SPEC_V02G AC-5 — read-only/advisory commands bypass
// the discovery gate. The contract is implemented as a module-level
// `skipDiscoveryGate: true` exported from each validate-input.js. bin/mmd.js
// achieves structural bypass by dispatching qa/cso/document-release BEFORE
// checkGate() runs — these tests confirm both the export AND the dispatch
// ordering.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { skipDiscoveryGate as qaSkip } from '../../lib/skills/qa/validate-input.js';
import { skipDiscoveryGate as csoSkip } from '../../lib/skills/cso/validate-input.js';
import { skipDiscoveryGate as drSkip } from '../../lib/skills/document-release/validate-input.js';

import { buildSubprocessEnv } from '../../lib/invoke-autodev.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');

test('@unit AC-5 — qa exports skipDiscoveryGate=true', () => {
  assert.equal(qaSkip, true);
});

test('@unit AC-5 — cso exports skipDiscoveryGate=true', () => {
  assert.equal(csoSkip, true);
});

test('@unit AC-5 — document-release exports skipDiscoveryGate=true', () => {
  assert.equal(drSkip, true);
});

// Structural dispatch test: even when a PENDING discovery report would
// normally block a `--here` invocation, qa/cso/document-release dispatch
// PRE-gate so they execute their own validators (which then map to their
// own exit codes — 0/2/3/4, never gate-5).

function makeBrownfieldWithPendingReport() {
  // A "brownfield with pending report" is what triggers checkGate(). We
  // simulate it via a directory containing package.json (brownfield marker)
  // and `.mmd/discover/last.md` with `Status: PENDING`. The discover/gate
  // module recognizes this exact shape.
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-gate-bypass-'));
  writeFileSync(path.join(dir, 'package.json'), '{"name": "fake"}');
  mkdirSync(path.join(dir, '.mmd', 'discover'), { recursive: true });
  writeFileSync(
    path.join(dir, '.mmd', 'discover', 'last.md'),
    `# Project Onboarder report

Status: PENDING

This is a fake pending report so checkGate() refuses non-bypassing commands.
`,
  );
  // Make it a git repo too (qa/cso/document-release all require one).
  const git = (args) => spawnSync(
    'git',
    ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args],
    { cwd: dir, encoding: 'utf8' },
  );
  git(['init', '-q', '-b', 'main']);
  git(['add', '-A']);
  git(['commit', '-m', 'init', '-q']);
  return dir;
}

function runMmd(args, opts = {}) {
  const baseEnv = buildSubprocessEnv(process.env);
  const env = {
    ...baseEnv,
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
    ...(opts.env || {}),
  };
  return spawnSync('node', [MMD, ...args], {
    cwd: opts.cwd,
    env,
    encoding: 'utf8',
    timeout: 15000,
  });
}

test('@unit @integration AC-5 — mmd qa --dry-run runs even when a PENDING discovery report exists', () => {
  const dir = makeBrownfieldWithPendingReport();
  try {
    const r = runMmd(['qa', '--dry-run'], { cwd: dir });
    // We expect exit 0 (qa --dry-run on a valid branch). The gate (which
    // would map to exit 5) MUST NOT have fired.
    assert.equal(r.status, 0, `expected exit 0 (gate bypassed); got ${r.status}. stderr=${r.stderr}\nstdout=${r.stdout}`);
    assert.notEqual(r.status, 5, 'AC-5 violated: discovery gate triggered for qa');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@unit @integration AC-5 — mmd cso --dry-run runs even when a PENDING discovery report exists', () => {
  const dir = makeBrownfieldWithPendingReport();
  try {
    const r = runMmd(['cso', '--dry-run'], { cwd: dir });
    assert.equal(r.status, 0, `expected exit 0 (gate bypassed); got ${r.status}. stderr=${r.stderr}\nstdout=${r.stdout}`);
    assert.notEqual(r.status, 5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@unit @integration AC-5 — mmd document-release --dry-run runs even when a PENDING discovery report exists', () => {
  const dir = makeBrownfieldWithPendingReport();
  try {
    // The repo has no tags yet, so we must pass an explicit <from> to avoid
    // the legitimate exit-4 ("no tags found").
    const r = runMmd(['document-release', '--dry-run', 'HEAD', 'HEAD'], { cwd: dir });
    assert.equal(r.status, 0, `expected exit 0 (gate bypassed); got ${r.status}. stderr=${r.stderr}\nstdout=${r.stdout}`);
    assert.notEqual(r.status, 5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
