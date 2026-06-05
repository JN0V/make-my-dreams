#!/usr/bin/env node
// bin/documentalist/document-review.js — `mmdream document-review` entry point
// (SPEC_V07A AC-3). The Documentalist's coherence-review subcommand: gather a
// deterministic inventory of MMD's surface, reconcile it against the §9 roadmap
// (heuristic), render a coherence report, and write EXACTLY ONE file —
// docs/coherence-review.md — then print a short summary.
//
// SRP (universal.md §I.S): orchestrate the gather → reconcile → render → write
// flow only. The judgment (inventory.js / roadmap-reconcile.js) and the render
// (coherence-report.js) are pure and live in lib/documentalist/; this file is a
// thin coordinator that wires the real fs + git + the optional claude spawn,
// mirroring bin/documentalist/document-readme.js.
//
// READ-ONLY CONTRACT (SPEC §4, the safety heart): this command writes EXACTLY
// docs/coherence-review.md and NOTHING else. It never moves, deletes, or edits
// any other file. An integration test asserts no other tracked path changes.
//
// Exit codes (mirror the document-* family):
//   0  ok (report written, or printed under --dry-run)
//   2  user/argv error
//   3  cannot write the report file
//   4  MAKE_MY_DREAMS.md unreadable (no roadmap to reconcile)

import { cwd as processCwd, stdout, stderr, env } from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';

import { SUBCOMMANDS } from '../../lib/argv-parser.js';
import { parseLessons } from '../../lib/composer/parse-lessons.js';
import { gatherInventory } from '../../lib/documentalist/inventory.js';
import { reconcileRoadmap } from '../../lib/documentalist/roadmap-reconcile.js';
import { renderCoherenceReport } from '../../lib/documentalist/coherence-report.js';
import { extractDocRefs } from '../../lib/documentalist/doc-refs.js';
import {
  checkArtifactConformance,
  checkFactConformance,
  checkDeprecatedSurface,
  checkVersionPinnedPromises,
} from '../../lib/documentalist/conformance.js';
import { buildUxTextSurface } from '../../lib/documentalist/ux-text-surface.js';
import { extractDocLinks } from '../../lib/documentalist/doc-links.js';
import { buildCoherenceGraph, coupledNeighbors } from '../../lib/documentalist/coherence-graph.js';
import { computeBlastRadius } from '../../lib/sealed-tests/blast-radius.js';
import { adapterFor, unanalyzedLanguageFor } from '../../lib/code-graph/adapters/index.js';

// The curated "truth docs" scanned for drift/conformance (SPEC_V07B AC-3/AC-4).
// These are the OPERATIONAL docs that claim artifacts exist NOW. We DELIBERATELY
// exclude MAKE_MY_DREAMS.md (the design/roadmap doc — intentionally aspirational,
// full of forward-looking `mmdream watch`/`mmdream dream` prose; it is already covered by
// the designed-vs-built reconciliation) and the frozen SPEC_V*.md history. This
// is the precision-first choice (AC-4): a drift section that cries wolf over
// design prose is useless. All docs/adr/*.md are added dynamically.
const CONFORMANCE_TRUTH_DOCS = Object.freeze([
  'README.md', 'CLAUDE.md', 'HANDOVER.md', 'docs/lessons-learned.md',
]);

// The LIVING current-state docs — the ones that purport to describe MMD as it is
// NOW. Only these are scanned for FACT conformance (counts / current version):
// ADRs and lessons-learned.md are point-in-time / append-only records, so a
// count they state ("17 lessons", "30 ADRs") was TRUE when written and is NOT
// drift — flagging it would be a false positive (AC-4 precision). Dangling CODE
// references, by contrast, are scanned everywhere (a moved file is a real
// navigability problem even in a historical ADR).
const CURRENT_STATE_DOCS = new Set(['README.md', 'CLAUDE.md', 'HANDOVER.md']);

const PKG_PATH = fileURLToPath(new URL('../../package.json', import.meta.url));
let VERSION = '0.0.0';
try {
  VERSION = JSON.parse(readFileSync(PKG_PATH, 'utf8')).version;
} catch {
  // package.json unreadable — version stays a placeholder, never crashes.
}

// The ONE file this command writes. Repo-root-relative.
export const REPORT_REL_PATH = path.join('docs', 'coherence-review.md');

// The claude spawn seam (mirrors MMD_QA_CMD / MMD_DOCUMENT_RELEASE_CMD). Used
// ONLY by --with-claude. Default 'claude'; a test points it at a fake script.
const CLAUDE_CMD = env.MMD_DOCUMENT_REVIEW_CMD || 'claude';
const CLAUDE_TIMEOUT_MS = Number(env.MMD_DOCUMENT_REVIEW_TIMEOUT_MS) || 60000;

