// lib/discover/report.js — REPORT phase: assemble mmd-discovery-report.md.
//
// SRP: pure-string transformation from {scanData, ingestData, inferredMd,
// caseLabel, version, clock} → markdown. The orchestrator does I/O.
//
// Spec: SPEC_V02C AC-5. Output is deterministic given the same inputs (mod
// the timestamp — accepted as a `clock` arg for testability).

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { assertSafeWritePath } from './safe-write.js';

/**
 * Human-readable label for each case from classify.js.
 *
 * @type {Record<string, string>}
 */
const CASE_LABELS = Object.freeze({
  'rich': 'Rich (Spec Kit + BMAD)',
  'bmad-alone': 'BMAD-alone (possible spec sprawl)',
  'blank': 'Blank (no SDD methodology)',
  'already-onboarded': 'Already-onboarded (refresh)',
});

/**
 * Build the SCANNED bullets. Deterministic. Methodologies listed in a fixed
 * order so report diffs stay stable.
 *
 * @param {object} scanData
 * @returns {string[]}
 */
function scannedSection(scanData) {
  const m = scanData.methodologies || {};
  const detected = [];
  if (m.spec_kit) detected.push('Spec Kit (.specify/)');
  if (m.bmad) detected.push('BMAD (_bmad/)');
  if (m.openspec) detected.push('OpenSpec (openspec/)');
  if (m.stories_dir) detected.push(`docs/stories/ (${m.stories_count} files)`);
  if (m.adr_dir) detected.push('docs/adr/');
  if (m.mmd_dir) detected.push('.mmd/ (previously onboarded)');
  if (m.claude_md) detected.push('CLAUDE.md');
  if (m.mmd_md) detected.push('MAKE_MY_DREAMS.md (this is MMD itself)');
  const methList = detected.length > 0 ? detected.join(', ') : 'none recognized';

  const f = scanData.frameworks || {};
  const langs = scanData.languages || { top5: [] };
  const primary = f.language || (langs.top5[0] || 'unknown');
  const secondary = langs.top5.slice(1).join(', ') || 'none';
  const fr = (f.frameworks && f.frameworks.length > 0) ? f.frameworks.join(', ') : 'none detected';
  const runner = f.test_runner || 'none detected';

  // L-017 (AC-2): surface the recursively-counted test-file total.
  const testsInfo = scanData.tests || { count: 0, dirs: [] };
  const testCount = Number.isFinite(testsInfo.count) ? testsInfo.count : 0;
  const testDirs = Array.isArray(testsInfo.dirs) && testsInfo.dirs.length > 0
    ? ` in ${testsInfo.dirs.join(', ')}`
    : '';

  const git = scanData.git || { is_git_repo: false };
  let gitLine;
  if (git.is_git_repo === false) {
    gitLine = 'not a git repo';
  } else {
    const branch = git.default_branch || 'unknown';
    const since = git.first_commit_iso ? git.first_commit_iso.slice(0, 10) : 'unknown';
    const n90 = git.commits_last_90d ?? 'unknown';
    gitLine = `since ${since}, ${n90} commits in last 90 days, branch: ${branch}`;
  }

  return [
    `- Methodologies: ${methList}`,
    `- Languages: ${primary} (+ ${secondary})`,
    `- Frameworks: ${fr}`,
    `- Test runner: ${runner}`,
    `- Git: ${gitLine}`,
  ];
}

/**
 * Build the INGESTED bullets from the ingest result.
 *
 * @param {object} ingestData
 * @returns {string[]}
 */
/**
 * Convert an absolute path to a friendlier relative form when possible;
 * tolerates missing values (returns '(unknown path)') so the report never
 * crashes on a partial ingest payload.
 *
 * @param {string|undefined|null} p
 */
function relish(p) {
  if (typeof p !== 'string' || p.length === 0) return '(unknown path)';
  try {
    const r = path.relative('.', p);
    return r.length > 0 ? r : p;
  } catch {
    return p;
  }
}

function ingestedSection(ingestData) {
  const out = [];
  if (!ingestData) return ['- (nothing to ingest)'];
  if (ingestData.spec_kit_constitution) {
    out.push(`- Spec Kit constitution → ${relish(ingestData.spec_kit_constitution.writtenPath)}`);
  }
  if (ingestData.bmad_stories) {
    const n = (ingestData.bmad_stories.stories || []).length;
    out.push(`- ${n} BMAD story file(s) consolidated → ${relish(ingestData.bmad_stories.writtenPath)}`);
  }
  if (ingestData.openspec) {
    out.push(`- OpenSpec files (${ingestData.openspec.files.length}) → ${relish(ingestData.openspec.writtenDir)}`);
  }
  if (ingestData.loose_specs) {
    out.push(`- Loose specs at root (${ingestData.loose_specs.files.length}) listed in ${relish(ingestData.loose_specs.writtenPath)}`);
  }
  if (out.length === 0) return ['- (nothing to ingest)'];
  return out;
}

