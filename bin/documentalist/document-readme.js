#!/usr/bin/env node
// bin/documentalist/document-readme.js — `mmd document-readme` entry point
// (SPEC_V03D AC-1/AC-4/AC-5/AC-6).
//
// SRP (universal.md §I.S): orchestrate the README doc-sync flow only — parse
// args, wire the real git/fs dependencies into the pure builders, rewrite the
// two marker-bounded mechanical blocks (Status + Changelog) via the SAME
// lib/handover/rewrite-markers.js the handover command uses, print a doc-drift
// report, and either print (--dry-run) or write README.md. The derivation
// (lib/readme-sync/*) and the rewrite (lib/handover/rewrite-markers.js) are pure
// and live elsewhere; this file is a thin coordinator mirroring bin/handover.js.
//
// Mechanical vs intent (SPEC §1): the Status + Changelog blocks are machine-owned
// (git/files). The README's prose History and command docs are human-owned and
// NEVER touched — we only ever rewrite between the markers, and the drift report
// only PRINTS (writes nothing to the README).
//
// Exit codes (mirror handover):
//   0  ok (blocks refreshed, or printed under --dry-run)
//   2  user/argv error
//   3  README.md missing/unreadable (nothing to refresh)
//   4  a marker pair absent — refuse to guess where to write (prints the block)

import { cwd as processCwd, stdout, stderr } from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

import { parseDocumentReadmeArgs, SUBCOMMANDS } from '../../lib/argv-parser.js';
import { runGit } from '../../lib/skills/_common/git.js';
import { parseLessons } from '../../lib/composer/parse-lessons.js';
import { buildStatusBlock } from '../../lib/readme-sync/build-status-block.js';
import { buildChangelog } from '../../lib/readme-sync/build-changelog.js';
import { detectDrift } from '../../lib/readme-sync/detect-drift.js';
import { rewriteMarkers } from '../../lib/handover/rewrite-markers.js';

const PKG_PATH = fileURLToPath(new URL('../../package.json', import.meta.url));
const VERSION = JSON.parse(readFileSync(PKG_PATH, 'utf8')).version;

// The two marker pairs this command owns in README.md (handover's contract,
// applied to the README — SPEC §1/§3). Exported for the integration test fixture.
export const STATUS_MARKERS = {
  start: '<!-- mmd:readme:status:start -->',
  end: '<!-- mmd:readme:status:end -->',
};
export const CHANGELOG_MARKERS = {
  start: '<!-- mmd:readme:changelog:start -->',
  end: '<!-- mmd:readme:changelog:end -->',
};

// Top-level flags the drift report cross-checks against the README (best-effort,
// AC-5). These are the user-facing top-level flags from bin/mmd.js's USAGE.
const TOP_LEVEL_FLAGS = Object.freeze([
  '--fast', '--here', '--label', '--catch', '--no-catch', '--skip-onboarding',
]);

const USAGE = `mmd document-readme — refresh README.md's mechanical Status + Changelog blocks (SPEC_V03D)

Usage:
  mmd document-readme [--tests <N>] [--dry-run]
  mmd document-readme --help

Behavior:
  Re-derives ONLY the two mechanical blocks and rewrites them in place between
  their markers, leaving every human-authored byte (intro, command docs, prose
  History) untouched:
    ${STATUS_MARKERS.start} … ${STATUS_MARKERS.end}
      version (package.json), latest tag, ADR count, active-lesson count,
      reflexive-slice (release-tag) count, and the test count.
    ${CHANGELOG_MARKERS.start} … ${CHANGELOG_MARKERS.end}
      one line per git tag, newest first, from each tag's annotation.
  It then prints a doc-drift report (any CLI subcommand/flag the README does not
  mention) to stdout — informational only, it writes nothing to the README.
  It never authors prose and never runs the test suite — the one non-cheap field,
  the test count, comes from --tests N or an explicit placeholder.

Flags:
  --tests <N>  Honest passing-test count (non-negative integer). Omitted → an
               explicit "run npm test to refresh" placeholder (never invented).
  --dry-run    Print the fully-rewritten README.md to stdout; write nothing.
  --help, -h   Print this usage and exit 0.

Exit codes:
  0  ok (refreshed, or printed under --dry-run)
  2  user/argv error
  3  README.md missing/unreadable
  4  a marker pair absent — add the two marker lines where the block belongs

mmd ${VERSION}
`;

/**
 * Render the doc-drift report lines (AC-5). Informational; printed to stdout.
 *
 * @param {{ subcommands: string[], flags: string[] }} drift
 * @returns {string}
 */