const USAGE = `mmdream document-review — the Documentalist's coherence review (SPEC_V07A)

Usage:
  mmdream document-review [--with-claude] [--dry-run]
  mmdream document-review --check
  mmdream document-review --since <ref>
  mmdream document-review --help

Behavior:
  Gathers a deterministic inventory of MMD's surface (subcommands, git tags,
  ADRs, lib/ modules, per-doc line counts, root SPEC sprawl, active lessons),
  reconciles it against the MAKE_MY_DREAMS.md §9 roadmap (a clearly-labelled
  heuristic: built / partial / unbuilt), scans the operational "truth docs" for
  DRIFT (dangling references to code artifacts that no longer exist + bounded
  stale-fact claims that disagree with the live inventory), and writes a
  regenerable coherence report to ${REPORT_REL_PATH}. Prints a short summary.

  The Drift / conformance section is advisory and FLAG-ONLY (detect-before-
  correct): the Documentalist tells you where the docs stopped matching reality;
  it NEVER edits a doc to "fix" it.

  READ-ONLY beyond that one file: it never moves, deletes, or edits anything
  else in the repo. The report is a dashboard — regenerate it after material
  changes; do not hand-edit it.

  --since <ref> (v0.7.d): the staleness-on-diff query. Computes the files
  changed since <ref> (git diff --name-only), walks a DERIVED coherence graph
  (code-to-code imports + doc-to-code refs + doc-to-doc links), and prints the
  ranked, advisory "Coupled changes" report to stdout — "change one node, learn
  which neighbors to review". This mode is a QUERY: it writes NOTHING (it does
  NOT rewrite ${REPORT_REL_PATH}). Coupling is a review hint, never a gate.

  --check (v0.18.0): the GATE (teeth). Runs the full review, writes the same
  dashboard, then EXITS 1 if ANY conformance drift is found (dangling references
  / stale facts / stale promises / deprecated-surface), 0 when clean — the same
  gate contract as secret-scan/deps-gate (pre-push / CI). The roadmap
  reconciliation heuristic is advisory and does NOT affect the exit. The plain
  run (no --check) stays report-only.

Flags:
  --check        Gate: exit 1 on any conformance drift, 0 when clean. Writes the
                 dashboard as usual; adds only the exit code (for pre-push / CI).
  --since <ref>  Staleness-on-diff: report the coupled neighbors of what changed
                 since <ref>. Read-only (writes nothing). Standalone mode.
  --with-claude  Layer an LLM judgment pass on top of the deterministic
                 reconciliation (opt-in). On absent/non-zero/unparseable claude,
                 falls back to the deterministic report with an honest note —
                 never a fabricated classification.
  --dry-run      Print the report to stdout; write nothing.
  --help, -h     Print this usage and exit 0.

Exit codes:
  0  ok (written, or printed under --dry-run / --since; --check clean)
  1  --check: a conformance drift finding was detected (gate failed)
  2  user/argv error
  3  cannot write ${REPORT_REL_PATH}
  4  MAKE_MY_DREAMS.md unreadable (no roadmap to reconcile)
  5  --since: git diff failed (not a git repo / bad ref); or --check outside a git repo

mmdream ${VERSION}
`;

/**
 * Parse the few document-review flags. Mirrors the document-readme contract:
 * boolean flags + the `--since <ref>` query, unknown flag → exit 2, no positionals.
 *
 * `--since <ref>` switches to the v0.7.d staleness-on-diff mode (a read-only
 * query — it never rewrites the dashboard). It requires a value (the git ref).
 *
 * `--check` (SPEC_V018A AC-5) adds the GATE: after writing the dashboard, exit 1
 * if any conformance drift (dangling refs / stale facts / stale promises /
 * deprecated-surface) is found, 0 when clean. The roadmap heuristic does NOT gate.
 *
 * @param {string[]} rawArgs
 * @returns {{ withClaude: boolean, dryRun: boolean, check: boolean, help: boolean, since: string|null, error: { message: string, exitCode: number }|null }}
 */
export function parseDocumentReviewArgs(rawArgs) {
  const out = { withClaude: false, dryRun: false, check: false, help: false, since: null, error: null };
  if (!Array.isArray(rawArgs)) {
    out.error = { message: 'parseDocumentReviewArgs: rawArgs must be an array', exitCode: 2 };
    return out;
  }
  for (let i = 0; i < rawArgs.length; i += 1) {
    const tok = rawArgs[i];
    if (tok === '--with-claude') out.withClaude = true;
    else if (tok === '--dry-run') out.dryRun = true;
    else if (tok === '--check') out.check = true;
    else if (tok === '--help' || tok === '-h') out.help = true;
    else if (tok === '--since') {
      const val = rawArgs[i + 1];
      if (typeof val !== 'string' || val.length === 0 || val.startsWith('-')) {
        out.error = {
          message: "--since requires a git ref (e.g. 'mmdream document-review --since main').",
          exitCode: 2,
        };
        return out;
      }
      out.since = val;
      i += 1; // consume the value
    } else {
      out.error = {
        message: `unknown document-review arg: '${tok}'. Run 'mmdream document-review --help' to see supported flags.`,
        exitCode: 2,
      };
      return out;
    }
  }
  // --check is the gate mode (writes the dashboard + sets the exit). It is
  // incompatible with --since (a standalone read-only query) and with --dry-run
  // (the gate must write + scan the same report). Reject the contradiction up
  // front rather than silently picking one (defensive, error-handling §I).
  if (out.check && out.since) {
    out.error = { message: '--check cannot be combined with --since (--since is a read-only query, not a gate).', exitCode: 2 };
    return out;
  }
  if (out.check && out.dryRun) {
    out.error = { message: '--check cannot be combined with --dry-run (the gate writes the dashboard it scans).', exitCode: 2 };
    return out;
  }
  return out;
}

