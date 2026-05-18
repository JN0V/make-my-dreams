// lib/skills/_common/skill-path.js — gStack SKILL.md path resolution
// (SPEC_V02G §5 "MMD_GSTACK_SKILLS_DIR env var" + "SKILL.md path constant location").
//
// SRP (universal.md §I.S): pure path computation. No filesystem reads. The
// existence check lives in the AC-2b pre-flight, NOT here — keeps this module
// trivially unit-testable.
//
// Public API:
//   - resolveSkillPath(name)            -> string (path string, possibly ~/-prefixed)
//   - expandSkillPath(p)                -> string (absolute, ~/-expanded if needed)
//   - DEFAULT_GSTACK_SKILLS_DIR_TILDE   -> '~/.claude/skills/gstack' (constant)
//
// Why two helpers? Prompts are STRINGS sent to claude (LLM + human reader both
// understand ~/...); filesystem ops need absolute paths. Separating them
// preserves the byte-identical help-output snapshot (F4 Option B) AND keeps
// FS code correct (G2 from the SPEC pass-2 review).

import { env, stderr } from 'node:process';
import os from 'node:os';
import path from 'node:path';

/** Tilde-form root for the default install location. Returned VERBATIM when
 *  MMD_GSTACK_SKILLS_DIR is unset — byte-identical to the v0.2.f SHIP_SKILL_PATH
 *  constant (lib/ship/build-prompt.js line 13 in the pre-refactor tree). */
export const DEFAULT_GSTACK_SKILLS_DIR_TILDE = '~/.claude/skills/gstack';

/**
 * Resolve the SKILL.md path for a named gStack skill.
 *
 * SECURITY NOTE — `MMD_GSTACK_SKILLS_DIR` is a TEST-FIXTURE KNOB. Its value
 * flows into TWO trust boundaries:
 *
 *   1. The LLM prompt — `buildShipPrompt` / `buildQaPrompt` / ... embed the
 *      resolved path verbatim ("Read the gStack skill at <path>"), so a
 *      malicious value (`/etc; rm -rf /` or path traversal) would be visible
 *      to the LLM.
 *   2. The filesystem — `assertSkillInstalled` calls `existsSync(<path>)`,
 *      so a value pointing at a sensitive location reveals whether that
 *      path exists.
 *
 * For PRODUCTION use, leave it UNSET — the default `~/.claude/skills/gstack`
 * is correct. The env var exists ONLY for the hermetic test fixtures (see
 * test/integration/qa-dry-run.test.js, test/unit/skills-common-invoke-claude.test.js)
 * which point it at temp directories they fully control. Per F12 (Phase-4
 * adversarial review): documented here so a future user reading
 * `mmd qa --help` knows the field is not a "configure your skills location"
 * knob aimed at production setups.
 *
 * Semantics:
 *   - When `MMD_GSTACK_SKILLS_DIR` is UNSET: returns the literal
 *     `~/.claude/skills/gstack/<name>/SKILL.md` (un-expanded ~/...).
 *     This is byte-identical to the legacy SHIP_SKILL_PATH constant — essential
 *     for the F4 Option B snapshot stability (prompt body must not drift in the
 *     refactor commit).
 *   - When `MMD_GSTACK_SKILLS_DIR` is SET:
 *       * absolute path → returns `${dir}/<name>/SKILL.md`
 *       * relative path → resolves against process.cwd() AND emits a stderr
 *         warning naming the resolved absolute path. Per
 *         error-handling.md §III: graceful — proceed, but inform the user.
 *
 * Does NOT touch the filesystem. Pure-ish (depends only on env + cwd at call
 * time; both injectable for tests via `opts`).
 *
 * @param {string} name              skill name, e.g. 'ship' / 'qa' / 'cso' / 'document-release'
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   cwd?: () => string,
 *   warn?: (msg: string) => void,
 * }} [opts]
 * @returns {string}
 */
export function resolveSkillPath(name, opts = {}) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError('resolveSkillPath: name must be a non-empty string');
  }
  const e = opts.env || env;
  const getCwd = opts.cwd || ((/** @returns {string} */ () => process.cwd()));
  const warn = opts.warn || ((msg) => stderr.write(msg + '\n'));

  const override = e.MMD_GSTACK_SKILLS_DIR;
  if (typeof override === 'string' && override.length > 0) {
    let dir = override;
    if (!path.isAbsolute(dir)) {
      const abs = path.resolve(getCwd(), dir);
      warn(
        `[mmd ${name}] warning: MMD_GSTACK_SKILLS_DIR is not absolute; ` +
        `resolved against cwd to ${abs}`,
      );
      dir = abs;
    }
    return path.join(dir, name, 'SKILL.md');
  }
  // Tilde-form, byte-identical to legacy SHIP_SKILL_PATH for `ship`.
  return `${DEFAULT_GSTACK_SKILLS_DIR_TILDE}/${name}/SKILL.md`;
}

/**
 * Expand a `~/`-prefixed path into an absolute path for filesystem
 * operations. Only `~/<rest>` (slash-form) is expanded; any other shape
 * (`~user/...`, `~`, `/abs`, `relative`) is returned unchanged. Per H8.
 *
 * @param {string} p
 * @returns {string}
 */
export function expandSkillPath(p) {
  if (typeof p !== 'string') {
    throw new TypeError('expandSkillPath: p must be a string');
  }
  if (p.startsWith('~/')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}