/**
 * Compute hypotheses + contradictions for the report. Hypotheses are
 * deterministic prompts the user should validate; contradictions surface
 * when two signals disagree (e.g. methodology says Spec Kit but no
 * constitution file was importable).
 *
 * @param {object} scanData
 * @param {object} ingestData
 * @param {string} caseLabel
 * @returns {{ hypotheses: string[], contradictions: string[] }}
 */
function hypothesesAndContradictions(scanData, ingestData, caseLabel) {
  const hypotheses = [];
  const contradictions = [];
  const m = scanData.methodologies || {};

  if (caseLabel === 'rich') {
    if (ingestData && ingestData.spec_kit_constitution) {
      hypotheses.push(
        'The imported Spec Kit constitution differs from MMD\'s default — ' +
        'review at `.mmd/shared/constitution/imported.md` before any code change.',
      );
    }
    if (ingestData && ingestData.bmad_stories) {
      const counts = countStatuses(ingestData.bmad_stories.stories);
      hypotheses.push(
        `BMAD stories breakdown — done: ${counts.done}, in-progress: ${counts['in-progress']}, ` +
        `draft: ${counts.draft}, unknown: ${counts.unknown}. ` +
        `Review at \`.mmd/shared/status.json\`.`,
      );
    }
  }

  if (caseLabel === 'bmad-alone') {
    const n = m.stories_count || 0;
    const done = ingestData && ingestData.bmad_stories
      ? countStatuses(ingestData.bmad_stories.stories).done
      : 0;
    hypotheses.push(
      `${n} stories detected, ${done} marked done — recommend cross-check ` +
      `vs real code (deferred to v0.2c+, per SPEC_V02C §4).`,
    );
    hypotheses.push(
      'Story-vs-code drift cannot be validated automatically yet. ' +
      'Sample-check a few "done" stories manually before approving.',
    );
  }

  if (caseLabel === 'blank') {
    hypotheses.push(
      'No SDD methodology detected — auto-dev will rely entirely on the inferred ' +
      'stack section. Validate that the inferred test runner + lint setup matches reality.',
    );
    hypotheses.push(
      'If the project has an unwritten convention (e.g. naming pattern not visible ' +
      'in the manifests), note it in the report under "Hypotheses" before approving.',
    );
  }

  if (caseLabel === 'already-onboarded') {
    hypotheses.push(
      'A previous VALIDATED report exists at `.mmd/shared/project-onboarder/last.md`. ' +
      'Re-run with `--refresh` to regenerate from scratch.',
    );
  }

  // Contradictions: signal says Spec Kit but ingest could not find a constitution.
  if (m.spec_kit && ingestData && !ingestData.spec_kit_constitution) {
    contradictions.push(
      'Spec Kit directory detected (`.specify/`) but no `memory/constitution.md` ' +
      'or `memory/constitution/index.md` was importable.',
    );
  }
  if (m.bmad && m.stories_dir && (!ingestData || !ingestData.bmad_stories)) {
    contradictions.push(
      'BMAD methodology and `docs/stories/` detected but no story files could be read.',
    );
  }

  return { hypotheses, contradictions };
}

/**
 * Count story statuses for a stories[] array.
 *
 * @param {Array<{status: string}>} stories
 * @returns {{ done: number, 'in-progress': number, draft: number, unknown: number }}
 */
function countStatuses(stories) {
  const out = { done: 0, 'in-progress': 0, draft: 0, unknown: 0 };
  for (const s of stories) {
    if (out[s.status] === undefined) out.unknown += 1;
    else out[s.status] += 1;
  }
  return out;
}

/**
 * Pick the "suggested next step" line based on case + ingest results.
 *
 * @param {string} caseLabel
 * @param {object} ingestData
 * @returns {string}
 */
function suggestedNextStep(caseLabel, ingestData) {
  if (caseLabel === 'already-onboarded') {
    return 'Run `mmd discover --refresh` if anything material changed, or proceed with `mmd --here "<change>"`.';
  }
  if (caseLabel === 'rich' && ingestData && ingestData.spec_kit_constitution) {
    return 'Validate the imported Spec Kit constitution at `.mmd/shared/constitution/imported.md`, then run `mmd discover --approve`.';
  }
  if (caseLabel === 'bmad-alone') {
    return 'Triage the stories at `.mmd/shared/status.json` (archive stale ones), then run `mmd discover --approve`.';
  }
  // blank or rich-without-constitution.
  return 'Review this report, then run `mmd discover --approve` followed by `mmd --here "<small change>"` to test.';
}

