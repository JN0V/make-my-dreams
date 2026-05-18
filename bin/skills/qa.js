#!/usr/bin/env node
// bin/skills/qa.js — `mmd qa` subcommand entry point (SPEC_V02G AC-2).
//
// SRP (universal.md §I.S): orchestrate the qa flow only. Every step lives in
// a dedicated lib/skills/qa/* module so this file stays a thin coordinator.
//
// Exit codes (per SPEC_V02G AC-2):
//   0  ok
//   2  user error (bad flags, suspicious branch name) — surfaced by parseQaArgs / validateQaTarget
//   3  cwd is not a git repo / HEAD not resolvable
//   4  spawn failure / gStack qa skill not installed
//   <code>  subprocess passthrough on a real run

import { cwd as processCwd, env, stdout, stderr } from 'node:process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

import { parseQaArgs } from '../../lib/argv-parser.js';
import { validateQaTarget } from '../../lib/skills/qa/validate-input.js';
import { buildQaPrompt } from '../../lib/skills/qa/build-prompt.js';
import {
  invokeClaudeQa,
  qaLogPath,
  buildQaEnv,
} from '../../lib/skills/qa/invoke-claude.js';
import { formatQaSummary, formatQaDryRun } from '../../lib/skills/qa/summary.js';
import {
  assertSkillInstalled,
  maybeWarnConcurrentClaude,
  buildSkillArgs,
} from '../../lib/skills/_common/invoke-claude.js';
import { resolveSkillPath } from '../../lib/skills/_common/skill-path.js';

const PKG_PATH = fileURLToPath(new URL('../../package.json', import.meta.url));
const VERSION = JSON.parse(readFileSync(PKG_PATH, 'utf8')).version;

const QA_USAGE = `mmd qa — invoke the gStack 'qa' skill on a slice (SPEC_V02G AC-2)

Usage:
  mmd qa [<branch>]
  mmd qa --dry-run [<branch>]
  mmd qa --help

Behavior:
  Reads the gStack qa skill at ~/.claude/skills/gstack/qa/SKILL.md and
  executes its workflow on the current (or named) branch: test
  stratification @smoke/@unit/@integration/@e2e, adversarial test pass,
  failure classification T1..T4. The command is read-only / advisory —
  no commits / pushes are made. Output is tee'd to .mmd/local/qa-runs/.
  Expected wall-clock: 5-20 minutes.

Flags:
  --dry-run    Build the prompt + env and print them; do NOT spawn claude.
  --help, -h   Print this usage and exit 0.

Exit codes:
  0  ok
  2  user/argv error (incl. suspicious branch characters)
  3  cwd is not a git repo / cannot resolve HEAD
  4  spawn failure / gStack qa skill not installed

Env vars:
  MMD_QA_TIMEOUT_MS           subprocess timeout in ms (default 1800000)
  MMD_QA_CMD                  override 'claude' command (testing fixture)
  MMD_GSTACK_SKILLS_DIR       override gStack skill root (testing fixture)
  MMD_QUIET=1                 suppress live tee to stdout (log file preserved)

mmd ${VERSION}
`;

/**
 * Entry point invoked by bin/mmd.js when argv[0] === 'qa'.
 *
 * @param {string[]} rawArgs argv tokens AFTER 'qa'
 * @returns {Promise<number>} exit code
 */
export async function runQa(rawArgs) {
  const parsed = parseQaArgs(rawArgs);
  if (parsed.help) {
    stdout.write(QA_USAGE);
    return 0;
  }
  if (parsed.error) {
    stderr.write(`error: ${parsed.error.message}\n`);
    stderr.write(QA_USAGE);
    return parsed.error.exitCode;
  }

  const root = processCwd();
  const validate = await validateQaTarget(root, { branch: parsed.branch });
  if (!validate.ok) {
    stderr.write(`error: ${validate.message}\n`);
    return validate.exitCode;
  }
  const { branch, baseBranch, sha } = validate;

  const prompt = buildQaPrompt({ branch, baseBranch, sha, repoRoot: root });
  const command = env.MMD_QA_CMD || 'claude';
  // F10 (Phase-4 review): single source of truth — the _common spawn helper
  // calls buildSkillArgs internally too, so the dry-run preview must use
  // the SAME function (not a wrapper-level re-export that could drift).
  const args = buildSkillArgs(prompt);
  const qaEnv = buildQaEnv(env);

  if (parsed.dryRun) {
    stdout.write(
      formatQaDryRun({ prompt, env: qaEnv, command, args, branch, baseBranch, sha }),
    );
    return 0;
  }

  // AC-2b pre-flight: assert the gStack qa skill is installed.
  const installed = assertSkillInstalled({
    skillName: 'qa',
    skillPath: resolveSkillPath('qa'),
  });
  if (!installed.ok) {
    stderr.write(installed.message + '\n');
    return installed.exitCode;
  }

  // AC-Long-Running (c): warn if another claude -p is running.
  maybeWarnConcurrentClaude({
    skillName: 'qa',
    disabled: env.MMD_DISABLE_CLAUDE_PGREP === '1',
  });

  const logPath = qaLogPath(root);
  const timeoutMs = env.MMD_QA_TIMEOUT_MS ? Number(env.MMD_QA_TIMEOUT_MS) : 1_800_000;
  const heartbeatIntervalMs = env.MMD_HEARTBEAT_INTERVAL_MS
    ? Number(env.MMD_HEARTBEAT_INTERVAL_MS)
    : 60_000;

  stdout.write(
    `mmd qa: invoking gStack 'qa' on '${branch}' (base=${baseBranch}, sha=${sha.slice(0, 7)})\n` +
    `  log: ${logPath}\n` +
    `  cmd: ${command} (PATH forced to include ~/.bun/bin)\n\n`,
  );

  let result;
  try {
    result = await invokeClaudeQa({
      prompt,
      cwd: root,
      logPath,
      timeoutMs,
      quiet: env.MMD_QUIET === '1',
      command,
      heartbeatIntervalMs,
    });
  } catch (err) {
    stderr.write(`mmd qa: ${err.message}\n`);
    stdout.write(
      formatQaSummary({
        branch, baseBranch, sha,
        subprocessExitCode: null,
        subprocessSignal: null,
        logPath,
      }),
    );
    return err.mmdExitCode ?? 4;
  }

  stdout.write(
    formatQaSummary({
      branch, baseBranch, sha,
      subprocessExitCode: result.code,
      subprocessSignal: result.signal,
      logPath: result.logPath,
      durationSeconds: result.durationSeconds,
    }),
  );

  if (result.code === null || result.code === undefined) return 0;
  return result.code;
}
