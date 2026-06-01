#!/usr/bin/env node
// bin/documentalist/document-review.js — `mmd document-review` entry point
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
} from '../../lib/documentalist/conformance.js';

// The curated "truth docs" scanned for drift/conformance (SPEC_V07B AC-3/AC-4).
// These are the OPERATIONAL docs that claim artifacts exist NOW. We DELIBERATELY
// exclude MAKE_MY_DREAMS.md (the design/roadmap doc — intentionally aspirational,
// full of forward-looking `mmd watch`/`mmd dream` prose; it is already covered by
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

const USAGE = `mmd document-review — the Documentalist's coherence review (SPEC_V07A)

Usage:
  mmd document-review [--with-claude] [--dry-run]
  mmd document-review --help

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

Flags:
  --with-claude  Layer an LLM judgment pass on top of the deterministic
                 reconciliation (opt-in). On absent/non-zero/unparseable claude,
                 falls back to the deterministic report with an honest note —
                 never a fabricated classification.
  --dry-run      Print the report to stdout; write nothing.
  --help, -h     Print this usage and exit 0.

Exit codes:
  0  ok (written, or printed under --dry-run)
  2  user/argv error
  3  cannot write ${REPORT_REL_PATH}
  4  MAKE_MY_DREAMS.md unreadable (no roadmap to reconcile)

mmd ${VERSION}
`;

/**
 * Parse the few document-review flags. Mirrors the document-readme contract:
 * boolean flags only, unknown flag → exit 2, no positionals.
 *
 * @param {string[]} rawArgs
 * @returns {{ withClaude: boolean, dryRun: boolean, help: boolean, error: { message: string, exitCode: number }|null }}
 */
export function parseDocumentReviewArgs(rawArgs) {
  const out = { withClaude: false, dryRun: false, help: false, error: null };
  if (!Array.isArray(rawArgs)) {
    out.error = { message: 'parseDocumentReviewArgs: rawArgs must be an array', exitCode: 2 };
    return out;
  }
  for (const tok of rawArgs) {
    if (tok === '--with-claude') out.withClaude = true;
    else if (tok === '--dry-run') out.dryRun = true;
    else if (tok === '--help' || tok === '-h') out.help = true;
    else {
      out.error = {
        message: `unknown document-review arg: '${tok}'. Run 'mmd document-review --help' to see supported flags.`,
        exitCode: 2,
      };
      return out;
    }
  }
  return out;
}

/**
 * The repo's REAL subcommand set — the authority for subcommand conformance.
 *
 * The argv-parser SUBCOMMANDS export is the documented list, but it can lag the
 * actual dispatch (e.g. `mmd lessons` is dispatched in bin/mmd.js yet missing
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
 * @param {string} root
 */
function gatherRealInventory(root) {
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
 * Run the deterministic drift / conformance scan (AC-3/AC-4). Pure-ish: the
 * only I/O is reading the truth docs + the injected fileExistsFn; the judgment
 * is the two pure conformance checks.
 *
 * @param {string} root
 * @param {object} inventory
 * @returns {{ dangling: object[], staleFacts: object[], scannedDocs: number }}
 */
function scanDrift(root, inventory) {
  const truthDocs = gatherTruthDocs(root);
  const docRefs = [];
  for (const { doc, text } of truthDocs) {
    for (const r of extractDocRefs(text)) docRefs.push({ ...r, doc });
  }
  const fileExistsFn = (rel) => existsSync(path.join(root, rel));
  const dangling = checkArtifactConformance({ docRefs, inventory, fileExistsFn });
  // Fact conformance only on the living current-state docs (counts in historical
  // ADRs/lessons are correct-as-of-writing, not drift).
  const factDocs = truthDocs.filter((d) => CURRENT_STATE_DOCS.has(d.doc));
  const staleFacts = checkFactConformance({ docs: factDocs, inventory });
  return { dangling, staleFacts, scannedDocs: truthDocs.length };
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

/**
 * Entry point invoked by bin/mmd.js when argv[0] === 'document-review'.
 *
 * @param {string[]} rawArgs everything AFTER 'document-review'
 * @param {{ enrich?: function }} [injected] test seam for the claude enrichment
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

  // The roadmap is mandatory input — without it there is nothing to reconcile.
  let roadmapText;
  try {
    roadmapText = readFileSync(path.join(root, 'MAKE_MY_DREAMS.md'), 'utf8');
  } catch (err) {
    stderr.write(
      `error: cannot read MAKE_MY_DREAMS.md at ${root}: ${err.code ? `${err.code}: ` : ''}${err.message}\n` +
      '  mmd document-review reconciles the §9 roadmap against the inventory; it needs that file.\n',
    );
    return 4;
  }

  // Gather (never throws) + reconcile (pure).
  const inventory = gatherRealInventory(root);
  const reconciliation = reconcileRoadmap({ roadmapText, inventory });

  // Drift / conformance scan (deterministic — AC-3/AC-4).
  const { dangling, staleFacts, scannedDocs } = scanDrift(root, inventory);

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

  const drift = { dangling, staleFacts, scannedDocs, semantic };
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
    `${staleFacts.length} stale fact${staleFacts.length === 1 ? '' : 's'} (scanned ${scannedDocs} truth docs, heuristic).\n` +
    (flags.length ? `  Doc-health: ${flags.join(', ')}.\n` : '  Doc-health: no length-cap flags.\n') +
    (llm.requested && !llm.enrichment ? `  (--with-claude enrichment unavailable: ${llm.note})\n` : '') +
    (semantic.requested && !semantic.text ? `  (--with-claude semantic drift unavailable: ${semantic.note})\n` : '') +
    '  Read-only: nothing else in the repo was modified. Regenerate after material changes.\n',
  );
  return 0;
}
