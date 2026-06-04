// @integration / @unit tests for Reality Check honest degradation (SPEC_V010A AC-4).
//
// With the generation prompt now technology-agnostic, a finished build may NOT
// be a web app. Before opening file://…/index.html, realityCheck consults the
// run descriptor / isWebPreviewable:
//   - non-web build (run.json {kind:'cli'}, no index.html) → SKIPPED, honest
//     reason naming the kind + run instruction; NEVER a FAIL on a missing
//     index.html.
//   - web-previewable build (descriptor web-static + real entry, OR bare
//     index.html back-compat) → today's open+screenshot path (unchanged).
//   - --here short-circuit → unchanged.
//
// The gate is forced via backend='playwright' so the test is deterministic
// WITHOUT needing chromium installed (the gate runs before the playwright import).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { realityCheck, nonWebPreviewReason } from '../../lib/reality-check.js';

function makeDemo({ descriptor, files } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-rc-honest-'));
  if (descriptor !== undefined) {
    mkdirSync(path.join(dir, '.mmd', 'shared'), { recursive: true });
    writeFileSync(
      path.join(dir, '.mmd', 'shared', 'run.json'),
      typeof descriptor === 'string' ? descriptor : JSON.stringify(descriptor),
      'utf8',
    );
  }
  for (const [rel, content] of Object.entries(files || {})) {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf8');
  }
  return dir;
}

const demos = [];
function demo(opts) { const d = makeDemo(opts); demos.push(d); return d; }
test.after(() => { for (const d of demos) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ } } });

// ── nonWebPreviewReason (pure) ───────────────────────────────────────────────

test('@unit AC-4: nonWebPreviewReason names the kind + run instruction', () => {
  const r = nonWebPreviewReason({ kind: 'cli', run: 'node rename.js ./photos' });
  assert.match(r, /built a cli project/);
  assert.match(r, /node rename\.js \.\/photos/);
  assert.doesNotMatch(r, /FAIL/);
});

test('@unit AC-4: nonWebPreviewReason falls back to run.json when run absent', () => {
  const r = nonWebPreviewReason({ kind: 'service' });
  assert.match(r, /built a service project/);
  assert.match(r, /\.mmd\/shared\/run\.json/);
});

test('@unit AC-4: nonWebPreviewReason with no descriptor → honest no-web-app message', () => {
  const r = nonWebPreviewReason(null);
  assert.match(r, /no web app to preview/);
  assert.match(r, /no index\.html/);
});

// ── realityCheck honest degradation (AC-4) ───────────────────────────────────

test('@integration AC-4: a cli build (run.json {kind:cli}, no index.html) → SKIPPED, never FAIL', async () => {
  const dir = demo({ descriptor: { kind: 'cli', run: 'node rename.js <dir>' } });
  const r = await realityCheck({ demoDir: dir, screenshotDir: dir, backend: 'playwright' });
  assert.equal(r.status, 'SKIPPED');
  assert.notEqual(r.status, 'FAIL', 'a non-web build must NEVER FAIL on a missing index.html');
  assert.match(r.reason, /built a cli project/);
  assert.match(r.reason, /node rename\.js/);
});

test('@integration AC-4: a non-web build with NO descriptor and NO index.html → SKIPPED honest, not FAIL', async () => {
  const dir = demo({ files: { 'README.md': '# a library' } });
  const r = await realityCheck({ demoDir: dir, screenshotDir: dir, backend: 'playwright' });
  assert.equal(r.status, 'SKIPPED');
  assert.match(r.reason, /no web app to preview/);
});

test('@integration AC-4: web-static descriptor with a real entry → NOT short-circuited (proceeds to playwright path)', async () => {
  const dir = demo({
    descriptor: { kind: 'web-static', entry: 'index.html' },
    files: { 'index.html': '<!doctype html><h1>ok</h1>' },
  });
  const r = await realityCheck({ demoDir: dir, screenshotDir: dir, backend: 'playwright' });
  // Whether chromium is installed or not, it must NOT be our honest non-web SKIP;
  // it follows the real playwright path (PASS / FAIL / a playwright-specific SKIP).
  assert.ok(['PASS', 'FAIL', 'SKIPPED'].includes(r.status));
  if (r.status === 'SKIPPED') {
    assert.doesNotMatch(r.reason, /browser preview not available for this kind/);
    assert.doesNotMatch(r.reason, /no web app to preview/);
  }
});

test('@integration AC-4: bare index.html back-compat (no descriptor) → proceeds, not honest-skip', async () => {
  const dir = demo({ files: { 'index.html': '<!doctype html><h1>ok</h1>' } });
  const r = await realityCheck({ demoDir: dir, screenshotDir: dir, backend: 'playwright' });
  assert.ok(['PASS', 'FAIL', 'SKIPPED'].includes(r.status));
  if (r.status === 'SKIPPED') {
    assert.doesNotMatch(r.reason, /no web app to preview/);
  }
});

test('@integration v0.17.a AC-3: --here is no longer a blanket SKIP — it runs the deterministic face', async () => {
  // A cli-kind build with no project test command: the deterministic face runs
  // the descriptor's `run` command via the injected exec seam (must exit 0).
  const dir = demo({ descriptor: { kind: 'cli', run: 'node x.js' } });
  const calls = [];
  const injectedExec = (cmd, args) => { calls.push([cmd, ...args].join(' ')); return { status: 0, stdout: '', stderr: '' }; };
  const r = await realityCheck({ demoDir: dir, hereMode: true, injectedExec });
  // It actually ran the cli `run` command (no longer a blanket skip / no npm-test prose).
  assert.equal(r.status, 'PASS');
  assert.equal(r.face, 'deterministic');
  assert.ok(calls.some((c) => c.includes('node x.js')), `expected the cli run command to be executed; calls=${JSON.stringify(calls)}`);
});