/**
 * The repo's REAL subcommand set — the authority for subcommand conformance.
 *
 * The argv-parser SUBCOMMANDS export is the documented list, but it can lag the
 * actual dispatch (e.g. `mmdream lessons` is dispatched in bin/mmd.js yet missing
 * from SUBCOMMANDS). Truth over tidiness (the whole point of this slice): derive
 * the real set from what bin/mmd.js ACTUALLY dispatches (`rawArgs[0] === '<name>'`)
 * unioned with SUBCOMMANDS. A third-party repo with no bin/mmd.js → SUBCOMMANDS
 * only. Never throws.
 *
 * @param {string} root
 * @returns {string[]}
 */
function realSubcommands(root) {
  const set = new Set(SUBCOMMANDS);
  try {
    const bin = readFileSync(path.join(root, 'bin', 'mmd.js'), 'utf8');
    const re = /rawArgs\[0\]\s*===\s*'([a-z][a-z0-9-]*)'/g;
    let m;
    while ((m = re.exec(bin)) !== null) set.add(m[1]);
  } catch {
    // No bin/mmd.js (third-party repo) → the documented SUBCOMMANDS is the best
    // we have. Honest: we don't fabricate a dispatch we couldn't read.
  }
  return [...set];
}

/**
 * Build the inventory from the real repo (injected fs + git + parser).
 *
 * Exported (v0.19.0 AC-1) so the `mmdream document` orchestrator REUSES the exact
 * same inventory gather — no duplicated detection logic (DRY, §III; SPEC §4.1).
 * @param {string} root
 */
export function gatherRealInventory(root) {
  const readFile = (rel) => readFileSync(path.join(root, rel), 'utf8');
  const readDir = (rel) => readdirSync(path.join(root, rel));
  const listTags = () => {
    try {
      return execFileSync('git', ['tag', '--list', '--sort=v:refname'], {
        cwd: root, encoding: 'utf8', timeout: 20000,
      }).split('\n').map((s) => s.trim()).filter(Boolean);
    } catch {
      return [];
    }
  };
  return gatherInventory({
    readFile, readDir, listTags, parseLessons, subcommands: realSubcommands(root),
  });
}

/**
 * Read the curated truth docs (+ every docs/adr/*.md) for conformance scanning.
 * Each doc independently degrades: an absent/unreadable doc is simply skipped
 * (honest — a doc we cannot read is not scanned, never a fabricated empty entry).
 *
 * @param {string} root
 * @returns {Array<{ doc: string, text: string }>}
 */
function gatherTruthDocs(root) {
  const docs = [];
  const add = (rel) => {
    try {
      docs.push({ doc: rel, text: readFileSync(path.join(root, rel), 'utf8') });
    } catch {
      // absent/unreadable → skip
    }
  };
  for (const d of CONFORMANCE_TRUTH_DOCS) add(d);
  try {
    for (const f of readdirSync(path.join(root, 'docs', 'adr')).sort()) {
      if (typeof f === 'string' && /^\d+.*\.md$/.test(f)) add(path.posix.join('docs', 'adr', f));
    }
  } catch {
    // no docs/adr dir → nothing to add
  }
  return docs;
}

/**
 * Build the wider "UX-text surface" (SPEC_V018A AC-2): the user-facing strings
 * beyond the markdown truth docs — shell-script printf/echo output (install-mmd.sh
 * + siblings) + the CLI --help/USAGE text. Injected reader; never throws.
 *
 * @param {string} root
 * @returns {Array<{ path: string, text: string }>}
 */
function gatherUxTextSurface(root) {
  const readFile = (rel) => readFileSync(path.join(root, rel), 'utf8');
  return buildUxTextSurface({ repoRoot: root, readFile });
}

/**
 * Run the deterministic drift / conformance scan (AC-3/AC-4 + AC-2/AC-3/AC-4 of
 * SPEC_V018A). Pure-ish: the only I/O is reading the truth docs + the UX-text
 * surface + the injected fileExistsFn; the judgment is the pure conformance checks.
 *
 * The conformance scan now reaches BEYOND markdown (SPEC_V018A AC-2): the
 * dangling-ref scan, the deprecated-surface check, and the version-pinned-promise
 * check all run over the markdown truth docs PLUS the shell-script printf/echo
 * output PLUS the CLI --help/USAGE text. The markdown checks are unchanged
 * (additive — the wider surface never narrows what was scanned).
 *
 * @param {string} root
 * @param {object} inventory
 * Exported (v0.19.0 AC-1) so the `mmdream document` orchestrator REUSES the exact
 * same deterministic drift scan — no second detection path (DRY, §III; SPEC §4.1).
 *
 * @returns {{ dangling: object[], staleFacts: object[], deprecated: object[],
 *             stalePromises: object[], scannedDocs: number, scannedUx: number }}
 */
