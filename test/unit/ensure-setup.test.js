// @unit tests for ensureSetupForSpawn (lib/onboarding/ensure-setup.js) — the
// shared first-run-setup guard used by the secondary commands that spawn
// claude/BMAD/gStack (bench, unblock, qa, cso, document-release). Runner +
// detect are injected, so no real spawn / fs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureSetupForSpawn } from '../../lib/onboarding/ensure-setup.js';

const ready = () => ({ ready: true, missing: [] });
const notReady = () => ({ ready: false, missing: ['the project constitution (…)'] });

test('@unit faked spawn (fakeCmdVar set) → skip setup entirely, runner never called', async () => {
  let ran = false;
  const r = await ensureSetupForSpawn({
    targetDir: '/x', env: { MMD_QA_CMD: '/fake/claude' }, fakeCmdVar: 'MMD_QA_CMD',
    runnerFn: () => { ran = true; return { code: 0 }; }, detectFn: notReady,
  });
  assert.equal(r.ok, true);
  assert.equal(r.action, 'faked');
  assert.equal(ran, false, 'a faked run must NOT trigger a real install');
});

test('@unit MMD_SKIP_SETUP=1 → bypass, runner never called', async () => {
  let ran = false;
  const r = await ensureSetupForSpawn({
    targetDir: '/x', env: { MMD_SKIP_SETUP: '1' }, fakeCmdVar: 'MMD_QA_CMD',
    runnerFn: () => { ran = true; return { code: 0 }; }, detectFn: notReady,
  });
  assert.equal(r.ok, true);
  assert.equal(ran, false);
});

test('@unit already set up → no-op (runner never called)', async () => {
  let ran = false;
  const r = await ensureSetupForSpawn({
    targetDir: '/x', env: {}, fakeCmdVar: 'MMD_QA_CMD',
    runnerFn: () => { ran = true; return { code: 0 }; }, detectFn: ready,
  });
  assert.equal(r.ok, true);
  assert.equal(r.action, 'ready');
  assert.equal(ran, false);
});

test('@unit NOT set up + real run (no fake, non-TTY) → AUTO-RUNS the installer', async () => {
  let target = null;
  const r = await ensureSetupForSpawn({
    targetDir: '/proj', env: {}, fakeCmdVar: 'MMD_QA_CMD', tty: false,
    runnerFn: (t) => { target = t; return { code: 0 }; }, detectFn: notReady,
  });
  assert.equal(r.ok, true);
  assert.equal(r.action, 'setup-ran');
  assert.equal(target, '/proj', 'the installer runs against the command cwd');
});

test('@unit NOT set up + installer FAILS → honest abort (ok:false, exit 8)', async () => {
  const r = await ensureSetupForSpawn({
    targetDir: '/proj', env: {}, fakeCmdVar: 'MMD_QA_CMD',
    runnerFn: () => ({ code: 1 }), detectFn: notReady,
  });
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 8);
});
