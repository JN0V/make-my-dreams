// lib/bench/run-one.js — orchestrate a single bench dream.
//
// Spec: SPEC_V02B AC-3 (isolated dir per dream) + AC-4 (metrics captured).
//
// SRP: this module owns the "given a dream + a run dir, produce a metrics
// object" transformation. It composes invoke-autodev.js (subprocess), the
// metrics serializer, and the file-system layout described by AC-3.
//
// Reality-check stub in dry-run (per §5 spec risk): never invoke the real
// realityCheck() from --dry-run. Instead, write a dummy screenshot file so
// the metric shape claims `ran=true, passed=true` — that mirrors the success
// case shape and lets the aggregator + exit-code classifier behave as they
// would in a real run.

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { invokeAutodev } from '../invoke-autodev.js';
import { slugify } from '../parse-dream.js';
import { serializeMetrics, countPhase4Findings } from './metrics.js';

/**
 * Count commits in a git repo at `repoDir`. Returns 0 if not a git repo.
 *
 * @param {string} repoDir
 * @returns {number}
 */
function countCommits(repoDir) {
  const r = spawnSync('git', ['-C', repoDir, 'rev-list', '--count', 'HEAD'], {
    encoding: 'utf8',
  });
  if (r.status !== 0) return 0;
  const n = Number(r.stdout.trim());
  return Number.isFinite(n) ? n : 0;
}

/**
 * Run a single dream. Returns the canonical AC-4 metrics object.
 *
 * @param {object} args
 * @param {{id:string, dream:string}} args.dream
 * @param {string} args.runDir             bench/runs/<run-id>/
 * @param {'fast'|'standard'|'deep'} args.engine
 * @param {boolean} args.dryRun
 * @param {number} [args.timeoutMs]        forwarded to invokeAutodev
 * @returns {Promise<object>}              the serialized metrics (object, not JSON)
 */
export async function runOneDream({ dream, runDir, engine, dryRun, timeoutMs }) {
  const dreamDir = path.join(runDir, dream.id);
  const slug = slugify(dream.dream);
  const demoDir = path.join(dreamDir, 'demo', slug);
  await mkdir(demoDir, { recursive: true });
  await mkdir(path.join(dreamDir), { recursive: true });

  const logPath = path.join(dreamDir, 'run.log');
  const screenshotPath = path.join(dreamDir, 'screenshot.png');
  const started_at = new Date().toISOString();
  const startedNs = process.hrtime.bigint();

  let exit_code;
  try {
    const result = await invokeAutodev({
      demoDir,
      dream: dream.dream,
      slug,
      promptParts: { dream: dream.dream, slug, demoDir },
      logPath,
      timeoutMs: timeoutMs ?? (dryRun ? 30_000 : 1_800_000),
      engine,
    });
    exit_code = result.code ?? -1;
  } catch (err) {
    // invokeAutodev rejects only on infra failures (ENOENT cmd / cwd missing).
    // Surface the error in the metric — exit_code uses the mmdExitCode if set
    // so the AC-6 classifier still sees a non-zero crash.
    exit_code = err.mmdExitCode ?? -1;
    try {
      await writeFile(logPath, `[bench] invokeAutodev rejected: ${err.message}\n`, 'utf8');
    } catch {
      // logging is best-effort here — never let it mask the metric write below
    }
  }

  const duration_seconds = Number(process.hrtime.bigint() - startedNs) / 1e9;
  const ended_at = new Date().toISOString();

  // Reality check (AC-3 + §5 risk):
  //   dry-run: write a dummy 1×1 PNG so screenshot_path resolves to a real
  //            artifact — the metric shape stays honest about ran=true.
  //   real:    deferred to v0.2b+ — for the v0 harness we mark ran=false
  //            since the spec narrows v0.2b to "harness validates itself in
  //            dry-run" (AC-1 + mission validation in §1). Real reality-check
  //            integration in the bench is a follow-up slice; today the user
  //            runs reality-check manually after a real bench.
  let reality_check;
  if (dryRun) {
    const PNG_1x1 = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63600000000005' +
        '00010d0a2db40000000049454e44ae426082',
      'hex',
    );
    await writeFile(screenshotPath, PNG_1x1);
    reality_check = {
      ran: true,
      passed: exit_code === 0,
      screenshot_path: screenshotPath,
      console_errors_count: 0,
    };
  } else {
    reality_check = {
      ran: false,
      passed: exit_code === 0,
      screenshot_path: null,
      console_errors_count: 0,
    };
  }

  // Phase 4 findings parser (AC-4 best-effort).
  let phase4_findings_count;
  try {
    const logContent = await readFile(logPath, 'utf8');
    phase4_findings_count = countPhase4Findings(logContent);
  } catch {
    phase4_findings_count = null;
  }

  const metrics = serializeMetrics({
    dream_id: dream.id,
    engine,
    started_at,
    ended_at,
    duration_seconds,
    exit_code,
    reality_check,
    commits_count: countCommits(demoDir),
    phase4_findings_count,
    log_path: logPath,
  });

  // Persist metrics.json per AC-4 (in the dream's run directory).
  await writeFile(
    path.join(dreamDir, 'metrics.json'),
    `${JSON.stringify(metrics, null, 2)}\n`,
    'utf8',
  );

  return metrics;
}
