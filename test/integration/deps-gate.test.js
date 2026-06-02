// test/integration/deps-gate.test.js — AC-3 + AC-4 for `mmdream deps-gate` (SPEC_V09B).
// The network-dependent cases call the exported runDepsGate() in-process with an
// injected FAKE fetcher + a fixed `now` + a captured output stream, in throwaway git
// repos — so they are fully OFFLINE and deterministic. The refusal / argv / dispatch
// cases spawn the real bin/mmd.js child (they hit no network: a refusal/argv error
// happens before any fetch). Tagged @integration.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runDepsGate } from '../../bin/security/deps-gate.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');
const NOW = Date.parse('2026-06-02T00:00:00Z');

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 20000 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

async function makeRepo(prefix = 'mmd-depsgate-') {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  git(dir, ['init']);
  git(dir, ['config', 'user.email', 't@t.t']);
  git(dir, ['config', 'user.name', 't']);
  return dir;
}
async function commitAll(dir, msg = 'c') {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', msg]);
}

/** A capturing output stream for the in-process runs. */
function makeOut() {
  const lines = [];
  return { write: (s) => lines.push(s), text: () => lines.join('') };
}

/** A fake fetchJson keyed by a (url → {status, body}) routing function. */
function fakeFetcher(route) {
  return async (url) => {
    const r = route(url);
    if (r === 'throw') throw new Error('network down (fake)');
    return r;
  };
}

// PyPI-shaped doc helpers (so the python adapter maps them correctly).
function pypiDoc(yearsAgoCreated) {
  const created = new Date(NOW - yearsAgoCreated * 365 * 86400000).toISOString();
  return { status: 200, body: { releases: { '1.0.0': [{ upload_time_iso_8601: created }] } } };
}
function pypiRecent(downloads) {
  return { status: 200, body: { data: { last_month: downloads } } };
}

