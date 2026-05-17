#!/usr/bin/env node
// bin/bench.js — `mmd bench` subcommand entry point.
//
// SRP (universal.md §I.S): orchestration only. All FS / parsing logic lives
// in lib/bench/* + lib/argv-parser.js (parseBenchArgs).
//
// Spec: SPEC_V02B AC-1..AC-7. The mission validation in §1: "mmd bench
// --dry-run exits 0 in under 30 s with a generated report".

import { mkdir, writeFile, symlink, readFile, lstat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

import { parseBenchArgs } from '../lib/argv-parser.js';
import { loadDreams } from '../lib/bench/load-dreams.js';
import { runOneDream } from '../lib/bench/run-one.js';
import { buildSummary, buildReportMd } from '../lib/bench/aggregate.js';
import { classifyBenchExit, failingDreamIds } from '../lib/bench/exit-codes.js';

const PKG_PATH = fileURLToPath(new URL('../package.json', import.meta.url));
const VERSION = JSON.parse(readFileSync(PKG_PATH, 'utf8')).version;

const BENCH_USAGE = `mmd bench — run the dream-bench v0 harness (SPEC_V02B)

Usage:
  mmd bench [--dry-run] [--engine <fast|standard|deep>] [--dreams <id1,id2,...>] [--out-dir <path>]
  mmd bench --help

Flags:
  --dry-run                 Use the fake-autodev fixture instead of the real auto-dev
                            (no MMD_BENCH_REAL gate needed). Validates the harness.
  --engine <e>              fast | standard | deep (default: standard).
  --dreams <id1,id2,...>    Comma-separated dream ids; default = all 5.
  --out-dir <path>          Override bench/runs/<run-id>/ (default: auto-generated).

Gate:
  Without MMD_BENCH_REAL=1 (and without --dry-run), 'mmd bench' refuses because
  a real run takes hours. Set MMD_BENCH_REAL=1 to confirm, or pass --dry-run.

Exit codes (AC-6):
  0  all dreams passed their reality check
  2  user/gate error (missing MMD_BENCH_REAL, invalid flag, ...)
  6  at least one dream failed reality check (no auto-dev crash)
  7  at least one dream's auto-dev crashed

Output (AC-3..AC-5):
  bench/runs/<run-id>/
    summary.json                      machine-readable aggregate
    report.md                         human-readable aggregate
    <dream-id>/metrics.json           per-dream AC-4 metrics
    <dream-id>/run.log                subprocess output
    <dream-id>/screenshot.png         reality-check screenshot (or stub in --dry-run)
    <dream-id>/demo/<slug>/           isolated working dir auto-dev modified
  bench/runs/latest                   symlink to the run that just completed
`;

/**
 * Generate a stable run identifier: ISO timestamp (filesystem-safe) + 6 random hex.
 */
function generateRunId() {
  const iso = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = randomBytes(3).toString('hex');
  return `${iso}-${suffix}`;
}

/**
 * Read the current MMD git short SHA. Best-effort — returns 'unknown' if
 * not in a git repo.
 */
function readMmdGitSha(repoRoot) {
  const r = spawnSync('git', ['-C', repoRoot, 'rev-parse', '--short', 'HEAD'], {
    encoding: 'utf8',
  });
  if (r.status !== 0) return 'unknown';
  return r.stdout.trim() || 'unknown';
}

/**
 * Replace a symlink atomically (POSIX: unlink + symlink).
 *
 * @param {string} target   what the symlink should point to (absolute)
 * @param {string} linkPath where the symlink lives (absolute)
 */
async function replaceSymlink(target, linkPath) {
  try {
    const st = await lstat(linkPath);
    if (st.isSymbolicLink() || st.isFile() || st.isDirectory()) {
      await unlink(linkPath).catch(() => {});
    }
  } catch {
    // ENOENT — no previous symlink.
  }
  await symlink(target, linkPath);
}

/**
 * Run the bench. Returns the numeric exit code.
 *
 * @param {string[]} rawArgs argv tokens AFTER `bench`
 * @returns {Promise<number>}
 */
export async function runBench(rawArgs) {
  const { stdout, stderr, env, cwd } = process;
  const opts = parseBenchArgs(rawArgs);
  if (opts.error) {
    stderr.write(`error: ${opts.error.message}\n`);
    return opts.error.exitCode;
  }
  if (opts.help) {
    stdout.write(BENCH_USAGE);
    return 0;
  }

  // AC-1: real-bench opt-in gate.
  if (!opts.dryRun && env.MMD_BENCH_REAL !== '1') {
    stderr.write(
      'Real bench takes hours; run with MMD_BENCH_REAL=1 to confirm, or pass --dry-run.\n',
    );
    return 2;
  }

  const repoRoot = cwd();
  const dreamsDir = path.join(repoRoot, 'bench', 'dreams');
  let dreams;
  try {
    dreams = await loadDreams({ dreamsDir, ids: opts.dreams });
  } catch (err) {
    stderr.write(`error: ${err.message}\n`);
    return 2;
  }
  if (dreams.length === 0) {
    stderr.write('error: no dreams to run (empty corpus or filtered-out)\n');
    return 2;
  }

  const runId = generateRunId();
  const runsRoot = path.join(repoRoot, 'bench', 'runs');
  const runDir = opts.outDir
    ? path.resolve(opts.outDir)
    : path.join(runsRoot, runId);
  await mkdir(runDir, { recursive: true });

  stdout.write(`[mmd bench] run-id=${runId}\n`);
  stdout.write(`[mmd bench] engine=${opts.engine} dry-run=${opts.dryRun} dreams=${dreams.length}\n`);
  stdout.write(`[mmd bench] out-dir=${runDir}\n`);

  const started_at = new Date().toISOString();
  const metrics = [];
  for (const dream of dreams) {
    stdout.write(`[mmd bench] starting ${dream.id} ...\n`);
    const m = await runOneDream({
      dream,
      runDir,
      engine: opts.engine,
      dryRun: opts.dryRun,
    });
    metrics.push(m);
    stdout.write(
      `[mmd bench] ${dream.id} done: exit=${m.exit_code} rc=${m.reality_check.passed ? 'pass' : 'fail'} ` +
        `dur=${m.duration_seconds.toFixed(2)}s\n`,
    );
  }
  const ended_at = new Date().toISOString();

  const summary = buildSummary({
    metrics,
    engine: opts.engine,
    mmd_version: VERSION,
    mmd_git_sha: readMmdGitSha(repoRoot),
    run_id: runId,
    started_at,
    ended_at,
  });
  await writeFile(
    path.join(runDir, 'summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf8',
  );
  await writeFile(path.join(runDir, 'report.md'), buildReportMd(summary), 'utf8');

  // AC-5: bench/runs/latest -> <run-id>
  if (!opts.outDir) {
    try {
      await mkdir(runsRoot, { recursive: true });
      await replaceSymlink(runDir, path.join(runsRoot, 'latest'));
    } catch (err) {
      // Symlink failure is not fatal — log and continue. On filesystems that
      // disallow symlinks (some Windows configs) the user can still find the
      // run via the run-id printed above.
      stderr.write(`[mmd bench] warning: could not update latest symlink: ${err.message}\n`);
    }
  }

  const exitCode = classifyBenchExit(metrics);
  if (exitCode !== 0) {
    const failing = failingDreamIds(metrics);
    stderr.write(`[mmd bench] failing dreams: ${failing.join(', ')}\n`);
  }
  stdout.write(`[mmd bench] report: ${path.join(runDir, 'report.md')}\n`);
  return exitCode;
}

// Allow `node bin/bench.js ...` for ad-hoc testing — bin/mmd.js routes
// programmatically via `import { runBench }`.
if (import.meta.url === `file://${process.argv[1]}`) {
  runBench(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`${err.stack || err.message || String(err)}\n`);
      process.exit(99);
    });
}
