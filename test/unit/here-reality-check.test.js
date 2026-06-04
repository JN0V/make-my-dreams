// @unit tests for the v0.17.a DETERMINISTIC face on --here (SPEC_V017A AC-3):
// hereRealityCheck + detectTestCommand in lib/reality-check.js. The exec seam is
// injected so no real `npm test` / `cargo test` runs; the run.json descriptor is
// passed directly. Asserts: tests-pass → PASS; tests-red → FAIL; no-test +
// no-runnable-kind → honest SKIPPED; cli runs+exit-0 → PASS; cli exit≠0 → FAIL;
// service-kind → SKIPPED. NEVER fabricates a pass; never throws.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { hereRealityCheck, detectTestCommand } from '../../lib/reality-check.js';

function makeRepo(files = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-here-rc-'));
  for (const [rel, content] of Object.entries(files)) {
    writeFileSync(path.join(dir, rel), content, 'utf8');
  }
  return dir;
}
const withRepo = async (files, fn) => {
  const dir = makeRepo(files);
  try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};
const passExec = () => ({ status: 0, stdout: 'ok', stderr: '' });
const failExec = () => ({ status: 1, stdout: '', stderr: '3 tests failed' });

// ── detectTestCommand ────────────────────────────────────────────────────────

test('@unit AC-3: detectTestCommand finds npm test from package.json scripts.test', async () => {
  await withRepo({ 'package.json': JSON.stringify({ scripts: { test: 'node --test' } }) }, (dir) => {
    const c = detectTestCommand(dir);
    assert.ok(c);
    assert.equal(c.cmd, 'npm');
    assert.match(c.label, /npm test/);
  });
});

test('@unit AC-3: detectTestCommand ignores the npm placeholder "no test specified"', async () => {
  await withRepo({ 'package.json': JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }) }, (dir) => {
    assert.equal(detectTestCommand(dir), null);
  });
});

test('@unit AC-3: detectTestCommand is technology-agnostic (pytest / cargo / make)', async () => {
  await withRepo({ 'pyproject.toml': '[tool.pytest]\n' }, (dir) => {
    assert.equal(detectTestCommand(dir).cmd, 'pytest');
  });
  await withRepo({ 'Cargo.toml': '[package]\nname="x"\n' }, (dir) => {
    assert.equal(detectTestCommand(dir).cmd, 'cargo');
  });
  await withRepo({ 'Makefile': 'build:\n\tcc x.c\ntest:\n\t./run-tests\n' }, (dir) => {
    assert.equal(detectTestCommand(dir).cmd, 'make');
  });
});

test('@unit AC-3: detectTestCommand returns null when nothing is detectable + never throws', async () => {
  await withRepo({ 'README.md': '# hi' }, (dir) => {
    assert.equal(detectTestCommand(dir), null);
  });
  assert.doesNotThrow(() => detectTestCommand(''));
  assert.equal(detectTestCommand(''), null);
  assert.equal(detectTestCommand(null), null);
});

// ── hereRealityCheck ─────────────────────────────────────────────────────────

test('@unit AC-3: tests pass → PASS (deterministic face)', async () => {
  await withRepo({ 'package.json': JSON.stringify({ scripts: { test: 'node --test' } }) }, async (dir) => {
    const r = await hereRealityCheck({ repoRoot: dir, runDescriptor: null, injectedExec: passExec });
    assert.equal(r.status, 'PASS');
    assert.equal(r.face, 'deterministic');
  });
});

test('@unit AC-3: tests red → FAIL with an honest reason', async () => {
  await withRepo({ 'package.json': JSON.stringify({ scripts: { test: 'node --test' } }) }, async (dir) => {
    const r = await hereRealityCheck({ repoRoot: dir, runDescriptor: null, injectedExec: failExec });
    assert.equal(r.status, 'FAIL');
    assert.equal(r.face, 'deterministic');
    assert.match(r.reason, /tests red/);
  });
});

test('@unit AC-3: no test command AND no runnable kind → honest SKIPPED (never a fabricated pass)', async () => {
  await withRepo({ 'README.md': '# nothing runnable' }, async (dir) => {
    const r = await hereRealityCheck({ repoRoot: dir, runDescriptor: null, injectedExec: passExec });
    assert.equal(r.status, 'SKIPPED');
    assert.match(r.reason, /no detectable test command or runnable entry point/);
  });
});

test('@unit AC-3: cli kind runs the `run` command — exit 0 → PASS', async () => {
  await withRepo({ 'README.md': '# x' }, async (dir) => {
    const calls = [];
    const exec = (cmd, args) => { calls.push([cmd, ...args].join(' ')); return { status: 0 }; };
    const r = await hereRealityCheck({ repoRoot: dir, runDescriptor: { kind: 'cli', run: 'node app.js --help' }, injectedExec: exec });
    assert.equal(r.status, 'PASS');
    assert.ok(calls.some((c) => c.includes('node app.js --help')));
  });
});

test('@unit AC-3: cli kind run command exits non-zero → FAIL', async () => {
  await withRepo({ 'README.md': '# x' }, async (dir) => {
    const r = await hereRealityCheck({ repoRoot: dir, runDescriptor: { kind: 'cli', run: 'node app.js' }, injectedExec: () => ({ status: 2, stderr: 'boom' }) });
    assert.equal(r.status, 'FAIL');
    assert.equal(r.face, 'deterministic');
    assert.match(r.reason, /cli run command exited 2/);
  });
});

test('@unit AC-3: service kind → honest SKIPPED (not a fabricated pass)', async () => {
  await withRepo({ 'README.md': '# x' }, async (dir) => {
    const r = await hereRealityCheck({ repoRoot: dir, runDescriptor: { kind: 'service', run: 'node server.js' }, injectedExec: passExec });
    assert.equal(r.status, 'SKIPPED');
    assert.match(r.reason, /service/);
  });
});

test('@unit AC-3: tests-pass + cli-run-pass → PASS (both sub-checks); a FAIL on either fails', async () => {
  await withRepo({ 'package.json': JSON.stringify({ scripts: { test: 'node --test' } }) }, async (dir) => {
    // tests pass, cli run fails → overall FAIL.
    const exec = (cmd) => (cmd === 'npm' ? { status: 0 } : { status: 1, stderr: 'cli broke' });
    const r = await hereRealityCheck({ repoRoot: dir, runDescriptor: { kind: 'cli', run: 'node app.js' }, injectedExec: exec });
    assert.equal(r.status, 'FAIL');
    assert.match(r.reason, /cli run command exited/);
  });
});

test('@unit AC-3: hereRealityCheck never throws on odd input', async () => {
  await assert.doesNotReject(() => hereRealityCheck());
  await assert.doesNotReject(() => hereRealityCheck({}));
  const r = await hereRealityCheck({});
  assert.equal(r.status, 'SKIPPED');
});
