// lib/reality-check.js — best-effort Reality Check (MCP → Playwright → SKIP chain).
// Constitution: §II KISS (zero-dep, runtime-detected Playwright), §VII (no silent catch).
//
// Public API:
//   - realityCheck({demoDir, screenshotDir?, backend?})
//       → {status: 'PASS'|'FAIL'|'SKIPPED', reason?, screenshotPath?}
//   - detectBackend() (exposed mostly for tests / future MCP integration)

import { mkdir } from 'node:fs/promises';
import path from 'node:path';

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
 * Best-effort Reality Check.
 *
 * @param {Object}  opts
 * @param {string}  opts.demoDir            The generated PWA directory (contains index.html).
 * @param {string} [opts.screenshotDir]     Where to drop reality-check screenshots.
 * @param {string} [opts.backend]           Force a backend. Defaults to env var or auto-detect.
 * @param {boolean} [opts.hereMode=false]   v0.2a — when true (--here mode), there is no demo
 *                                          PWA to open. Reality Check is short-circuited to
 *                                          SKIPPED with a stable reason string (AC-6).
 */
export async function realityCheck({ demoDir, screenshotDir, backend, hereMode = false }) {
  // AC-6: --here mode short-circuit. No PWA exists to open; the slice branch
  // contains the actual changes and the user can run their own `npm test`
  // (suggested by bin/mmd.js when applicable).
  if (hereMode) {
    return {
      status: 'SKIPPED',
      reason: '--here mode — no PWA to open. Run `npm test` to verify changes.',
    };
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
 * Playwright backend — opens file://<demoDir>/index.html, screenshots, watches for
 * pageerrors and console.error.
 *
 * Gracefully degrades to SKIPPED if Playwright isn't installed (we don't declare it
 * as a dep — see constitution §II + §V.A06).
 */
async function runPlaywright(demoDir, screenshotDir) {
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
