#!/usr/bin/env node
// bin/documentalist/document.js — `mmdream document` entry point (SPEC_V019A).
//
// THE AUTONOMOUS DOCUMENTALIST ORCHESTRATOR. The Documentalist shipped as six
// separate commands (v0.2 → v0.7); the vision (MAKE_MY_DREAMS.md §6.4) was always
// ONE agent. This is that agent: a single `mmdream document` that runs the four
// maintenance hats in one pass and auto-commits the lossless/mechanical work.
//
//   1. met à jour  — refresh HANDOVER State block + README Status/Changelog blocks
//   2. détecte     — write docs/coherence-review.md (drift/conformance dashboard)
//   3. consolide   — archive shipped root SPEC_V*.md → docs/specs/ + rewrite refs
//   4. liens       — report the doc↔code↔ADR coupling for the files changed this pass
//   5. condense    — role-aware conciseness/correction (SPEC_V021A): MOVE surplus
//                    (byte-lossless → linked sibling) + DELETE false/deprecated
//
// SRP (universal §I.S): this file is a THIN COORDINATOR. It SEQUENCES + COMMITS +
// REPORTS only. Every detector/renderer/planner it calls is the existing, tested
// capability — NO detection/render/plan logic is duplicated (SPEC §4.1, DRY §III):
//   - step 1 reuses lib/handover/* + lib/readme-sync/* (the handover/document-readme builders)
//   - step 2 reuses document-review's gatherRealInventory + scanDrift + the lib renderer
//   - step 3 reuses lib/documentalist/compact.js (planCompaction + applyReferenceRewrites)
//   - step 4 reuses document-review's buildSinceCoupling + renderCoupledChanges
//
// AUTO-COMMIT BOUNDARY (SPEC §2 / commit-git §IV.7): only LOSSLESS/MECHANICAL
// changes are committed (regenerable blocks, the dashboard, git mv SPEC archival +
// ref rewrites). NO prose is cut (the risky semantic compaction is the deferred
// v0.21 branch+oracle path). The individual commands keep their never-auto-commit
// promise; `document` is the higher-level agent that commits the lossless work.
//
// THREE CLEAN MODES:
//   default     the fixer — write + auto-commit the lossless changes, print the report
//   --no-commit write the changes, create NO commit (leave them staged/working)
//   --dry-run   preview the whole pass, change NOTHING (clean tree after)
//   --check     the CI/pre-push GATE — run detection, exit 1 on any conformance
//               drift, 0 clean; read-only beyond the dashboards, NO auto-commit
//
// Exit codes (mirror the document-* family + the --check gate contract):
//   0  ok (pass completed, or --check clean)
//   1  --check: a conformance drift finding was detected (gate failed)
//   2  user/argv error
//   4  --check: detection could not run (e.g. roadmap unreadable) — distinct from 5
//   5  not a git repository (--check needs one; archival needs git mv)

import { cwd as processCwd, stdout, stderr } from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

import { runGit } from '../../lib/skills/_common/git.js';
import { parseLessons } from '../../lib/composer/parse-lessons.js';

// Step 1 — mechanical blocks (the SAME builders handover / document-readme use).
import { buildStateBlock } from '../../lib/handover/build-state-block.js';
import { rewriteMarkers, MARKER_START, MARKER_END } from '../../lib/handover/rewrite-markers.js';
import { buildStatusBlock } from '../../lib/readme-sync/build-status-block.js';
import { buildChangelog } from '../../lib/readme-sync/build-changelog.js';
import { STATUS_MARKERS, CHANGELOG_MARKERS } from './document-readme.js';

// Step 2 — coherence dashboard (REUSE document-review's gather + scan + the lib
// renderer; no second detection path).
import {
  gatherRealInventory,
  scanDrift,
  buildSinceCoupling,
  renderCoupledChanges,
  deriveDeprecatedSet,
  REPORT_REL_PATH,
} from './document-review.js';
import { reconcileRoadmap } from '../../lib/documentalist/roadmap-reconcile.js';
import { renderCoherenceReport } from '../../lib/documentalist/coherence-report.js';

// Step 3 — SPEC archival (the pure planner + idempotent rewrite).
import {
  planCompaction,
  applyReferenceRewrites,
  countReferences,
  ARCHIVE_DIR,
} from '../../lib/documentalist/compact.js';

// Step 5 — conciseness/correction: structure assessment + the two actions
// (SPEC_V021A). All pure detection/planning; the I/O (write siblings, rewrite the
// doc, git commit) lives here in the bin.
import { assessDocStructure, inferRole, splitSections } from '../../lib/documentalist/doc-structure.js';
import {
  checkCapabilityClaims,
  checkDeprecatedSurface,
  checkObsoleteForwardClaims,
} from '../../lib/documentalist/conformance.js';
import {
  planExtraction,
  planRemovals,
  CHANGELOG_FILE,
} from '../../lib/documentalist/compact-action.js';

const PKG_PATH = fileURLToPath(new URL('../../package.json', import.meta.url));
let VERSION = '0.0.0';
try {
  VERSION = JSON.parse(readFileSync(PKG_PATH, 'utf8')).version;
} catch {
  // package.json unreadable — version stays a placeholder, never crashes.
}

const INDEX_NAME = 'INDEX.md';
const SPEC_FILE_RE = /^SPEC_V.*\.md$/;

const USAGE = `mmdream document — the autonomous Documentalist orchestrator (SPEC_V019A)

Usage:
  mmdream document [--no-commit]
  mmdream document --check
  mmdream document --dry-run
  mmdream document --help

Behavior:
  ONE autonomous maintenance pass over the whole doc set, reusing the already-built
  capabilities (no detection/render/plan logic re-implemented):

    1. met à jour  refresh HANDOVER.md's State block + README.md's Status + Changelog
                   blocks (mechanical, lossless → auto-committed)
    2. détecte     write the coherence/drift/conformance dashboard to
                   ${REPORT_REL_PATH} (DETECT only — the auto-corrector is v0.20)
    3. consolide   archive shipped root SPEC_V*.md → ${ARCHIVE_DIR}/ with an index
                   and rewritten references (git mv, lossless → auto-committed)
    4. liens       report the doc↔code↔ADR coupling for the files changed this pass
    5. condense    role-aware conciseness/correction (SPEC_V021A): detect structure
                   + capability-lies + deprecated-surface, then MOVE the surplus
                   (true-but-verbose → linked sibling, byte-lossless) and DELETE the
                   high-confidence removable falsehoods/deprecations (precision-first;
                   a non-excisable finding is FLAGGED, never auto-edited)

  Then prints ONE unified, human-readable report: what was committed, the drift
  findings, the coupling. Honest (§VI): a step that found nothing says so; a step
  that hit a wall reports it — never a fabricated success.

  AUTO-COMMIT: only LOSSLESS/mechanical changes are committed (regenerable blocks,
  the dashboard, the SPEC archival). NO prose is cut — the risky semantic
  conciseness pass is the deferred v0.21 branch+oracle work. The 4 maintenance
  commands keep their never-auto-commit promise; mmdream document is the agent
  that commits the lossless work.

Modes:
  (default)    the fixer — write + auto-commit the lossless changes, print the report
  --no-commit  write the changes but create NO commit (leave them staged/working)
  --dry-run    preview the whole pass; change NOTHING (clean tree after)
  --check      CI/pre-push GATE: run detection, exit 1 on any conformance drift,
               0 clean. Read-only beyond the dashboards — NO auto-commit.
  --help, -h   Print this usage and exit 0.

Exit codes:
  0  ok (pass completed, or --check clean)
  1  --check: a conformance drift finding was detected (gate failed)
  2  user/argv error
  4  --check: detection could not run (e.g. roadmap unreadable)
  5  not a git repository

mmdream ${VERSION}
`;

