#!/usr/bin/env node
// bin/lessons.js — `mmd lessons` subcommand entry point.
//
// SPEC_V02E AC-7: introspect the lessons-learned.md file + composer audits.
//
// Sub-actions:
//   mmd lessons                    list every active lesson + injection count
//   mmd lessons match "<prompt>"   show which lessons would be injected for input
//   mmd lessons --show <id>        print the full lesson body
//   mmd lessons --help             usage + exit 0
//
// Exit codes:
//   0  ok
//   2  user error (bad subaction, missing arg, malformed id)
//   3  lessons file missing (docs/lessons-learned.md)

import { cwd as processCwd, stdout, stderr } from 'node:process';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  composeLessonsSync,
  matchLessons,
} from '../lib/composer/match.js';
import { parseLessons } from '../lib/composer/parse-lessons.js';
import { aggregateComposerUsageSync } from '../lib/composer/usage-stats.js';

const PKG_PATH = fileURLToPath(new URL('../package.json', import.meta.url));
const VERSION = JSON.parse(readFileSync(PKG_PATH, 'utf8')).version;

const LESSONS_USAGE = `mmd lessons — introspect docs/lessons-learned.md + composer activity (SPEC_V02E AC-7)

Usage:
  mmd lessons                       List every active lesson (id, title, keyword count, injection count)
  mmd lessons match "<prompt>"      Show which lessons would be injected for that prompt
  mmd lessons --show <L-NNN>        Print one lesson (title, status, keywords, rule)
  mmd lessons --help, -h            Print this usage and exit 0

Behavior:
  Reads docs/lessons-learned.md from the current working directory's repo
  root. The injection-count column reads every *.composer.json sidecar under
  .mmd/local/ — if no composer-augmented runs have happened yet, the count
  column shows 0 for every lesson.

  Lessons with Status=milestone or Status=promoted are excluded from match
  / list (they are not auto-injection candidates).

Exit codes:
  0  ok
  2  user error (bad subaction, missing arg, malformed --show id)
  3  docs/lessons-learned.md missing

Env vars:
  MMD_COMPOSER_DISABLED=1           Bypass composition (mmd lessons match
                                    still works — it inspects the file).
  MMD_LESSONS_FILE                  Override the lessons-learned.md path
                                    (defaults to <cwd>/docs/lessons-learned.md)

mmd ${VERSION}
`;

/**
 * Parse the lessons sub-argv. Pure — no I/O. Exported for unit tests.
 *
 * @param {string[]} rawArgs
 * @returns {{
 *   action: 'list' | 'match' | 'show' | 'help',
 *   prompt?: string,
 *   id?: string,
 *   error?: { message: string, exitCode: number },
 * }}
 */
export function parseLessonsArgs(rawArgs) {
  const args = Array.isArray(rawArgs) ? rawArgs.slice() : [];
  if (args.includes('--help') || args.includes('-h')) return { action: 'help' };

  // `--show <id>` — id may follow as the next positional.
  const showIdx = args.indexOf('--show');
  if (showIdx >= 0) {
    const id = args[showIdx + 1];
    if (!id) {
      return {
        action: 'show',
        error: { message: '--show requires a lesson id (e.g. L-001)', exitCode: 2 },
      };
    }
    if (!/^L-\d+$/.test(id)) {
      return {
        action: 'show',
        error: { message: `--show: invalid lesson id '${id}' (expected L-NNN)`, exitCode: 2 },
      };
    }
    return { action: 'show', id };
  }

  if (args[0] === 'match') {
    const prompt = args.slice(1).join(' ').trim();
    if (!prompt) {
      return {
        action: 'match',
        error: { message: 'match: prompt argument is required', exitCode: 2 },
      };
    }
    return { action: 'match', prompt };
  }

  if (args.length === 0) return { action: 'list' };

  // Unknown subaction.
  return {
    action: 'list',
    error: { message: `unknown subaction '${args[0]}' — try: list (default), match, --show`, exitCode: 2 },
  };
}

function resolveLessonsPath(env) {
  if (env && typeof env.MMD_LESSONS_FILE === 'string' && env.MMD_LESSONS_FILE.length > 0) {
    return path.resolve(env.MMD_LESSONS_FILE);
  }
  return path.join(processCwd(), 'docs', 'lessons-learned.md');
}

/**
 * Entry point dispatched by bin/mmd.js when argv[0] === 'lessons'.
 *
 * @param {string[]} rawArgs argv tokens AFTER 'lessons'
 * @returns {Promise<number>}
 */
