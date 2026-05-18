#!/usr/bin/env node
// bin/skills/document-release.js — `mmd document-release` subcommand entry
// point (SPEC_V02G AC-4).
//
// SRP (universal.md §I.S): orchestrate the document-release flow only.
//
// Exit codes:
//   0  ok
//   2  user error (bad flags)
//   3  cwd is not a git repo / git unavailable
//   4  invalid refs (<from>/<to> not real commits, or no tags + no <from>)
//      OR spawn failure / gStack document-release skill not installed
//   <code>  subprocess passthrough on a real run

import { cwd as processCwd, env, stdout, stderr } from 'node:process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { parseDocumentReleaseArgs } from '../../lib/argv-parser.js';
import { validateDocumentReleaseTarget } from '../../lib/skills/document-release/validate-input.js';
import { buildDocumentReleasePrompt } from '../../lib/skills/document-release/build-prompt.js';
import {
  invokeClaudeDocumentRelease,
  documentReleasePaths,
  buildDocumentReleaseEnv,
  buildDocumentReleaseArgs,
} from '../../lib/skills/document-release/invoke-claude.js';
import {
  formatDocumentReleaseSummary,
  formatDocumentReleaseDryRun,
} from '../../lib/skills/document-release/summary.js';
import {
  assertSkillInstalled,
  maybeWarnConcurrentClaude,
} from '../../lib/skills/_common/invoke-claude.js';
import { resolveSkillPath } from '../../lib/skills/_common/skill-path.js';

const PKG_PATH = fileURLToPath(new URL('../../package.json', import.meta.url));
const VERSION = JSON.parse(readFileSync(PKG_PATH, 'utf8')).version;

const DOCUMENT_RELEASE_USAGE = `mmd document-release — invoke the gStack 'document-release' skill (SPEC_V02G AC-4)

Usage:
  mmd document-release [<from>] [<to>]
  mmd document-release --dry-run [<from>] [<to>]
  mmd document-release --help

Defaults:
  <from> = git describe --tags --abbrev=0  (last tag in the repo)
  <to>   = HEAD

Behavior:
  Reads the gStack document-release skill at
  ~/.claude/skills/gstack/document-release/SKILL.md and produces a release-
  notes draft for the commit range <from>..<to>. The draft is written to
  .mmd/local/document-release-runs/<ts>-<pid>.md — a markdown file the user
  reviews and edits before publishing. Read-only / advisory.

Flags:
  --dry-run    Build the prompt + env and print them; do NOT spawn claude.
  --help, -h   Print this usage and exit 0.

Exit codes:
  0  ok
  2  user/argv error
  3  cwd is not a git repo
  4  invalid refs / spawn failure / gStack skill not installed

Env vars:
  MMD_DOCUMENT_RELEASE_TIMEOUT_MS  subprocess timeout (default 1800000)
  MMD_DOCUMENT_RELEASE_CMD         override 'claude' command (testing)
  MMD_GSTACK_SKILLS_DIR            override gStack skill root (testing)
  MMD_QUIET=1                      suppress live tee to stdout

mmd ${VERSION}
`;

/**
 * Entry point invoked by bin/mmd.js when argv[0] === 'document-release'.
 *
 * @param {string[]} rawArgs argv tokens AFTER 'document-release'
 * @returns {Promise<number>} exit code
 */
export async function runDocumentRelease(rawArgs) {
  const parsed = parseDocumentReleaseArgs(rawArgs);
  if (parsed.help) {
    stdout.write(DOCUMENT_RELEASE_USAGE);
    return 0;
  }
  if (parsed.error) {
    stderr.write(`error: ${parsed.error.message}\n`);
    stderr.write(DOCUMENT_RELEASE_USAGE);
    return parsed.error.exitCode;
  }

  const root = processCwd();
  const validate = await validateDocumentReleaseTarget(root, {
    from: parsed.from,
    to: parsed.to,
  });
  if (!validate.ok) {
    stderr.write(`error: ${validate.message}\n`);
    return validate.exitCode;
  }
  const { fromRef, toRef, fromSha, toSha } = validate;

  // Compute the two paths (markdown draft + driver log).
  const { outputPath, logPath } = documentReleasePaths(root);

  const prompt = buildDocumentReleasePrompt({
    fromRef, toRef, fromSha, toSha,
    repoRoot: root,
    outputPath,
  });
  const command = env.MMD_DOCUMENT_RELEASE_CMD || 'claude';
  const args = buildDocumentReleaseArgs(prompt);
  const drEnv = buildDocumentReleaseEnv(env);

  if (parsed.dryRun) {
    stdout.write(
      formatDocumentReleaseDryRun({
        prompt,
        env: drEnv,
        command,
        args,
        fromRef, toRef, fromSha, toSha,
        outputPath,
      }),
    );
    return 0;
  }

  // AC-2b pre-flight: assert the gStack document-release skill is installed.
  const installed = assertSkillInstalled({
    skillName: 'document-release',
    skillPath: resolveSkillPath('document-release'),
  });
  if (!installed.ok) {
    stderr.write(installed.message + '\n');
    return installed.exitCode;
  }

  maybeWarnConcurrentClaude({
    skillName: 'document-release',
    disabled: env.MMD_DISABLE_CLAUDE_PGREP === '1',
  });

  // Create the runs/ dir up front so the markdown draft and driver log share
  // it (the _common invoke-claude will also mkdir but only on logPath; we
  // ensure outputPath's parent exists too — they happen to be the same dir).
  await mkdir(path.dirname(outputPath), { recursive: true });

  const timeoutMs = env.MMD_DOCUMENT_RELEASE_TIMEOUT_MS
    ? Number(env.MMD_DOCUMENT_RELEASE_TIMEOUT_MS)
    : 1_800_000;
  const heartbeatIntervalMs = env.MMD_HEARTBEAT_INTERVAL_MS
    ? Number(env.MMD_HEARTBEAT_INTERVAL_MS)
    : 60_000;

  stdout.write(
    `mmd document-release: invoking gStack 'document-release' for range ` +
    `${fromRef}..${toRef}\n` +
    `  draft: ${outputPath}\n` +
    `  log  : ${logPath}\n` +
    `  cmd  : ${command} (PATH forced to include ~/.bun/bin)\n\n`,
  );

  let result;
  try {
    result = await invokeClaudeDocumentRelease({
      prompt,
      cwd: root,
      logPath,
      timeoutMs,
      quiet: env.MMD_QUIET === '1',
      command,
      heartbeatIntervalMs,
    });
  } catch (err) {
    stderr.write(`mmd document-release: ${err.message}\n`);
    stdout.write(
      formatDocumentReleaseSummary({
        fromRef, toRef, fromSha, toSha, outputPath,
        subprocessExitCode: null,
        subprocessSignal: null,
        logPath,
      }),
    );
    return err.mmdExitCode ?? 4;
  }

  stdout.write(
    formatDocumentReleaseSummary({
      fromRef, toRef, fromSha, toSha, outputPath,
      subprocessExitCode: result.code,
      subprocessSignal: result.signal,
      logPath: result.logPath,
      durationSeconds: result.durationSeconds,
    }),
  );

  if (result.code === null || result.code === undefined) return 0;
  return result.code;
}
