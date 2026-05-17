#!/usr/bin/env node
// bin/discover.js — `mmd discover` subcommand entry point (SPEC_V02C AC-1..AC-5).
//
// SRP (universal.md §I.S): orchestrate SCAN → INGEST → INFER → REPORT only.
// Every phase lives in a dedicated lib/discover/* module:
//
//   1. parseDiscoverArgs    (lib/argv-parser.js)
//   2. runScan              (lib/discover/scan.js)
//   3. runIngest            (lib/discover/ingest.js)
//   4. runInfer             (lib/discover/infer.js)
//   5. classify             (lib/discover/classify.js)
//   6. buildReport+writeReport (lib/discover/report.js)
//
// Exit codes (per AC-1):
//   0  ok
//   2  user/argv error (surfaced by parseDiscoverArgs OR --approve with no report)
//   3  target path doesn't exist or isn't a directory
//   4  target is not a git repo and --force-non-git was not passed
//   5  reserved — used by the validation gate in bin/mmd.js, not here

import { cwd as processCwd, stdout, stderr } from 'node:process';
import { readFileSync } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseDiscoverArgs } from '../lib/argv-parser.js';
import { runScan, writeScan } from '../lib/discover/scan.js';
import { runIngest } from '../lib/discover/ingest.js';
import { runInfer, writeInferred } from '../lib/discover/infer.js';
import { classify } from '../lib/discover/classify.js';
import { buildReport, writeReport, flipReportToValidated } from '../lib/discover/report.js';
import { readReport, reportPathFor } from '../lib/discover/gate.js';
import { assertSafeWritePath } from '../lib/discover/safe-write.js';

const PKG_PATH = fileURLToPath(new URL('../package.json', import.meta.url));
const VERSION = JSON.parse(readFileSync(PKG_PATH, 'utf8')).version;

const DISCOVER_USAGE = `mmd discover — Project Onboarder for brownfield repos (SPEC_V02C)

Usage:
  mmd discover [<path>]                     Scan + ingest + infer + report
  mmd discover --approve [<path>]           Mark mmd-discovery-report.md as VALIDATED
  mmd discover --refresh [<path>]           Re-run from scratch (overwrites last.md)
  mmd discover --infer-with-claude [<path>] LLM-augmented INFER (deferred to v0.2c+)
  mmd discover --no-report-update [<path>]  Scan only; do NOT touch the root report
  mmd discover --force-non-git [<path>]     Allow scanning a non-git directory
  mmd discover --help, -h                   Print this usage and exit 0

Path defaults to cwd. Writes ONLY in <path>/.mmd/, <path>/docs/ (NEW files),
and <path>/mmd-discovery-report.md. Never modifies existing user code.

Exit codes:
  0  ok
  2  user/argv error
  3  path doesn't exist or is not a directory
  4  not a git repo (override with --force-non-git)

mmd ${VERSION}
`;

/**
 * Resolve a positional path argument to an absolute, existing directory path.
 * Returns a typed result.
 *
 * @param {string} maybeRel
 * @returns {Promise<{ ok: true, abs: string } | { ok: false, exitCode: 3, message: string }>}
 */
async function resolveTargetPath(maybeRel) {
  const abs = path.resolve(maybeRel);
  let s;
  try {
    s = await stat(abs);
  } catch (err) {
    return {
      ok: false,
      exitCode: 3,
      message: `mmd discover: target path does not exist: '${abs}' (${err.code || err.message})`,
    };
  }
  if (!s.isDirectory()) {
    return { ok: false, exitCode: 3, message: `mmd discover: target is not a directory: '${abs}'` };
  }
  return { ok: true, abs };
}

/**
 * Entry point invoked by bin/mmd.js when argv[0] === 'discover'.
 *
 * @param {string[]} rawArgs argv tokens AFTER 'discover'
 * @returns {Promise<number>} exit code
 */
