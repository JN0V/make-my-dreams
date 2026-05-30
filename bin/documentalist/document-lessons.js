#!/usr/bin/env node
// bin/documentalist/document-lessons.js — `mmd document-lessons` entry point.
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

const PKG_PATH = fileURLToPath(new URL('../../package.json', import.meta.url));
const VERSION = JSON.parse(readFileSync(PKG_PATH, 'utf8')).version;

const USAGE = `mmd document-lessons — Documentalist lite: increment lesson counters + auto-promote (SPEC_V02I)

Usage:
  mmd document-lessons [--dry-run] [--since <ts>]

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
  MMD_LESSONS_FILE   Override the lessons-learned.md path (default <cwd>/docs/lessons-learned.md).

mmd ${VERSION}
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
        message: `unknown document-lessons arg: '${tok}'. Run 'mmd document-lessons --help'.`,
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
  const { totalRuns, byLesson } = aggregateInjections(composers, {
    onWarn: (m) => stderr.write(`warning: ${m}\n`),
  });

  // 3. Parse + enrich lessons.
  let markdown;
  try {
    markdown = await readFile(lessonsPath, 'utf8');
  } catch (err) {
    stderr.write(`error: cannot read lessons file: ${lessonsPath} (${err.code || err.message})\n`);
    return 2;
  }
  const lessons = enrichLessons(markdown);

  // 4. Compute counter mutations + promotions.
  const { updatedLessons, toPromote } = mutateCounters(lessons, byLesson);
  const incrementCount = updatedLessons.filter((l) => l.counterDelta > 0).length;
  const promoteIds = new Set(toPromote.map((l) => l.id));

  // 5. Summary line (AC-5 wording). totalInjections = sum of per-lesson run
  // counts (injection events); byLesson.size = distinct lessons touched.
  const totalInjections = [...byLesson.values()].reduce((s, r) => s + r.count, 0);
  const willWord = parsed.dryRun ? 'would' : 'will';
  stdout.write(
    `Processed ${totalRuns} run(s), ${totalInjections} injection(s) across ` +
      `${byLesson.size} lesson(s). ${willWord} increment ${incrementCount} counter(s), ` +
      `${willWord} promote ${toPromote.length} lesson(s).\n`,
  );

  if (parsed.dryRun) {
    for (const lesson of toPromote) {
      const plan = await promoteLesson(lesson, repoRoot, { dryRun: true, lessonsPath });
      stdout.write(
        `  would promote ${plan.lessonId} → ${plan.targetModule} ` +
          `(ADR ${path.basename(plan.adrPath)})\n`,
      );
    }
    return 0;
  }

  // 6. Apply: counter updates for NON-promoted changed lessons (promoted ones
  // are removed wholesale, so their counter need not be written), then promote.
  const counterUpdates = new Map();
  for (const l of updatedLessons) {
    if (l.counterDelta > 0 && !promoteIds.has(l.id)) counterUpdates.set(l.id, l.counter);
  }
  if (counterUpdates.size > 0) {
    const next = serializeCounterUpdates(markdown, counterUpdates);
    await writeFile(lessonsPath, next, 'utf8');
  }

  let hadFailure = false;
  for (const lesson of toPromote) {
    const result = await promoteLesson(lesson, repoRoot, { dryRun: false, lessonsPath });
    if (result.errors && result.errors.length) {
      hadFailure = true;
      for (const e of result.errors) stderr.write(`error: promote ${lesson.id}: ${e}\n`);
    } else {
      stdout.write(
        `  promoted ${result.lessonId} → ${result.targetModule} ` +
          `(${path.basename(result.adrPath)})\n`,
      );
    }
  }

  return hadFailure ? 6 : 0;
}
