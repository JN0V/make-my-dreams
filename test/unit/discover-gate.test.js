// @unit tests for lib/discover/gate.js — decision logic + helpers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import {
  parseReportStatus,
  looksLikeBrownfield,
  isMmdItself,
  checkGate,
} from '../../lib/discover/gate.js';

async function tmp() {
  return await mkdtemp(path.join(os.tmpdir(), 'mmd-gate-'));
}

test('@unit parseReportStatus: VALIDATED → "validated"', () => {
  assert.equal(parseReportStatus('> Status: VALIDATED at 2026-01-01'), 'validated');
  assert.equal(parseReportStatus('Status: VALIDATED'), 'validated');
});

test('@unit parseReportStatus: PENDING VALIDATION → "pending"', () => {
  assert.equal(parseReportStatus('> Status: PENDING VALIDATION'), 'pending');
});

test('@unit parseReportStatus: missing/garbage → "unknown"', () => {
  assert.equal(parseReportStatus(''), 'unknown');
  assert.equal(parseReportStatus('# report\nbody'), 'unknown');
  assert.equal(parseReportStatus(null), 'unknown');
});

test('@unit looksLikeBrownfield: package.json present → true', async () => {
  const t = await tmp();
  try {
    await writeFile(path.join(t, 'package.json'), '{}', 'utf8');
    assert.equal(await looksLikeBrownfield(t), true);
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit looksLikeBrownfield: empty dir → false', async () => {
  const t = await tmp();
  try {
    assert.equal(await looksLikeBrownfield(t), false);
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit looksLikeBrownfield: src/ with files but no manifest → true (fallback)', async () => {
  const t = await tmp();
  try {
    await mkdir(path.join(t, 'src'), { recursive: true });
    await writeFile(path.join(t, 'src', 'index.js'), '', 'utf8');
    assert.equal(await looksLikeBrownfield(t), true);
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit isMmdItself: MAKE_MY_DREAMS.md present → true', async () => {
  const t = await tmp();
  try {
    await writeFile(path.join(t, 'MAKE_MY_DREAMS.md'), '# MMD', 'utf8');
    assert.equal(await isMmdItself(t), true);
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit isMmdItself: absent → false', async () => {
  const t = await tmp();
  try {
    assert.equal(await isMmdItself(t), false);
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit checkGate: empty dir → ok blank', async () => {
  const t = await tmp();
  try {
    const r = await checkGate(t);
    assert.equal(r.ok, true);
    assert.equal(r.reason, 'blank');
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit checkGate: MMD self (MAKE_MY_DREAMS.md present, no report) → ok mmd-self', async () => {
  const t = await tmp();
  try {
    await writeFile(path.join(t, 'MAKE_MY_DREAMS.md'), '# MMD', 'utf8');
    const r = await checkGate(t);
    assert.equal(r.ok, true);
    assert.equal(r.reason, 'mmd-self');
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit checkGate: brownfield (package.json) without report → blocking, reason "missing"', async () => {
  const t = await tmp();
  try {
    await writeFile(path.join(t, 'package.json'), '{}', 'utf8');
    const r = await checkGate(t);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'missing');
    assert.match(r.message, /no discovery report/);
    assert.match(r.message, /--skip-onboarding/);
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit checkGate: report PENDING → blocking, reason "pending"', async () => {
  const t = await tmp();
  try {
    await writeFile(path.join(t, 'package.json'), '{}', 'utf8');
    await writeFile(path.join(t, 'mmd-discovery-report.md'),
      '# r\n> Status: PENDING VALIDATION\n', 'utf8');
    const r = await checkGate(t);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'pending');
    assert.match(r.message, /pending discovery report/);
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit checkGate: report VALIDATED → ok validated (even on MMD self)', async () => {
  const t = await tmp();
  try {
    await writeFile(path.join(t, 'MAKE_MY_DREAMS.md'), '# MMD', 'utf8');
    await writeFile(path.join(t, 'mmd-discovery-report.md'),
      '# r\n> Status: VALIDATED at 2026-01-01\n', 'utf8');
    const r = await checkGate(t);
    assert.equal(r.ok, true);
    assert.equal(r.reason, 'validated');
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});
