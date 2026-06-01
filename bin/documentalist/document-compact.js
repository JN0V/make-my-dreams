#!/usr/bin/env node
// bin/documentalist/document-compact.js — `mmd document-compact` entry point
// (SPEC_V07C AC-2). The Documentalist's first ACTION: archive the root
// SPEC_V*.md sprawl into docs/specs/ with an index and rewritten references.
//
// SRP (universal.md §I.S): orchestrate the gather → plan → execute flow only.
// The judgment + the text transform are PURE in lib/documentalist/compact.js;
// this file wires the real fs + git (readdir, readFile, `git mv`, writeFile),
// mirroring bin/documentalist/document-review.js.
//
// SAFETY CONTRACT (SPEC §intro, the heart of this slice):
//   • MOVE-ONLY + reference-PATH rewrite — it NEVER edits doc prose, NEVER
//     deletes, NEVER summarizes. Only `git mv` + an exact filename-token prefix.
//   • IDEMPOTENT — no root SPECs → a clean no-op (exit 0); an already-prefixed
//     reference is never double-prefixed.
//   • REVERSIBLE — `git mv` preserves history (`git log --follow` reaches the
//     original); the whole change is a plain git rename + edits the operator
//     reviews and can revert.
//   • HONEST + never half-applied — a non-git repo or an untracked SPEC is
//     reported non-zero BEFORE any mutation; `--dry-run` changes NOTHING.
//   • Does NOT auto-commit (commit-git §I) — the operator reviews + commits.
//
// Exit codes:
//   0  ok (archived, or a no-op, or printed under --dry-run)
//   2  user/argv error
//   3  cannot write the INDEX / a rewritten doc (fs failure)
//   5  not a git repository (cannot `git mv` to preserve history)
//   6  a precondition failed (untracked SPEC) or `git mv` failed — not half-applied

import { cwd as processCwd, stdout, stderr } from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

import { planCompaction, applyReferenceRewrites, countReferences, ARCHIVE_DIR } from '../../lib/documentalist/compact.js';

const PKG_PATH = fileURLToPath(new URL('../../package.json', import.meta.url));
let VERSION = '0.0.0';
try {
  VERSION = JSON.parse(readFileSync(PKG_PATH, 'utf8')).version;
} catch {
  // package.json unreadable — version stays a placeholder, never crashes.
}

// The archive index filename (lives inside docs/specs/, beside the moved specs).
const INDEX_NAME = 'INDEX.md';

// Matches an MMD root SPEC filename (the sprawl pattern). Anchored — exact name.
const SPEC_FILE_RE = /^SPEC_V.*\.md$/;

const USAGE = `mmd document-compact — the Documentalist archives the root SPEC sprawl (SPEC_V07C)

Usage:
  mmd document-compact [--dry-run]
  mmd document-compact --help

Behavior:
  Gathers the root SPEC_V*.md files, plans their relocation into ${ARCHIVE_DIR}/,
  then \`git mv\`s each (history preserved), writes ${ARCHIVE_DIR}/${INDEX_NAME}
  (one entry per SPEC, newest-first), and rewrites references to the moved files
  (\`SPEC_V0XX.md\` → \`${ARCHIVE_DIR}/SPEC_V0XX.md\`) across tracked markdown.
  Prints a short summary. Run \`mmd document-review\` afterwards to confirm no
  dangling SPEC references (the v0.7.b Drift detector validates the rewrite).

  MOVE-ONLY + idempotent + reversible: it never edits doc prose, never deletes,
  never double-prefixes an already-archived reference, and a re-run with no root
  SPECs is a clean no-op. It does NOT commit — review the staged renames + edits
  and commit them yourself.

Flags:
  --dry-run   Print the plan; change NOTHING (clean tree after).
  --help, -h  Print this usage and exit 0.

Exit codes:
  0  ok (archived, no-op, or printed under --dry-run)
  2  user/argv error
  3  cannot write the index / a rewritten doc
  5  not a git repository
  6  a precondition failed (untracked SPEC) or git mv failed — not half-applied

mmd ${VERSION}
`;