/**
 * Parse the `mmdream document` flags. Boolean-only, mirrors the document-* family
 * contract: unknown flag → exit 2, no positionals. The modes are mutually
 * exclusive where they contradict (a gate that previews + commits is incoherent),
 * rejected up front (error-handling §I — fail fast, never silently pick one).
 *
 * PURE + never throws (AC-5): same args → same parse; odd input → an error object,
 * never a crash.
 *
 * @param {string[]} rawArgs everything AFTER 'document'
 * @returns {{ dryRun: boolean, check: boolean, noCommit: boolean, help: boolean,
 *             error: { message: string, exitCode: number }|null }}
 */
export function parseDocumentArgs(rawArgs) {
  const out = { dryRun: false, check: false, noCommit: false, help: false, error: null };
  if (!Array.isArray(rawArgs)) {
    out.error = { message: 'parseDocumentArgs: rawArgs must be an array', exitCode: 2 };
    return out;
  }
  for (const tok of rawArgs) {
    if (tok === '--dry-run') out.dryRun = true;
    else if (tok === '--check') out.check = true;
    else if (tok === '--no-commit') out.noCommit = true;
    else if (tok === '--help' || tok === '-h') out.help = true;
    else {
      out.error = {
        message: `unknown document arg: '${tok}'. Run 'mmdream document --help' to see supported modes.`,
        exitCode: 2,
      };
      return out;
    }
  }
  // --check is a read-only gate; --dry-run previews-nothing; --no-commit writes
  // without committing. They contradict each other — reject the combination
  // rather than silently picking one (defensive, error-handling §I).
  if (out.check && out.dryRun) {
    out.error = { message: '--check cannot be combined with --dry-run (the gate writes the dashboard it scans).', exitCode: 2 };
    return out;
  }
  if (out.check && out.noCommit) {
    out.error = { message: '--check cannot be combined with --no-commit (--check never commits anyway).', exitCode: 2 };
    return out;
  }
  if (out.dryRun && out.noCommit) {
    out.error = { message: '--dry-run cannot be combined with --no-commit (--dry-run writes nothing).', exitCode: 2 };
    return out;
  }
  return out;
}

/**
 * Run a git command in the repo. Returns { ok, stdout, stderr, status }. Never
 * throws (a spawn error → ok:false with the message). Mirrors document-compact's
 * git helper (DRY — same shape, same contract).
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
 * Is `root` inside a git work tree? The not-a-git-repo oracle for the gate +
 * archival (exit 5). Never throws.
 *
 * @param {string} root
 * @returns {boolean}
 */
function isGitRepo(root) {
  const r = git(root, ['rev-parse', '--is-inside-work-tree']);
  return r.ok && r.stdout.trim() === 'true';
}

/**
 * Stage the given repo-relative paths and commit them with `message` — but ONLY
 * if they actually carry staged changes (an empty commit is noise). Returns a
 * small honest result describing what happened, never throws.
 *
 * @param {string} root
 * @param {string} message conventional, human-readable commit message
 * @param {string[]} files repo-relative paths to stage (may include since-deleted
 *   moves — `git add -A -- <path>` records adds + deletes + modifications)
 * @returns {{ committed: boolean, reason: string|null }}
 *   committed:true  → a commit was created
 *   committed:false → nothing staged (reason: 'nothing to commit') or a git wall
 */
function commitFiles(root, message, files) {
  const real = [...new Set(files.filter((f) => typeof f === 'string' && f.length > 0))];
  if (real.length === 0) return { committed: false, reason: 'nothing to commit' };

  // Stage ONLY the paths that exist on disk. A `git mv` source path no longer
  // exists (its deletion is ALREADY staged), and `git add -A -- <missing>` errors
  // on the unmatched pathspec — so we never feed a gone source to `git add`. The
  // commit below is still scoped to the FULL set (existing + the already-staged
  // rename source), so the rename is captured atomically.
  const onDisk = real.filter((rel) => existsSync(path.join(root, rel)));
  if (onDisk.length > 0) {
    const add = git(root, ['add', '-A', '--', ...onDisk]);
    if (!add.ok) {
      return { committed: false, reason: `git add failed: ${add.stderr.trim() || `status ${add.status}`}` };
    }
  }

  // Are there STAGED changes among these paths? `git diff --cached --quiet` exits
  // 1 when there are staged diffs, 0 when the index matches HEAD. We never create
  // an empty commit (universal §VI — an honest "nothing to commit").
  const staged = git(root, ['diff', '--cached', '--quiet', '--', ...real]);
  if (staged.ok) {
    // exit 0 → no staged changes for these paths.
    return { committed: false, reason: 'nothing to commit' };
  }

  const commit = git(root, ['commit', '-m', message, '--', ...real]);
  if (!commit.ok) {
    return { committed: false, reason: `git commit failed: ${commit.stderr.trim() || `status ${commit.status}`}` };
  }
  return { committed: true, reason: null };
}

// ── Step 1 — mechanical blocks ──────────────────────────────────────────────

/**
 * Refresh HANDOVER.md's State block (the SAME builder + rewriter `mmdream handover`
 * uses — no second derivation). Returns an honest per-file outcome.
 *
 * @param {string} root
 * @param {boolean} write actually write the file (false for --dry-run preview)
 * @returns {Promise<{ status: 'refreshed'|'unchanged'|'wall', detail: string, file: string|null }>}
 */
async function refreshHandover(root, write) {
  const handoverPath = path.join(root, 'HANDOVER.md');
  let block;
  try {
    block = await buildStateBlock({
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
      tests: null, // honest placeholder — document never invents a test count
    });
  } catch (err) {
    return { status: 'wall', detail: `cannot build State block: ${err.message}`, file: null };
  }

  let fileText;
  try {
    fileText = readFileSync(handoverPath, 'utf8');
  } catch (err) {
    return { status: 'wall', detail: `HANDOVER.md unreadable (${err.code || err.message})`, file: null };
  }

  const result = rewriteMarkers(fileText, block, { start: MARKER_START, end: MARKER_END });
  if (!result.ok) {
    return {
      status: 'wall',
      detail: `HANDOVER.md is missing the state marker(s): ${result.missing.join(', ')}`,
      file: null,
    };
  }
  if (result.text === fileText) {
    return { status: 'unchanged', detail: 'already up to date', file: null };
  }
  if (write) {
    try {
      writeFileSync(handoverPath, result.text, 'utf8');
    } catch (err) {
      return { status: 'wall', detail: `cannot write HANDOVER.md: ${err.message}`, file: null };
    }
  }
  return { status: 'refreshed', detail: 'State block refreshed', file: 'HANDOVER.md' };
}

