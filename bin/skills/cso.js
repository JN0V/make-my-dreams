#!/usr/bin/env node
// bin/skills/cso.js — `mmd cso` subcommand entry point (SPEC_V02G AC-3).
//
// SRP (universal.md §I.S): orchestrate the cso flow only.
//
// Exit codes:
//   0  ok
//   2  user error (bad flags)
//   3  cwd is not a git repo / HEAD not resolvable
//   4  spawn failure / gStack cso skill not installed
//   <code>  subprocess passthrough on a real run

import { cwd as processCwd, env, stdout, stderr } from 'node:process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

import { parseCsoArgs } from '../../lib/argv-parser.js';
import { validateCsoTarget } from '../../lib/skills/cso/validate-input.js';
import { buildCsoPrompt } from '../../lib/skills/cso/build-prompt.js';
import {
  invokeClaudeCso,
  csoLogPath,
  buildCsoEnv,
} from '../../lib/skills/cso/invoke-claude.js';
import { formatCsoSummary, formatCsoDryRun } from '../../lib/skills/cso/summary.js';
import {
  assertSkillInstalled,
  maybeWarnConcurrentClaude,
  buildSkillArgs,
} from '../../lib/skills/_common/invoke-claude.js';
import { resolveSkillPath } from '../../lib/skills/_common/skill-path.js';

const PKG_PATH = fileURLToPath(new URL('../../package.json', import.meta.url));
const VERSION = JSON.parse(readFileSync(PKG_PATH, 'utf8')).version;

const CSO_USAGE = `mmd cso — invoke the gStack 'cso' security skill (SPEC_V02G AC-3)

Usage:
  mmd cso [<branch>]
  mmd cso --dry-run [<branch>]
  mmd cso --help

Behavior:
  Reads the gStack cso (Chief Security Officer) skill at
  ~/.claude/skills/gstack/cso/SKILL.md and executes its Bundle A audit:
  secret scanning, dependency audit, lethal-trifecta check, sandbox
  configuration validation. Read-only / advisory — no commits / pushes
  are made. Output is tee'd to .mmd/local/cso-runs/. Expected wall-clock:
  5-20 minutes.

Flags:
  --dry-run    Build the prompt + env and print them; do NOT spawn claude.
  --help, -h   Print this usage and exit 0.

Exit codes:
  0  ok
  2  user/argv error
  3  cwd is not a git repo / cannot resolve HEAD
  4  spawn failure / gStack cso skill not installed

Env vars:
  MMD_CSO_TIMEOUT_MS          subprocess timeout in ms (default 1800000)
  MMD_CSO_CMD                 override 'claude' command (testing fixture)
  MMD_GSTACK_SKILLS_DIR       override gStack skill root (testing fixture)
  MMD_QUIET=1                 suppress live tee to stdout (log file preserved)

mmd ${VERSION}
`;

/**
 * Entry point invoked by bin/mmd.js when argv[0] === 'cso'.
 *
 * @param {string[]} rawArgs argv tokens AFTER 'cso'
 * @returns {Promise<number>} exit code
 */
export async function runCso(rawArgs) {
  const parsed = parseCsoArgs(rawArgs);
  if (parsed.help) {
    stdout.write(CSO_USAGE);
    return 0;
  }
  if (parsed.error) {
    stderr.write(`error: ${parsed.error.message}\n`);
    stderr.write(CSO_USAGE);
    return parsed.error.exitCode;
  }

  const root = processCwd();
  const validate = await validateCsoTarget(root, { branch: parsed.branch });
  if (!validate.ok) {
    stderr.write(`error: ${validate.message}\n`);
    return validate.exitCode;
  }
  const { branch, baseBranch, sha } = validate;

  const prompt = buildCsoPrompt({ branch, baseBranch, sha, repoRoot: root });
  const command = env.MMD_CSO_CMD || 'claude';
  // F10 (Phase-4 review): single source of truth — see bin/skills/qa.js.
  const args = buildSkillArgs(prompt);
  const csoEnv = buildCsoEnv(env);

  if (parsed.dryRun) {
    stdout.write(
      formatCsoDryRun({ prompt, env: csoEnv, command, args, branch, baseBranch, sha }),
    );
    return 0;
  }

  const installed = assertSkillInstalled({
    skillName: 'cso',
    skillPath: resolveSkillPath('cso'),
  });
  if (!installed.ok) {
    stderr.write(installed.message + '\n');
    return installed.exitCode;
  }

  maybeWarnConcurrentClaude({
    skillName: 'cso',
    disabled: env.MMD_DISABLE_CLAUDE_PGREP === '1',
  });

  const logPath = csoLogPath(root);
  const timeoutMs = env.MMD_CSO_TIMEOUT_MS ? Number(env.MMD_CSO_TIMEOUT_MS) : 1_800_000;
  const heartbeatIntervalMs = env.MMD_HEARTBEAT_INTERVAL_MS
    ? Number(env.MMD_HEARTBEAT_INTERVAL_MS)
    : 60_000;

  stdout.write(
    `mmd cso: invoking gStack 'cso' on '${branch}' (base=${baseBranch}, sha=${sha.slice(0, 7)})\n` +
    `  log: ${logPath}\n` +
    `  cmd: ${command} (PATH forced to include ~/.bun/bin)\n\n`,
  );

  let result;
  try {
    result = await invokeClaudeCso({
      prompt,
      cwd: root,
      logPath,
      timeoutMs,
      quiet: env.MMD_QUIET === '1',
      command,
      heartbeatIntervalMs,
    });
  } catch (err) {
    stderr.write(`mmd cso: ${err.message}\n`);
    stdout.write(
      formatCsoSummary({
        branch, baseBranch, sha,
        subprocessExitCode: null,
        subprocessSignal: null,
        logPath,
      }),
    );
    return err.mmdExitCode ?? 4;
  }

  stdout.write(
    formatCsoSummary({
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