/**
 * Parse the document-compact flags. Boolean-only, mirrors the document-review
 * contract: unknown flag → exit 2, no positionals.
 *
 * @param {string[]} rawArgs everything AFTER 'document-compact'
 * @returns {{ dryRun: boolean, help: boolean, error: { message: string, exitCode: number }|null }}
 */
export function parseDocumentCompactArgs(rawArgs) {
  const out = { dryRun: false, help: false, error: null };
  if (!Array.isArray(rawArgs)) {
    out.error = { message: 'parseDocumentCompactArgs: rawArgs must be an array', exitCode: 2 };
    return out;
  }
  for (const tok of rawArgs) {
    if (tok === '--dry-run') out.dryRun = true;
    else if (tok === '--help' || tok === '-h') out.help = true;
    else {
      out.error = {
        message: `unknown document-compact arg: '${tok}'. Run 'mmd document-compact --help' to see supported flags.`,
        exitCode: 2,
      };
      return out;
    }
  }
  return out;
}

/**
 * The first markdown H1 line of a SPEC (its title line), or '' when absent. Used
 * verbatim by the index renderer (it strips the leading `# `).
 *
 * @param {string} text
 * @returns {string}
 */
function firstTitleLine(text) {
  if (typeof text !== 'string') return '';
  for (const line of text.split('\n')) {
    if (/^#\s+/.test(line)) return line.trim();
  }
  return '';
}

/**
 * Run a git command in the repo. Returns { ok, stdout, stderr, status }. Never
 * throws (a spawn error is surfaced as ok:false with the message).
 *
 * @param {string} root
 * @param {string[]} args
 */
function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 20000 });
  if (r.error) return { ok: false, stdout: '', stderr: r.error.message, status: null };
  return { ok: r.status === 0, stdout: r.stdout || '', stderr: r.stderr || '', status: r.status };
}

/**
 * List the SPEC_V*.md files directly in a directory (root or the archive). A
 * missing dir → []. Never throws.
 *
 * @param {string} root
 * @param {string} rel  '' for the repo root, 'docs/specs' for the archive
 * @returns {string[]}
 */
