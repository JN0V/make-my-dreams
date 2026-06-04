// lib/reality-check.js — best-effort Reality Check (MCP → Playwright → SKIP chain).
// Constitution: §II KISS (zero-dep, runtime-detected Playwright), §VII (no silent catch).
//
// Public API:
//   - realityCheck({demoDir, screenshotDir?, backend?})
//       → {status: 'PASS'|'FAIL'|'SKIPPED', reason?, screenshotPath?}
//   - detectBackend() (exposed mostly for tests / future MCP integration)
//   - nonWebPreviewReason(descriptor) (pure; the honest non-web SKIPPED reason)
//
// v0.10.a (SPEC_V010A AC-4, ADR-048): with the generation prompt now
// technology-agnostic, a finished build is no longer guaranteed to be a web app
// with an index.html. Before the playwright path opens file://…/index.html it
// consults the run descriptor / isWebPreviewable: a non-web build degrades
// HONESTLY to SKIPPED (naming the kind + how to run it), never a FAIL on a
// missing index.html. This is §VIII detect-and-refuse applied to the preview
// side — the honesty couple (§VI) that ships WITH the prompt change.

import { mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { readRunDescriptor, isWebPreviewable } from './greenfield/run-descriptor.js';

/**
 * Auto-detect which Reality Check backend is reachable.
 *  - v0.1: MCP is a stub (always false).
 *  - Playwright is runtime-detected via dynamic `import` so it stays an
 *    optional, undeclared dependency (constitution §V.A06).
 */
export async function detectBackend() {
  // MCP integration deferred to v0.2.
  const mcpAvailable = false;
  if (mcpAvailable) return 'mcp';
  const pw = await import('playwright').then(() => 'playwright').catch(() => null);
  if (pw) return 'playwright';
  return 'skip';
}

/**
 * v0.17.a (SPEC_V017A AC-3) — DETECT the project's test command in a
 * technology-agnostic way (universal §VIII). Returns a descriptor the caller can
 * run, or null when no test entry is detectable (→ honest SKIPPED, never a faked
 * pass). PURE — no spawn, no throw; reads manifests defensively.
 *
 * Order of detection (the project under test is most often Node, so package.json
 * first; the others let the same gate work on Python / Rust / Make repos):
 *   - package.json with a non-empty `scripts.test`  → `npm test`
 *   - pyproject.toml / setup.py / requirements.txt   → `pytest`
 *   - Cargo.toml                                     → `cargo test`
 *   - Makefile with a `test:` target                 → `make test`
 *
 * @param {string} repoRoot  the repository root to inspect
 * @returns {{ cmd: string, args: string[], label: string } | null}
 */
export function detectTestCommand(repoRoot) {
  if (typeof repoRoot !== 'string' || repoRoot.length === 0) return null;
  const has = (rel) => {
    try { return existsSync(path.join(repoRoot, rel)); } catch { return false; }
  };

  // Node — a package.json declaring a non-empty `scripts.test`.
  if (has('package.json')) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
      const t = pkg && pkg.scripts && pkg.scripts.test;
      if (typeof t === 'string' && t.trim() !== '' && !/no test specified/i.test(t)) {
        return { cmd: 'npm', args: ['test', '--silent'], label: 'npm test' };
      }
    } catch { /* malformed package.json → fall through to other stacks */ }
  }

  // Python.
  if (has('pyproject.toml') || has('setup.py') || has('requirements.txt')) {
    return { cmd: 'pytest', args: ['-q'], label: 'pytest' };
  }

  // Rust.
  if (has('Cargo.toml')) {
    return { cmd: 'cargo', args: ['test'], label: 'cargo test' };
  }

  // Make — only when a `test:` target is present.
  if (has('Makefile')) {
    try {
      const mk = readFileSync(path.join(repoRoot, 'Makefile'), 'utf8');
      if (/^test\s*:/m.test(mk)) return { cmd: 'make', args: ['test'], label: 'make test' };
    } catch { /* unreadable Makefile → no make-test */ }
  }

  return null;
}

