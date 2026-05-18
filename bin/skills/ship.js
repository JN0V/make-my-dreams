#!/usr/bin/env node
// bin/skills/ship.js — `mmd ship` subcommand entry point (SPEC_V02F AC-3..AC-7,
// refactored per SPEC_V02G §5 — moved from bin/ship.js, with import paths
// adjusted one level deeper).
//
// SRP (universal.md §I.S): orchestrate the ship flow only. Every step lives
// in a dedicated lib/skills/ship/* module so this file stays a thin coordinator:
//
//   1. parseShipArgs           (lib/argv-parser.js)
//   2. validateShipTarget      (lib/skills/ship/validate-branch.js)
//   3. buildShipPrompt         (lib/skills/ship/build-prompt.js)
//   4. assertSkillInstalled    (lib/skills/_common/invoke-claude.js) — AC-2b
//   5. invokeClaudeShip        (lib/skills/ship/invoke-claude.js)   ← skipped on --dry-run
//   6. audit-pillars.sh        (scripts/audit-pillars.sh)
//   7. formatShipSummary       (lib/skills/ship/summary.js)
//
// Exit codes (per spec §2):
//   0  ok
//   1  user declined a required prompt (currently unused — reserved)
//   2  user error (bad flags, ...) — surfaced by parseShipArgs
//   3  cwd is not a git repo / HEAD not resolvable
//   4  protected branch / spawn failure / gStack skill missing (AC-2b)
//   <code>  subprocess passthrough on a real ship run
//
// L-006 mitigation: `claude -p` can hang in `S (sleeping)` indefinitely. We
// always set a timeout (default 30 min, overridable via MMD_SHIP_TIMEOUT_MS).
// L-002 mitigation: heartbeat every 60s (overridable via MMD_HEARTBEAT_INTERVAL_MS).

import { spawnSync } from 'node:child_process';
import { cwd as processCwd, env, stdout, stderr } from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';

import { parseShipArgs } from '../../lib/argv-parser.js';
import { validateShipTarget } from '../../lib/skills/ship/validate-branch.js';
import { buildShipPrompt } from '../../lib/skills/ship/build-prompt.js';
import {
  invokeClaudeShip,
  shipLogPath,
  buildShipEnv,
  buildShipArgs,
} from '../../lib/skills/ship/invoke-claude.js';
import { formatShipSummary, formatDryRun } from '../../lib/skills/ship/summary.js';
import {
  assertSkillInstalled,
  maybeWarnConcurrentClaude,
} from '../../lib/skills/_common/invoke-claude.js';
import { resolveSkillPath } from '../../lib/skills/_common/skill-path.js';

const PKG_PATH = fileURLToPath(new URL('../../package.json', import.meta.url));
const VERSION = JSON.parse(readFileSync(PKG_PATH, 'utf8')).version;

const SHIP_USAGE = `mmd ship — invoke the gStack 'ship' skill on a slice branch (SPEC_V02F)

Usage:
  mmd ship [<branch>]
  mmd ship --dry-run [<branch>]
  mmd ship --help

Behavior:
  Reads the gStack ship skill at ~/.claude/skills/gstack/ship/SKILL.md and
  executes its 20-step workflow on the current (or named) slice branch:
  merge-base verify, semver bump, CHANGELOG update, WIP squash, push, tag,
  PR creation, analytics persist. Output is tee'd to .mmd/local/ship-runs/.

Flags:
  --dry-run    Build the prompt + env and print them; do NOT spawn claude.
  --help, -h   Print this usage and exit 0.

Exit codes:
  0  ok
  2  user/argv error
  3  cwd is not a git repo / cannot resolve HEAD
  4  protected branch / spawn failure (claude not on PATH, ...)

Env vars:
  MMD_SHIP_TIMEOUT_MS    subprocess timeout in ms (default 1800000)
  MMD_SHIP_CMD           override 'claude' command (testing fixture)
  MMD_QUIET=1            suppress live tee to stdout (log file preserved)

mmd ${VERSION}
`;

/**
 * Resolve the path to scripts/audit-pillars.sh relative to this file. The
 * script lives in <repoRoot>/scripts/audit-pillars.sh; bin/skills/ship.js lives
 * in <repoRoot>/bin/skills/. We resolve via fileURLToPath so it works
 * regardless of how the module was imported (npm symlink, direct node
 * invocation, etc.).
 *
 * @returns {string}
 */
function auditPillarsScriptPath() {
  return fileURLToPath(new URL('../../scripts/audit-pillars.sh', import.meta.url));
}

/**
 * Run scripts/audit-pillars.sh against <base>..<branch> from `cwd` and return
 * its stdout (or null if the script could not run / produced no output).
 * Non-zero exit codes are tolerated — the audit is advisory (AC-7 explicit
 * "informative — a hard gate would risk breaking emergency ships").
 *
 * @param {{ cwd: string, baseBranch: string }} opts
 * @returns {string | null}
 */