/**
 * Refresh README.md's Status + Changelog blocks (the SAME builders + markers
 * `mmdream document-readme` uses). Returns per-block honest outcomes.
 *
 * @param {string} root
 * @param {boolean} write
 * @returns {Promise<{ status: object, changelog: object, file: string|null }>}
 *   each inner outcome: { status: 'refreshed'|'unchanged'|'wall', detail }
 */
async function refreshReadme(root, write) {
  const readmePath = path.join(root, 'README.md');
  const fail = (detail) => ({
    status: { status: 'wall', detail },
    changelog: { status: 'wall', detail },
    file: null,
  });

  let statusBlock;
  let changelogBlock;
  try {
    statusBlock = await buildStatusBlock({
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
      tests: null, // honest placeholder — never invents a test count
    });
    changelogBlock = await buildChangelog({ runGit, repoRoot: root });
  } catch (err) {
    return fail(`cannot build README blocks: ${err.message}`);
  }

  let fileText;
  try {
    fileText = readFileSync(readmePath, 'utf8');
  } catch (err) {
    return fail(`README.md unreadable (${err.code || err.message})`);
  }

  const statusRes = rewriteMarkers(fileText, statusBlock, STATUS_MARKERS);
  if (!statusRes.ok) {
    return {
      status: { status: 'wall', detail: `missing the Status marker(s): ${statusRes.missing.join(', ')}` },
      changelog: { status: 'wall', detail: 'skipped (Status marker missing)' },
      file: null,
    };
  }
  const changelogRes = rewriteMarkers(statusRes.text, changelogBlock, CHANGELOG_MARKERS);
  // SPEC_V021A §4 — the refresh FOLLOWS THE MARKER. Once Step 5 has relocated the
  // changelog markers + content to CHANGELOG.md, README no longer carries them, so
  // the in-README changelog rewrite returns ok:false. That is NOT a wall — the
  // changelog now lives in CHANGELOG.md and is refreshed THERE (the changelog is
  // maintained at its new location, the README keeps only the link).
  let changelogFollowFile = null;
  let changelogOutcome;
  if (!changelogRes.ok) {
    const followed = refreshRelocatedChangelog(root, changelogBlock, write);
    if (followed.found) {
      changelogOutcome = followed.outcome;
      changelogFollowFile = followed.file; // CHANGELOG.md when it actually changed
    } else {
      // The markers are in neither README nor CHANGELOG.md — a genuine wall.
      changelogOutcome = { status: 'wall', detail: `missing the Changelog marker(s): ${changelogRes.missing.join(', ')}` };
    }
    // Status may still have changed; write README with the Status rewrite only.
    const statusOnly = statusRes.text;
    const statusChangedOnly = statusOnly !== fileText;
    if (statusChangedOnly && write) {
      try {
        writeFileSync(readmePath, statusOnly, 'utf8');
      } catch (err) {
        return fail(`cannot write README.md: ${err.message}`);
      }
    }
    return {
      status: statusChangedOnly
        ? { status: 'refreshed', detail: 'Status block refreshed' }
        : { status: 'unchanged', detail: 'already up to date' },
      changelog: changelogOutcome,
      file: statusChangedOnly ? 'README.md' : null,
      changelogFile: changelogFollowFile,
    };
  }

  const finalText = changelogRes.text;
  const statusChanged = statusRes.text !== fileText;
  const changelogChanged = changelogRes.text !== statusRes.text;

  if (finalText !== fileText && write) {
    try {
      writeFileSync(readmePath, finalText, 'utf8');
    } catch (err) {
      return fail(`cannot write README.md: ${err.message}`);
    }
  }
  return {
    status: statusChanged
      ? { status: 'refreshed', detail: 'Status block refreshed' }
      : { status: 'unchanged', detail: 'already up to date' },
    changelog: changelogChanged
      ? { status: 'refreshed', detail: 'Changelog block refreshed' }
      : { status: 'unchanged', detail: 'already up to date' },
    file: finalText !== fileText ? 'README.md' : null,
    changelogFile: null,
  };
}

/**
 * Refresh the changelog block at its RELOCATED home (CHANGELOG.md) once Step 5 has
 * moved the markers there (SPEC_V021A §4 — the refresh follows the marker). Never
 * throws: a missing/marker-less CHANGELOG.md → { found:false }.
 *
 * @param {string} root
 * @param {string} changelogBlock the freshly-built changelog content
 * @param {boolean} write
 * @returns {{ found: boolean, outcome?: object, file?: string|null }}
 */
function refreshRelocatedChangelog(root, changelogBlock, write) {
  const clPath = path.join(root, CHANGELOG_FILE);
  let text;
  try {
    text = readFileSync(clPath, 'utf8');
  } catch {
    return { found: false };
  }
  if (!text.includes(CHANGELOG_MARKERS.start) || !text.includes(CHANGELOG_MARKERS.end)) {
    return { found: false };
  }
  const res = rewriteMarkers(text, changelogBlock, CHANGELOG_MARKERS);
  if (!res.ok) return { found: false };
  if (res.text === text) {
    return { found: true, outcome: { status: 'unchanged', detail: 'already up to date (in CHANGELOG.md)' }, file: null };
  }
  if (write) {
    try {
      writeFileSync(clPath, res.text, 'utf8');
    } catch (err) {
      return { found: true, outcome: { status: 'wall', detail: `cannot write ${CHANGELOG_FILE}: ${err.message}` }, file: null };
    }
  }
  return { found: true, outcome: { status: 'refreshed', detail: 'Changelog block refreshed (in CHANGELOG.md)' }, file: CHANGELOG_FILE };
}

// ── Step 2 — coherence dashboard ────────────────────────────────────────────

/**
 * Run the detection + write the coherence dashboard (REUSE document-review's
 * gatherRealInventory + scanDrift + the lib reconcile/render — no second path).
 *
 * @param {string} root
 * @param {boolean} write actually write docs/coherence-review.md (false → preview)
 * @returns {{ written: boolean, driftTotal: number, drift: object, file: string|null, wall: string|null }}
 */
function runDashboard(root, write) {
  let roadmapText;
  try {
    roadmapText = readFileSync(path.join(root, 'MAKE_MY_DREAMS.md'), 'utf8');
  } catch (err) {
    return {
      written: false, driftTotal: 0,
      drift: { dangling: [], staleFacts: [], deprecated: [], stalePromises: [] },
      file: null,
      wall: `MAKE_MY_DREAMS.md unreadable (${err.code || err.message}) — no roadmap to reconcile`,
    };
  }

  const inventory = gatherRealInventory(root);
  const reconciliation = reconcileRoadmap({ roadmapText, inventory });
  const {
    dangling, staleFacts, deprecated, stalePromises, scannedDocs, scannedUx,
  } = scanDrift(root, inventory);

  const drift = {
    dangling, staleFacts, deprecated, stalePromises, scannedDocs, scannedUx,
    semantic: { requested: false, text: null, note: null },
  };
  const report = renderCoherenceReport({
    inventory,
    reconciliation,
    llm: { requested: false, enrichment: null, note: null },
    drift,
    version: VERSION,
  });

  const driftTotal = dangling.length + staleFacts.length + deprecated.length + stalePromises.length;

  let written = false;
  if (write) {
    try {
      writeFileSync(path.join(root, REPORT_REL_PATH), report, 'utf8');
      written = true;
    } catch (err) {
      return { written: false, driftTotal, drift, file: null, wall: `cannot write ${REPORT_REL_PATH}: ${err.message}` };
    }
  }
  return { written, driftTotal, drift, inventory, file: written ? REPORT_REL_PATH : null, wall: null };
}