/**
 * v0.17.a (SPEC_V017A AC-3) — the DETERMINISTIC face of the alignment gate on the
 * `--here` path: does the change actually WORK? Replaces the old blanket
 * `--here` SKIP. Two sub-checks, both anchored to "it runs":
 *   1. Run the detected project test command (if any) → must pass.
 *   2. A run.json-kind "does it run" check:
 *        web-static → the existing open+screenshot+no-JS-error check
 *        cli        → run the descriptor's `run` command, must exit 0
 *        service/other/null → honest SKIPPED with a reason (never a fabricated pass)
 *
 * Result composition (HONEST at every branch — §VI, never throws, never fakes):
 *   - either sub-check FAILs            → { status: 'FAIL', face: 'deterministic', reason }
 *   - at least one sub-check PASSes and none fail → { status: 'PASS', face: 'deterministic' }
 *   - no test command AND no runnable kind → { status: 'SKIPPED', reason } honestly
 *
 * The exec seam is injected so the unit suite fakes subprocess results (no real
 * `npm test`). It defaults to a real bounded spawnSync.
 *
 * @param {Object} opts
 * @param {string} opts.repoRoot                 the repo under test
 * @param {{kind:string, run?:string}|null} [opts.runDescriptor]  pre-read descriptor (else read from repoRoot)
 * @param {(cmd:string,args:string[],cwd:string)=>{status:number|null,stdout?:string,stderr?:string}} [opts.injectedExec]
 * @returns {Promise<{status:string, face?:string, reason?:string}>}
 */
export async function hereRealityCheck({ repoRoot, runDescriptor, injectedExec } = {}) {
  if (typeof repoRoot !== 'string' || repoRoot.length === 0) {
    return { status: 'SKIPPED', reason: 'no repo root to verify' };
  }
  const exec = typeof injectedExec === 'function' ? injectedExec : defaultExec;
  const descriptor = runDescriptor !== undefined ? runDescriptor : readRunDescriptor(repoRoot);

  let ranSomething = false;

  // ── Sub-check 1: the project's test command ────────────────────────────────
  const testCmd = detectTestCommand(repoRoot);
  if (testCmd) {
    ranSomething = true;
    let r;
    try {
      r = exec(testCmd.cmd, testCmd.args, repoRoot);
    } catch (err) {
      return {
        status: 'FAIL',
        face: 'deterministic',
        reason: `${testCmd.label} could not run: ${err && err.message ? err.message : err}`,
      };
    }
    if (!r || r.status !== 0) {
      const excerpt = excerptOutput(r);
      return {
        status: 'FAIL',
        face: 'deterministic',
        reason: `tests red (${testCmd.label} exited ${r ? r.status : 'unknown'})${excerpt ? `: ${excerpt}` : ''}`,
      };
    }
  }

  // ── Sub-check 2: run.json-kind "does it run" ───────────────────────────────
  const kind = descriptor && typeof descriptor.kind === 'string' ? descriptor.kind : null;
  if (kind === 'web-static') {
    ranSomething = true;
    const web = await runPlaywright(repoRoot, undefined);
    if (web.status === 'FAIL') {
      return { status: 'FAIL', face: 'deterministic', reason: `web build does not run: ${web.reason}` };
    }
    // A web PASS counts; a SKIPPED (no browser, not previewable) does not fail
    // the gate — it just isn't a positive run signal.
  } else if (kind === 'cli') {
    const runStr = descriptor && typeof descriptor.run === 'string' ? descriptor.run.trim() : '';
    if (runStr === '') {
      // cli kind but no `run` command — honest, not a fabricated pass.
      if (!ranSomething) {
        return { status: 'SKIPPED', reason: 'run.json kind is cli but has no `run` command to execute' };
      }
    } else {
      ranSomething = true;
      let r;
      try {
        r = exec('sh', ['-c', runStr], repoRoot);
      } catch (err) {
        return {
          status: 'FAIL',
          face: 'deterministic',
          reason: `cli run command failed to launch: ${err && err.message ? err.message : err}`,
        };
      }
      if (!r || r.status !== 0) {
        const excerpt = excerptOutput(r);
        return {
          status: 'FAIL',
          face: 'deterministic',
          reason: `cli run command exited ${r ? r.status : 'unknown'}${excerpt ? `: ${excerpt}` : ''}`,
        };
      }
    }
  }
  // service / other / null kind → no runnable check (honest skip below if nothing else ran).

  if (!ranSomething) {
    return {
      status: 'SKIPPED',
      reason: 'no detectable test command or runnable entry point — '
        + `${kind ? `run.json kind '${kind}' is not runnable here; ` : 'no run.json; '}`
        + 'deterministic face skipped honestly (no fabricated pass)',
    };
  }
  return { status: 'PASS', face: 'deterministic' };
}

