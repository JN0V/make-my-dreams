// @integration test for install-mmd.sh final summary banner — SPEC_V02M AC-4.
//
// The banner is the last thing the installer prints: a single block listing all
// 5 pillars (plus bun) with a ✓ / ⚠ / ✗ marker and a short reason each. It reads
// the per-pillar status variables set by the earlier phases via ${VAR:-default}
// so it can be exercised in isolation here: we extract the banner block, preset
// the status variables through the environment, and assert the rendered output.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const INSTALLER = path.join(REPO_ROOT, 'install-mmd.sh');

/** Extract the final summary banner block into a runnable temp script. */
function extractBanner() {
  const src = readFileSync(INSTALLER, 'utf8');
  const startIdx = src.indexOf('# FINAL SUMMARY BANNER:');
  // The banner ends right before the legacy success box separator+"# Summary".
  const endIdx = src.indexOf('# Summary', startIdx);
  if (startIdx < 0 || endIdx < 0) {
    throw new Error('install-mmd.sh: summary banner markers not found');
  }
  // Walk back to the start of the separator line that precedes "# Summary".
  const sepIdx = src.lastIndexOf('# ===', endIdx);
  const block = src.slice(startIdx, sepIdx);
  // The banner uses the color vars; the harness neutralizes them so the markers
  // (✓/⚠/✗) render as bare glyphs the assertions can match.
  const helpers = `#!/usr/bin/env bash
set -uo pipefail
RED=''; GREEN=''; YELLOW=''; NC=''
${block}
exit 0
`;
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-installer-banner-'));
  const scriptPath = path.join(dir, 'banner.sh');
  writeFileSync(scriptPath, helpers);
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

test('@integration install-mmd summary banner: renders all 5 pillars + bun with markers', () => {
  const banner = extractBanner();
  try {
    // A realistic mixed install: most present, OpenSpec declined, Ralph skipped.
    const r = spawnSync('bash', [banner], {
      encoding: 'utf8',
      timeout: 15000,
      env: {
        PATH: '/usr/bin:/bin',
        BUN_OK: 'true',
        BUN_VER: '1.3.0',
        GSTACK_STATUS: 'PRESENT_FUNCTIONAL',
        BMAD_STATUS: 'PRESENT_FUNCTIONAL',
        SPEC_KIT_STATUS: 'PRESENT_FUNCTIONAL',
        SPEC_KIT_VER: 'specify 1.0.0',
        OPENSPEC_STATUS: 'NOT_INSTALLED',
        RALPH_STATUS: 'SKIPPED_OLD_CLAUDE',
      },
    });
    assert.equal(r.status, 0, `expected exit 0; stdout=${r.stdout}\nstderr=${r.stderr}`);
    const out = r.stdout;
    assert.match(out, /Install summary/);
    // Every pillar label present.
    for (const label of ['bun', 'gStack', 'BMAD', 'Spec Kit', 'OpenSpec', 'Ralph Loop']) {
      assert.ok(out.includes(label), `banner missing pillar label: ${label}\n${out}`);
    }
    // Marker glyphs: ✓ for the present ones, ⚠ for declined/skipped.
    assert.match(out, /bun\s+✓/);
    assert.match(out, /Spec Kit\s+✓/);
    assert.match(out, /OpenSpec\s+⚠/);
    assert.match(out, /Ralph Loop\s+⚠/);
  } finally {
    rmSync(path.dirname(banner), { recursive: true, force: true });
  }
});

test('@integration install-mmd summary banner: broken pillar renders ✗', () => {
  const banner = extractBanner();
  try {
    const r = spawnSync('bash', [banner], {
      encoding: 'utf8',
      timeout: 15000,
      env: {
        PATH: '/usr/bin:/bin',
        BUN_OK: 'true',
        BUN_VER: '1.3.0',
        GSTACK_STATUS: 'PRESENT_BROKEN',
        BMAD_STATUS: 'PRESENT_FUNCTIONAL',
        SPEC_KIT_STATUS: 'PRESENT_BROKEN',
        OPENSPEC_STATUS: 'PRESENT_FUNCTIONAL',
        OPENSPEC_VER: 'openspec 0.9.0',
        RALPH_STATUS: 'PRESENT_FUNCTIONAL',
      },
    });
    assert.equal(r.status, 0, `expected exit 0; stdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stdout, /gStack\s+✗/);
    assert.match(r.stdout, /Spec Kit\s+✗/);
  } finally {
    rmSync(path.dirname(banner), { recursive: true, force: true });
  }
});

test('@integration install-mmd summary banner: defaults to NOT_INSTALLED when vars unset', () => {
  const banner = extractBanner();
  try {
    // No pillar vars exported at all — the ${VAR:-default} fallbacks engage.
    const r = spawnSync('bash', [banner], {
      encoding: 'utf8',
      timeout: 15000,
      env: { PATH: '/usr/bin:/bin' },
    });
    assert.equal(r.status, 0, `expected exit 0; stdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stdout, /Install summary/);
    assert.match(r.stdout, /Spec Kit\s+⚠/);
  } finally {
    rmSync(path.dirname(banner), { recursive: true, force: true });
  }
});
