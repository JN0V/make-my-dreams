// lib/discover/gate.js — validation gate (AC-7).
//
// SRP: pure-ish decision logic about whether `mmd --here` / `mmd <dream>`
// should be blocked because the target lacks a validated discovery report.
// I/O is limited to reading two well-known files; the actual stderr write
// and the exit-code mapping happen in bin/mmd.js.
//
// Spec: SPEC_V02C AC-7.
//
// Three return shapes:
//   - { ok: true, reason: 'mmd-self' }        target is MMD itself → never gate
//                                              (unless a report exists)
//   - { ok: true, reason: 'validated' }       report exists and is VALIDATED
//   - { ok: true, reason: 'blank' }           empty / fresh git init →
//                                              brownfield gate does not apply
//   - { ok: false, reason: 'pending',
//        message: <stderr text> }             report exists, NOT validated
//   - { ok: false, reason: 'missing',
//        message: <stderr text> }             no report, brownfield signals present
//
// The bypass flag `--skip-onboarding` is honored at the bin/mmd.js layer.

import { readFile, readdir, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';

const REPORT_FILENAME = 'mmd-discovery-report.md';

/**
 * Read the report status from a file's content. Returns:
 *   'validated' | 'pending' | 'unknown'  (when no `Status:` line found)
 *
 * @param {string} content
 * @returns {'validated'|'pending'|'unknown'}
 */
export function parseReportStatus(content) {
  if (typeof content !== 'string') return 'unknown';
  // Look for "Status: VALIDATED" or "Status: PENDING VALIDATION", tolerating
  // leading `> ` (blockquote) and arbitrary whitespace.
  if (/^\s*>?\s*Status:\s*VALIDATED\b/m.test(content)) return 'validated';
  if (/^\s*>?\s*Status:\s*PENDING VALIDATION\b/m.test(content)) return 'pending';
  return 'unknown';
}

/**
 * Quick "looks like a real brownfield project" probe. Heuristic per AC-7:
 *   any of: package.json / pyproject.toml / Cargo.toml / go.mod
 *   AND a git repo with >1 commits.
 *
 * Fresh git init with no files → not brownfield → gate does not fire.
 *
 * @param {string} targetDir
 * @returns {Promise<boolean>}
 */
export async function looksLikeBrownfield(targetDir) {
  const manifests = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'requirements.txt'];
  let hasManifest = false;
  for (const m of manifests) {
    try {
      await access(path.join(targetDir, m), fsConstants.F_OK);
      hasManifest = true;
      break;
    } catch {
      // try next
    }
  }
  if (!hasManifest) {
    // Fallback: a src/ dir with files is also a brownfield indicator.
    try {
      const entries = await readdir(path.join(targetDir, 'src'), { withFileTypes: true });
      if (entries.some((e) => e.isFile())) hasManifest = true;
    } catch {
      // no src/
    }
  }
  return hasManifest;
}

/**
 * Quick "is this MMD itself?" probe — presence of MAKE_MY_DREAMS.md at root.
 *
 * @param {string} targetDir
 * @returns {Promise<boolean>}
 */
export async function isMmdItself(targetDir) {
  try {
    await access(path.join(targetDir, 'MAKE_MY_DREAMS.md'), fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Main gate decision. Pure decision flow built on the helpers above.
 *
 * @param {string} targetDir absolute path
 * @returns {Promise<
 *   | { ok: true, reason: 'mmd-self'|'validated'|'blank' }
 *   | { ok: false, reason: 'pending'|'missing', message: string }
 * >}
 */
export async function checkGate(targetDir) {
  const reportPath = path.join(targetDir, REPORT_FILENAME);

  // 1. Report present? Read its status first — a VALIDATED report always wins.
  let reportContent = null;
  try {
    reportContent = await readFile(reportPath, 'utf8');
  } catch {
    reportContent = null;
  }
  if (reportContent !== null) {
    const status = parseReportStatus(reportContent);
    if (status === 'validated') return { ok: true, reason: 'validated' };
    // PENDING or unknown → blocking.
    return {
      ok: false,
      reason: 'pending',
      message:
        'Brownfield project detected with a pending discovery report. ' +
        'Review mmd-discovery-report.md, then run `mmd discover --approve` to mark it validated. ' +
        'To bypass this gate (not recommended), pass --skip-onboarding.',
    };
  }

  // 2. No report — is this MMD itself? Skip the missing-report check.
  if (await isMmdItself(targetDir)) return { ok: true, reason: 'mmd-self' };

  // 3. No report — does the target LOOK like a brownfield?
  if (await looksLikeBrownfield(targetDir)) {
    return {
      ok: false,
      reason: 'missing',
      message:
        'Brownfield project detected and no discovery report. ' +
        'Run `mmd discover` first, or pass --skip-onboarding to bypass.',
    };
  }
  return { ok: true, reason: 'blank' };
}

/**
 * Read the report file. Returns null if missing (caller decides whether that's
 * a "no report" or an error).
 *
 * @param {string} targetDir
 * @returns {Promise<string|null>}
 */
export async function readReport(targetDir) {
  const reportPath = path.join(targetDir, REPORT_FILENAME);
  try {
    return await readFile(reportPath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Resolve the report path (does not require existence) — single source of
 * truth for the filename so callers don't hardcode it.
 *
 * @param {string} targetDir
 * @returns {string}
 */
export function reportPathFor(targetDir) {
  return path.join(targetDir, REPORT_FILENAME);
}
