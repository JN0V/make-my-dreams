// lib/onboarding/setup.js — the transparent first-run setup guard for `mmd --here`.
//
// SRP (universal.md §I.S): owns the DECISION of the guard (detect → confirm |
// auto → run → cheat-sheet → result) and nothing else. The two things that
// touch the outside world — asking the user (confirmFn) and spawning
// install-mmd.sh (runnerFn) — are INJECTED (DIP, universal §I.D) so the whole
// flow is driveable in tests without a TTY or a shell. The caller (runHereMode
// in bin/mmd.js) supplies the real readline prompt + the real spawn, maps the
// returned result onto its exit-code ladder, and proceeds only when ok.
//
// Spec: SPEC_V06A AC-3. Honesty (universal §VI): a declined or failed setup is
// NEVER an inert launch — it returns ok:false with exitCode 8 so the run aborts
// with a clear pointer. An already-ready repo is a no-op (and install-mmd.sh
// never overwrites an existing constitution — "elle reste").

import { detectMmdSetup } from './detect.js';
import { buildOnboardingCheatsheet } from './cheatsheet.js';

/**
 * The distinct, documented exit code for "setup missing and the user declined,
 * or the setup runner failed". A new rung on runHereMode's closed ladder
 * (3 cwd, 4 git, 5 gate/branch, 6 grounding/state, 7 judge, 8 setup).
 */
export const EXIT_SETUP = 8;

/**
 * Run the first-run setup guard.
 *
 * Decision order:
 *   1. `MMD_SKIP_SETUP=1` → bypass with a warning (escape hatch, mirrors
 *      MMD_SKIP_GROUNDING). action 'bypassed', ok:true.
 *   2. Already ready (detectMmdSetup) → no-op, action 'ready', ok:true. The
 *      run proceeds exactly as before; an existing constitution is untouched.
 *   3. Not ready:
 *      - TTY: print what's missing, ask once (confirmFn). Yes → run setup;
 *        No → abort (exitCode 8, action 'declined').
 *      - non-TTY (serve/CI): auto-run with an honest log line (no prompt).
 *      - setup runner: spawn install-mmd.sh <target> (runnerFn). On success →
 *        print the cheat-sheet, action 'setup-ran', ok:true. On non-zero /
 *        throw → report, action 'failed', exitCode 8 (never proceed inert).
 *
 * @param {object}   args
 * @param {string}   args.targetDir   absolute path of the repo being onboarded
 * @param {boolean}  args.tty         is stdin a TTY? (drives confirm vs auto)
 * @param {object}   [args.env]       process env (read MMD_SKIP_SETUP)
 * @param {() => Promise<boolean>} args.confirmFn   ask the user yes/no (TTY only)
 * @param {(targetDir: string) => Promise<{code: number}>} args.runnerFn  spawn install-mmd.sh
 * @param {(targetDir: string) => {ready: boolean, missing: string[]}} [args.detectFn]
 * @param {() => string} [args.cheatsheetFn]   build the post-setup cheat-sheet
 * @param {(s: string) => void} [args.out]     stdout sink
 * @param {(s: string) => void} [args.err]     stderr sink
 * @returns {Promise<{ ok: boolean, action: string, exitCode?: number }>}
 */
export async function runFirstRunSetup({
  targetDir,
  tty,
  env = {},
  confirmFn,
  runnerFn,
  detectFn = detectMmdSetup,
  cheatsheetFn = buildOnboardingCheatsheet,
  out = () => {},
  err = () => {},
}) {
  // 1. Escape hatch.
  if (env.MMD_SKIP_SETUP === '1') {
    err(
      '[mmd] first-run setup skipped (MMD_SKIP_SETUP=1) — proceeding without ' +
        'verifying that this repo has MMD\'s constitution + auto-dev workflow.\n',
    );
    return { ok: true, action: 'bypassed' };
  }

  // 2. Already set up → no-op (never overwrite, "elle reste").
  const status = detectFn(targetDir);
  if (status.ready) {
    return { ok: true, action: 'ready' };
  }

  // 3. Not ready — explain what's missing, then confirm (TTY) or auto (non-TTY).
  out(`MMD isn't set up in this repo yet. Missing:\n`);
  for (const m of status.missing) out(`  • ${m}\n`);

  if (tty) {
    const yes = await confirmFn();
    if (!yes) {
      err(
        'error: setup declined. MMD needs its constitution + auto-dev workflow ' +
          'to run here. Set it up with `install-mmd.sh .` (or re-run and accept), ' +
          `then try again. (exit ${EXIT_SETUP})\n`,
      );
      return { ok: false, action: 'declined', exitCode: EXIT_SETUP };
    }
    out('Running first-run setup (install-mmd.sh)...\n');
  } else {
    // serve / CI: no prompt, but an honest log line — never a silent inert launch.
    out('[mmd] repo not set up and stdin is not a TTY — auto-running first-run setup (install-mmd.sh)...\n');
  }

  // Spawn the setup. Honesty (universal §VI): a failure is reported and aborts.
  let result;
  try {
    result = await runnerFn(targetDir);
  } catch (e) {
    err(
      `error: first-run setup failed to start: ${e && e.message ? e.message : e}. ` +
        `MMD will not proceed with an unset-up repo. (exit ${EXIT_SETUP})\n`,
    );
    return { ok: false, action: 'failed', exitCode: EXIT_SETUP };
  }
  const code = result && typeof result.code === 'number' ? result.code : 1;
  if (code !== 0) {
    const sig = result && result.signal ? ` (terminated by ${result.signal})` : '';
    err(
      `error: first-run setup (install-mmd.sh) exited with code ${code}${sig}. ` +
        `MMD will not proceed with an unset-up repo. (exit ${EXIT_SETUP})\n`,
    );
    return { ok: false, action: 'failed', exitCode: EXIT_SETUP };
  }

  // Success → print the cheat-sheet once, then proceed.
  out(`\n${cheatsheetFn()}\n\n`);
  return { ok: true, action: 'setup-ran' };
}