/** Default bounded exec seam for hereRealityCheck (real spawnSync). */
function defaultExec(cmd, args, cwd) {
  return spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    timeout: 600000,
    // Inherit the env so the project's test runner finds its tools on PATH.
    env: process.env,
  });
}

/** A short, redaction-free excerpt of a failed command's output (for the reason). */
function excerptOutput(r) {
  if (!r) return '';
  const raw = `${r.stderr || ''}${r.stdout || ''}`.trim();
  if (raw === '') return '';
  const oneLine = raw.replace(/\s+/g, ' ').trim();
  return oneLine.length > 200 ? `${oneLine.slice(0, 200)}…` : oneLine;
}

/**
 * Best-effort Reality Check.
 *
 * @param {Object}  opts
 * @param {string}  opts.demoDir            The generated PWA directory (contains index.html).
 * @param {string} [opts.screenshotDir]     Where to drop reality-check screenshots.
 * @param {string} [opts.backend]           Force a backend. Defaults to env var or auto-detect.
 * @param {boolean} [opts.hereMode=false]   when true (--here mode), v0.17.a (AC-3)
 *                                          runs the DETERMINISTIC face (project
 *                                          tests + run.json-kind "does it run")
 *                                          instead of the old blanket SKIP. There
 *                                          is no demo PWA, so demoDir is the repo
 *                                          root under test.
 * @param {Function} [opts.injectedExec]    test seam for hereRealityCheck's spawns.
 */
export async function realityCheck({ demoDir, screenshotDir, backend, hereMode = false, injectedExec }) {
  // v0.17.a (SPEC_V017A AC-3) — the blanket --here SKIP is GONE. In --here mode
  // demoDir is the repo under test; run the deterministic face (tests + a
  // run.json-kind "does it run" check), honest SKIPPED only when nothing is
  // detectable — never a fabricated pass.
  if (hereMode) {
    return hereRealityCheck({ repoRoot: demoDir, injectedExec });
  }
  const forced = backend || process.env.MMD_REALITY_CHECK_BACKEND;
  let resolved = forced;
  if (!resolved) resolved = await detectBackend();

  // Normalize unknown values to 'skip' for forward-compat (don't crash on typos).
  switch (resolved) {
    case 'skip':
      return {
        status: 'SKIPPED',
        reason: forced === 'skip' ? 'backend forced to skip' : 'no backend available',
      };
    case 'mcp':
      return runMcp(demoDir, screenshotDir);
    case 'playwright':
      return runPlaywright(demoDir, screenshotDir);
    default:
      return { status: 'SKIPPED', reason: `unknown backend '${resolved}'` };
  }
}

/**
 * MCP backend — v0.1 stub. Real implementation deferred to v0.2.
 */
async function runMcp(_demoDir, _screenshotDir) {
  return {
    status: 'SKIPPED',
    reason: 'mcp not available — v0.2 deferred',
  };
}

/**
 * Build the honest "this build is not a previewable web app" reason string
 * (SPEC_V010A AC-4). Names the build kind + how to run it, derived from the
 * run descriptor — never a fabricated kind. Pure, exported for unit testing.
 *
 * @param {{ kind: string, run?: string } | null} descriptor  from readRunDescriptor
 * @returns {string}
 */
