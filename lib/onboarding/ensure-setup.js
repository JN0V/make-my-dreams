// lib/onboarding/ensure-setup.js — one-line first-run setup guard for the
// SECONDARY commands that spawn claude/BMAD/gStack (bench, unblock, qa, cso,
// document-release). The primary entry points (serve, greenfield, --here) wire
// runFirstRunSetup directly; this is the shared, DRY helper for the rest so that
// EVERY command which needs BMAD/gStack installs it on first use rather than
// dying on a cryptic "Unknown command" / "skill not found".
//
// SRP: decide "do we need to run setup, and if so run it"; delegates the actual
// decision/spawn to setup.js + run-install.js. Pure-ish (only spawns when not
// set up and not faked/bypassed).

import { createInterface } from 'node:readline/promises';
import { runFirstRunSetup } from './setup.js';
import { runInstallMmd } from './run-install.js';

/** Default TTY confirm (o/N). Only called when stdin is a TTY. */
async function defaultConfirm() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const a = (await rl.question('  Run first-run setup now? [o/N] ')).trim().toLowerCase();
    return a === 'o' || a === 'oui' || a === 'y' || a === 'yes';
  } finally {
    rl.close();
  }
}

/**
 * Ensure MMD is set up before a command spawns claude/BMAD/gStack.
 *
 * - If the command's spawn is FAKED (env[fakeCmdVar] set), this is a test/CI run
 *   that won't touch the real skill → skip (return ok). This is what keeps every
 *   existing per-command test (which sets its own *_CMD seam) green.
 * - Otherwise defer to runFirstRunSetup: MMD_SKIP_SETUP=1 bypasses; already set
 *   up → no-op; not set up → TTY confirms (defaultConfirm) / non-TTY auto-runs
 *   install-mmd.sh; a genuine failure → { ok:false, exitCode:8 }.
 *
 * @param {{ targetDir:string, env?:object, fakeCmdVar?:string, tty?:boolean,
 *           out?:(s:string)=>void, err?:(s:string)=>void, confirmFn?:()=>Promise<boolean> }} opts
 * @returns {Promise<{ ok:boolean, exitCode?:number, action?:string }>}
 */
export async function ensureSetupForSpawn({
  targetDir,
  env = process.env,
  fakeCmdVar,
  tty = false,
  out = () => {},
  err = () => {},
  confirmFn = defaultConfirm,
  // Injected for tests (DIP) — default to the real install-mmd.sh spawn / detect.
  runnerFn = (t) => runInstallMmd(t, { env }),
  detectFn,
}) {
  if (fakeCmdVar && env[fakeCmdVar]) return { ok: true, action: 'faked' };
  return runFirstRunSetup({
    targetDir,
    tty: !!tty,
    env,
    confirmFn,
    runnerFn,
    ...(detectFn ? { detectFn } : {}),
    out,
    err,
  });
}
