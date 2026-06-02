#!/usr/bin/env node
// bin/handover.js — `mmdream handover` subcommand entry point (SPEC_V02P AC-1/AC-5).
//
// SRP (universal.md §I.S): orchestrate the handover-refresh flow only — parse
// args, wire the real git/fs/clock dependencies into the two pure modules, and
// either print (--dry-run) or write the refreshed HANDOVER.md. The derivation
// (lib/handover/build-state-block.js) and the rewrite (lib/handover/
// rewrite-markers.js) are pure and live elsewhere; this file is a thin
// coordinator that mirrors bin/conductor/unblock.js's shape.
//
// Exit codes:
//   0  ok (block refreshed, or printed under --dry-run)
//   2  user/argv error
//   3  HANDOVER.md missing/unreadable (nothing to refresh)
//   4  markers absent — refuse to guess where to write (prints the block)

import { cwd as processCwd, stdout, stderr } from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

import { parseHandoverArgs } from '../lib/argv-parser.js';
import { runGit } from '../lib/skills/_common/git.js';
import { parseLessons } from '../lib/composer/parse-lessons.js';
import { buildStateBlock } from '../lib/handover/build-state-block.js';
import {
  rewriteMarkers,
  MARKER_START,
  MARKER_END,
} from '../lib/handover/rewrite-markers.js';

const PKG_PATH = fileURLToPath(new URL('../package.json', import.meta.url));
const VERSION = JSON.parse(readFileSync(PKG_PATH, 'utf8')).version;

const HANDOVER_USAGE = `mmdream handover — refresh HANDOVER.md's mechanical State block (SPEC_V02P)

Usage:
  mmdream handover [--tests <N>] [--dry-run]
  mmdream handover --help

Behavior:
  Re-derives ONLY the mechanical "State at handover" block (latest tag, branch,
  version, active-lessons count + ids, ADR count, recent commits, generated date)
  from git + repo files, and rewrites it in place between the two markers:
    ${MARKER_START}
    ${MARKER_END}
  Every human-authored section outside the markers is preserved byte-for-byte.
  It never authors intent and never runs the test suite — the one non-cheap
  field, the test count, comes from --tests N or an explicit placeholder.

Flags:
  --tests <N>  Honest passing-test count (non-negative integer). Omitted → an
               explicit "run npm test to refresh" placeholder (never invented).
  --dry-run    Print the fully-rewritten HANDOVER.md to stdout; write nothing.
  --help, -h   Print this usage and exit 0.

Exit codes:
  0  ok (refreshed, or printed under --dry-run)
  2  user/argv error
  3  HANDOVER.md missing/unreadable
  4  markers absent — add the two marker lines where the State block belongs

mmdream ${VERSION}
`;

/**
 * Entry point invoked by bin/mmd.js when argv[0] === 'handover'.
 *
 * @param {string[]} rawArgs everything AFTER 'handover'
 * @returns {Promise<number>} exit code
 */
export async function runHandover(rawArgs) {
  const parsed = parseHandoverArgs(rawArgs);
  if (parsed.help) {
    stdout.write(HANDOVER_USAGE);
    return 0;
  }
  if (parsed.error) {
    stderr.write(`error: ${parsed.error.message}\n`);
    stderr.write(HANDOVER_USAGE);
    return parsed.error.exitCode;
  }

  const root = processCwd();
  const handoverPath = path.join(root, 'HANDOVER.md');

  // Build the mechanical block from real (but cleanly-injected) dependencies.
  const block = await buildStateBlock({
    runGit,
    repoRoot: root,
    readFile: (p) => readFileSync(p, 'utf8'),
    parseLessons,
    listAdrFiles: () =>
      readdirSync(path.join(root, 'docs', 'adr')).filter((n) => n.endsWith('.md')),
    clock: () => new Date(),
    paths: {
      packageJson: path.join(root, 'package.json'),
      lessons: path.join(root, 'docs', 'lessons-learned.md'),
    },
    tests: parsed.tests,
  });

  // Read the existing HANDOVER.md (refresh-in-place only — never scaffold).
  let fileText;
  try {
    fileText = readFileSync(handoverPath, 'utf8');
  } catch (err) {
    stderr.write(
      `error: cannot read HANDOVER.md at ${handoverPath}: ` +
        `${err.code ? `${err.code}: ` : ''}${err.message}\n` +
        `  mmdream handover refreshes an existing HANDOVER.md; it does not create one.\n`,
    );
    return 3;
  }

  const result = rewriteMarkers(fileText, block);
  if (!result.ok) {
    // Markers absent — do NOT guess where to write. Print the block + how to fix.
    stderr.write(
      `error: HANDOVER.md is missing the state marker(s): ${result.missing.join(', ')}.\n` +
        `  Add these two lines around where the State block belongs, then re-run:\n` +
        `    ${MARKER_START}\n` +
        `    ${MARKER_END}\n\n` +
        `  Derived State block (for reference):\n\n${block}\n`,
    );
    return 4;
  }

  if (parsed.dryRun) {
    // AC-5: print the fully-rewritten file; write nothing.
    stdout.write(result.text);
    if (!result.text.endsWith('\n')) stdout.write('\n');
    return 0;
  }

  try {
    writeFileSync(handoverPath, result.text, 'utf8');
  } catch (err) {
    stderr.write(`error: failed to write HANDOVER.md: ${err.message}\n`);
    return 3;
  }
  stdout.write(
    `[OK] HANDOVER.md State block refreshed. Review with: git diff HANDOVER.md\n` +
      `     (intent sections untouched; commit when you're happy — commit-git §I)\n`,
  );
  return 0;
}