export function scanDrift(root, inventory) {
  const truthDocs = gatherTruthDocs(root);
  const uxSurface = gatherUxTextSurface(root); // AC-2: scripts + --help/USAGE

  // The repo's REAL top-level directories — the derived (not hardcoded) successor
  // to the old lib|bin|test|docs allowlist (§VIII polyglot precision). A doc's
  // file ref is judged dangling ONLY when rooted at one of these, so a broadened
  // candidate that is not repo-rooted (shorthand / relative link / illustrative)
  // never becomes a false positive. Never throws (unreadable root → empty set →
  // filter off → back-compat judge-all, honest).
  let repoTopDirs = [];
  try {
    repoTopDirs = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    repoTopDirs = [];
  }
  const fileExistsFn = (rel) => existsSync(path.join(root, rel));

  // Dangling refs — over the markdown docs AND the wider UX-text surface (AC-2).
  // Each ref carries its source path (a doc rel-path or a "<script>"/"bin/mmd.js
  // --help" label) so a finding points back at the real location.
  const docRefs = [];
  for (const { doc, text } of truthDocs) {
    for (const r of extractDocRefs(text)) docRefs.push({ ...r, doc });
  }
  for (const { path: uxPath, text } of uxSurface) {
    for (const r of extractDocRefs(text)) docRefs.push({ ...r, doc: uxPath });
  }
  const dangling = checkArtifactConformance({ docRefs, inventory, fileExistsFn, repoTopDirs });

  // Fact conformance only on the living current-state docs (counts in historical
  // ADRs/lessons are correct-as-of-writing, not drift).
  const factDocs = truthDocs.filter((d) => CURRENT_STATE_DOCS.has(d.doc));
  const staleFacts = checkFactConformance({ docs: factDocs, inventory });

  // Deprecated-surface (AC-3) + version-pinned promises (AC-4) — over the LIVING
  // current-state docs (README/CLAUDE/HANDOVER) AND the UX-text surface (scripts +
  // --help). NOT over the historical ADRs / lessons-learned: those are point-in-time
  // records, so a `mmd <command>` they wrote BEFORE the v0.9.2 rename, or a promise
  // pinned to a version that was future WHEN WRITTEN, was correct as of writing — not
  // current drift (the exact CURRENT_STATE_DOCS precision rule that already scopes
  // checkFactConformance; flagging a historical ADR's old command would cry wolf).
  // The UX-text surface IS current (the installer + --help run TODAY), so it stays.
  const currencySurface = [
    ...truthDocs.filter((d) => CURRENT_STATE_DOCS.has(d.doc)).map((d) => ({ path: d.doc, text: d.text })),
    ...uxSurface,
  ];
  const deprecated = checkDeprecatedSurface(currencySurface);
  const stalePromises = checkVersionPinnedPromises(currencySurface, { currentVersion: VERSION });

  return {
    dangling, staleFacts, deprecated, stalePromises,
    scannedDocs: truthDocs.length, scannedUx: uxSurface.length,
  };
}

/**
 * Optional --with-claude enrichment. Spawns `claude -p <prompt>` via the
 * injected seam, returns the LLM's prose commentary on the heuristic. On ANY
 * failure (binary absent, non-zero exit, empty/whitespace reply) returns null +
 * an honest note — NEVER a fabricated classification (universal §VI, L-021).
 *
 * The enrichment is COMMENTARY rendered under its own heading; it never mutates
 * the deterministic table, so it cannot manufacture a built/unbuilt verdict.
 *
 * @param {{ reconciliation: object, inventory: object }} ctx
 * @returns {{ enrichment: string|null, note: string|null }}
 */
function enrichWithClaude({ reconciliation, inventory }) {
  const entries = Array.isArray(reconciliation?.entries) ? reconciliation.entries : [];
  const table = entries
    .map((e) => `- ${e.version} ${e.capability} → ${e.status} (${e.signal})`)
    .join('\n');
  const prompt =
    'You are reviewing a DETERMINISTIC heuristic that classified MMD roadmap ' +
    'capabilities as built/partial/unbuilt by name-matching against the codebase ' +
    'inventory. Below is the heuristic output. In at most 8 bullet points, flag ' +
    'where the NAME-MATCH likely mis-judged reality (e.g. a lib module exists but ' +
    'only a lite version shipped, or a capability shipped under a different name). ' +
    'Do NOT restate the table. Be concise. If you are unsure, say so — never invent ' +
    'a confident verdict.\n\n' +
    `Inventory: ${inventory?.subcommands?.length || 0} subcommands, ` +
    `${inventory?.adrs?.length || 0} ADRs, lib modules: ${(inventory?.libModules || []).join(', ')}.\n\n` +
    `Heuristic classification:\n${table}\n`;

  let res;
  try {
    res = spawnSync(CLAUDE_CMD, ['-p', prompt], {
      encoding: 'utf8', timeout: CLAUDE_TIMEOUT_MS,
    });
  } catch (err) {
    return { enrichment: null, note: `claude spawn failed (${err.code || err.message})` };
  }
  if (res.error) {
    const reason = res.error.code === 'ENOENT'
      ? `'${CLAUDE_CMD}' not found on PATH`
      : res.error.message;
    return { enrichment: null, note: reason };
  }
  if (typeof res.status === 'number' && res.status !== 0) {
    return { enrichment: null, note: `claude exited ${res.status}` };
  }
  const text = (res.stdout || '').trim();
  if (!text) {
    return { enrichment: null, note: 'claude returned an empty reply' };
  }
  return { enrichment: text, note: null };
}

