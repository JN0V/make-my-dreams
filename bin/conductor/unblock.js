#!/usr/bin/env node
// bin/conductor/unblock.js — `mmd unblock` subcommand entry point (SPEC_V02J AC-3).
//
// SRP (universal.md §I.S): orchestrate the unblock flow only. Each step lives
// in a dedicated lib/conductor/* module so this file stays a thin coordinator:
//
//   1. parseUnblockArgs        (lib/argv-parser.js)
//   2. resolve branch + repo   (git via lib/skills/_common/git.js)
//   3. detectStall(...)        (lib/conductor/stall-detector.js)
//   4. runFiveWhys(...)        (lib/conductor/five-whys.js)        ← skipped on --dry-run
//   5. write .mmd/shared/5-whys/<ts>.md + print summary
//
// Exit codes (EXACTLY per SPEC AC-3):
//   0  ok (no stall detected without --force; or --dry-run not stalled)
//   2  user/argv error
//   4  not a slice branch
//   5  detector found nothing wrong (without --force)
//   6  session ran, action = escalate-to-user
//   7  session ran, action = abandon-approach
//   8  session ran, action = continue-with-hint | task-actually-complete |
//      false-positive-stall  (AND --dry-run when stalled)
//
// L-002/L-006: the 5-Whys runner always sets a timeout; no live tail reliance.
// L-016: the parse fallback to escalate-to-user is sacred (five-whys-parser).

import { cwd as processCwd, env, stdout, stderr } from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';

import { parseUnblockArgs } from '../../lib/argv-parser.js';
import { runGit } from '../../lib/skills/_common/git.js';
import { detectStall } from '../../lib/conductor/stall-detector.js';
import { runFiveWhys } from '../../lib/conductor/five-whys.js';
import { STALL_SIGNALS } from '../../lib/conductor/stall-signals.js';

const PKG_PATH = fileURLToPath(new URL('../../package.json', import.meta.url));
const VERSION = JSON.parse(readFileSync(PKG_PATH, 'utf8')).version;

const ADR_LINK = 'docs/adr/011-five-whys-escalation.md';

const UNBLOCK_USAGE = `mmd unblock — run a 5-Whys stuck-recovery session on a slice branch (SPEC_V02J)

Usage:
  mmd unblock [<slice-branch>]
  mmd unblock --dry-run [<slice-branch>]
  mmd unblock --force [<slice-branch>]
  mmd unblock --help

Behavior:
  Runs the deterministic stall detector against the slice's .mmd/shared/status.json,
  last-commit age, and run-log error patterns. If stalled (or --force), spawns a
  BMAD Party Mode 5-Whys session (Mary leads; Winston/Quinn/Amelia/Christie augment),
  parses the recommended action, and writes the session to .mmd/shared/5-whys/<ts>.md.
  Does NOT auto-execute the action — the user reads the summary and acts.

Flags:
  --dry-run    Run the detector only; print signals + evidence; never spawn claude.
  --force      Skip the detector; run the 5-Whys session unconditionally.
  --help, -h   Print this usage and exit 0.

Stall signals (closed enum):
${STALL_SIGNALS.map((s) => `  - ${s}`).join('\n')}

Recommended actions (closed enum):
  - continue-with-hint        (exit 8)
  - abandon-approach          (exit 7)
  - escalate-to-user          (exit 6)
  - task-actually-complete    (exit 8)
  - false-positive-stall      (exit 8)

Exit codes:
  0  ok (no stall without --force)
  2  user/argv error
  4  not a slice branch
  5  detector found nothing wrong (without --force)
  6  session ran, action = escalate-to-user
  7  session ran, action = abandon-approach
  8  session ran, action = continue-with-hint|task-actually-complete|false-positive-stall
     (also --dry-run when a stall IS detected)

Env vars:
  MMD_STALL_MIN_NOCOMMIT              minutes-since-last-commit threshold (default 10)
  MMD_STALL_MAX_RETRIES              retry-count threshold (default 3)
  MMD_STALL_DURATION_BUDGET_FACTOR   duration-budget multiplier (default 2.0)
  MMD_STALL_ERROR_PATTERN_REGEX      run-log error pattern (overrides default)
  MMD_FIVEWHYS_TIMEOUT_MS            5-Whys subprocess timeout in ms (default 1800000)
  MMD_UNBLOCK_CMD                    override 'claude' command (testing fixture)
  MMD_COMPOSER_DISABLED=1            bypass the lessons composer (escape hatch)

See ${ADR_LINK} for the design rationale.

mmd ${VERSION}
`;

