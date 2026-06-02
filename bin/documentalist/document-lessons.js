#!/usr/bin/env node
// bin/documentalist/document-lessons.js — `mmdream document-lessons` entry point.
//
// SPEC_V02I AC-1 + AC-5: the "Documentalist lite". Scans every composer audit
// under .mmd/local/, deduplicates by run, increments each matched lesson's
// reuse counter in docs/lessons-learned.md, and auto-promotes any lesson that
// reaches its `**To promote if**: N` threshold (append to the right constitution
// module + remove from lessons-learned.md + write a promotion ADR).
//
// Pipeline (SPEC_V02I §3):
//   scan composer.json → aggregateInjections → parse+enrich lessons →
//   mutateCounters → {dry-run: print plan} | {serialize counters + promote}
//
// Exit codes (AC-5): 0 ok / 2 user-argv error / 5 no composer.json found /
//                    6 partial failure (some promotions errored).

import { cwd as processCwd, stdout, stderr } from 'node:process';
import path from 'node:path';
import { readFileSync, statSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { findComposerAudits } from '../../lib/composer/usage-stats.js';
import { parseLessons } from '../../lib/composer/parse-lessons.js';
import { aggregateInjections } from '../../lib/documentalist/aggregate-injections.js';
import { mutateCounters } from '../../lib/documentalist/mutate-counters.js';
import {
  parseCounterMeta,
  serializeCounterUpdates,
} from '../../lib/documentalist/serialize-lessons.js';
import { promoteLesson } from '../../lib/documentalist/promote-lesson.js';
import { validatedReuses } from '../../lib/autolearn/validated-reuse.js';
import {
  readRunStateForComposerSync,
  readCreditedRunsSync,
  writeCreditedRunsSync,
  mergeCredited,
} from '../../lib/autolearn/run-outcome.js';
import {
  buildPromoteGatePrompt,
  parsePromoteGateVerdict,
  gateFallback,
} from '../../lib/autolearn/promote-gate.js';
import { buildSubprocessEnv } from '../../lib/invoke-autodev.js';

const PKG_PATH = fileURLToPath(new URL('../../package.json', import.meta.url));
const VERSION = JSON.parse(readFileSync(PKG_PATH, 'utf8')).version;

const USAGE = `mmdream document-lessons — Documentalist lite: increment lesson counters + auto-promote (SPEC_V02I)

Usage:
  mmdream document-lessons [--dry-run] [--since <ts>]

Flags:
  --dry-run        Print what WOULD change; modify no files. Exit 0.
  --since <ts>     Only process composer audits newer than <ts> (ISO date/time).
                   Default: all-time.
  --help, -h       Print this usage and exit 0.

What it does:
  Scans .mmd/local/**/*.composer.json, deduplicates by run, and increments each
  matched lesson's reuse counter in docs/lessons-learned.md. Any lesson reaching
  its own '**To promote if**: N' threshold is auto-promoted: its Rule is appended
  to the right constitution module (.specify/memory/constitution/<module>.md),
  its block is removed from docs/lessons-learned.md, and a promotion ADR is
  written under docs/adr/. Milestone lessons (Status: milestone) are never
  touched.

  THIS COMMAND MODIFIES docs/lessons-learned.md and MAY CREATE/EDIT constitution
  and docs/adr/ files. Use --dry-run first to preview.

Exit codes:
  0  ok
  2  user-argv error
  5  no composer.json found at all
  6  partial failure (one or more promotions errored; details on stderr)

Env vars:
  MMD_LESSONS_FILE        Override the lessons-learned.md path (default <cwd>/docs/lessons-learned.md).
  MMD_PROMOTE_GATE_CMD    The injected LLM promotion-validation gate command (a 'claude -p'
                          seam). When a lesson reaches its threshold, the gate reviews the
                          rule + its reusing runs and returns validated|not-validated|uncertain.
                          ONLY 'validated' promotes; anything else (incl. gate absent or an
                          unparseable verdict) HOLDS the lesson (counter preserved). Unset →
                          promotion gate unavailable → every threshold lesson is held.
  MMD_PROMOTE_GATE_TIMEOUT_MS  Gate spawn timeout (default 120000). 0 = no timeout.

mmdream ${VERSION}
`;

/**
 * Parse the document-lessons sub-argv. Pure. Exported for unit tests.
 *
 * @param {string[]} rawArgs argv tokens AFTER 'document-lessons'
 * @returns {{
 *   dryRun: boolean, since: string|null, help: boolean,
 *   error?: { message: string, exitCode: number },
 * }}
 */
export function parseDocumentLessonsArgs(rawArgs) {
  const out = { dryRun: false, since: null, help: false };
  const args = Array.isArray(rawArgs) ? rawArgs : [];
  for (let i = 0; i < args.length; i += 1) {
    const tok = args[i];
    if (tok === '--help' || tok === '-h') {
      out.help = true;
      continue;
    }
    if (tok === '--dry-run') {
      out.dryRun = true;
      continue;
    }
    if (tok === '--since') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('--')) {
        return { ...out, error: { message: "flag '--since' requires a value", exitCode: 2 } };
      }
      const ms = Date.parse(value);
      if (Number.isNaN(ms)) {
        return {
          ...out,
          error: { message: `--since: invalid timestamp '${value}' (expected ISO date)`, exitCode: 2 },
        };
      }
      out.since = value;
      i += 1;
      continue;
    }
    return {
      ...out,
      error: {
        message: `unknown document-lessons arg: '${tok}'. Run 'mmdream document-lessons --help'.`,
        exitCode: 2,
      },
    };
  }
  return out;
}