/**
 * Optional --with-claude SEMANTIC drift pass (SPEC_V07B AC-3). The deterministic
 * checks catch dangling references + stale counts; this layers an LLM that flags
 * where a doc's DESCRIPTION likely no longer reflects what shipped (semantic
 * drift) — distinct from a missing file. Honest fallback on ANY failure (binary
 * absent / non-zero / empty): returns { text: null, note } — NEVER a fabricated
 * "conformant" verdict (the sacred uncertain discipline, universal §VI, L-021).
 *
 * @param {{ inventory: object, dangling: object[], staleFacts: object[] }} ctx
 * @returns {{ text: string|null, note: string|null }}
 */
function semanticDriftWithClaude({ inventory, dangling, staleFacts }) {
  const adrTitles = (Array.isArray(inventory?.adrs) ? inventory.adrs : [])
    .slice(-12)
    .map((a) => `ADR-${String(a.number).padStart(3, '0')} — ${a.title || '(untitled)'}`)
    .join('\n');
  const prompt =
    'You are checking MMD docs for SEMANTIC drift: places where a doc/ADR still ' +
    'DESCRIBES a capability that has since changed or never fully shipped, even ' +
    'though the file paths it cites still exist (so the deterministic checks pass). ' +
    'Below are the recent ADR titles + the live inventory. In at most 6 bullets, ' +
    'flag the ADRs/descriptions most LIKELY to have drifted from current behavior. ' +
    'You are reasoning from titles only — be explicit that this is a suspicion, and ' +
    'if you are unsure say so. NEVER assert "conformant"; never fabricate a verdict.\n\n' +
    `Inventory: ${inventory?.subcommands?.length || 0} subcommands, ` +
    `${inventory?.adrs?.length || 0} ADRs, lib modules: ${(inventory?.libModules || []).join(', ')}.\n` +
    `Deterministic drift already found: ${dangling.length} dangling refs, ${staleFacts.length} stale facts.\n\n` +
    `Recent ADRs:\n${adrTitles}\n`;

  let res;
  try {
    res = spawnSync(CLAUDE_CMD, ['-p', prompt], { encoding: 'utf8', timeout: CLAUDE_TIMEOUT_MS });
  } catch (err) {
    return { text: null, note: `claude spawn failed (${err.code || err.message})` };
  }
  if (res.error) {
    const reason = res.error.code === 'ENOENT' ? `'${CLAUDE_CMD}' not found on PATH` : res.error.message;
    return { text: null, note: reason };
  }
  if (typeof res.status === 'number' && res.status !== 0) {
    return { text: null, note: `claude exited ${res.status}` };
  }
  const text = (res.stdout || '').trim();
  if (!text) return { text: null, note: 'claude returned an empty reply' };
  return { text, note: null };
}

// ── v0.7.d: --since staleness-on-diff (the coherence graph walk) ────────────

// Human labels for the edge kinds in the "Coupled changes" report (universal §VII).
const KIND_LABEL = Object.freeze({
  import: 'imports',
  'doc-ref': 'doc→code ref',
  'doc-link': 'doc↔doc link',
  transitive: 'transitive',
});

const isJs = (f) => /\.(?:js|mjs|cjs)$/.test(f);
const isMd = (f) => /\.md$/i.test(f);

/**
 * Is `root` inside a git work tree? The not-a-git-repo oracle for the --check
 * gate (SPEC_V018A AC-5). Mirrors the secret-scan/deps-gate contract: an honest
 * exit 5 outside a repo, never a fabricated pass. Never throws (any failure →
 * false → exit 5).
 *
 * @param {string} root
 * @returns {boolean}
 */
function defaultIsGitRepo(root) {
  try {
    const out = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: root, encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * The default git seam for --since: the list of files changed since <ref>, and
 * the repo's tracked files (the universe of graph nodes). Both via git; a
 * failure (not a repo / bad ref) is returned as an error, never thrown.
 *
 * @param {string} root
 * @param {string} ref
 * @returns {{ changed: string[]|null, tracked: string[], error: string|null }}
 */
function defaultGitSeam(root, ref) {
  const run = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 20000 });
  let changed;
  try {
    changed = run(['diff', '--name-only', ref])
      .split('\n').map((s) => s.trim()).filter(Boolean);
  } catch (err) {
    const stderrTxt = (err && err.stderr ? String(err.stderr) : '').trim();
    return { changed: null, tracked: [], error: stderrTxt || (err && err.message) || 'git diff failed' };
  }
  let tracked = [];
  try {
    tracked = run(['ls-files']).split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    tracked = []; // diff worked but ls-files didn't — degrade to no doc nodes (honest)
  }
  return { changed, tracked, error: null };
}