export function runAuditPillars({ cwd, baseBranch }) {
  const script = auditPillarsScriptPath();
  if (!existsSync(script)) return null;
  const r = spawnSync('bash', [script, baseBranch], {
    cwd,
    encoding: 'utf8',
    timeout: 15000,
  });
  const out = (r.stdout || '').trim();
  if (out.length === 0) return null;
  return out;
}

/**
 * Entry point invoked by bin/mmd.js when argv[0] === 'ship'.
 *
 * @param {string[]} rawArgs argv.slice(3) — everything AFTER 'ship'
 * @returns {Promise<number>} exit code
 */
export async function runShip(rawArgs) {
  const parsed = parseShipArgs(rawArgs);
  if (parsed.help) {
    stdout.write(SHIP_USAGE);
    return 0;
  }
  if (parsed.error) {
    stderr.write(`error: ${parsed.error.message}\n`);
    stderr.write(SHIP_USAGE);
    return parsed.error.exitCode;
  }

  // Pre-flight: validate cwd is a git repo and the branch is non-protected.
  const root = processCwd();
  const validate = await validateShipTarget(root, { branch: parsed.branch });
  if (!validate.ok) {
    stderr.write(`error: ${validate.message}\n`);
    return validate.exitCode;
  }
  const { branch, baseBranch, sha } = validate;

  // Build the prompt + planned subprocess argv + env (shared between dry-run
  // and real run so the preview reflects what will actually be spawned).
  const prompt = buildShipPrompt({
    branch,
    baseBranch,
    sha,
    repoRoot: root,
  });
  const command = env.MMD_SHIP_CMD || 'claude';
  const args = buildShipArgs(prompt);
  const shipEnv = buildShipEnv(env);

  if (parsed.dryRun) {
    // AC-5: print the would-be invocation and exit 0 without spawning claude.
    // AC-2b: --dry-run SKIPS the pre-flight skill-installation check.
    stdout.write(
      formatDryRun({
        prompt,
        env: shipEnv,
        command,
        args,
        branch,
        baseBranch,
        sha,
      }),
    );
    return 0;
  }

  // AC-2b pre-flight (real runs only): assert the gStack skill is installed.
  const installed = assertSkillInstalled({
    skillName: 'ship',
    skillPath: resolveSkillPath('ship'),
  });
  if (!installed.ok) {
    stderr.write(installed.message + '\n');
    return installed.exitCode;
  }

  // AC-Long-Running (c): warn if another claude -p is running. Hermetic in tests.
  maybeWarnConcurrentClaude({
    skillName: 'ship',
    disabled: env.MMD_DISABLE_CLAUDE_PGREP === '1',
  });

  // Real ship — spawn claude -p with PATH forcing.
  const logPath = shipLogPath(root);
  const timeoutMs = env.MMD_SHIP_TIMEOUT_MS ? Number(env.MMD_SHIP_TIMEOUT_MS) : 1_800_000;
  const heartbeatIntervalMs = env.MMD_HEARTBEAT_INTERVAL_MS
    ? Number(env.MMD_HEARTBEAT_INTERVAL_MS)
    : 60_000;

  stdout.write(
    `mmd ship: invoking gStack 'ship' on '${branch}' (base=${baseBranch}, sha=${sha.slice(0, 7)})\n` +
    `  log: ${logPath}\n` +
    `  cmd: ${command} (PATH forced to include ~/.bun/bin)\n\n`,
  );

  let result;
  try {
    result = await invokeClaudeShip({
      prompt,
      cwd: root,
      logPath,
      timeoutMs,
      quiet: env.MMD_QUIET === '1',
      command,
      heartbeatIntervalMs,
    });
  } catch (err) {
    stderr.write(`mmd ship: ${err.message}\n`);
    // AC-7: the audit is advisory — surface it even when the subprocess failed
    // to spawn, so the user at least sees the pillar table for the slice.
    const auditOutput = runAuditPillars({ cwd: root, baseBranch });
    stdout.write(
      formatShipSummary({
        branch,
        baseBranch,
        sha,
        subprocessExitCode: null,
        subprocessSignal: null,
        logPath,
        auditOutput,
      }),
    );
    return err.mmdExitCode ?? 4;
  }

  // AC-7: run audit-pillars and include its output in the final summary,
  // regardless of the subprocess exit code (advisory — never gating).
  const auditOutput = runAuditPillars({ cwd: root, baseBranch });

  stdout.write(
    formatShipSummary({
      branch,
      baseBranch,
      sha,
      subprocessExitCode: result.code,
      subprocessSignal: result.signal,
      logPath: result.logPath,
      durationSeconds: result.durationSeconds,
      auditOutput,
    }),
  );

  // Per L-006: a null code from claude -p is a "subprocess weirdness" not a
  // hard failure. We still propagate it (caller's exit() handles it) but the
  // summary already showed the user what happened.
  if (result.code === null || result.code === undefined) return 0;
  return result.code;
}
