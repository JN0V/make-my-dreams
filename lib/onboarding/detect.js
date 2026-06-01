// lib/onboarding/detect.js — pure readiness probe for MMD's first-run setup.
//
// SRP (universal.md §I.S): owns ONLY the question "does this repo have what
// `mmd --here` needs to run?". No prompting, no spawning, no mutation — just
// synchronous fs reads over a closed list of marker paths. This lets the
// first-run guard (setup.js) and its tests reason about readiness without a
// shell or a TTY.
//
// Spec: SPEC_V06A AC-2. `detectMmdSetup(targetDir)` returns
// `{ ready: boolean, missing: string[] }`. It NEVER throws — an unreadable or
// odd path degrades to `ready:false` (error-handling.md §III graceful
// degradation): the safe default is "not set up", which the guard handles by
// offering setup, never by crashing the run.

import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * The minimum set `mmd --here` needs in the target repo. install-mmd.sh
 * materializes all of these (Phase 2 writes the constitution; the auto-dev
 * phase writes the workflow + the `.claude/commands` adv slash-command).
 *
 * Kept as relative POSIX-style paths so the human-readable `missing[]` entries
 * name exactly the files a user would look for.
 */
export const CONSTITUTION_REL = '.specify/memory/constitution.md';
export const AUTODEV_WORKFLOW_REL = '_bmad/adv/workflows/auto-dev/workflow.md';
export const ADV_COMMAND_REL = '.claude/commands/bmad-adv-auto-dev.md';

/**
 * True if `targetDir/rel` exists as a regular file. Never throws: any fs error
 * (ENOENT, EACCES, ELOOP, a non-string targetDir) reads as "not present".
 *
 * @param {string} targetDir
 * @param {string} rel
 * @returns {boolean}
 */
function fileExists(targetDir, rel) {
  try {
    const full = path.join(targetDir, rel);
    return existsSync(full) && statSync(full).isFile();
  } catch {
    return false;
  }
}

/**
 * Probe whether the target repo is ready for `mmd --here`.
 *
 * Two requirements, each named in plain language if absent (universal.md §VII):
 *   1. the project constitution at `.specify/memory/constitution.md`
 *   2. MMD's auto-dev workflow — present if EITHER the workflow file
 *      (`_bmad/adv/workflows/auto-dev/workflow.md`) OR the adv slash-command
 *      (`.claude/commands/bmad-adv-auto-dev.md`) exists. Either is enough to
 *      drive auto-dev, so we require the pair, not both files.
 *
 * @param {string} targetDir absolute path to the repo being onboarded
 * @returns {{ ready: boolean, missing: string[] }}
 */
export function detectMmdSetup(targetDir) {
  const missing = [];

  if (!fileExists(targetDir, CONSTITUTION_REL)) {
    missing.push(`the project constitution (${CONSTITUTION_REL})`);
  }

  const hasWorkflow = fileExists(targetDir, AUTODEV_WORKFLOW_REL);
  const hasAdvCommand = fileExists(targetDir, ADV_COMMAND_REL);
  if (!hasWorkflow && !hasAdvCommand) {
    missing.push(
      `the MMD auto-dev workflow (${AUTODEV_WORKFLOW_REL} ` +
        `or the ${ADV_COMMAND_REL} command)`,
    );
  }

  return { ready: missing.length === 0, missing };
}
