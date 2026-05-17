// lib/ship/build-prompt.js — pure function that constructs the gStack-ship
// invocation prompt sent to `claude -p` (SPEC_V02F AC-4 + AC-5).
//
// SRP (universal.md §I.S): this module knows ONLY how to assemble a prompt
// string. It does NOT spawn processes, read files, or touch the filesystem.
// All git-derived values (branch, base, SHA) are caller-provided so the
// function is deterministic and trivially testable.
//
// Security (security.md §I): the prompt is a natural-language string. We do
// NOT shell-interpolate. Callers MUST pass the prompt as a single argv
// element to spawn() with shell=false (see lib/ship/invoke-claude.js).

const SHIP_SKILL_PATH = '~/.claude/skills/gstack/ship/SKILL.md';

/**
 * Build the prompt body delivered to `claude -p` to invoke the gStack ship
 * skill end-to-end on a given slice branch.
 *
 * Constraint anchors (verified by unit tests):
 *   - mentions the branch, base, sha verbatim (so the skill knows what to ship)
 *   - references the gStack ship skill path (SKILL.md) so the LLM loads it
 *   - includes a "no prompts, headless" directive (claude -p is non-interactive)
 *   - includes a "audit-pillars will run after you exit" reminder (AC-7)
 *
 * @param {{
 *   branch: string,
 *   baseBranch: string,
 *   sha: string,
 *   repoRoot: string,
 *   tagPrefix?: string,
 * }} opts
 * @returns {string}
 */
export function buildShipPrompt(opts) {
  if (!opts || typeof opts !== 'object') {
    throw new TypeError('buildShipPrompt: opts must be an object');
  }
  const { branch, baseBranch, sha, repoRoot, tagPrefix = 'v' } = opts;
  if (typeof branch !== 'string' || branch.length === 0) {
    throw new TypeError('buildShipPrompt: branch must be a non-empty string');
  }
  if (typeof baseBranch !== 'string' || baseBranch.length === 0) {
    throw new TypeError('buildShipPrompt: baseBranch must be a non-empty string');
  }
  if (typeof sha !== 'string' || sha.length === 0) {
    throw new TypeError('buildShipPrompt: sha must be a non-empty string');
  }
  if (typeof repoRoot !== 'string' || repoRoot.length === 0) {
    throw new TypeError('buildShipPrompt: repoRoot must be a non-empty string');
  }

  const lines = [
    'You are invoking the gStack `ship` skill on this MMD slice.',
    '',
    `Repository root: ${repoRoot}`,
    `Slice branch   : ${branch}`,
    `Base branch    : ${baseBranch}`,
    `Branch tip SHA : ${sha}`,
    `Tag prefix     : ${tagPrefix}`,
    '',
    'Task: read and follow the gStack ship skill at',
    `  ${SHIP_SKILL_PATH}`,
    'and execute its 20-step workflow on the slice above. This is a headless',
    'invocation (claude -p, no interactive TTY) — do NOT ask for user input.',
    'When the skill asks for a confirmation, proceed with the default action.',
    '',
    'Expected outputs:',
    '  - merge-base verified, tests run against the merge result',
    '  - semver bump derived from the diff (and from package.json)',
    '  - CHANGELOG updated',
    '  - WIP commits squashed if appropriate',
    '  - tag created with the resolved version',
    '  - branch pushed, tag pushed',
    '  - PR opened if upstream supports it',
    '',
    'Constraints:',
    '  - NEVER force-push main / master.',
    '  - NEVER skip git hooks (--no-verify, --no-gpg-sign).',
    '  - NEVER commit secrets or generated artifacts not already tracked.',
    '  - Respect the project constitution at .specify/memory/constitution/*.md.',
    '',
    'After you exit, MMD will run scripts/audit-pillars.sh against',
    `${baseBranch}..${branch} and surface the pillar-invocation table to the user. The`,
    'audit is advisory; it does not gate your ship.',
  ];

  return lines.join('\n');
}

/**
 * Return the anchor list a unit test (or a sub-agent) should look for inside
 * a prompt produced by buildShipPrompt. Exposed for round-trip introspection
 * tests (assert the prompt contains every anchor).
 *
 * @param {{branch: string, baseBranch: string, sha: string}} opts
 * @returns {string[]}
 */
export function shipPromptAnchors({ branch, baseBranch, sha }) {
  return [
    branch,
    baseBranch,
    sha,
    SHIP_SKILL_PATH,
    'audit-pillars',
    'headless',
  ];
}

export { SHIP_SKILL_PATH };
