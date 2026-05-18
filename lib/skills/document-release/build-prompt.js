// lib/skills/document-release/build-prompt.js — pure prompt builder for
// `mmd document-release` (SPEC_V02G AC-4).
//
// Unlike qa/cso which operate on a slice diff, document-release operates on
// the diff between TWO git refs (last-tag → HEAD by default) and writes a
// markdown release-notes draft.
//
// SRP (universal.md §I.S): assembles a prompt string. No spawn, no fs.

import { resolveSkillPath } from '../_common/skill-path.js';

const DOCUMENT_RELEASE_SKILL_PATH = resolveSkillPath('document-release');

/**
 * Build the prompt that invokes the gStack `document-release` skill end-to-end
 * on a range of commits.
 *
 * @param {{
 *   fromRef: string,
 *   toRef: string,
 *   fromSha: string,
 *   toSha: string,
 *   repoRoot: string,
 *   outputPath: string,
 * }} opts
 * @returns {string}
 */
export function buildDocumentReleasePrompt(opts) {
  if (!opts || typeof opts !== 'object') {
    throw new TypeError('buildDocumentReleasePrompt: opts must be an object');
  }
  const { fromRef, toRef, fromSha, toSha, repoRoot, outputPath } = opts;
  if (typeof fromRef !== 'string' || fromRef.length === 0) {
    throw new TypeError('buildDocumentReleasePrompt: fromRef must be a non-empty string');
  }
  if (typeof toRef !== 'string' || toRef.length === 0) {
    throw new TypeError('buildDocumentReleasePrompt: toRef must be a non-empty string');
  }
  if (typeof fromSha !== 'string' || fromSha.length === 0) {
    throw new TypeError('buildDocumentReleasePrompt: fromSha must be a non-empty string');
  }
  if (typeof toSha !== 'string' || toSha.length === 0) {
    throw new TypeError('buildDocumentReleasePrompt: toSha must be a non-empty string');
  }
  if (typeof repoRoot !== 'string' || repoRoot.length === 0) {
    throw new TypeError('buildDocumentReleasePrompt: repoRoot must be a non-empty string');
  }
  if (typeof outputPath !== 'string' || outputPath.length === 0) {
    throw new TypeError('buildDocumentReleasePrompt: outputPath must be a non-empty string');
  }

  const lines = [
    'You are invoking the gStack `document-release` skill on this MMD repo.',
    '',
    `Repository root : ${repoRoot}`,
    `From ref        : ${fromRef} (resolved to ${fromSha})`,
    `To ref          : ${toRef} (resolved to ${toSha})`,
    `Output draft to : ${outputPath}`,
    '',
    'Task: read and follow the gStack document-release skill at',
    `  ${DOCUMENT_RELEASE_SKILL_PATH}`,
    `and produce a release-notes draft for the range ${fromRef}..${toRef}.`,
    'Inputs you should consult: git log + commit bodies, ADRs in docs/adr/,',
    'lessons-learned diff (docs/lessons-learned.md). This is a headless',
    'invocation (claude -p, no interactive TTY) — do NOT ask for user input.',
    '',
    'Expected output:',
    `  - write a markdown release-notes draft to ${outputPath}`,
    '  - sections: Highlights, Features, Fixes, Docs/ADRs, Lessons learned',
    '  - severity-prefixed entries (feat/fix/docs/test/refactor/chore)',
    '  - human-readable summary at the top suitable for a GitHub release',
    '  - advisory draft — the user reviews and edits before publishing',
    '',
    'Constraints:',
    '  - NEVER push commits, NEVER open PRs, NEVER create tags.',
    '  - Write to the supplied outputPath only — do not modify CHANGELOG.md or',
    '    any tracked file. The user will move/rename the draft as needed.',
    '  - Respect the project constitution at .specify/memory/constitution/*.md.',
  ];

  return lines.join('\n');
}

/**
 * Return the anchor list a unit test should look for in a
 * buildDocumentReleasePrompt output.
 *
 * @param {{fromRef: string, toRef: string, fromSha: string, toSha: string, outputPath: string}} opts
 * @returns {string[]}
 */
export function documentReleasePromptAnchors({ fromRef, toRef, fromSha, toSha, outputPath }) {
  return [
    fromRef,
    toRef,
    fromSha,
    toSha,
    outputPath,
    DOCUMENT_RELEASE_SKILL_PATH,
    'headless',
    'gstack',
  ];
}

export { DOCUMENT_RELEASE_SKILL_PATH };