/**
 * Build the coherence graph for a --since run from the THREE derived sources
 * (SPEC_V07D AC-3), then walk it from the changed set.
 *
 *   - code↔code imports : computeBlastRadius (reuses the resolved import graph,
 *                         ADR-027) — direct importers of each changed file.
 *   - doc→code refs     : doc-refs.js `file` refs (`.js` targets) over every doc.
 *   - doc↔doc links     : doc-links.js (`[[wiki]]` / `ADR-NNN` / relative `.md`).
 *
 * Conservative (precision-first, AC-4): an edge is kept ONLY when its target is a
 * real tracked file (a dangling target is the v0.7.b drift detector's concern,
 * not the graph's — we don't flag phantom neighbors). Pure beyond the injected
 * reads; the actual graph build + walk are the pure lib functions.
 *
 * @param {string} root
 * @param {string[]} changed changed (repo-relative) files
 * @param {string[]} tracked all tracked files (graph-node universe)
 * @param {object} inventory the live inventory (for ADR-number → file resolution)
 * @returns {{ coupling: Array<{file: string, neighbors: object[]}>,
 *             unanalyzedLangs: string[] }}
 *   `unanalyzedLangs` = the languages in the DIFF whose code coupling has no
 *   import adapter yet (Rust/Go/C…) — surfaced honestly by the report rather than
 *   silently omitted (§VIII / §VI). Empty for an all-JS/Python diff.
 *
 * Exported (v0.19.0 AC-1) so the `mmdream document` orchestrator REUSES the exact
 * same coupling walk for its step-4 report — no second graph build (DRY, §III).
 */
export function buildSinceCoupling(root, changed, tracked, inventory) {
  const trackedSet = new Set(tracked);
  // Code files = every tracked file an import adapter handles (JS, Python, …).
  // The import graph is now POLYGLOT (SPEC_V081): the code↔code edges come from
  // whichever adapter matches each file, not just JS. For an all-JS diff the
  // edges (and therefore the output) are byte-for-byte unchanged.
  const codeFiles = tracked.filter((f) => adapterFor(f));
  const docFiles = tracked.filter(isMd);

  // Read cache so per-changed-file computeBlastRadius calls don't re-read disk.
  const cache = new Map();
  const readRel = (rel) => {
    if (cache.has(rel)) return cache.get(rel);
    let t = '';
    try { t = readFileSync(path.join(root, rel), 'utf8'); } catch { t = ''; }
    cache.set(rel, t);
    return t;
  };

  // 1. Import edges (code↔code): direct importers of each changed file, via the
  // polyglot graph (each file dispatched to its language adapter).
  const io = { listFiles: () => codeFiles, readFile: readRel };
  const importEdges = [];
  for (const c of changed) {
    const { importers } = computeBlastRadius([c], io);
    for (const imp of importers) importEdges.push({ from: c, to: imp });
  }

  // Honesty: which languages in the DIFF have no import adapter yet? Their code
  // coupling is NOT computed — say so rather than silently omit it (§VIII).
  const unanalyzedLangs = [];
  const seenLang = new Set();
  for (const c of changed) {
    const lang = unanalyzedLanguageFor(c);
    if (lang && !seenLang.has(lang)) { seenLang.add(lang); unanalyzedLangs.push(lang); }
  }
  unanalyzedLangs.sort();

  // 2/3. Doc edges: scan every tracked doc once for code refs + doc links.
  const resolveAdr = (n) => {
    const a = (inventory.adrs || []).find((x) => x && x.number === n);
    return a && a.file ? `docs/adr/${a.file}` : null;
  };
  const docToCodeEdges = [];
  const docLinkEdges = [];
  for (const doc of docFiles) {
    const text = readRel(doc);
    if (!text) continue;
    for (const r of extractDocRefs(text)) {
      // Only `.js` file refs are doc→code; `.md` file refs are doc↔doc.
      if (r.kind === 'file' && trackedSet.has(r.value)) {
        if (isJs(r.value)) docToCodeEdges.push({ from: doc, to: r.value });
        else if (isMd(r.value)) docLinkEdges.push({ from: doc, to: r.value });
      }
    }
    for (const e of extractDocLinks(text, { docPath: doc, resolveAdr })) {
      if (trackedSet.has(e.to)) docLinkEdges.push({ from: doc, to: e.to });
    }
  }

  const graph = buildCoherenceGraph({ importEdges, docToCodeEdges, docLinkEdges });
  return { coupling: coupledNeighbors(graph, changed), unanalyzedLangs };
}

/**
 * Render the "Coupled changes" report (AC-3) — ranked, advisory, plain-language
 * (universal §VII). Pure: coupling result in, markdown out.
 *
 * @param {string} ref the git ref the diff is against
 * @param {Array<{file: string, neighbors: object[]}>} coupling
 * @param {string[]} [unanalyzedLangs] languages in the diff with no import
 *   adapter — their code coupling is unavailable and the report SAYS so (§VIII).
 * @returns {string}
 */