/**
 * Assemble the full report markdown. Pure transform. Tests freeze `clock` to
 * lock the timestamp.
 *
 * @param {object} args
 * @param {string} args.targetDir       absolute path of target
 * @param {object} args.scanData        SCAN payload
 * @param {object} args.ingestData      INGEST result (may have null fields)
 * @param {string} args.inferredMd      INFER markdown body (rendered into "Inferred" section)
 * @param {string} args.caseLabel       one of classify.js DISCOVERY_CASES
 * @param {string} args.version         MMD version string (read from package.json by caller)
 * @param {Date}   [args.clock]         injected timestamp (defaults to new Date())
 * @returns {string}
 */
export function buildReport({ targetDir, scanData, ingestData, inferredMd, caseLabel, version, clock }) {
  const now = clock instanceof Date ? clock : new Date();
  const detectedLabel = CASE_LABELS[caseLabel] || caseLabel;
  const { hypotheses, contradictions } = hypothesesAndContradictions(scanData, ingestData, caseLabel);
  const inferredBody = inferredMd
    .replace(/^# Inferred conventions\n+/, '')
    .replace(/^> Generated by[^\n]*\n+/, '')
    .trim();

  const lines = [];
  lines.push('# MMD Discovery Report');
  lines.push('');
  lines.push(`> Generated by \`mmd discover\` at ${now.toISOString()} on ${targetDir}`);
  lines.push('> Status: PENDING VALIDATION — run `mmd discover --approve` after review');
  lines.push(`> MMD version: ${version}`);
  lines.push('');
  lines.push('## Detected case');
  lines.push(detectedLabel);
  lines.push('');
  lines.push('## Scanned');
  for (const b of scannedSection(scanData)) lines.push(b);
  lines.push('');
  lines.push('## Ingested');
  for (const b of ingestedSection(ingestData)) lines.push(b);
  lines.push('');
  lines.push('## Inferred');
  lines.push(inferredBody);
  lines.push('');
  lines.push('## Hypotheses to validate (please review)');
  if (hypotheses.length === 0) {
    lines.push('1. (no specific hypotheses generated — proceed with caution)');
  } else {
    hypotheses.forEach((h, i) => lines.push(`${i + 1}. ${h}`));
  }
  lines.push('');
  if (contradictions.length > 0) {
    lines.push('## Contradictions / surprises');
    for (const c of contradictions) lines.push(`- ${c}`);
    lines.push('');
  }
  lines.push('## Suggested next step');
  lines.push(suggestedNextStep(caseLabel, ingestData));
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('*This report was generated automatically. Edit it freely to correct errors; re-run `mmd discover --refresh` to regenerate from scratch.*');
  lines.push('');
  return lines.join('\n');
}

/**
 * Persist the report to both `<target>/mmd-discovery-report.md` (the user-
 * visible file) and `<target>/.mmd/shared/project-onboarder/last.md` (the
 * audit-trail snapshot).
 *
 * @param {string} targetDir
 * @param {string} reportContent
 * @param {{ skipRootReport?: boolean }} [opts]  honors --no-report-update
 * @returns {Promise<{ rootPath: string|null, lastPath: string }>}
 */
export async function writeReport(targetDir, reportContent, opts = {}) {
  const lastDir = path.join(targetDir, '.mmd', 'shared', 'project-onboarder');
  const lastPath = path.join(lastDir, 'last.md');
  await assertSafeWritePath(targetDir, lastPath);
  await mkdir(lastDir, { recursive: true });
  await writeFile(lastPath, reportContent, 'utf8');

  if (opts.skipRootReport) {
    return { rootPath: null, lastPath };
  }
  const rootPath = path.join(targetDir, 'mmd-discovery-report.md');
  await assertSafeWritePath(targetDir, rootPath);
  await writeFile(rootPath, reportContent, 'utf8');
  return { rootPath, lastPath };
}

/**
 * Flip the `Status:` line in an existing report from PENDING VALIDATION to
 * VALIDATED at <iso>. Used by `mmd discover --approve`. The match is robust
 * to small format variations (leading >, whitespace).
 *
 * @param {string} reportContent
 * @param {Date}   [clock]
 * @returns {string}  updated content
 * @throws {Error}   when no PENDING VALIDATION line was found (the report
 *                   is either already validated or malformed)
 */
export function flipReportToValidated(reportContent, clock) {
  const now = clock instanceof Date ? clock : new Date();
  const stamp = now.toISOString();
  const re = /^(\s*>?\s*Status:\s*)(PENDING VALIDATION)([^\n]*)$/m;
  if (!re.test(reportContent)) {
    throw new Error(
      'flipReportToValidated: no `Status: PENDING VALIDATION` line found ' +
      '— report is either already validated or malformed',
    );
  }
  return reportContent.replace(re, (_match, p1) => `${p1}VALIDATED at ${stamp}`);
}