// ── Step 3 — SPEC archival ──────────────────────────────────────────────────

/** The first markdown H1 line of a SPEC (its title line), or '' when absent. */
function firstTitleLine(text) {
  if (typeof text !== 'string') return '';
  for (const line of text.split('\n')) {
    if (/^#\s+/.test(line)) return line.trim();
  }
  return '';
}

/** List SPEC_V*.md files directly in a directory (root or archive). Never throws. */
function listSpecFiles(root, rel) {
  try {
    return readdirSync(path.join(root, rel))
      .filter((n) => typeof n === 'string' && SPEC_FILE_RE.test(n))
      .sort();
  } catch {
    return [];
  }
}

function readSpec(root, rel, name) {
  let text = '';
  try {
    text = readFileSync(path.join(root, rel, name), 'utf8');
  } catch {
    text = '';
  }
  return { name, title: firstTitleLine(text) };
}

/** Tracked markdown OUTSIDE the archive — the docs whose refs must be rewritten. */
function trackedMarkdownOutsideArchive(root) {
  const mdList = git(root, ['ls-files', '-z', '*.md']);
  return (mdList.ok ? mdList.stdout.split('\0').map((s) => s.trim()).filter(Boolean) : [])
    .filter((rel) => !rel.startsWith(`${ARCHIVE_DIR}/`));
}

/**
 * Archive shipped root SPEC_V*.md → docs/specs/ (REUSE the pure planner +
 * idempotent rewrite + git mv — same logic as `mmdream document-compact`, no
 * second planner). Lossless + idempotent: no root SPECs → a clean no-op.
 *
 * In preview mode (write:false) it computes the plan + counts the reference
 * rewrites but moves/writes NOTHING (so --dry-run leaves a clean tree).
 *
 * @param {string} root
 * @param {boolean} write
 * @returns {{ moved: number, refsRewritten: number, filesChanged: number,
 *             changedFiles: string[], wall: string|null }}
 */
function runArchival(root, write) {
  const rootSpecNames = listSpecFiles(root, '');
  const archivedNames = listSpecFiles(root, ARCHIVE_DIR);
  const specs = [
    ...rootSpecNames.map((n) => readSpec(root, '', n)),
    ...archivedNames.map((n) => readSpec(root, ARCHIVE_DIR, n)),
  ];
  const plan = planCompaction({ specs, existingArchive: archivedNames });

  // Idempotent no-op: nothing at root to archive.
  if (plan.moves.length === 0) {
    return { moved: 0, refsRewritten: 0, filesChanged: 0, changedFiles: [], wall: null };
  }

  // ── Preview (write:false): count the blast radius, change nothing. ──────────
  if (!write) {
    let refs = 0;
    let files = 0;
    for (const rel of trackedMarkdownOutsideArchive(root)) {
      let text;
      try {
        text = readFileSync(path.join(root, rel), 'utf8');
      } catch {
        continue;
      }
      const hits = countReferences(text, plan.referenceRewrites);
      if (hits > 0) { refs += hits; files += 1; }
    }
    return { moved: plan.moves.length, refsRewritten: refs, filesChanged: files, changedFiles: [], wall: null };
  }

  // ── Execute (lossless, all-or-nothing preconditions). ───────────────────────
  // Every SPEC to move must be git-tracked (git mv fails on an untracked file).
  const tracked = git(root, ['ls-files', '-z']);
  const trackedSet = new Set(
    tracked.ok ? tracked.stdout.split('\0').map((s) => s.trim()).filter(Boolean) : [],
  );
  const untracked = plan.moves.map((m) => m.src).filter((src) => !trackedSet.has(src));
  if (untracked.length > 0) {
    return {
      moved: 0, refsRewritten: 0, filesChanged: 0, changedFiles: [],
      wall: `these root SPEC(s) are not git-tracked, so 'git mv' cannot preserve history: ${untracked.join(', ')} (skipped archival)`,
    };
  }

  try {
    mkdirSync(path.join(root, ARCHIVE_DIR), { recursive: true });
  } catch (err) {
    return { moved: 0, refsRewritten: 0, filesChanged: 0, changedFiles: [], wall: `cannot create ${ARCHIVE_DIR}/: ${err.message}` };
  }

  const changedFiles = [];
  const moved = [];
  for (const mv of plan.moves) {
    const r = git(root, ['mv', mv.src, mv.dst]);
    if (!r.ok) {
      return {
        moved: moved.length, refsRewritten: 0, filesChanged: 0, changedFiles,
        wall: `'git mv ${mv.src} ${mv.dst}' failed: ${r.stderr.trim() || `status ${r.status}`} (moved ${moved.length} of ${plan.moves.length})`,
      };
    }
    moved.push(mv);
    changedFiles.push(mv.src, mv.dst);
  }

  // Index.
  try {
    const indexBody = plan.indexMarkdown.endsWith('\n') ? plan.indexMarkdown : `${plan.indexMarkdown}\n`;
    const indexPath = path.join(ARCHIVE_DIR, INDEX_NAME);
    writeFileSync(path.join(root, indexPath), indexBody, 'utf8');
    changedFiles.push(indexPath);
  } catch (err) {
    return {
      moved: moved.length, refsRewritten: 0, filesChanged: 0, changedFiles,
      wall: `cannot write ${ARCHIVE_DIR}/${INDEX_NAME}: ${err.message} (renames staged)`,
    };
  }

  // Reference rewrites.
  let filesChanged = 0;
  let refsRewritten = 0;
  for (const rel of trackedMarkdownOutsideArchive(root)) {
    const abs = path.join(root, rel);
    let text;
    try {
      text = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const hits = countReferences(text, plan.referenceRewrites);
    if (hits === 0) continue;
    const rewritten = applyReferenceRewrites(text, plan.referenceRewrites);
    if (rewritten === text) continue;
    try {
      writeFileSync(abs, rewritten, 'utf8');
    } catch (err) {
      return {
        moved: moved.length, refsRewritten, filesChanged, changedFiles,
        wall: `cannot write rewritten references to ${rel}: ${err.message}`,
      };
    }
    filesChanged += 1;
    refsRewritten += hits;
    changedFiles.push(rel);
  }

  return { moved: moved.length, refsRewritten, filesChanged, changedFiles, wall: null };
}

// ── Step 5 — conciseness / correction (SPEC_V021A) ──────────────────────────

// v0.21 scope: only README.md targeted for conciseness (§VIII generalization to
// any concise-role markdown doc in any repo is deferred to a later slice). README
// is the live target; KISS — one doc, explicit (F2).
const CONCISE_DOCS = ['README.md'];

/**
 * Run the conciseness / correction pass over the concise-role docs (SPEC_V021A
 * AC-5): detect (structure + capability-lies + deprecated-surface), then ACT —
 * MOVE the surplus (byte-lossless) + DELETE the high-confidence removable
 * falsehoods/deprecations, role-aware, precision-first. Pure detection + the I/O
 * here; the planners decide, this applies.
 *
 * @param {string} root
 * @param {boolean} write actually write/commit (false for --dry-run / --check preview)
 * @returns {{
 *   findings: { capability: object[], deprecated: object[], structure: object[] },
 *   moves: Array<{ doc: string, heading: string, dst: string, isChangelog: boolean }>,
 *   removed: Array<{ doc: string, line: number, mode: string, what: string }>,
 *   flagged: Array<object>,
 *   changedFiles: string[],
 *   beforeAfter: Array<{ doc: string, before: number, after: number }>,
 *   wall: string|null,
 * }}
 */
function runConciseness(root, write, opts = {}) {
  const result = {
    findings: { capability: [], deprecated: [], obsoleteForward: [], structure: [] },
    moves: [], removed: [], flagged: [], changedFiles: [], beforeAfter: [], wall: null,
  };

  // Roadmap text for the capability-lie corroboration (reuse the dashboard's read).
  let roadmapText = null;
  try {
    roadmapText = readFileSync(path.join(root, 'MAKE_MY_DREAMS.md'), 'utf8');
  } catch {
    roadmapText = null; // capability-lie still fires on the curated trigger.
  }
  const inventory = opts.inventory || gatherRealInventory(root);
  const derivedCommands = deriveDeprecatedSet(root);

  for (const docRel of CONCISE_DOCS) {
    const docPath = path.join(root, docRel);
    let docText;
    try {
      docText = readFileSync(docPath, 'utf8');
    } catch {
      continue; // doc absent → nothing to condense (honest skip).
    }
    const role = inferRole(docRel);
    if (role === 'reference') continue; // never condense a reference doc.

    const beforeLines = docText.split('\n').length;

    // ── DETECT ────────────────────────────────────────────────────────────────
    const structure = assessDocStructure({ docPath: docRel, docText });
    const capability = checkCapabilityClaims({ docText, doc: docRel, roadmap: roadmapText, inventory });
    const deprecated = checkDeprecatedSurface([{ path: docRel, text: docText }], { derivedCommands });
    // SPEC_V022A AC-1: obsolete forward-looking narrative (a "next: X" of an
    // already-built capability / past version). Same detect→act split.
    const obsoleteForward = checkObsoleteForwardClaims({
      docText, doc: docRel, roadmap: roadmapText, inventory, currentVersion: VERSION,
    });
    result.findings.structure.push({ doc: docRel, ...structure });
    result.findings.capability.push(...capability);
    result.findings.deprecated.push(...deprecated);
    result.findings.obsoleteForward.push(...obsoleteForward);

    // --check / --dry-run never mutate the doc here — detection only.
    if (!write) {
      result.beforeAfter.push({ doc: docRel, before: beforeLines, after: beforeLines });
      continue;
    }

    let newText = docText;

    // ── ACT 1: MOVE the surplus (only if over budget) ──────────────────────────
    // The sections to extract = the oversized ones PLUS, when the doc IS over
    // budget, the known NARRATIVE sections that read as surplus on a concise
    // LANDING doc: the genuine changelog (→ CHANGELOG.md, identified by its marker /
    // heading) and the prose History narrative (→ docs/<stem>-history.md). A
    // landing doc is a quick-start surface; the long-form story + the release list
    // live in siblings (SPEC §4 + AC-6 — History & changelog explicitly relocated).
    // NOTE: this relocation only happens when `structure.overBudget` (the whole
    // MOVE pass below is gated on it); a within-budget doc keeps its changelog +
    // History inline unchanged (SPEC AC-4 requires an over-budget concise doc).
    const sectionsToMove = [...structure.oversizedSections];
    if (structure.overBudget) {
      const docLines = newText.split('\n');
      for (const s of splitSections(newText)) {
        // The REAL changelog marker is the HTML-comment START tag, NOT a bare
        // 'mmd:readme:changelog' substring (which appears in PROSE describing the
        // markers — matching it would misroute Usage to CHANGELOG.md, the v0.21-v1 bug).
        const isChangelog = /^changelog$/i.test(s.heading.trim())
          || docLines.slice(s.startLine - 1, s.endLine).join('\n').includes('<!-- mmd:readme:changelog:start -->');
        const isHistory = /^history$/i.test(s.heading.trim());
        if ((isChangelog || isHistory)
          && !sectionsToMove.some((m) => m.heading.trim() === s.heading.trim())) {
          sectionsToMove.push(s);
        }
      }
    }
    if (structure.overBudget && sectionsToMove.length > 0) {
      const plan = planExtraction({
        docPath: docRel, docText: newText, role,
        sections: sectionsToMove,
      });
      for (const mv of plan.moves) {
        const dstAbs = path.join(root, mv.dst);
        try {
          // CHANGELOG.md special-case: the moved content already carries the
          // freshly-refreshed changelog markers + lines (Step 1 ran first), so
          // writing it to CHANGELOG.md regenerates the changelog AT its new
          // location (SPEC §4 — the refresh follows the marker).
          mkdirSync(path.dirname(dstAbs), { recursive: true });
          const body = mv.content.endsWith('\n') ? mv.content : `${mv.content}\n`;
          writeFileSync(dstAbs, body, 'utf8');
          result.changedFiles.push(mv.dst);
          result.moves.push({ doc: docRel, heading: mv.heading, dst: mv.dst, isChangelog: mv.isChangelog });
        } catch (err) {
          result.wall = `cannot write ${mv.dst}: ${err.message}`;
        }
      }
      newText = plan.newDocText;
    }

    // ── ACT 2: DELETE the high-confidence removable falsehoods/deprecations ─────
    // Re-detect on the (possibly shortened) text so line numbers are current after
    // the MOVE rewrote the doc.
    const capAfter = checkCapabilityClaims({ docText: newText, doc: docRel, roadmap: roadmapText, inventory });
    const depAfter = checkDeprecatedSurface([{ path: docRel, text: newText }], { derivedCommands });
    const fwdAfter = checkObsoleteForwardClaims({
      docText: newText, doc: docRel, roadmap: roadmapText, inventory, currentVersion: VERSION,
    });
    const removalFindings = [...capAfter, ...depAfter, ...fwdAfter];
    const removalPlan = planRemovals({ docText: newText, findings: removalFindings });
    for (const rm of removalPlan.removals) result.removed.push({ doc: docRel, ...rm });
    result.flagged.push(...removalPlan.flagged.map((f) => ({ doc: docRel, ...f })));
    newText = removalPlan.newDocText;

    // Write the condensed doc if it changed.
    if (newText !== docText) {
      try {
        writeFileSync(docPath, newText, 'utf8');
        result.changedFiles.push(docRel);
      } catch (err) {
        result.wall = `cannot write ${docRel}: ${err.message}`;
      }
    }
    result.beforeAfter.push({ doc: docRel, before: beforeLines, after: newText.split('\n').length });
  }

  return result;
}

// ── Report assembly (pure) ──────────────────────────────────────────────────

const SEP = '═'.repeat(58);

/**
 * Assemble the unified report (AC-3 / SPEC §1.3). PURE — outcomes in, the
 * human-readable text out (universal §VII — lead with prose). Never throws.
 *
 * @param {{
 *   mode: 'default'|'no-commit'|'dry-run'|'check',
 *   handover: object, readme: object, blocksCommit: object|null,
 *   dashboard: object,
 *   archival: object, archivalCommit: object|null,
 *   coupling: string,
 * }} parts
 * @returns {string}
 */
export function buildDocumentReport(parts) {
  const {
    mode, handover, readme, blocksCommit, dashboard, archival, archivalCommit,
    conciseness, concisenessCommit, coupling,
  } = parts;
  const lines = [];
  lines.push(`mmdream document — autonomous Documentalist pass (v${VERSION})`);
  lines.push(SEP);
  lines.push('');

  // Step 1.
  lines.push('Step 1 — Mechanical blocks refreshed');
  lines.push(`  HANDOVER.md state block: ${blockLine(handover)}`);
  lines.push(`  README.md status block: ${blockLine(readme.status)}`);
  lines.push(`  README.md changelog block: ${blockLine(readme.changelog)}`);

  // Step 2.
  lines.push('');
  lines.push('Step 2 — Coherence drift dashboard');
  if (dashboard.wall) {
    lines.push(`  wall: ${dashboard.wall}`);
  } else {
    lines.push(`  ${REPORT_REL_PATH} ${mode === 'dry-run' ? 'preview (not written)' : 'written'}`);
    const d = dashboard.drift;
    if (dashboard.driftTotal === 0) {
      lines.push('  Drift: clean — no conformance drift found.');
    } else {
      lines.push(
        `  Drift: ${d.dangling.length} dangling · ${d.staleFacts.length} stale facts · ` +
        `${d.deprecated.length} deprecated-surface · ${d.stalePromises.length} stale promises`,
      );
    }
  }
  // Steps 1+2 share one commit (the lossless block + dashboard refresh). Whether
  // anything actually changed this pass (for the honest --no-commit line, F7): a
  // block was refreshed OR the dashboard was (re)written (dashboard.file is the
  // written path, null when not written, e.g. under --dry-run/--check).
  const blocksChanged = Boolean(handover.file || readme.file || readme.changelogFile || dashboard.file);
  lines.push(`  → ${commitLine(mode, blocksCommit, 'docs(document): refresh mechanical blocks and coherence dashboard', blocksChanged)}`);

  // Step 3.
  lines.push('');
  lines.push('Step 3 — SPEC archival');
  if (archival.wall) {
    lines.push(`  wall: ${archival.wall}`);
  } else if (archival.moved === 0 && mode === 'check') {
    // --check is a read-only gate, so archival is deliberately NOT run. Saying
    // "no root SPEC_V*.md found" here would be a §VI honesty bug — root SPECs may
    // well exist; they are simply skipped because --check never mutates the tree.
    lines.push('  SPEC archival skipped (--check is a read-only gate).');
  } else if (archival.moved === 0) {
    lines.push('  no root SPEC_V*.md found — nothing to archive.');
  } else if (mode === 'dry-run') {
    lines.push(
      `  would archive ${archival.moved} root SPEC_V*.md → ${ARCHIVE_DIR}/ ` +
      `(rewrite ${archival.refsRewritten} reference${archival.refsRewritten === 1 ? '' : 's'} across ${archival.filesChanged} file${archival.filesChanged === 1 ? '' : 's'})`,
    );
  } else {
    lines.push(
      `  ${archival.moved} root SPEC_V*.md archived → ${ARCHIVE_DIR}/ ` +
      `(rewrote ${archival.refsRewritten} reference${archival.refsRewritten === 1 ? '' : 's'} across ${archival.filesChanged} file${archival.filesChanged === 1 ? '' : 's'})`,
    );
  }
  if (archival.moved > 0 && !archival.wall) {
    // archival.moved > 0 here, so SPECs really were archived → the tree changed.
    lines.push(`  → ${commitLine(mode, archivalCommit, `docs(document): archive ${archival.moved} shipped SPEC${archival.moved === 1 ? '' : 's'} into ${ARCHIVE_DIR}/`, true)}`);
  }

  // Step 5 — conciseness / correction (SPEC_V021A).
  lines.push('');
  lines.push('Step 5 — Conciseness / correction (role-aware: move surplus, delete false/deprecated)');
  if (conciseness) {
    renderConciseness(lines, mode, conciseness, concisenessCommit);
  } else {
    lines.push('  (not run)');
  }

  // Step 4.
  lines.push('');
  lines.push('Step 4 — Doc↔code↔ADR coupling (files changed this pass)');
  lines.push(indent(coupling, '  '));

  // Summary.
  lines.push('');
  const commits = countCommits(blocksCommit, archivalCommit, concisenessCommit);
  // All 5 steps are always ATTEMPTED; a step that hit a wall is reported per-step
  // above (its `wall` line). "steps run" is honest where "steps completed" would
  // overclaim when a step walled (F5 — §VI: don't imply success a step didn't have).
  const stepsRun = 5;
  const walls = countWalls(handover, readme, dashboard, archival, conciseness);
  const driftN = dashboard.wall ? 0 : dashboard.driftTotal;
  lines.push(
    `Summary: ${stepsRun} steps run${walls > 0 ? ` (${walls} hit a wall — see above)` : ''}, ` +
    `${commits} auto-commit${commits === 1 ? '' : 's'}, ${driftN} drift finding${driftN === 1 ? '' : 's'}.`,
  );
  return lines.join('\n');
}

/**
 * Render the Step 5 conciseness/correction outcome (SPEC_V021A AC-5). Honest per
 * mode + per finding (universal §VI/§VII): what was detected, moved, removed, and
 * what was FLAGGED for human review (never auto-edited). Pure.
 *
 * @param {string[]} lines the accumulating report lines (mutated)
 * @param {string} mode
 * @param {object} c the runConciseness result
 * @param {object|null} commit the conciseness commitFiles result (default mode)
 */
function renderConciseness(lines, mode, c, commit) {
  if (c.wall) {
    lines.push(`  wall: ${c.wall}`);
  }
  // Detection summary (always shown — it is the value even when nothing acted).
  const capList = Array.isArray(c.findings.capability) ? c.findings.capability : [];
  const depList = Array.isArray(c.findings.deprecated) ? c.findings.deprecated : [];
  const fwdList = Array.isArray(c.findings.obsoleteForward) ? c.findings.obsoleteForward : [];
  const capN = capList.length;
  const depN = depList.length;
  const fwdN = fwdList.length;
  const overBudget = (Array.isArray(c.findings.structure) ? c.findings.structure : []).filter((s) => s.overBudget);
  if (overBudget.length > 0) {
    for (const s of overBudget) {
      lines.push(`  ${s.doc}: ${s.lineCount} lines (budget ${s.budget}) — over budget, ${s.oversizedSections.length} oversized section${s.oversizedSections.length === 1 ? '' : 's'}${s.changelogInline ? ', changelog inline' : ''}`);
    }
  } else {
    lines.push('  structure: all concise docs within budget.');
  }
  lines.push(`  detected: ${capN} capability-lie${capN === 1 ? '' : 's'} · ${depN} deprecated-as-primary mention${depN === 1 ? '' : 's'} · ${fwdN} obsolete forward-looking claim${fwdN === 1 ? '' : 's'}`);
  // SPEC_V022A: name each obsolete forward-looking finding (it is the headline new
  // detection — show it explicitly, not just a count). Honest, human-readable §VII.
  if (fwdN > 0) {
    for (const f of fwdList.slice(0, 10)) {
      lines.push(`    - OBSOLETE FORWARD: ${f.doc}:${f.line} — ${f.reason}${f.removable ? '' : ' (flagged; rewrite is semantic, deferred)'}`);
    }
    if (fwdN > 10) lines.push(`    … +${fwdN - 10} more`);
  }

  if (mode === 'dry-run' || mode === 'check') {
    // Detection-only modes: no MOVE/DELETE applied.
    lines.push(`  (${mode}: detection only — no move/delete applied)`);
    return;
  }

  // Actions taken.
  if (c.moves.length > 0) {
    for (const mv of c.moves) {
      lines.push(`  MOVED: ${mv.doc} § "${mv.heading}" → ${mv.dst}${mv.isChangelog ? ' (changelog)' : ''}`);
    }
  } else {
    lines.push('  no surplus sections to move.');
  }
  if (c.removed.length > 0) {
    for (const rm of c.removed) {
      lines.push(`  REMOVED (${rm.mode}): ${rm.doc}:${rm.line} — ${rm.what}`);
    }
  } else {
    lines.push('  no false/deprecated surface removed.');
  }
  // Flagged (non-removable) — reported, NEVER auto-edited (precision-first §VI).
  const realFlagged = c.flagged.filter((f) => f && (f.confidence === 'high'));
  if (realFlagged.length > 0) {
    lines.push(`  FLAGGED for review (not auto-edited): ${realFlagged.length}`);
    for (const f of realFlagged.slice(0, 10)) {
      lines.push(`    - ${f.doc}:${f.line} — ${f.capability || f.token || f.reason || 'finding'} (not cleanly excisable)`);
    }
    if (realFlagged.length > 10) lines.push(`    … +${realFlagged.length - 10} more`);
  }
  for (const ba of c.beforeAfter) {
    if (ba.before !== ba.after) lines.push(`  ${ba.doc}: ${ba.before} → ${ba.after} lines`);
  }
  lines.push(`  → ${commitLine(mode, commit, 'docs(document): condense concise docs', c.changedFiles.length > 0)}`);
}

/** One step's block outcome → a human phrase. */
function blockLine(o) {
  if (!o) return 'nothing changed';
  if (o.status === 'refreshed') return 'refreshed';
  if (o.status === 'unchanged') return 'nothing changed';
  return `wall: ${o.detail}`;
}

/**
 * The "→ committed: …" line, honest per mode (universal §VI/§VII).
 *
 * @param {string} mode
 * @param {object|null} commit the commitFiles result (default mode only)
 * @param {string} message the conventional commit message
 * @param {boolean} [changed] did this step actually produce a change? Used to keep
 *   the --no-commit line honest (F7): "nothing to commit" when nothing changed,
 *   rather than implying changes are sitting in the working tree.
 */
function commitLine(mode, commit, message, changed = true) {
  if (mode === 'dry-run') return 'preview only (--dry-run: nothing committed)';
  if (mode === 'check') return 'not committed (--check is a read-only gate)';
  if (mode === 'no-commit') {
    return changed
      ? 'not committed (--no-commit: changes left in the working tree)'
      : 'nothing to commit';
  }
  if (!commit) return 'nothing to commit';
  if (commit.committed) return `committed: "${message}"`;
  if (commit.reason === 'nothing to commit') return 'nothing to commit';
  return `NOT committed — ${commit.reason}`;
}

function countCommits(...commits) {
  return commits.filter((c) => c && c.committed).length;
}

/**
 * Count how many of the five steps hit a wall, tolerant of each step's distinct
 * outcome shape (handover/dashboard/archival/conciseness carry a wall flag;
 * README carries per-block statuses). Used for the honest summary line (F5).
 * Never throws.
 *
 * @param {object} handover refreshHandover outcome ({ status })
 * @param {object} readme refreshReadme outcome ({ status:{status}, changelog:{status} })
 * @param {object} dashboard runDashboard outcome ({ wall })
 * @param {object} archival runArchival outcome ({ wall })
 * @param {object} conciseness runConciseness outcome ({ wall })
 * @returns {number}
 */
function countWalls(handover, readme, dashboard, archival, conciseness) {
  let n = 0;
  if (handover && handover.status === 'wall') n += 1;
  if (readme && ((readme.status && readme.status.status === 'wall')
    || (readme.changelog && readme.changelog.status === 'wall'))) n += 1;
  if (dashboard && dashboard.wall) n += 1;
  if (archival && archival.wall) n += 1;
  if (conciseness && conciseness.wall) n += 1;
  return n;
}

/** Indent every line of `text` by `pad`. */
function indent(text, pad) {
  return String(text).split('\n').map((l) => (l.length ? pad + l : l)).join('\n');
}

/**
 * Compute the coupling report for the files changed this pass (REUSE
 * buildSinceCoupling + renderCoupledChanges — the document-review --since logic).
 * The "ref" the diff is conceptually against is HEAD before this pass; we feed the
 * explicit changed-file set rather than a git diff, so the report names exactly
 * what the orchestrator touched.
 *
 * @param {string} root
 * @param {string[]} changedFiles repo-relative files written/moved this pass
 * @param {object} inventory the live inventory (ADR resolution)
 * @returns {string}
 */
function couplingReport(root, changedFiles, inventory) {
  const unique = [...new Set(changedFiles.filter((f) => typeof f === 'string' && f.length > 0))];
  if (unique.length === 0) {
    return 'No files changed this pass — nothing to couple.';
  }
  const tracked = git(root, ['ls-files']);
  const trackedList = tracked.ok
    ? tracked.stdout.split('\n').map((s) => s.trim()).filter(Boolean)
    : [];
  // A file just archived (git mv'd) leaves its old path no longer tracked; couple
  // only the files that are real graph nodes (tracked), which is the honest set.
  const inv = inventory || gatherRealInventory(root);
  const { coupling, unanalyzedLangs } = buildSinceCoupling(root, unique, trackedList, inv);
  return renderCoupledChanges('this pass', coupling, unanalyzedLangs);
}

/**
 * Entry point invoked by bin/mmd.js when argv[0] === 'document'.
 *
 * @param {string[]} rawArgs everything AFTER 'document'
 * @returns {Promise<number>} exit code
 */
export async function runDocument(rawArgs) {
  const parsed = parseDocumentArgs(rawArgs);
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

  // The gate + archival both need a git repo. Honest exit 5 (mirrors the
  // document-* / secret-scan / deps-gate contract). The dashboard alone degrades
  // gracefully outside a repo, but the orchestrator's whole job (commit lossless
  // work, git mv SPECs) is git-bound, so we require it for every mode.
  if (!isGitRepo(root)) {
    stderr.write(
      `error: ${root} is not a git repository.\n` +
      '  mmdream document refreshes + archives + (in default mode) commits lossless doc work; it needs git.\n',
    );
    return 5;
  }

  const mode = parsed.check ? 'check' : parsed.dryRun ? 'dry-run' : parsed.noCommit ? 'no-commit' : 'default';
  // --dry-run previews (writes nothing); --check is read-only BEYOND the dashboards
  // (it writes docs/coherence-review.md but NEVER touches HANDOVER.md/README.md —
  // the "read-only beyond the dashboards" contract, SPEC §4 / AC-3). So in --check
  // the block refreshers run preview-only (write:false) while runDashboard still
  // writes. default + --no-commit write everything.
  const write = mode !== 'dry-run' && mode !== 'check';
  const doCommit = mode === 'default'; // ONLY default mode auto-commits

  // ── Steps 1+2: mechanical blocks + dashboard ────────────────────────────────
  // The block refreshers honor `write` (preview-only under --dry-run AND --check —
  // --check is read-only beyond the dashboards, so HANDOVER.md / README.md are
  // NEVER touched). The dashboard, by contrast, IS one of the dashboards --check is
  // allowed to (re)write: it writes whenever we are not in --dry-run. (SPEC §4 /
  // AC-3 — the same "writes the dashboard it scans" rule document-review --check has.)
  const handover = await refreshHandover(root, write);
  const readme = await refreshReadme(root, write);
  const dashboard = runDashboard(root, mode !== 'dry-run');

  // Auto-commit the lossless block + dashboard refresh as ONE atomic commit.
  let blocksCommit = null;
  if (doCommit) {
    const files = [handover.file, readme.file, readme.changelogFile, dashboard.file].filter(Boolean);
    blocksCommit = commitFiles(root, 'docs(document): refresh mechanical blocks and coherence dashboard', files);
  }

  // ── Step 3: SPEC archival ───────────────────────────────────────────────────
  // In --check mode the pass is read-only beyond the dashboards — no archival.
  const archival = mode === 'check'
    ? { moved: 0, refsRewritten: 0, filesChanged: 0, changedFiles: [], wall: null }
    : runArchival(root, write);

  let archivalCommit = null;
  if (doCommit && archival.moved > 0 && !archival.wall) {
    archivalCommit = commitFiles(
      root,
      `docs(document): archive ${archival.moved} shipped SPEC${archival.moved === 1 ? '' : 's'} into ${ARCHIVE_DIR}/`,
      archival.changedFiles,
    );
  }

  // ── Step 5: conciseness / correction (SPEC_V021A) ───────────────────────────
  // Detect (structure + capability-lies + deprecated-surface) and ACT — MOVE the
  // surplus + DELETE the high-confidence removable falsehoods, role-aware. In
  // --check / --dry-run it DETECTS only (write:false → no mutation, clean tree).
  // Runs AFTER Steps 1-3 so the changelog markers/content it relocates to
  // CHANGELOG.md are the freshly-refreshed ones (the refresh follows the marker).
  const conciseness = runConciseness(root, write, { inventory: dashboard.inventory });

  let concisenessCommit = null;
  if (doCommit && conciseness.changedFiles.length > 0 && !conciseness.wall) {
    concisenessCommit = commitFiles(
      root,
      'docs(document): condense concise docs — move surplus losslessly, remove false/deprecated surface',
      [...new Set(conciseness.changedFiles)],
    );
  }

  // ── Step 4: coupling for the files changed this pass ────────────────────────
  const changedThisPass = [
    handover.file, readme.file, readme.changelogFile, dashboard.file,
    ...(archival.changedFiles || []), ...(conciseness.changedFiles || []),
  ].filter(Boolean);
  const coupling = mode === 'dry-run' || changedThisPass.length === 0
    ? 'No files changed this pass — nothing to couple.'
    : couplingReport(root, changedThisPass, dashboard.inventory);

  // ── Unified report ──────────────────────────────────────────────────────────
  const report = buildDocumentReport({
    mode, handover, readme, blocksCommit, dashboard, archival, archivalCommit,
    conciseness, concisenessCommit, coupling,
  });
  stdout.write(report);
  if (!report.endsWith('\n')) stdout.write('\n');

  // ── --check gate (teeth) ────────────────────────────────────────────────────
  // Run detection, exit 1 on ANY conformance drift, 0 clean. The dashboard is
  // already written (identical to a plain run); now set the exit from drift only.
  // The roadmap heuristic is advisory and does NOT gate (mirrors document-review
  // --check). No commits in this mode (read-only beyond the dashboard).
  if (mode === 'check') {
    if (dashboard.wall) {
      // A detection wall (e.g. MAKE_MY_DREAMS.md unreadable) is NOT "not a git repo"
      // (exit 5) — it is "could not run the detection" (exit 4), mirroring
      // document-review --check, where an unreadable roadmap exits 4 (§VI honesty:
      // distinguish "no git" from "could not detect").
      stderr.write(`\ndocument --check: could not run detection — ${dashboard.wall}\n`);
      return 4;
    }
    // SPEC_V021A AC-5: the gate now ALSO fails on a capability-lie or a
    // deprecated-surface-as-primary finding from Step 5 (the new teeth), in
    // addition to the existing coherence-dashboard drift.
    const capLies = conciseness.findings.capability.length;
    const depSurface = conciseness.findings.deprecated.length;
    const obsoleteForward = Array.isArray(conciseness.findings.obsoleteForward)
      ? conciseness.findings.obsoleteForward.length : 0;
    const newFindings = capLies + depSurface + obsoleteForward;
    if (dashboard.driftTotal > 0 || newFindings > 0) {
      const d = dashboard.drift;
      const total = dashboard.driftTotal + newFindings;
      stderr.write(
        `\ndocument --check: FAIL — ${total} conformance finding${total === 1 ? '' : 's'} ` +
        `(${d.dangling.length} dangling · ${d.staleFacts.length} stale fact${d.staleFacts.length === 1 ? '' : 's'} · ` +
        `${d.deprecated.length} deprecated-surface · ${d.stalePromises.length} stale promise${d.stalePromises.length === 1 ? '' : 's'} · ` +
        `${capLies} capability-lie${capLies === 1 ? '' : 's'} · ${depSurface} deprecated-as-primary · ` +
        `${obsoleteForward} obsolete-forward).\n` +
        `  See ${REPORT_REL_PATH} for the dashboard details. (The roadmap heuristic is advisory and does NOT affect this gate.)\n`,
      );
      return 1;
    }
    stdout.write('\ndocument --check: PASS — no conformance drift.\n');
  }
  return 0;
}