function resolveLessonsPath(env) {
  if (env && typeof env.MMD_LESSONS_FILE === 'string' && env.MMD_LESSONS_FILE.length > 0) {
    return path.resolve(env.MMD_LESSONS_FILE);
  }
  return path.join(processCwd(), 'docs', 'lessons-learned.md');
}

/**
 * Merge the lossy v0.2.7 parser output with the counter metadata so each lesson
 * carries everything mutateCounters + promoteLesson need.
 */
function enrichLessons(markdown) {
  const base = parseLessons(markdown);
  const meta = parseCounterMeta(markdown);
  return base.map((l) => {
    const m = meta.get(l.id) || {};
    return {
      ...l,
      counter: m.counter ?? null,
      promoteIfN: m.promoteIfN ?? null,
      promoteLine: m.promoteLine ?? null,
      targetModule: m.targetModule || 'ai-coding.md',
    };
  });
}

/**
 * Run the injected LLM promotion-validation gate for one lesson (SPEC_V090
 * AC-3). Mirrors the v0.4.d judge seam (invokeJudge): a `claude -p`-shaped
 * spawn behind the `MMD_PROMOTE_GATE_CMD` env override, with the sacred fallback
 * at EVERY failure branch — gate absent, spawn error, timeout, non-zero exit, or
 * unparseable reply all resolve to `uncertain` (→ HOLD), NEVER a fabricated
 * `validated`. Promotion edits the constitution, so the gate is conservative.
 *
 * @param {{ id: string, title?: string, rule?: string }} lesson
 * @param {string[]} reusingRuns the distinct done-run ids that reused the lesson
 * @param {string} repoRoot
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ verdict: string, reason: string }}
 */
function runPromoteGate(lesson, reusingRuns, repoRoot, env) {
  const cmd = env.MMD_PROMOTE_GATE_CMD;
  if (!cmd || cmd.length === 0) {
    return gateFallback('promotion gate unavailable — set MMD_PROMOTE_GATE_CMD');
  }
  let prompt;
  try {
    prompt = buildPromoteGatePrompt({ lesson, reusingRuns });
  } catch (err) {
    return gateFallback(`gate prompt build failed: ${err.message}`);
  }
  const timeoutMs =
    env.MMD_PROMOTE_GATE_TIMEOUT_MS !== undefined
      ? Number(env.MMD_PROMOTE_GATE_TIMEOUT_MS)
      : 120_000;
  const r = spawnSync(cmd, ['-p', prompt], {
    cwd: repoRoot,
    env: buildSubprocessEnv(env),
    encoding: 'utf8',
    timeout: timeoutMs && timeoutMs > 0 ? timeoutMs : undefined,
  });
  if (r.error) {
    const why = r.error.code === 'ENOENT' ? `'${cmd}' not found on PATH` : r.error.message;
    return gateFallback(`gate could not run: ${why}`);
  }
  // L-006: a timeout kills the child and leaves status===null — never parse a
  // truncated reply as a confident verdict; fall back to uncertain (→ HOLD).
  if (r.status === null) {
    return gateFallback(`gate timed out or was killed (signal ${r.signal || 'unknown'})`);
  }
  if (r.status !== 0) {
    return gateFallback(`gate exited with code ${r.status}`);
  }
  return parsePromoteGateVerdict(r.stdout || '');
}