export async function runLessons(rawArgs) {
  const parsed = parseLessonsArgs(rawArgs);
  if (parsed.action === 'help') {
    stdout.write(LESSONS_USAGE);
    return 0;
  }
  if (parsed.error) {
    stderr.write(`error: ${parsed.error.message}\n`);
    stderr.write(LESSONS_USAGE);
    return parsed.error.exitCode;
  }

  const lessonsPath = resolveLessonsPath(process.env);
  if (!existsSync(lessonsPath)) {
    stderr.write(`error: lessons file not found: ${lessonsPath}\n`);
    return 3;
  }

  const markdown = readFileSync(lessonsPath, 'utf8');
  const warnings = [];
  const allLessons = parseLessons(markdown, { onWarn: (m) => warnings.push(m) });
  const active = allLessons.filter((l) => l.status === 'active');

  if (parsed.action === 'show') {
    const lesson = allLessons.find((l) => l.id === parsed.id);
    if (!lesson) {
      stderr.write(`error: lesson '${parsed.id}' not found in ${lessonsPath}\n`);
      return 2;
    }
    stdout.write(formatLessonShow(lesson));
    return 0;
  }

  if (parsed.action === 'match') {
    const matched = matchLessons(parsed.prompt, allLessons);
    stdout.write(formatMatchList(parsed.prompt, matched, active.length));
    return 0;
  }

  // Default: list.
  const stats = aggregateComposerUsageSync(processCwd());
  stdout.write(formatList(active, stats, lessonsPath));
  for (const w of warnings) stderr.write(`warning: ${w}\n`);
  return 0;
}

function formatList(activeLessons, stats, lessonsPath) {
  const lines = [];
  lines.push(`Lessons file: ${lessonsPath}`);
  lines.push(`Active lessons: ${activeLessons.length}`);
  if (stats.totalRuns > 0) {
    lines.push(
      `Composer activity: ${stats.totalRuns} run(s) audited, ${stats.autoInjectedRuns} auto-injected (avg ${stats.avgInjectedPerRun.toFixed(2)} lesson(s) per run).`,
    );
  } else {
    lines.push('Composer activity: none recorded yet (run `mmd --here ...` or `mmd ship ...` to populate `.mmd/local/`).');
  }
  lines.push('');
  lines.push(`ID      | KW | INJ | TITLE`);
  lines.push(`--------+----+-----+----------------------------------------------------------------`);
  for (const lesson of activeLessons) {
    const kw = String(lesson.keywords.length).padStart(2, ' ');
    const inj = String(stats.perLessonCount[lesson.id] || 0).padStart(3, ' ');
    const title = lesson.title.length > 60 ? lesson.title.slice(0, 57) + '...' : lesson.title;
    lines.push(`${lesson.id} | ${kw} | ${inj} | ${title}`);
  }
  lines.push('');
  return lines.join('\n');
}

function formatLessonShow(lesson) {
  const lines = [];
  lines.push(`# ${lesson.id} — ${lesson.title}`);
  lines.push('');
  lines.push(`**Status**: ${lesson.status}`);
  if (lesson.keywords.length > 0) {
    lines.push(`**Keywords**: ${lesson.keywords.join(', ')}`);
  } else {
    lines.push(`**Keywords**: (none)`);
  }
  lines.push('');
  lines.push('**Rule**:');
  lines.push(lesson.rule || '(no rule recorded)');
  lines.push('');
  return lines.join('\n');
}

function formatMatchList(prompt, matched, totalActive) {
  const lines = [];
  const preview = prompt.length > 80 ? prompt.slice(0, 77) + '...' : prompt;
  lines.push(`mmd lessons match — input: "${preview}"`);
  lines.push(`Active lessons considered: ${totalActive}`);
  lines.push(`Matched: ${matched.length}`);
  lines.push('');
  if (matched.length === 0) {
    lines.push('(no lessons matched — composer would prepend nothing)');
    lines.push('');
    return lines.join('\n');
  }
  lines.push(`ID      | SCORE | HITS                                              | TITLE`);
  lines.push(`--------+-------+---------------------------------------------------+--------------------------------`);
  for (const lesson of matched) {
    const hits = lesson.keywords_hit.join(', ');
    const hitsTrunc = hits.length > 50 ? hits.slice(0, 47) + '...' : hits;
    const title = lesson.title.length > 40 ? lesson.title.slice(0, 37) + '...' : lesson.title;
    lines.push(`${lesson.id} | ${String(lesson.score).padStart(5, ' ')} | ${hitsTrunc.padEnd(50, ' ')}| ${title}`);
  }
  lines.push('');
  return lines.join('\n');
}