function listSpecFiles(root, rel) {
  try {
    return readdirSync(path.join(root, rel))
      .filter((n) => typeof n === 'string' && SPEC_FILE_RE.test(n))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Read a SPEC's { name, title } given its directory + filename. An unreadable
 * file degrades to an empty title (honest — the index falls back to the name).
 *
 * @param {string} root
 * @param {string} rel directory relative to root
 * @param {string} name filename
 */
function readSpec(root, rel, name) {
  let text = '';
  try {
    text = readFileSync(path.join(root, rel, name), 'utf8');
  } catch {
    text = '';
  }
  return { name, title: firstTitleLine(text) };
}

/**
 * The git-tracked markdown files OUTSIDE the archive folder — the docs whose
 * references to the moved SPECs must be rewritten. A spec moved into docs/specs/
 * keeps BARE sibling cross-references (they still resolve), so files now under
 * the archive are deliberately excluded. Best-effort: a git failure → [].
 *
 * @param {string} root
 * @returns {string[]} repo-root-relative paths
 */
function trackedMarkdownOutsideArchive(root) {
  const mdList = git(root, ['ls-files', '-z', '*.md']);
  return (mdList.ok ? mdList.stdout.split('\0').map((s) => s.trim()).filter(Boolean) : [])
    .filter((rel) => !rel.startsWith(`${ARCHIVE_DIR}/`));
}

/**
 * Count how many references across how many files WOULD be rewritten — a pure,
 * read-only preview (no writes), so `--dry-run` can report the real blast radius
 * the SPEC example promises ("rewrite N references across K files"). Returns
 * { known:false } when the tracked-file set can't be read (e.g. not a git repo),
 * so dry-run never fabricates a count (§VI).
 *
 * @param {string} root
 * @param {Array<{ from: string }>} referenceRewrites
 * @returns {{ refs: number, files: number, known: boolean }}
 */
function previewRewriteStats(root, referenceRewrites) {
  const inside = git(root, ['rev-parse', '--is-inside-work-tree']);
  if (!inside.ok || inside.stdout.trim() !== 'true') return { refs: 0, files: 0, known: false };
  let refs = 0;
  let files = 0;
  for (const rel of trackedMarkdownOutsideArchive(root)) {
    let text;
    try {
      text = readFileSync(path.join(root, rel), 'utf8');
    } catch {
      continue;
    }
    const hits = countReferences(text, referenceRewrites);
    if (hits > 0) {
      refs += hits;
      files += 1;
    }
  }
  return { refs, files, known: true };
}

/**
 * Entry point invoked by bin/mmd.js when argv[0] === 'document-compact'.
 *
 * @param {string[]} rawArgs everything AFTER 'document-compact'
 * @returns {Promise<number>} exit code
 */
export async function runDocumentCompact(rawArgs) {
  const parsed = parseDocumentCompactArgs(rawArgs);
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

  // Gather the root SPEC sprawl + any already-archived specs (for a complete
  // index). The plan moves ONLY the root ones.
  const rootSpecNames = listSpecFiles(root, '');
  const archivedNames = listSpecFiles(root, ARCHIVE_DIR);

  const specs = [
    ...rootSpecNames.map((n) => readSpec(root, '', n)),
    ...archivedNames.map((n) => readSpec(root, ARCHIVE_DIR, n)),
  ];
  const plan = planCompaction({ specs, existingArchive: archivedNames });

  // Idempotent no-op: nothing at root to archive. (Exit 0 — not an error.)
  if (plan.moves.length === 0) {
    stdout.write(
      `Nothing to archive — no SPEC_V*.md at the repo root. (no-op)\n`
      + (archivedNames.length ? `  ${archivedNames.length} SPEC(s) already under ${ARCHIVE_DIR}/.\n` : ''),
    );
    return 0;
  }

  // ── --dry-run: print the plan, change NOTHING ──────────────────────────────
  if (parsed.dryRun) {
    const stats = previewRewriteStats(root, plan.referenceRewrites);
    const rewritePhrase = stats.known
      ? `rewrite ${stats.refs} reference${stats.refs === 1 ? '' : 's'} across ${stats.files} file${stats.files === 1 ? '' : 's'}`
      : 'rewrite references across tracked markdown (count unavailable — not a git repo)';
    stdout.write(
      `Would archive ${plan.moves.length} SPEC_V*.md → ${ARCHIVE_DIR}/ (git mv), `
      + `write ${ARCHIVE_DIR}/${INDEX_NAME}, and ${rewritePhrase}.\n`,
    );
    for (const mv of plan.moves) stdout.write(`  ${mv.src} → ${mv.dst}\n`);
    stdout.write('Nothing changed (dry-run).\n');
    return 0;
  }

  // ── Preconditions (validate BEFORE any mutation — never half-apply) ────────
  // 1. Must be a git repo (so `git mv` preserves history; AC-4 asserts --follow).
  const inside = git(root, ['rev-parse', '--is-inside-work-tree']);
  if (!inside.ok || inside.stdout.trim() !== 'true') {
    stderr.write(
      `error: ${root} is not a git repository.\n`
      + '  mmd document-compact uses `git mv` to preserve each SPEC\'s history; it cannot run here.\n',
    );
    return 5;
  }
  // 2. Every SPEC to move must be git-tracked (git mv fails on an untracked file;
  //    catching it up front keeps the run all-or-nothing).
  const tracked = git(root, ['ls-files', '-z']);
  const trackedSet = new Set(
    tracked.ok ? tracked.stdout.split('\0').map((s) => s.trim()).filter(Boolean) : [],
  );
  const untracked = plan.moves.map((m) => m.src).filter((src) => !trackedSet.has(src));
  if (untracked.length > 0) {
    stderr.write(
      `error: these root SPEC(s) are not git-tracked, so 'git mv' cannot preserve their history: `
      + `${untracked.join(', ')}.\n  Commit (or remove) them first, then re-run. Nothing was changed.\n`,
    );
    return 6;
  }

  // ── Execute ───────────────────────────────────────────────────────────────
  // a. Create the archive dir (git mv into a non-existent dir fails).
  try {
    mkdirSync(path.join(root, ARCHIVE_DIR), { recursive: true });
  } catch (err) {
    stderr.write(`error: cannot create ${ARCHIVE_DIR}/: ${err.message}\n`);
    return 3;
  }

  // b. git mv each root SPEC → docs/specs/. Stop + report honestly on the first
  //    failure (preconditions make this near-impossible, but we never pretend).
  const moved = [];
  for (const mv of plan.moves) {
    const r = git(root, ['mv', mv.src, mv.dst]);
    if (!r.ok) {
      stderr.write(
        `error: 'git mv ${mv.src} ${mv.dst}' failed: ${r.stderr.trim() || `status ${r.status}`}.\n`
        + `  Moved ${moved.length} of ${plan.moves.length} before this. Review with 'git status' and `
        + `'git reset' to undo the staged renames.\n`,
      );
      return 6;
    }
    moved.push(mv);
  }

  // NOTE on "never half-applied": the PRECONDITIONS (non-git repo, untracked
  // SPEC) are checked above, BEFORE any mutation — that is the all-or-nothing
  // guarantee. Once the git mv's succeed, the index write + the per-file rewrites
  // below are sequential I/O; a rare failure there (disk full, read-only file)
  // leaves the renames staged + some docs rewritten. That residual is fully
  // git-reversible, and the error messages below say so explicitly (we never
  // pretend it was clean — §VI). True multi-file atomicity is out of scope (KISS).

  // c. Write the archive INDEX.md (newest-first; from the pure planner).
  try {
    const indexBody = plan.indexMarkdown.endsWith('\n') ? plan.indexMarkdown : `${plan.indexMarkdown}\n`;
    writeFileSync(path.join(root, ARCHIVE_DIR, INDEX_NAME), indexBody, 'utf8');
  } catch (err) {
    stderr.write(
      `error: cannot write ${ARCHIVE_DIR}/${INDEX_NAME}: ${err.message}\n`
      + `  The ${moved.length} SPEC rename(s) are already STAGED. Undo with 'git reset --hard' `
      + `(or re-run after fixing the cause). Nothing was committed.\n`,
    );
    return 3;
  }

  // d. Rewrite references in tracked markdown OUTSIDE the archive (a moved spec
  //    keeps its bare sibling cross-references — see trackedMarkdownOutsideArchive).
  let filesChanged = 0;
  let refsRewritten = 0;
  for (const rel of trackedMarkdownOutsideArchive(root)) {
    const abs = path.join(root, rel);
    let text;
    try {
      text = readFileSync(abs, 'utf8');
    } catch {
      continue; // unreadable tracked file → skip (honest: we don't fabricate an edit)
    }
    const hits = countReferences(text, plan.referenceRewrites);
    if (hits === 0) continue;
    const rewritten = applyReferenceRewrites(text, plan.referenceRewrites);
    if (rewritten === text) continue;
    try {
      writeFileSync(abs, rewritten, 'utf8');
    } catch (err) {
      stderr.write(
        `error: cannot write rewritten references to ${rel}: ${err.message}\n`
        + `  Partial state: ${moved.length} SPEC(s) moved + ${filesChanged} doc(s) rewritten before this. `
        + `Undo with 'git reset --hard' (nothing was committed).\n`,
      );
      return 3;
    }
    filesChanged += 1;
    refsRewritten += hits;
  }

  // ── Summary (honest counts) ────────────────────────────────────────────────
  stdout.write(
    `Archived ${moved.length} SPEC_V*.md → ${ARCHIVE_DIR}/ (history preserved via git mv)\n`
    + `Wrote ${ARCHIVE_DIR}/${INDEX_NAME} (${specs.length} entr${specs.length === 1 ? 'y' : 'ies'}, newest-first)\n`
    + `Rewrote ${refsRewritten} reference${refsRewritten === 1 ? '' : 's'} `
    + `(SPEC_V0XX.md → ${ARCHIVE_DIR}/SPEC_V0XX.md) across ${filesChanged} file${filesChanged === 1 ? '' : 's'}\n`
    + `Root SPEC sprawl resolved. Changes are staged/working — review and commit them yourself.\n`
    + `Run \`mmd document-review\` to confirm no dangling SPEC references.\n`,
  );
  return 0;
}