export async function runDiscover(rawArgs) {
  const parsed = parseDiscoverArgs(rawArgs);
  if (parsed.help) {
    stdout.write(DISCOVER_USAGE);
    return 0;
  }
  if (parsed.error) {
    stderr.write(`error: ${parsed.error.message}\n`);
    stderr.write(DISCOVER_USAGE);
    return parsed.error.exitCode;
  }

  const targetRel = parsed.path || processCwd();
  const resolved = await resolveTargetPath(targetRel);
  if (!resolved.ok) {
    stderr.write(`error: ${resolved.message}\n`);
    return resolved.exitCode;
  }
  const targetDir = resolved.abs;

  // --approve path: flip Status: line on the existing report and exit.
  if (parsed.approve) {
    const existing = await readReport(targetDir);
    if (existing === null) {
      stderr.write(
        `error: mmd discover --approve: no ${reportPathFor(targetDir)} found. ` +
        `Run \`mmd discover\` first.\n`,
      );
      return 2;
    }
    let updated;
    try {
      updated = flipReportToValidated(existing);
    } catch (err) {
      stderr.write(`error: ${err.message}\n`);
      return 2;
    }
    // Writes through the same safety guard — the report is at the root, which
    // is one of the 3 allowed sinks.
    const reportPath = reportPathFor(targetDir);
    await assertSafeWritePath(targetDir, reportPath);
    await writeFile(reportPath, updated, 'utf8');
    // Mirror into last.md so the gate sees VALIDATED on the next run.
    const lastPath = path.join(targetDir, '.mmd', 'shared', 'project-onboarder', 'last.md');
    await assertSafeWritePath(targetDir, lastPath);
    await writeFile(lastPath, updated, 'utf8');
    stdout.write(`mmd discover --approve: report marked VALIDATED at ${reportPath}\n`);
    return 0;
  }

  // Discovery flow: SCAN → INGEST → INFER → REPORT.
  stdout.write(`mmd discover: scanning ${targetDir}\n`);
  const scanData = await runScan(targetDir);

  // Non-git enforcement (AC-1 exit 4) — unless --force-non-git.
  if (!scanData.git.is_git_repo && !parsed.forceNonGit) {
    stderr.write(
      `error: mmd discover: target is not a git repo. ` +
      `Pass --force-non-git to override (warning: brownfield assumptions weaken without git history).\n`,
    );
    return 4;
  }

  // --refresh: even if last.md exists, we re-run everything (which we already
  // do unconditionally in this code path). The flag is honored cosmetically —
  // it suppresses the "no changes detected" optimization noted in spec §5.
  // Since v0.2c doesn't yet implement that optimization, the flag is wired
  // for future use; the scan/ingest/infer always run today.
  if (scanData.already_onboarded && !parsed.refresh) {
    stdout.write(
      'mmd discover: target already onboarded (VALIDATED report found). ' +
      'Re-running anyway; pass --refresh for an explicit overwrite.\n',
    );
  }

  await writeScan(targetDir, scanData);
  stdout.write('mmd discover: SCAN complete\n');

  const ingestData = await runIngest(targetDir);
  stdout.write('mmd discover: INGEST complete\n');

  const inferredMd = await runInfer(targetDir, scanData, { useClaude: parsed.inferWithClaude });
  await writeInferred(targetDir, inferredMd);
  stdout.write('mmd discover: INFER complete\n');

  const caseLabel = classify(scanData);
  const report = buildReport({
    targetDir,
    scanData,
    ingestData,
    inferredMd,
    caseLabel,
    version: VERSION,
  });
  const written = await writeReport(targetDir, report, { skipRootReport: parsed.noReportUpdate });
  if (written.rootPath) {
    stdout.write(`mmd discover: REPORT written to ${written.rootPath}\n`);
  } else {
    stdout.write(`mmd discover: REPORT snapshot written to ${written.lastPath} (root unchanged: --no-report-update)\n`);
  }
  stdout.write(`mmd discover: detected case = ${caseLabel}\n`);
  if (!parsed.noReportUpdate) {
    stdout.write(
      `Next: review the report, then \`mmd discover --approve\` to clear the gate ` +
      `for \`mmd --here\` / \`mmd <dream>\`.\n`,
    );
  }
  return 0;
}

// Allow `node bin/discover.js ...` for ad-hoc testing.
if (import.meta.url === `file://${process.argv[1]}`) {
  runDiscover(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`${err.stack || err.message || String(err)}\n`);
      process.exit(99);
    });
}