// ── AC-3: a typosquat gates (exit 1) ──────────────────────────────────────────
test('@integration a python typosquat (reqeusts) → likely-typosquat HIGH, exit 1', async () => {
  const dir = await makeRepo();
  try {
    await writeFile(path.join(dir, 'requirements.txt'), 'reqeusts==9.9.9\n');
    await commitAll(dir);
    const route = (url) => {
      if (url.includes('pypi.org/pypi/reqeusts/')) return pypiDoc(0.01); // ~3 days old
      if (url.includes('pypistats.org') && url.includes('reqeusts')) return pypiRecent(4); // ~0 downloads
      return { status: 404, body: null };
    };
    const out = makeOut();
    const code = await runDepsGate([], { cwd: dir, fetchJson: fakeFetcher(route), now: NOW, out, err: out, timeoutMs: 1000 });
    assert.equal(code, 1, out.text());
    assert.match(out.text(), /likely-typosquat/);
    assert.match(out.text(), /GATE TRIGGERED/);
    assert.match(out.text(), /requests/); // names the popular package it is near
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── AC-3: the healthy real package is clean (exit 0) ──────────────────────────
test('@integration the correct package (requests: old, popular) → clean, exit 0', async () => {
  const dir = await makeRepo();
  try {
    await writeFile(path.join(dir, 'requirements.txt'), 'requests>=2.0\n');
    await commitAll(dir);
    const route = (url) => {
      if (url.includes('pypi.org/pypi/requests/')) return pypiDoc(13); // 13 years old
      if (url.includes('pypistats.org')) return pypiRecent(50_000_000);
      return { status: 404, body: null };
    };
    const out = makeOut();
    const code = await runDepsGate([], { cwd: dir, fetchJson: fakeFetcher(route), now: NOW, out, err: out });
    assert.equal(code, 0, out.text());
    assert.match(out.text(), /no supply-chain risks/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── AC-3: an npm 404 → unresolvable HIGH (exit 1) ─────────────────────────────
test('@integration an npm dependency the registry 404s → unresolvable HIGH, exit 1', async () => {
  const dir = await makeRepo();
  try {
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { 'totally-made-up-xyz': '^1.0.0' } }, null, 2) + '\n');
    await commitAll(dir);
    const out = makeOut();
    const code = await runDepsGate([], {
      cwd: dir, now: NOW, out, err: out,
      fetchJson: fakeFetcher(() => ({ status: 404, body: null })),
    });
    assert.equal(code, 1, out.text());
    assert.match(out.text(), /unresolvable/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── AC-3: --since restricts to ADDED deps only ────────────────────────────────
test('@integration --since gates only on a dependency ADDED since the ref', async () => {
  const dir = await makeRepo();
  try {
    // Base: one healthy dep.
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { lodash: '^4.0.0' } }, null, 2) + '\n');
    await commitAll(dir, 'base');
    const base = git(dir, ['rev-parse', 'HEAD']).trim();
    // Add an unresolvable dep.
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { lodash: '^4.0.0', 'evil-404-pkg': '^1.0.0' } }, null, 2) + '\n');
    await commitAll(dir, 'add evil');

    const route = (url) => {
      if (url.includes('registry.npmjs.org/lodash')) return { status: 200, body: { time: { created: '2012-01-01T00:00:00Z' } } };
      if (url.includes('api.npmjs.org') && url.includes('lodash')) return { status: 200, body: { downloads: 9_000_000 } };
      return { status: 404, body: null }; // evil-404-pkg
    };
    const out = makeOut();
    const code = await runDepsGate(['--since', base], { cwd: dir, fetchJson: fakeFetcher(route), now: NOW, out, err: out });
    assert.equal(code, 1, out.text());
    assert.match(out.text(), /evil-404-pkg/);
    // lodash was NOT added since base → it must not appear in the (added-only) scan.
    assert.ok(!/lodash/.test(out.text()), 'unchanged deps must be excluded by --since');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── AC-3: READ-ONLY — a run changes no tracked file ───────────────────────────
test('@integration READ-ONLY: a deps-gate run writes nothing (clean git status)', async () => {
  const dir = await makeRepo();
  try {
    await writeFile(path.join(dir, 'requirements.txt'), 'reqeusts==9.9.9\n');
    await commitAll(dir);
    const out = makeOut();
    await runDepsGate([], {
      cwd: dir, now: NOW, out, err: out,
      fetchJson: fakeFetcher((url) => (url.includes('pypi.org') ? pypiDoc(0.01) : (url.includes('pypistats') ? pypiRecent(2) : { status: 404, body: null }))),
    });
    const status = git(dir, ['status', '--porcelain']);
    assert.equal(status.trim(), '', `deps-gate must be read-only; git status: ${status}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── AC-3 (§VIII): an unsupported-only stack is REFUSED honestly (exit 6) ───────
test('@integration a Cargo.toml-only repo is refused honestly (exit 6, names Rust, no numbers)', async () => {
  const dir = await makeRepo();
  try {
    await writeFile(path.join(dir, 'Cargo.toml'), '[package]\nname = "demo"\n');
    await commitAll(dir);
    // Spawn the real bin — refusal happens before any fetch, so no network.
    const r = spawnSync('node', [MMD, 'deps-gate'], {
      cwd: dir, encoding: 'utf8', timeout: 60000,
      env: { ...process.env, MMD_SKIP_SETUP: '1', MMD_SKIP_GROUNDING: '1' },
    });
    assert.equal(r.status, 6, r.stdout + r.stderr);
    assert.match(r.stderr, /Rust/);
    assert.match(r.stderr, /No report written/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── AC-3: argv + git-failure exit codes (no network) ──────────────────────────
test('@integration --help exits 0; --since with no value exits 2; non-git dir exits 5', async () => {
  const help = spawnSync('node', [MMD, 'deps-gate', '--help'], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 30000, env: { ...process.env, MMD_SKIP_SETUP: '1' } });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /mmdream deps-gate/);

  const badArg = spawnSync('node', [MMD, 'deps-gate', '--since'], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 30000, env: { ...process.env, MMD_SKIP_SETUP: '1' } });
  assert.equal(badArg.status, 2, badArg.stdout + badArg.stderr);
  assert.match(badArg.stderr, /--since requires/);

  const dir = await mkdtemp(path.join(tmpdir(), 'mmd-depsgate-nogit-'));
  try {
    const out = makeOut();
    const code = await runDepsGate([], { cwd: dir, out, err: out, fetchJson: fakeFetcher(() => ({ status: 404, body: null })) });
    assert.equal(code, 5, out.text());
    assert.match(out.text(), /git repo/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── AC-4: a single squat signal stays ADVISORY (medium), does NOT gate ────────
test('@integration a name-similar but old, popular dep is advisory only (exit 0)', async () => {
  const dir = await makeRepo();
  try {
    // "lodahs" is near "lodash" but we make it OLD + well-adopted → near-popular
    // signal ALONE → medium advisory, not the gating conjunction.
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { lodahs: '^1.0.0' } }, null, 2) + '\n');
    await commitAll(dir);
    const route = (url) => {
      if (url.includes('registry.npmjs.org/lodahs')) return { status: 200, body: { time: { created: '2014-01-01T00:00:00Z' } } };
      if (url.includes('api.npmjs.org') && url.includes('lodahs')) return { status: 200, body: { downloads: 5_000_000 } };
      return { status: 404, body: null };
    };
    const out = makeOut();
    const code = await runDepsGate([], { cwd: dir, fetchJson: fakeFetcher(route), now: NOW, out, err: out });
    assert.equal(code, 0, 'a single squat signal must not gate: ' + out.text());
    assert.match(out.text(), /advisory/);
    assert.match(out.text(), /near-popular-name/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── AC-4: the network fails → every dep UNVERIFIED advisory, exit 0 ───────────
test('@integration a failing fetcher → every dep unverified MEDIUM, exit 0 (honest, not a fabricated pass)', async () => {
  const dir = await makeRepo();
  try {
    await writeFile(path.join(dir, 'requirements.txt'), 'requests>=2.0\nflask>=2.0\n');
    await commitAll(dir);
    const out = makeOut();
    const code = await runDepsGate([], {
      cwd: dir, now: NOW, out, err: out, timeoutMs: 500,
      fetchJson: fakeFetcher(() => 'throw'), // every fetch rejects
    });
    assert.equal(code, 0, 'a network failure must NOT gate (no fabricated fail): ' + out.text());
    assert.match(out.text(), /unverified/);
    assert.match(out.text(), /NOT a fabricated pass|not a fabricated pass|Advisory, not a pass/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── AC-4: a repo with NO supported manifest → nothing to gate (exit 0) ────────
test('@integration a repo with no dependency manifest → nothing to gate (exit 0)', async () => {
  const dir = await makeRepo();
  try {
    await writeFile(path.join(dir, 'README.md'), '# just docs\n');
    await commitAll(dir);
    const out = makeOut();
    const code = await runDepsGate([], { cwd: dir, out, err: out, fetchJson: fakeFetcher(() => ({ status: 404, body: null })) });
    assert.equal(code, 0, out.text());
    assert.match(out.text(), /nothing to gate/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
