// lib/skills/qa/build-prompt.js — pure prompt builder for `mmd qa`
// (SPEC_V02G AC-2). Mirrors lib/skills/ship/build-prompt.js shape so the
// pattern is uniform across all skill wrappers.
//
// SRP (universal.md §I.S): assembles a prompt string. No spawn, no fs.
// Security (security.md §I): caller passes prompt as a single argv element
// with shell=false (see lib/skills/_common/invoke-claude.js).

import { resolveSkillPath } from '../_common/skill-path.js';

// Resolved at module load. Tilde-form (~/.claude/skills/gstack/qa/SKILL.md)
// when MMD_GSTACK_SKILLS_DIR is unset — preserves the F4 Option B snapshot
// shape inherited from the ship wrapper.
const QA_SKILL_PATH = resolveSkillPath('qa');

/**
 * Build the prompt body that invokes the gStack `qa` skill end-to-end on a
 * branch's diff vs the base.
 *
 * @param {{
 *   branch: string,
 *   baseBranch: string,
 *   sha: string,
 *   repoRoot: string,
 * }} opts
 * @returns {string}
 */
export function buildQaPrompt(opts) {
  if (!opts || typeof opts !== 'object') {
    throw new TypeError('buildQaPrompt: opts must be an object');
  }
  const { branch, baseBranch, sha, repoRoot } = opts;
  if (typeof branch !== 'string' || branch.length === 0) {
    throw new TypeError('buildQaPrompt: branch must be a non-empty string');
  }
  if (typeof baseBranch !== 'string' || baseBranch.length === 0) {
    throw new TypeError('buildQaPrompt: baseBranch must be a non-empty string');
  }
  if (typeof sha !== 'string' || sha.length === 0) {
    throw new TypeError('buildQaPrompt: sha must be a non-empty string');
  }
  if (typeof repoRoot !== 'string' || repoRoot.length === 0) {
    throw new TypeError('buildQaPrompt: repoRoot must be a non-empty string');
  }

  const lines = [
    'You are invoking the gStack `qa` skill on this MMD slice.',
    '',
    `Repository root: ${repoRoot}`,
    `Slice branch   : ${branch}`,
    `Base branch    : ${baseBranch}`,
    `Branch tip SHA : ${sha}`,
    '',
    'Task: read and follow the gStack qa skill at',
    `  ${QA_SKILL_PATH}`,
    'and execute its workflow (test stratification @smoke/@unit/@integration/@e2e,',
    'adversarial test pass, failure classification T1..T4). This is a headless',
    'invocation (claude -p, no interactive TTY) — do NOT ask for user input.',
    '',
    'Expected outputs:',
    '  - tests run against the slice diff vs base',
    '  - failures classified: T1 (in-branch new), T2 (pre-existing flake),',
    '    T3 (infra/env), T4 (obsolete-deleted-spec)',
    '  - suggested fix or follow-up per failure',
    '  - advisory report — no commits / no pushes are made by this command',
    '',
    'Constraints:',
    '  - NEVER modify production source code (qa is read-only / advisory).',
    '  - NEVER push, commit, or open PRs (qa reports — it does not ship).',
    '  - Respect the project constitution at .specify/memory/constitution/*.md.',
  ];

  return lines.join('\n');
}

/**
 * Return the anchor list a unit test (or sub-agent) should look for in a
 * prompt produced by buildQaPrompt.
 *
 * @param {{branch: string, baseBranch: string, sha: string}} opts
 * @returns {string[]}
 */
export function qaPromptAnchors({ branch, baseBranch, sha }) {
  return [branch, baseBranch, sha, QA_SKILL_PATH, 'headless', 'gstack'];
}

export { QA_SKILL_PATH };