export function renderCoupledChanges(ref, coupling, unanalyzedLangs = []) {
  const lines = [];
  lines.push('## Coupled changes (staleness — review the neighbors of what you changed)');
  lines.push('_Derived graph, advisory + ranked. Coupling ≠ certainty — review, don\'t obey._');
  lines.push('');

  if (coupling.length === 0) {
    lines.push(`No files changed since \`${ref}\`. Nothing to couple.`);
    lines.push('');
    appendUnanalyzedNote(lines, unanalyzedLangs);
    return lines.join('\n');
  }

  lines.push(`Changed in this diff (${coupling.length} file${coupling.length === 1 ? '' : 's'}), against \`${ref}\`:`);
  lines.push('');

  let isolated = 0;
  for (const { file, neighbors, hubSuppressed } of coupling) {
    if (neighbors.length === 0 && !hubSuppressed) {
      isolated += 1;
      continue;
    }
    lines.push(`- ${file}`);
    for (const n of neighbors) {
      const tag = n.strength === 'strong' ? 'strong' : 'weak';
      const label = KIND_LABEL[n.kind] || n.kind;
      lines.push(`    → review (${tag}): ${n.to}   [${label}]`);
    }
    // Honest hub-source cap note (never a silent truncation — universal §VI). The
    // file couples to too much of the repo to list it all as a useful hint.
    if (hubSuppressed > 0) {
      lines.push(
        `    … +${hubSuppressed} more direct neighbor${hubSuppressed === 1 ? '' : 's'} suppressed ` +
        `(hub source — this file couples to much of the repo; the top ${neighbors.length} are shown, ` +
        'reviewing all is noise, not a hint).',
      );
    }
  }

  if (isolated > 0) {
    lines.push('');
    lines.push(
      `${isolated} changed file${isolated === 1 ? ' has' : 's have'} no coupled neighbors ` +
      '(no edges) — likely self-contained.',
    );
  }
  lines.push('');
  appendUnanalyzedNote(lines, unanalyzedLangs);
  return lines.join('\n');
}

/**
 * Append the honest "code coupling unavailable for <stack>" note when the diff
 * touched a language with no import adapter (§VIII / §VI — never silently omit an
 * un-analyzed stack as if it had no coupling). No-op for an all-adapted diff.
 *
 * @param {string[]} lines the accumulating render lines (mutated)
 * @param {string[]} unanalyzedLangs sorted unique language names
 */
function appendUnanalyzedNote(lines, unanalyzedLangs) {
  if (!Array.isArray(unanalyzedLangs) || unanalyzedLangs.length === 0) return;
  const stacks = unanalyzedLangs.join(', ');
  lines.push(
    `> Note: code coupling for ${stacks} is not available — no import adapter yet. ` +
    'Those changed files contributed no code↔code edges (their reach may be larger ' +
    'than shown). Add an adapter under lib/code-graph/adapters/ to close the gap.',
  );
  lines.push('');
}

/**
 * Run the --since staleness-on-diff query (AC-3). Read-only: prints the "Coupled
 * changes" report to stdout and writes NOTHING. A git failure (not a repo / bad
 * ref) → an honest non-zero exit (5), never a crash.
 *
 * @param {string} root
 * @param {string} ref
 * @param {{ gitSeam?: function }} injected test seam for the git diff/ls-files
 * @returns {number} exit code
 */
function runSinceMode(root, ref, injected = {}) {
  const seam = injected.gitSeam || defaultGitSeam;
  const { changed, tracked, error } = seam(root, ref);
  if (error || changed === null) {
    stderr.write(
      `error: --since could not compute the diff against '${ref}': ${error || 'git diff failed'}\n` +
      '  Is this a git repo, and is the ref valid? Try a known ref (e.g. main, HEAD~1).\n',
    );
    return 5;
  }

  const inventory = gatherRealInventory(root);
  const { coupling, unanalyzedLangs } = buildSinceCoupling(root, changed, tracked, inventory);
  const report = renderCoupledChanges(ref, coupling, unanalyzedLangs);
  stdout.write(report);
  if (!report.endsWith('\n')) stdout.write('\n');
  return 0;
}

/**
 * Entry point invoked by bin/mmd.js when argv[0] === 'document-review'.
 *
 * @param {string[]} rawArgs everything AFTER 'document-review'
 * @param {{ enrich?: function, gitSeam?: function }} [injected] test seams
 * @returns {Promise<number>} exit code
 */
