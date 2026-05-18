// lib/skills/cso/build-prompt.js — pure prompt builder for `mmd cso`
// (SPEC_V02G AC-3). Mirrors lib/skills/qa/build-prompt.js shape.
//
// SRP (universal.md §I.S): assembles a prompt string. No spawn, no fs.

import { resolveSkillPath } from '../_common/skill-path.js';

const CSO_SKILL_PATH = resolveSkillPath('cso');

/**
 * Build the prompt body that invokes the gStack `cso` (Chief Security Officer)
 * skill end-to-end on a slice's diff.
 *
 * @param {{
 *   branch: string,
 *   baseBranch: string,
 *   sha: string,
 *   repoRoot: string,
 * }} opts
 * @returns {string}
 */
export function buildCsoPrompt(opts) {
  if (!opts || typeof opts !== 'object') {
    throw new TypeError('buildCsoPrompt: opts must be an object');
  }
  const { branch, baseBranch, sha, repoRoot } = opts;
  if (typeof branch !== 'string' || branch.length === 0) {
    throw new TypeError('buildCsoPrompt: branch must be a non-empty string');
  }
  if (typeof baseBranch !== 'string' || baseBranch.length === 0) {
    throw new TypeError('buildCsoPrompt: baseBranch must be a non-empty string');
  }
  if (typeof sha !== 'string' || sha.length === 0) {
    throw new TypeError('buildCsoPrompt: sha must be a non-empty string');
  }
  if (typeof repoRoot !== 'string' || repoRoot.length === 0) {
    throw new TypeError('buildCsoPrompt: repoRoot must be a non-empty string');
  }

  const lines = [
    'You are invoking the gStack `cso` skill on this MMD slice.',
    '',
    `Repository root: ${repoRoot}`,
    `Slice branch   : ${branch}`,
    `Base branch    : ${baseBranch}`,
    `Branch tip SHA : ${sha}`,
    '',
    'Task: read and follow the gStack cso skill at',
    `  ${CSO_SKILL_PATH}`,
    'and execute its Bundle A security audit on the slice above:',
    '  - secret scanning (committed keys, tokens, .env exposure)',
    '  - dependency audit (npm audit / known CVEs / slopsquatting risk)',
    '  - lethal trifecta check (untrusted input + private data + exfiltration)',
    '  - sandbox / settings.json configuration validation',
    'This is a headless invocation (claude -p, no interactive TTY) — do NOT',
    'ask for user input.',
    '',
    'Expected outputs:',
    '  - severity-graded findings (critical / high / medium / low / info)',
    '  - per-finding remediation hint',
    '  - advisory report — no commits / no pushes are made by this command',
    '',
    'Constraints:',
    '  - NEVER modify production source code (cso is read-only / advisory).',
    '  - NEVER exfiltrate secrets to network endpoints (read-only scan).',
    '  - Respect the project constitution at .specify/memory/constitution/*.md.',
  ];

  return lines.join('\n');
}

/**
 * Return the anchor list a unit test should look for in a buildCsoPrompt
 * output.
 *
 * @param {{branch: string, baseBranch: string, sha: string}} opts
 * @returns {string[]}
 */
export function csoPromptAnchors({ branch, baseBranch, sha }) {
  return [branch, baseBranch, sha, CSO_SKILL_PATH, 'headless', 'gstack'];
}

export { CSO_SKILL_PATH };