// Map a recommended_action to its exit code (AC-3).
const ACTION_EXIT = Object.freeze({
  'escalate-to-user': 6,
  'abandon-approach': 7,
  'continue-with-hint': 8,
  'task-actually-complete': 8,
  'false-positive-stall': 8,
});

/**
 * Resolve the slice branch + repo root. The branch must be a `slice/*` branch
 * (AC-3: default = current branch; else exit 4). Other failure (not a git repo)
 * also maps to exit 4 — `mmd unblock` only ever runs against a slice branch.
 *
 * @param {string} root
 * @param {string|null} explicitBranch
 * @returns {Promise<{ ok: true, branch: string } | { ok: false, exitCode: 4, message: string }>}
 */
async function resolveSliceBranch(root, explicitBranch) {
  let branch = explicitBranch;
  if (!branch) {
    const inside = await runGit(['rev-parse', '--is-inside-work-tree'], root);
    if (!inside.ok || inside.code !== 0 || inside.stdout.trim() !== 'true') {
      return {
        ok: false,
        exitCode: 4,
        message:
          'mmd unblock: not inside a git repository (or git unavailable). ' +
          'Run from a slice/* branch, or pass <slice-branch> explicitly.',
      };
    }
    const cur = await runGit(['branch', '--show-current'], root);
    if (!cur.ok || cur.code !== 0) {
      return {
        ok: false,
        exitCode: 4,
        message: 'mmd unblock: could not read the current branch.',
      };
    }
    branch = cur.stdout.trim();
  }
  if (typeof branch !== 'string' || !branch.startsWith('slice/')) {
    return {
      ok: false,
      exitCode: 4,
      message:
        `mmd unblock: '${branch || '(empty)'}' is not a slice branch. ` +
        `unblock only operates on slice/* branches. Pass an explicit slice/<name>.`,
    };
  }
  return { ok: true, branch };
}

/** `git log <branch> --oneline -5` text (best-effort, for the 5-Whys context). */
async function recentCommits(root, branch) {
  const r = await runGit(['log', branch, '--oneline', '-5'], root);
  if (r.ok && r.code === 0) return r.stdout.trim();
  return '';
}

/** Read the slice's dream verbatim from status.json (best-effort). */
function readDream(statusJsonPath) {
  try {
    const status = JSON.parse(readFileSync(statusJsonPath, 'utf8'));
    return typeof status.dream === 'string' ? status.dream : '';
  } catch {
    return '';
  }
}

/** Render the markdown session file written to .mmd/shared/5-whys/<ts>.md. */
function renderSessionMarkdown({ branch, signals, evidence, parsed, parseOk, sessionLog, composer }) {
  const injected =
    composer && Array.isArray(composer.injectedLessons) && composer.injectedLessons.length > 0
      ? composer.injectedLessons.map((l) => `- ${l.id} — ${l.title}`).join('\n')
      : '- (none)';
  return [
    `# 5-Whys session — ${branch}`,
    '',
    `Generated: ${new Date().toISOString()}`,
    `Parse OK: ${parseOk}`,
    '',
    '## Stall signals',
    '',
    signals.length > 0 ? signals.map((s) => `- ${s}`).join('\n') : '- (forced; detector skipped)',
    '',
    '## Detector evidence',
    '',
    '```json',
    JSON.stringify(evidence, null, 2),
    '```',
    '',
    '## Injected lessons (composer)',
    '',
    injected,
    '',
    '## Parsed result',
    '',
    '```json',
    JSON.stringify(parsed, null, 2),
    '```',
    '',
    '## Full session log',
    '',
    '```',
    sessionLog || '(empty)',
    '```',
    '',
  ].join('\n');
}

/**
 * Entry point invoked by bin/mmd.js when argv[0] === 'unblock'.
 *
 * @param {string[]} rawArgs everything AFTER 'unblock'
 * @returns {Promise<number>} exit code
 */