export function nonWebPreviewReason(descriptor) {
  if (descriptor && typeof descriptor === 'object' && typeof descriptor.kind === 'string') {
    const run = typeof descriptor.run === 'string' && descriptor.run.length > 0
      ? descriptor.run
      : 'see .mmd/shared/run.json';
    return `built a ${descriptor.kind} project — browser preview not available for this kind yet. `
      + `To run it: ${run}`;
  }
  // No descriptor AND no bare index.html (the caller only reaches here when the
  // build is not web-previewable): nothing to open, and no run descriptor to
  // point at. Honest about both gaps.
  return 'no web app to preview — no index.html and no .mmd/shared/run.json found in the build; '
    + 'nothing to open.';
}

/**
 * Playwright backend — opens file://<demoDir>/index.html, screenshots, watches for
 * pageerrors and console.error.
 *
 * Gracefully degrades to SKIPPED if Playwright isn't installed (we don't declare it
 * as a dep — see constitution §II + §V.A06).
 *
 * v0.10.a (SPEC_V010A AC-4, §VIII detect-and-refuse on the preview path): BEFORE
 * opening (or even launching a browser for) a missing index.html, consult the
 * run descriptor / isWebPreviewable. A non-web build (e.g. run.json {kind:'cli'},
 * no index.html) is NOT a failure — it returns SKIPPED with an honest reason
 * naming the kind + how to run it, NEVER a FAIL on a missing index.html. A
 * web-previewable build (descriptor web-static with a real entry, OR — back-compat
 * — a bare index.html with no descriptor) follows today's open+screenshot path.
 */
async function runPlaywright(demoDir, screenshotDir) {
  // §VIII honest degradation gate (AC-4) — runs before the playwright import so a
  // non-web build is reported honestly even when chromium is unavailable.
  const descriptor = readRunDescriptor(demoDir);
  if (!isWebPreviewable(descriptor, demoDir)) {
    return { status: 'SKIPPED', reason: nonWebPreviewReason(descriptor) };
  }

  let pw;
  try {
    pw = await import('playwright');
  } catch {
    return { status: 'SKIPPED', reason: 'playwright not installed' };
  }
  let browser;
  try {
    try {
      browser = await pw.chromium.launch();
    } catch (launchErr) {
      const msg = String(launchErr && launchErr.message || launchErr);
      if (/Executable doesn't exist/i.test(msg) || /missing dependencies/i.test(msg)) {
        return {
          status: 'SKIPPED',
          reason: 'playwright chromium browser not installed — run `npx playwright install chromium`',
        };
      }
      return { status: 'SKIPPED', reason: `playwright launch failed: ${msg}` };
    }

    const context = await browser.newContext();
    const page = await context.newPage();

    const errors = [];
    page.on('pageerror', (err) => {
      errors.push(`pageerror: ${err.message || String(err)}`);
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(`console.error: ${msg.text()}`);
      }
    });

    const absDemoDir = path.resolve(demoDir);
    const url = `file://${absDemoDir}/index.html`;
    try {
      await page.goto(url, { timeout: 10000 });
    } catch (gotoErr) {
      return { status: 'FAIL', reason: `navigation failed: ${gotoErr.message || gotoErr}` };
    }
    try {
      await page.waitForLoadState('networkidle', { timeout: 5000 });
    } catch {
      // Non-fatal — some pages never reach networkidle.
    }

    // Screenshot path.
    const outDir = screenshotDir || path.join(absDemoDir, '.mmd', 'local', 'reality-checks');
    let screenshotPath;
    try {
      await mkdir(outDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      screenshotPath = path.join(outDir, `${ts}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
    } catch (shotErr) {
      return { status: 'SKIPPED', reason: `screenshot path unwritable: ${shotErr.message || shotErr}` };
    }

    if (errors.length > 0) {
      return { status: 'FAIL', reason: errors[0], screenshotPath };
    }
    return { status: 'PASS', screenshotPath };
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
  }
}