function formatDriftReport(drift) {
  const { subcommands, flags } = drift;
  if (subcommands.length === 0 && flags.length === 0) {
    return 'Doc-drift report: none — every subcommand and top-level flag is mentioned in README.md.';
  }
  const lines = ['Doc-drift report: the following are NOT mentioned in README.md (informational):'];
  for (const s of subcommands) lines.push(`  - subcommand: mmd ${s}`);
  for (const f of flags) lines.push(`  - flag: ${f}`);
  lines.push('  (Run prose-doc updates manually — document-readme never edits the README narrative.)');
  return lines.join('\n');
}

/**
 * Entry point invoked by bin/mmd.js when argv[0] === 'document-readme'.
 *
 * @param {string[]} rawArgs everything AFTER 'document-readme'
 * @returns {Promise<number>} exit code
 */
export async function runDocumentReadme(rawArgs) {
  const parsed = parseDocumentReadmeArgs(rawArgs);
  if (parsed.help) {
    stdout.write(USAGE);
    return 0;
  }
  if (parsed.error) {
    stderr.write(`error: ${parsed.error.message}\n`);
    stderr.write(USAGE);
    return parsed.error.exitCode;
  }

  const root = processCwd();
  const readmePath = path.join(root, 'README.md');

  // Build the two mechanical blocks from real (but cleanly-injected) deps.
  const statusBlock = await buildStatusBlock({
    runGit,
    repoRoot: root,
    readFile: (p) => readFileSync(p, 'utf8'),
    parseLessons,
    listAdrFiles: () =>
      readdirSync(path.join(root, 'docs', 'adr')).filter((n) => n.endsWith('.md')),
    paths: {
      packageJson: path.join(root, 'package.json'),
      lessons: path.join(root, 'docs', 'lessons-learned.md'),
    },
    tests: parsed.tests,
  });
  const changelogBlock = await buildChangelog({ runGit, repoRoot: root });

  // Read the existing README.md (refresh-in-place only — never scaffold).
  let fileText;
  try {
    fileText = readFileSync(readmePath, 'utf8');
  } catch (err) {
    stderr.write(
      `error: cannot read README.md at ${readmePath}: ` +
        `${err.code ? `${err.code}: ` : ''}${err.message}\n` +
        `  mmd document-readme refreshes an existing README.md; it does not create one.\n`,
    );
    return 3;
  }

  // Rewrite BOTH marker pairs with the SAME handover rewriter. A missing pair is
  // the handover contract: refuse to guess, print the block + how to fix (exit 4).
  const statusResult = rewriteMarkers(fileText, statusBlock, STATUS_MARKERS);
  if (!statusResult.ok) {
    stderr.write(
      `error: README.md is missing the Status marker(s): ${statusResult.missing.join(', ')}.\n` +
        `  Add these two lines around where the Status block belongs, then re-run:\n` +
        `    ${STATUS_MARKERS.start}\n` +
        `    ${STATUS_MARKERS.end}\n\n` +
        `  Derived Status block (for reference):\n\n${statusBlock}\n`,
    );
    return 4;
  }
  const changelogResult = rewriteMarkers(statusResult.text, changelogBlock, CHANGELOG_MARKERS);
  if (!changelogResult.ok) {
    stderr.write(
      `error: README.md is missing the Changelog marker(s): ${changelogResult.missing.join(', ')}.\n` +
        `  Add these two lines around where the Changelog block belongs, then re-run:\n` +
        `    ${CHANGELOG_MARKERS.start}\n` +
        `    ${CHANGELOG_MARKERS.end}\n\n` +
        `  Derived Changelog block (for reference):\n\n${changelogBlock}\n`,
    );
    return 4;
  }
  const finalText = changelogResult.text;

  // Doc-drift report (AC-5) — compare the LIVE README (the input, before rewrite,
  // which carries the human prose/command docs) to the registered subcommands +
  // top-level flags. Informational; never writes to the README.
  const drift = detectDrift({
    subcommands: [...SUBCOMMANDS],
    flags: [...TOP_LEVEL_FLAGS],
    readmeText: fileText,
  });
  const driftReport = formatDriftReport(drift);

  if (parsed.dryRun) {
    // AC-6: print the fully-rewritten file; write nothing. The drift report
    // goes to stderr so stdout is exactly the README (pipeable / diffable).
    stdout.write(finalText);
    if (!finalText.endsWith('\n')) stdout.write('\n');
    stderr.write(`\n${driftReport}\n`);
    return 0;
  }

  try {
    writeFileSync(readmePath, finalText, 'utf8');
  } catch (err) {
    stderr.write(`error: failed to write README.md: ${err.message}\n`);
    return 3;
  }
  stdout.write(
    `[OK] README.md Status + Changelog blocks refreshed. Review with: git diff README.md\n` +
      `     (prose History + command docs untouched; commit when you're happy — commit-git §I)\n`,
  );
  stdout.write(`${driftReport}\n`);
  return 0;
}