export async function runUnblock(rawArgs) {
  const parsed = parseUnblockArgs(rawArgs);
  if (parsed.help) {
    stdout.write(UNBLOCK_USAGE);
    return 0;
  }
  if (parsed.error) {
    stderr.write(`error: ${parsed.error.message}\n`);
    stderr.write(UNBLOCK_USAGE);
    return parsed.error.exitCode;
  }

  const root = processCwd();
  const resolved = await resolveSliceBranch(root, parsed.branch);
  if (!resolved.ok) {
    stderr.write(`error: ${resolved.message}\n`);
    return resolved.exitCode;
  }
  const branch = resolved.branch;

  const statusJsonPath = path.join(root, '.mmd', 'shared', 'status.json');

  // ── Detector (skipped only when --force) ────────────────────────────────
  let detection = { stalled: false, signals: [], evidence: {} };
  if (!parsed.force) {
    detection = detectStall({ statusJsonPath, sliceBranch: branch, repoRoot: root, env });
  }

  // ── --dry-run: detector only, never spawn claude ────────────────────────
  if (parsed.dryRun) {
    stdout.write(`mmd unblock --dry-run on '${branch}'\n`);
    stdout.write(`  stalled: ${detection.stalled}\n`);
    stdout.write(
      `  signals: ${detection.signals.length > 0 ? detection.signals.join(', ') : '(none)'}\n`,
    );
    stdout.write('  evidence:\n');
    stdout.write(`${JSON.stringify(detection.evidence, null, 2)}\n`);
    if (detection.stalled) {
      stdout.write(
        '\nStall detected. Re-run without --dry-run to launch a 5-Whys session.\n',
      );
      return 8;
    }
    stdout.write('\nNo stall detected.\n');
    return 0;
  }

  // ── No --force and not stalled → nothing to do (exit 5) ─────────────────
  if (!parsed.force && !detection.stalled) {
    stdout.write(`mmd unblock: no stall detected on '${branch}'. Nothing to do.\n`);
    stdout.write('  (use --force to run a 5-Whys session anyway.)\n');
    return 5;
  }

  // ── Build context + run the 5-Whys session ──────────────────────────────
  const context = {
    sliceBranch: branch,
    repoRoot: root,
    signals: detection.signals,
    evidence: detection.evidence,
    lastCommits: await recentCommits(root, branch),
    logTail: '',
    dream: readDream(statusJsonPath),
  };

  stdout.write(
    `mmd unblock: ${parsed.force ? '(forced) ' : ''}running 5-Whys session on '${branch}'...\n`,
  );

  const result = await runFiveWhys({
    context,
    repoRoot: root,
    claudePath: env.MMD_UNBLOCK_CMD || 'claude',
    env,
  });

  // ── Persist .mmd/shared/5-whys/<ts>.md ──────────────────────────────────
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(root, '.mmd', 'shared', '5-whys');
  const outFile = path.join(outDir, `${ts}.md`);
  try {
    await mkdir(outDir, { recursive: true });
    await writeFile(
      outFile,
      renderSessionMarkdown({
        branch,
        signals: detection.signals,
        evidence: detection.evidence,
        parsed: result.parsed,
        parseOk: result.parseOk,
        sessionLog: result.sessionLog,
        composer: result.composer,
      }),
      'utf8',
    );
  } catch (err) {
    // error-handling.md §III: writing the audit file is best-effort; the
    // recommendation itself is the load-bearing output. Warn, do not fail.
    stderr.write(`mmd unblock: warning — could not write session file: ${err.message}\n`);
  }

  // ── Print summary + exit with the mapped code ───────────────────────────
  const p = result.parsed;
  stdout.write('\n=== 5-Whys result ===\n');
  stdout.write(`  root_cause:         ${p.root_cause}\n`);
  stdout.write(`  recommended_action: ${p.recommended_action}\n`);
  stdout.write(`  action_hint:        ${p.action_hint}\n`);
  stdout.write(`  confidence:         ${p.confidence}\n`);
  stdout.write(`  parse_ok:           ${result.parseOk}\n`);
  stdout.write(`  session file:       ${outFile}\n`);
  if (result.spawnError) {
    stderr.write(`  (note: claude -p did not complete cleanly: ${result.spawnError})\n`);
  }
  stdout.write(`\n  Next: ${nextStep(p.recommended_action, p.action_hint)}\n`);

  return ACTION_EXIT[p.recommended_action] ?? 6;
}

/** Human-facing "what to do now" line keyed on the recommended action. */
function nextStep(action, hint) {
  switch (action) {
    case 'continue-with-hint':
      return `apply the hint and resume the slice — ${hint}`;
    case 'abandon-approach':
      return `stop this approach and rethink — ${hint}`;
    case 'task-actually-complete':
      return 'the task looks complete — verify the DoD and ship.';
    case 'false-positive-stall':
      return 'no real stall — let the slice keep running.';
    case 'escalate-to-user':
    default:
      return `a human decision is needed — ${hint || 'review the session file.'}`;
  }
}