export async function runDocumentReview(rawArgs, injected = {}) {
  const parsed = parseDocumentReviewArgs(rawArgs);
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

  // v0.7.d: --since is a standalone, READ-ONLY staleness query. It returns before
  // any roadmap read / report write — the no-flag dashboard path stays unchanged.
  if (parsed.since) {
    return runSinceMode(root, parsed.since, injected);
  }

  // SPEC_V018A AC-5: --check is a GATE (for pre-push / CI). It must honor the
  // gate-family not-a-git-repo contract (exit 5, mirrors secret-scan/deps-gate):
  // a gate that silently "passes" outside a repo is dishonest. The plain dashboard
  // run does NOT require a git repo (it degrades tags to []), so this check is
  // scoped to --check only — back-compat for the no-flag path.
  if (parsed.check) {
    const isGit = injected.isGitRepo ? injected.isGitRepo(root) : defaultIsGitRepo(root);
    if (!isGit) {
      stderr.write(
        `error: --check needs a git repo at ${root} (it is a pre-push/CI gate).\n` +
        '  Run it inside a git repository, or use the plain `mmdream document-review` dashboard.\n',
      );
      return 5;
    }
  }

  // The roadmap is mandatory input — without it there is nothing to reconcile.
  let roadmapText;
  try {
    roadmapText = readFileSync(path.join(root, 'MAKE_MY_DREAMS.md'), 'utf8');
  } catch (err) {
    stderr.write(
      `error: cannot read MAKE_MY_DREAMS.md at ${root}: ${err.code ? `${err.code}: ` : ''}${err.message}\n` +
      '  mmdream document-review reconciles the §9 roadmap against the inventory; it needs that file.\n',
    );
    return 4;
  }

  // Gather (never throws) + reconcile (pure).
  const inventory = gatherRealInventory(root);
  const reconciliation = reconcileRoadmap({ roadmapText, inventory });

  // Drift / conformance scan (deterministic — dangling refs + stale facts +
  // SPEC_V018A AC-2 wider surface + AC-3 deprecated + AC-4 stale promises).
  const {
    dangling, staleFacts, deprecated, stalePromises, scannedDocs, scannedUx,
  } = scanDrift(root, inventory);

  // Optional LLM enrichment (opt-in, graceful fallback).
  let llm = { requested: false, enrichment: null, note: null };
  let semantic = { requested: false, text: null, note: null };
  if (parsed.withClaude) {
    const enrichFn = injected.enrich || enrichWithClaude;
    const { enrichment, note } = enrichFn({ reconciliation, inventory });
    llm = { requested: true, enrichment, note };

    // Opt-in SEMANTIC drift pass (separate seam, same honest-fallback discipline).
    const driftFn = injected.semanticDrift || semanticDriftWithClaude;
    const { text, note: dnote } = driftFn({ inventory, dangling, staleFacts });
    semantic = { requested: true, text, note: dnote };
  }

  const drift = {
    dangling, staleFacts, deprecated, stalePromises, scannedDocs, scannedUx, semantic,
  };
  const report = renderCoherenceReport({ inventory, reconciliation, llm, drift, version: VERSION });

  if (parsed.dryRun) {
    stdout.write(report);
    if (!report.endsWith('\n')) stdout.write('\n');
    return 0;
  }

  const reportPath = path.join(root, REPORT_REL_PATH);
  try {
    writeFileSync(reportPath, report, 'utf8');
  } catch (err) {
    stderr.write(`error: cannot write ${REPORT_REL_PATH}: ${err.message}\n`);
    return 3;
  }

  // Summary (honest counts from the inventory + reconciliation).
  const entries = reconciliation.entries || [];
  const count = (s) => entries.filter((e) => e.status === s).length;
  const flags = [];
  for (const d of inventory.docLineCounts || []) {
    if (d.overCap) flags.push(`${d.doc} over cap`);
  }
  stdout.write(
    `Coherence review written to ${REPORT_REL_PATH}\n` +
    `  Roadmap §9: ${count('built')} built · ${count('partial')} partial · ` +
    `${count('unbuilt')} unbuilt · ${count('unknown')} unknown (heuristic).\n` +
    `  Inventory: ${inventory.subcommands.length} subcommands · ${inventory.adrs.length} ADRs · ` +
    `${inventory.lessonCount == null ? '?' : inventory.lessonCount} lessons · ${inventory.specCount} root SPECs.\n` +
    `  Drift: ${dangling.length} dangling reference${dangling.length === 1 ? '' : 's'} · ` +
    `${staleFacts.length} stale fact${staleFacts.length === 1 ? '' : 's'} · ` +
    `${deprecated.length} deprecated-surface · ${stalePromises.length} stale promise${stalePromises.length === 1 ? '' : 's'} ` +
    `(scanned ${scannedDocs} truth docs + ${scannedUx} UX-text surfaces, heuristic).\n` +
    (flags.length ? `  Doc-health: ${flags.join(', ')}.\n` : '  Doc-health: no length-cap flags.\n') +
    (llm.requested && !llm.enrichment ? `  (--with-claude enrichment unavailable: ${llm.note})\n` : '') +
    (semantic.requested && !semantic.text ? `  (--with-claude semantic drift unavailable: ${semantic.note})\n` : '') +
    '  Read-only: nothing else in the repo was modified. Regenerate after material changes.\n',
  );

  // SPEC_V018A AC-5: --check is the GATE (teeth). The dashboard is already written
  // (identical to the plain run); now set the exit from CONFORMANCE drift only.
  // The roadmap reconciliation is a noisy heuristic — it does NOT gate (advisory
  // only, mirroring deps-gate's "single signals stay advisory"). A clean repo
  // exits 0; ANY dangling ref / stale fact / stale promise / deprecated-surface
  // finding exits 1 (pre-push / CI fails honestly).
  if (parsed.check) {
    const driftTotal = dangling.length + staleFacts.length + deprecated.length + stalePromises.length;
    if (driftTotal > 0) {
      stderr.write(
        `\ndocument-review --check: FAIL — ${driftTotal} conformance drift finding${driftTotal === 1 ? '' : 's'} ` +
        `(${dangling.length} dangling · ${staleFacts.length} stale fact${staleFacts.length === 1 ? '' : 's'} · ` +
        `${deprecated.length} deprecated-surface · ${stalePromises.length} stale promise${stalePromises.length === 1 ? '' : 's'}).\n` +
        `  See ${REPORT_REL_PATH} for the details. (The roadmap heuristic is advisory and does NOT affect this gate.)\n`,
      );
      return 1;
    }
    stdout.write('document-review --check: PASS — no conformance drift.\n');
  }
  return 0;
}