/**
 * Entry point dispatched by bin/mmd.js when argv[0] === 'document-lessons'.
 *
 * @param {string[]} rawArgs argv tokens AFTER 'document-lessons'
 * @returns {Promise<number>}
 */
export async function runDocumentLessons(rawArgs) {
  const parsed = parseDocumentLessonsArgs(rawArgs);
  if (parsed.help) {
    stdout.write(USAGE);
    return 0;
  }
  if (parsed.error) {
    stderr.write(`error: ${parsed.error.message}\n`);
    stderr.write(USAGE);
    return parsed.error.exitCode;
  }

  const repoRoot = processCwd();
  const lessonsPath = resolveLessonsPath(process.env);

  // 1. Scan composer audits (reuse v0.2e finder).
  let auditPaths = await findComposerAudits(repoRoot);
  if (parsed.since) {
    const sinceMs = Date.parse(parsed.since);
    auditPaths = auditPaths.filter((p) => {
      try {
        return statSync(p).mtimeMs >= sinceMs;
      } catch {
        return false;
      }
    });
  }
  if (auditPaths.length === 0) {
    stderr.write(
      `error: no composer.json audits found under ${path.join(repoRoot, '.mmd', 'local')}` +
        `${parsed.since ? ` newer than ${parsed.since}` : ''}.\n`,
    );
    return 5;
  }

  // 2. Parse each + aggregate (skip malformed, continue).
  const composers = [];
  for (const p of auditPaths) {
    let json = null;
    try {
      json = JSON.parse(await readFile(p, 'utf8'));
    } catch {
      json = null; // aggregator logs the warning
    }
    composers.push({ path: p, json });
  }
  // 2a. RAW injections (ADR-010's old signal) — kept for honest reporting only
  // (AC-4), NO LONGER the counter driver.
  const { byLesson } = aggregateInjections(composers, {
    onWarn: (m) => stderr.write(`warning: ${m}\n`),
  });

  // 2b. VALIDATED reuses (the v0.9.0 signal): join each audit's injected ids to
  // its run outcome (the sibling outcome.json), then count distinct done-runs
  // per lesson (per-run deduped). This is what drives the counter.
  const runRecords = composers.map(({ path: p, json }) => {
    const runId =
      (json && typeof json.run_id === 'string' && json.run_id) ||
      (json && typeof json.runId === 'string' && json.runId) ||
      (p ? path.basename(p).replace(/\.composer\.json$/, '') : null);
    const matched = json && Array.isArray(json.matched) ? json.matched : [];
    const injectedLessonIds = matched
      .filter((m) => m && typeof m.id === 'string')
      .map((m) => m.id);
    const state = p ? readRunStateForComposerSync(p) : null;
    return { runId, injectedLessonIds, state };
  });
  const validatedByLesson = validatedReuses(runRecords);
  const totalRuns = new Set(runRecords.map((r) => r.runId).filter(Boolean)).size;
  const doneRuns = new Set(
    runRecords.filter((r) => r.state === 'done').map((r) => r.runId).filter(Boolean),
  ).size;

  // 3. Parse + enrich lessons.
  let markdown;
  try {
    markdown = await readFile(lessonsPath, 'utf8');
  } catch (err) {
    stderr.write(`error: cannot read lessons file: ${lessonsPath} (${err.code || err.message})\n`);
    return 2;
  }
  const lessons = enrichLessons(markdown);

  // 4. Compute counter mutations — by VALIDATED reuses NOT-yet-credited
  // (idempotent via the durable credited-runs record), NOT by raw injections.
  const creditedRuns = readCreditedRunsSync(repoRoot);
  const { updatedLessons, toPromote, newlyCreditedRuns } = mutateCounters(
    lessons,
    validatedByLesson,
    { creditedRuns },
  );
  const incrementCount = updatedLessons.filter((l) => l.counterDelta > 0).length;

  // 5. Honest summary (AC-4): RAW injections and VALIDATED reuses are shown as
  // DISTINCT, labelled values so they are never conflated again (ADR-010).
  const totalInjections = [...byLesson.values()].reduce((s, r) => s + r.count, 0);
  const totalValidatedReuses = [...validatedByLesson.values()].reduce((s, r) => s + r.count, 0);
  const willWord = parsed.dryRun ? 'would' : 'will';
  stdout.write(
    `Processed ${totalRuns} run(s) (${doneRuns} done).\n` +
      `  Raw injections (ADR-010's old signal, NOT the counter): ` +
      `${totalInjections} across ${byLesson.size} lesson(s).\n` +
      `  Validated reuses (injected-into-a-done-run, the promotion signal): ` +
      `${totalValidatedReuses} across ${validatedByLesson.size} lesson(s).\n` +
      `${willWord} increment ${incrementCount} counter(s) by newly-credited validated reuses, ` +
      `${willWord} consider ${toPromote.length} lesson(s) for promotion (gate-validated only).\n`,
  );

  // Per-lesson delta detail (printed in dry-run; the plan).
  if (parsed.dryRun) {
    for (const l of updatedLessons) {
      if (l.counterDelta > 0) {
        stdout.write(
          `  ${l.id}: +${l.counterDelta} (validated reuses ${l.validatedReuseTotal}, ` +
            `raw injections ${byLesson.get(l.id)?.count ?? 0}, ` +
            `counter ${l.previousCounter}→${l.counter}/${l.promoteIfN})\n`,
        );
      }
    }
    for (const lesson of toPromote) {
      const reusing = validatedByLesson.get(lesson.id)?.runIds || [];
      const gate = runPromoteGate(lesson, reusing, repoRoot, process.env);
      if (gate.verdict === 'validated') {
        const plan = await promoteLesson(lesson, repoRoot, { dryRun: true, lessonsPath });
        stdout.write(
          `  would PROMOTE ${plan.lessonId} → ${plan.targetModule} ` +
            `(ADR ${path.basename(plan.adrPath)}) — gate validated\n`,
        );
      } else {
        stdout.write(
          `  would HOLD ${lesson.id} — gate ${gate.verdict}` +
            `${gate.reason ? `: ${gate.reason}` : ''} (counter preserved, stays active)\n`,
        );
      }
    }
    return 0;
  }

  // 6. Run the promotion gate for each threshold lesson FIRST so we know which
  // are actually promoted (validated) vs held (everything else). A held lesson
  // keeps its incremented counter; only a promoted lesson's block is removed.
  let hadFailure = false;
  const promotedIds = new Set();
  const gateDecisions = [];
  for (const lesson of toPromote) {
    const reusing = validatedByLesson.get(lesson.id)?.runIds || [];
    const gate = runPromoteGate(lesson, reusing, repoRoot, process.env);
    gateDecisions.push({ lesson, gate });
    if (gate.verdict === 'validated') promotedIds.add(lesson.id);
  }

  // 6a. Write counter updates for every incremented lesson that is NOT being
  // promoted (held-at-threshold lessons included — their counter must persist;
  // a promoted lesson's whole block is removed by promoteLesson below).
  const counterUpdates = new Map();
  for (const l of updatedLessons) {
    if (l.counterDelta > 0 && !promotedIds.has(l.id)) counterUpdates.set(l.id, l.counter);
  }
  if (counterUpdates.size > 0) {
    const next = serializeCounterUpdates(markdown, counterUpdates);
    await writeFile(lessonsPath, next, 'utf8');
  }

  // 6b. Promote the gate-validated lessons; HOLD the rest with an honest note.
  for (const { lesson, gate } of gateDecisions) {
    if (gate.verdict !== 'validated') {
      stdout.write(
        `  held ${lesson.id} — gate ${gate.verdict}` +
          `${gate.reason ? `: ${gate.reason}` : ''} (counter ${lesson.counter}/${lesson.promoteIfN} ` +
          `preserved, stays active in lessons-learned.md)\n`,
      );
      continue;
    }
    const result = await promoteLesson(lesson, repoRoot, { dryRun: false, lessonsPath });
    if (result.errors && result.errors.length) {
      hadFailure = true;
      for (const e of result.errors) stderr.write(`error: promote ${lesson.id}: ${e}\n`);
    } else {
      stdout.write(
        `  promoted ${result.lessonId} → ${result.targetModule} ` +
          `(${path.basename(result.adrPath)}) — gate validated\n`,
      );
    }
  }

  // 7. Persist the idempotency record: the runs newly credited this pass are
  // never counted again (AC-2). Best-effort — a write failure does not undo the
  // counter/promotion work already applied.
  if (Object.keys(newlyCreditedRuns).length > 0) {
    try {
      writeCreditedRunsSync(repoRoot, mergeCredited(creditedRuns, newlyCreditedRuns));
    } catch (err) {
      stderr.write(`warning: could not persist credited-runs record: ${err.message}\n`);
    }
  }

  return hadFailure ? 6 : 0;
}
