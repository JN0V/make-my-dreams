// lib/onboarding/detect-bmad-skill.js — preflight for the greenfield / `mmdream serve`
// flow's hard dependency on the BMAD `bmad-product-brief` skill.
//
// WHY THIS EXISTS (field bug, 2026-06): the Dream Catcher scopes a greenfield
// dream with one autonomous call — `claude -p "/bmad-product-brief <dream>"`
// (lib/dream-catcher/elicit.js). That slash command is a BMAD skill, installed
// PER-PROJECT under `.claude/skills/bmad-product-brief/` (by install-mmd.sh).
// Run `mmdream serve` / `mmdream "<dream>"` from a directory WITHOUT BMAD and the
// subprocess answers `Unknown command: /bmad-product-brief` — a cryptic dead-end
// (and auto-dev would fail next for the same reason). The honest fix is to DETECT
// the missing skill up front and tell the user what to do (universal §VI), the
// same shape as the `--here` first-run setup guard (lib/onboarding/setup.js).
//
// SRP: this module only DETECTS + phrases the message. Wiring (serve / greenfield)
// lives in the bins. Pure (fs reads only), never throws.

import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Where Claude Code resolves a personal/project skill: `<root>/.claude/skills/<name>/`.
export const PRODUCT_BRIEF_SKILL_REL = path.join('.claude', 'skills', 'bmad-product-brief');

/** True if `p` is an existing directory. Never throws (any fs error → false). */
function dirExists(p) {
  try {
    return existsSync(p) && statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Is the `bmad-product-brief` skill reachable by a `claude -p` launched from `cwd`?
 * Claude resolves a skill from the PROJECT (`<cwd>/.claude/skills/`) or the personal
 * GLOBAL (`~/.claude/skills/`) — we accept either.
 *
 * @param {{ cwd: string, home?: string, existsDirFn?: (p: string) => boolean }} opts
 * @returns {{ available: boolean, checked: string[] }} — `checked` lists the
 *   absolute paths probed, for an honest "Checked: …" line.
 */
export function detectBmadProductBrief({ cwd, home = os.homedir(), existsDirFn = dirExists } = {}) {
  const checked = [];
  if (typeof cwd === 'string' && cwd.length > 0) checked.push(path.join(cwd, PRODUCT_BRIEF_SKILL_REL));
  if (typeof home === 'string' && home.length > 0) checked.push(path.join(home, PRODUCT_BRIEF_SKILL_REL));
  const available = checked.some((p) => existsDirFn(p));
  return { available, checked };
}

/**
 * The honest, actionable message printed when the skill (and thus BMAD) is not
 * installed for the greenfield / serve flow. Plain language first (universal §VII).
 *
 * @param {{ cwd: string, checked: string[], flow?: string }} opts
 * @returns {string}
 */
export function bmadMissingMessage({ cwd, checked = [], flow = 'greenfield' }) {
  const where = `${flow === 'serve' ? '`mmdream serve`' : 'the greenfield dream flow'}`;
  return (
    `error: ${where} needs the BMAD "bmad-product-brief" skill to scope your dream, ` +
    `but it is not installed for this directory:\n` +
    `  ${cwd}\n\n` +
    `BMAD (MMD's engine) installs per-project. To fix it, either:\n` +
    `  • set this directory up:   bash <your-MMD-install>/install-mmd.sh .\n` +
    `  • or run from the directory where you installed MMD (BMAD lives there).\n\n` +
    `Checked for the skill at:\n` +
    checked.map((p) => `  - ${p}`).join('\n') +
    `\n\n(Bypass this check with MMD_SKIP_SETUP=1 — but the run will then fail at ` +
    `the "/bmad-product-brief" call unless BMAD is reachable some other way.)`
  );
}
