// lib/onboarding/run-install.js — the shared install-mmd.sh runner used by the
// first-run setup guard from EVERY entry point (--here, greenfield, serve).
//
// SRP (universal §I.S): owns only "spawn install-mmd.sh against <targetDir> and
// report its exit code". The DECISION (detect → confirm/auto → run) lives in
// setup.js; the WIRING lives in the bins. Extracted so `mmdream serve` (a
// different process entry than bin/mmd.js) can auto-set-up a fresh directory
// WITHOUT duplicating the spawn or risking a bin↔bin import cycle.
//
// `MMD_SETUP_CMD` overrides the script path — the testing seam (mirrors
// MMD_AUTODEV_CMD): tests point it at a fast fake installer so the guard's
// decision flow is exercised offline, without `npx bmad-method`.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// install-mmd.sh ships beside package.json at MMD's own install root.
export const INSTALL_SCRIPT = fileURLToPath(new URL('../../install-mmd.sh', import.meta.url));

/**
 * Spawn install-mmd.sh against `targetDir` (stdio inherited so the user sees
 * progress). Returns `{ code }` for runFirstRunSetup to branch on; a spawn-throw
 * (e.g. bash missing) propagates so the guard reports it honestly.
 *
 * @param {string} targetDir
 * @param {{ env?: NodeJS.ProcessEnv }} [opts]
 * @returns {{ code: number, signal?: string|null }}
 */
export function runInstallMmd(targetDir, { env = process.env } = {}) {
  const script = env.MMD_SETUP_CMD || INSTALL_SCRIPT;
  const r = spawnSync('bash', [script, targetDir], {
    cwd: targetDir,
    stdio: 'inherit',
  });
  if (r.error) throw r.error;
  if (r.status == null) return { code: 1, signal: r.signal || null };
  return { code: r.status };
}
