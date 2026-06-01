#!/usr/bin/env node
// bin/mmd.js — MMD CLI entry point.
// SRP (constitution §I.S): argv parsing + top-level flow orchestration + exit codes.
// All FS / subprocess / state logic lives in lib/*.
//
// v0.2 additions: --fast routing (FAST engine, trimmed auto-dev), POSIX argv
// parsing via lib/argv-parser.js, engine_metrics in status.json (AC-6), soft
// FAST-budget warning (AC-5), 1-page spec generation overwriting slice.md
// (AC-4). Deferred items: B8 (EACCES catch consolidation), E7 (lstat on
// --resume), E13/E14 (-- separator + unknown-flag rejection — owned by
// argv-parser).

import { argv, env, stdin, stdout, stderr, exit, cwd } from 'node:process';
import path from 'node:path';
import { rm, lstat, writeFile, realpath } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { slugify, deriveBranchSlug, initStateFiles, nextAvailableSlug } from '../lib/parse-dream.js';
import { ensureLayout, readStatus, writeStatus, ensureGitignore } from '../lib/state.js';
import { invokeAutodev, buildSubprocessEnv, resolveAutodevMode } from '../lib/invoke-autodev.js';
import { buildManifest, verifyManifest, sealIntact } from '../lib/sealed-tests/manifest.js';
import { buildTesterPrompt, buildCoderPrompt } from '../lib/sealed-tests/tester-prompt.js';
import { computeBlastRadius } from '../lib/sealed-tests/blast-radius.js';
import { realityCheck } from '../lib/reality-check.js';
import { parseArgv, resolveEngine, resolveShouldCatch } from '../lib/argv-parser.js';
import { deriveSpec } from '../lib/spec-derive.js';
import { buildEngineRecord, withDuration, fastBudgetExceeded } from '../lib/engine.js';
import {
  validateHereTarget,
  generateSliceBranchName,
  createSliceBranch,
  checkPromptGrounding,
  buildHerePrompt,
  parseProtectedBranches,
} from '../lib/here-mode.js';
import { readFile as fsReadFile } from 'node:fs/promises';
import { checkGate } from '../lib/discover/gate.js';
import { runCliDreamCatcher } from '../lib/dream-catcher/cli-driver.js';
import { runElicit } from '../lib/dream-catcher/elicit.js';

// F30 — version sourced once from package.json (shared with GET /api/health).
const PKG_PATH = fileURLToPath(new URL('../package.json', import.meta.url));
const VERSION = JSON.parse(readFileSync(PKG_PATH, 'utf8')).version;

const USAGE = `mmd ${VERSION} — Make My Dreams CLI

Usage:
  mmd "<dream description>"            Generate a PWA fulfilling the dream
                                       (on a TTY: an interactive Dream Catcher
                                       dialogue refines it first — v0.3.b)
  mmd --fast "<dream>"                 Trimmed auto-dev pipeline (target <=10 min)
  mmd --sealed "<dream>"               Sealed-test oracle: a tester writes blind acceptance
                                       tests, MMD seals them (hash), auto-dev implements, then
                                       MMD verifies the seal (tamper = fail) + re-runs them (v0.4.a)
  mmd --here "<change>"                Modify the current git repo in place (v0.2a)
  mmd bench [--dry-run]                Run the dream-bench v0 harness (v0.2b)
  mmd ship [<branch>] [--dry-run]      Invoke gStack ship skill on the current slice (v0.2.f)
  mmd qa [<branch>] [--dry-run]        Invoke gStack qa skill — test stratification + adversarial pass (v0.2.g)
  mmd cso [<branch>] [--dry-run]       Invoke gStack cso skill — security review per Bundle A (v0.2.g)
  mmd document-release [<from>] [<to>] Invoke gStack document-release skill — release-notes draft (v0.2.g)
  mmd discover [<path>]                Project Onboarder for brownfield repos (v0.2c)
  mmd lessons                          Introspect docs/lessons-learned.md + composer audits (v0.2e)
  mmd document-lessons [--dry-run]     Increment lesson counters + auto-promote at threshold (v0.2.i)
  mmd unblock [<branch>] [--dry-run]   Run a 5-Whys stuck-recovery session on a slice (v0.2.j)
  mmd handover [--tests N] [--dry-run] Refresh HANDOVER.md's mechanical State block (v0.2.p)
  mmd document-readme [--tests N] [--dry-run]
                                       Refresh README.md's Status + Changelog blocks; report doc drift (v0.3.d)
  mmd serve                            Start the local web mode (v0.2.5)
  mmd --version                        Print version and exit
  mmd --help, -h                       Print this usage and exit

Engine flags (mutually exclusive):
  --fast                               FAST engine — trimmed auto-dev (v0.2)
  --standard                           STANDARD engine — current default (v0.2d for full semantics)
  --deep                               DEEP engine — full BMAD process (v0.2d)

Mode flags (orthogonal to engine):
  --sealed                             Opt-in sealed-test oracle for greenfield: independent tester
                                       writes acceptance tests, MMD seals them, auto-dev implements,
                                       MMD verifies the seal is intact + re-runs the tests (v0.4.a)
  --here                               Self / brownfield-in-place: modify cwd, no demo/<slug>/ scaffold (v0.2a)
  --label <name>                       Human-readable branch name for --here (e.g. --label wip-salvage); else derived from the dream
  --skip-onboarding                    Bypass the v0.2c Project Onboarder gate (NOT RECOMMENDED)

Dream Catcher dialogue (greenfield only, mutually exclusive — v0.3.b):
  --catch                              Force the interactive dialogue (errors on a non-TTY)
  --no-catch                           Skip the dialogue even on a TTY (launch the verbatim dream)

Idempotent re-run flags (used when a demo dir already exists):
  --resume                             Print current dream state and exit 3
  --fresh                              Delete the demo dir and restart
  --cancel                             Abort and exit 1

POSIX:
  --                                   Stop flag parsing; treat the rest as positional

Environment variables:
  MMD_AUTODEV_CMD                      Override the auto-dev subprocess (testing only)
  MMD_AUTODEV_MODE                     'cli' | 'test' — explicit mode (replaces v0.1 heuristic)
  MMD_COMPOSER_DISABLED=1              Bypass v0.2e lessons composer (escape hatch)
  MMD_QUIET=1                          Suppress terminal tee of subprocess output (log file preserved)
  MMD_FAST_MAX_MINUTES                 Soft FAST budget (default 12; warning only — no kill)
  MMD_TIMEOUT_MS                       Subprocess timeout in ms (default 1800000, 0 to disable)
  MMD_REALITY_CHECK_BACKEND            mcp | playwright | skip
  MMD_DREAM_MAX_LEN                    Max dream length in chars (default 500)
  MMD_PROFILE                          Audience profile threaded into the build (Kid|Curious|Pro);
                                       set by the Dream Catcher dialogue. Kid → safe-by-default prompt (v0.3.b)
  MMD_HERE_PROTECTED_BRANCHES          Comma-separated list (default: main,master)
                                       — slice branch is always created from HEAD,
                                       even when on a protected branch (v0.2a AC-2)
`;

function nowIso() {
  return new Date().toISOString();
}

async function promptRfc() {
  if (!input.isTTY) return null;
  const rl = createInterface({ input, output });
  try {
    const ans = (await rl.question('Existing dream found. [R]esume / [F]resh / [C]ancel? '))
      .trim()
      .toUpperCase();
    if (['R', 'F', 'C'].includes(ans)) return ans;
    return null;
  } finally {
    rl.close();
  }
}

/**
 * v0.3.b — build a readline-backed io channel for the CLI Dream Catcher driver
 * (AC-3). Reuses the `node:readline/promises` + `input.isTTY` pattern from
 * promptRfc(). `ask` resolves to the trimmed answer, or `null` on EOF / abort
 * (Ctrl-D) so the driver can honor "an aborted dialogue does not launch". `print`
 * writes a line to stdout. Caller MUST call close() when the dialogue ends.
 */
function createReadlineIo() {
  const rl = createInterface({ input, output });
  return {
    async ask(prompt) {
      try {
        return await rl.question(prompt);
      } catch {
        // readline rejects (e.g. AbortError) when the input stream closes (EOF).
        return null;
      }
    },
    print(text) {
      output.write(text.endsWith('\n') ? text : `${text}\n`);
    },
    close() {
      rl.close();
    },
  };
}

async function resolveExistingChoice(flags) {
  // Explicit flags win over interactive prompt.
  if (flags.cancel) return 'cancel';
  if (flags.fresh) return 'fresh';
  if (flags.resume) return 'resume';
  if (!stdin.isTTY) {
    stderr.write(
      'Existing dream found and stdin is not a TTY. Use --resume / --fresh / --cancel.\n'
    );
    // F7 — usage class: 2.
    exit(2);
  }
  const ans = await promptRfc();
  if (ans === 'R') return 'resume';
  if (ans === 'F') return 'fresh';
  return 'cancel';
}

/**
 * v0.2a — `--here` mode pipeline (self / brownfield-in-place).
 *
 * Spec: SPEC_V02A.md AC-1..AC-7.
 *
 * Differences from the greenfield path:
 *   - No demo/<slug>/ — state files live at <cwd>/.mmd/shared/.
 *   - Validate cwd is a clean git repo (exit 3 / exit 4).
 *   - Create slice branch slice/here-<slug>-<unix-ts> (exit 5 if it fails).
 *   - Auto-dev prompt explicitly forbids demo/ scaffolding (AC-4).
 *   - Reality Check is short-circuited (AC-6).
 *   - status.json carries mode/target_dir/slice_branch/base_branch/base_sha (AC-5).
 */
async function runHereMode({ cwd: targetDir, dream, slug, branchSlug = slug, engine, skipOnboarding }) {
  // F2 (Phase 4 review): canonicalize the target dir via fs.realpath so we
  // do NOT record a symlinked path in status.json (audit trail integrity)
  // while git operates on the real path. path.resolve alone does not follow
  // symlinks. realpath() rejects with ENOENT if the path does not exist —
  // which is the right failure mode for `mmd --here` (cwd MUST exist).
  let absTargetDir;
  try {
    absTargetDir = await realpath(path.resolve(targetDir));
  } catch (err) {
    stderr.write(
      `error: --here: cannot resolve cwd '${targetDir}': ${err.code ? err.code + ': ' : ''}${err.message}\n`,
    );
    return 3;
  }
  stdout.write(`Mode: --here (modifying current repo: ${absTargetDir})\n`);
  if (engine === 'fast') {
    stdout.write('Engine: FAST (trimmed auto-dev — target <=10 min)\n');
  }

  // v0.2c AC-7: Project Onboarder validation gate. Block --here when the
  // target is a brownfield without a VALIDATED discovery report, unless the
  // user explicitly opts out with --skip-onboarding.
  if (!skipOnboarding) {
    const gate = await checkGate(absTargetDir);
    if (!gate.ok) {
      stderr.write(`${gate.message}\n`);
      return 5;
    }
  }

  // AC-2 — git validation (exit 3 / exit 4).
  const validation = await validateHereTarget(absTargetDir);
  if (!validation.ok) {
    stderr.write(`error: ${validation.message}\n`);
    return validation.exitCode;
  }
  const { baseBranch, baseSha } = validation;

  // SPEC_V02H AC-3/AC-4 — prompt-grounding precheck (closes L-015). Runs AFTER
  // the clean-tree check (cheap, fail-fast) and BEFORE slice-branch creation
  // (no point creating a branch we are about to error out of). Verifies every
  // documented file path cited in the dream exists on the slice base; exits 6
  // with a remediation message if any are missing. Escape hatch:
  // MMD_SKIP_GROUNDING=1 bypasses the check with a warning.
  const grounding = await checkPromptGrounding({
    dream,
    baseSha,
    baseBranch,
    repoRoot: absTargetDir,
    env,
  });
  if (grounding.skipped) {
    stderr.write(`${grounding.warning}\n`);
  } else if (!grounding.ok) {
    stderr.write(`error: ${grounding.message}\n`);
    return grounding.exitCode;
  }

  // AC-3 — slice branch creation (exit 5). The branch name uses branchSlug
  // (human-readable, from --label or boilerplate-stripped dream — universal.md
  // §VII), kept distinct from slug (slice_id) so status.json's id is unchanged.
  const sliceBranch = generateSliceBranchName(branchSlug);
  const branchResult = await createSliceBranch(absTargetDir, sliceBranch);
  if (!branchResult.ok) {
    stderr.write(`error: ${branchResult.message}\n`);
    return branchResult.exitCode;
  }
  stdout.write(`Slice branch: ${sliceBranch} (base: ${baseBranch} @ ${baseSha.slice(0, 7)})\n`);

  // F6 (Phase 4 review): give MMD_HERE_PROTECTED_BRANCHES a runtime
  // consequence so it is observable (universal.md §II KISS: no dead-code).
  // When the base branch is protected the slice creation already succeeded —
  // we only emit an informational note that the protected branch was NOT
  // modified (per AC-2 "auto-creates the slice branch anyway"). The env var
  // is honored: a user can broaden the list (e.g. include `release`) and
  // observe the note when --here-ing from those branches.
  const protectedBranches = parseProtectedBranches(env.MMD_HERE_PROTECTED_BRANCHES);
  if (protectedBranches.includes(baseBranch)) {
    stderr.write(
      `Note: --here from a protected branch '${baseBranch}' — slice branch ` +
        `'${sliceBranch}' was created from current HEAD; '${baseBranch}' is never modified.\n`,
    );
  }

  // F4 (Phase 4 review): wrap post-checkout FS writes in a try/catch so an
  // EACCES / ENOSPC / EISDIR after the slice branch was already created does
  // NOT fall through to the top-level exit-99 catch. Instead surface a
  // recovery hint that lets the user wipe the partial slice cleanly
  // (error-handling.md §II environmental-error class — diagnostic + suggested
  // remedy, exit code 6 / subprocess-style failure).
  const initialEngineRecord = buildEngineRecord(engine);
  const hereContextReason =
    `slice=${sliceBranch} base=${baseBranch}@${baseSha} target=${absTargetDir}`;
  // F5 (Phase 4 review): embed the --here invocation context as the `reason`
  // of the existing (initial)->in_progress transition. writeStatus appends a
  // decisions.log audit line with `[reason: ...]` when reason is set, so we
  // never emit a synthetic `here-context` state value that consumers can't
  // map to the pending|in_progress|done|failed machine.
  const inProgressStatus = {
    slice_id: slug,
    dream,
    state: 'in_progress',
    created_at: nowIso(),
    updated_at: nowIso(),
    tasks: [{ id: 'auto-dev', state: 'in_progress' }],
    mode: 'here',
    target_dir: absTargetDir,
    slice_branch: sliceBranch,
    base_branch: baseBranch,
    base_sha: baseSha,
    reason: hereContextReason,
    ...initialEngineRecord,
  };

  try {
    // AC-5 — write state under <cwd>/.mmd/shared/.
    await ensureLayout(absTargetDir);
    await ensureGitignore(absTargetDir);

    // Write a minimal vision/slice for traceability — these are NOT the
    // greenfield "new product" docs; they describe the CHANGE being applied.
    const sharedDir = path.join(absTargetDir, '.mmd', 'shared');
    await writeFile(
      path.join(sharedDir, 'vision.md'),
      `# Vision (--here mode)\n\n` +
        `Modify the repository at: ${absTargetDir}\n` +
        `Slice branch: ${sliceBranch}\n` +
        `Base branch: ${baseBranch} @ ${baseSha}\n\n` +
        `This is NOT a new-product vision. It documents an in-place change.\n`,
      'utf8',
    );
    await writeFile(
      path.join(sharedDir, 'slice.md'),
      `# Change — ${slug}\n\n` +
        `Dream: ${dream}\n\n` +
        `Target: ${absTargetDir} (in-place)\n` +
        `Slice branch: ${sliceBranch}\n` +
        `Base: ${baseBranch} @ ${baseSha}\n\n` +
        `Acceptance: the change is applied on the slice branch, all existing tests still pass, and a human reviews + merges.\n`,
      'utf8',
    );

    await writeStatus(absTargetDir, inProgressStatus);
  } catch (err) {
    // F4: post-checkout FS failure. The slice branch already exists but state
    // files are partial/missing. Tell the user EXACTLY how to recover (commit
    // -git.md branch hygiene: never leave broken WIP behind without a path
    // back to a clean tree).
    stderr.write(
      `error: failed to initialize --here state after creating slice branch.\n` +
        `  cause: ${err.code ? `${err.code}: ` : ''}${err.message}\n` +
        `  context: slice branch '${sliceBranch}' was created from '${baseBranch}' @ ${baseSha}.\n` +
        `  To recover: git checkout ${baseBranch} && git reset --hard ${baseSha} && git branch -D ${sliceBranch}\n`,
    );
    const e = new Error(`--here state init failed: ${err.message}`);
    e.mmdExitCode = 6;
    throw e;
  }

  // AC-4 — build the in-place prompt for auto-dev (no demo/ scaffold).
  const herePrompt = buildHerePrompt({ dream, sliceBranch, targetDir: absTargetDir, engine });

  const timestamp = `${nowIso().replace(/[:.]/g, '-')}-${process.pid}`;
  const logPath = path.join(absTargetDir, '.mmd', 'local', 'runs', `${timestamp}.log`);

  const startNs = process.hrtime.bigint();
  let invokeResult;
  try {
    invokeResult = await invokeAutodev({
      demoDir: absTargetDir, // cwd of subprocess = target repo root (AC-4).
      dream,
      slug,
      promptParts: { dream, slug, demoDir: absTargetDir, prompt: herePrompt, mode: 'here' },
      logPath,
      timeoutMs: env.MMD_TIMEOUT_MS ? Number(env.MMD_TIMEOUT_MS) : 1_800_000,
      engine,
    });
  } catch (err) {
    const elapsedFail = Number(process.hrtime.bigint() - startNs) / 1e9;
    await writeStatus(absTargetDir, {
      ...inProgressStatus,
      state: 'failed',
      updated_at: nowIso(),
      ...withDuration(initialEngineRecord, elapsedFail),
    });
    stderr.write(`auto-dev invocation failed: ${err.message}. See ${logPath}\n`);
    const e = new Error(err.message);
    e.mmdExitCode = err.mmdExitCode ?? 99;
    throw e;
  }

  const elapsedSeconds = Number(process.hrtime.bigint() - startNs) / 1e9;
  const finalEngineRecord = withDuration(initialEngineRecord, elapsedSeconds);

  if (engine === 'fast' && fastBudgetExceeded(elapsedSeconds)) {
    const mins = Math.floor(elapsedSeconds / 60);
    const secs = Math.floor(elapsedSeconds % 60);
    stderr.write(
      `Warning: FAST mode is taking longer than expected (${mins}m ${secs}s). ` +
        `Consider re-running with --standard.\n`,
    );
  }

  const { code } = invokeResult;
  if (code !== 0) {
    await writeStatus(absTargetDir, {
      ...inProgressStatus,
      state: 'failed',
      updated_at: nowIso(),
      ...finalEngineRecord,
    });
    stderr.write(`auto-dev exited with code ${code}. See ${logPath}\n`);
    const e = new Error(`auto-dev subprocess exited ${code}`);
    e.mmdExitCode = 6;
    throw e;
  }

  // AC-6 — Reality Check short-circuited in --here mode (no PWA to open).
  // Also suggest `npm test` when the target repo has a test script.
  try {
    const rc = await realityCheck({ demoDir: absTargetDir, hereMode: true });
    stdout.write(`Reality Check: ${rc.status}${rc.reason ? ' — ' + rc.reason : ''}\n`);
  } catch (err) {
    stderr.write(`Reality Check: error — ${err.message}\n`);
  }
  await maybeSuggestNpmTest(absTargetDir);

  await writeStatus(absTargetDir, {
    ...inProgressStatus,
    state: 'done',
    updated_at: nowIso(),
    tasks: [{ id: 'auto-dev', state: 'done', log: logPath }],
    ...finalEngineRecord,
  });
  stdout.write(
    `[OK] Changes applied on ${sliceBranch}. Review with: git diff ${baseSha}..HEAD\n` +
      `     Merge with:  git checkout ${baseBranch} && git merge --ff-only ${sliceBranch}\n` +
      `     Discard with: git checkout ${baseBranch} && git branch -D ${sliceBranch}\n`,
  );
  return 0;
}

/**
 * AC-6 — if cwd's package.json declares a `test` script, suggest `npm test`
 * (suggestion only — never auto-runs). Defensive: any read/parse error is
 * swallowed silently because this is a courtesy nudge, not a contract.
 */
async function maybeSuggestNpmTest(targetDir) {
  try {
    const pkgRaw = await fsReadFile(path.join(targetDir, 'package.json'), 'utf8');
    const pkg = JSON.parse(pkgRaw);
    if (pkg && pkg.scripts && typeof pkg.scripts.test === 'string' && pkg.scripts.test.length > 0) {
      stdout.write(`Suggestion: run \`npm test\` from ${targetDir} to verify the change.\n`);
    }
  } catch {
    // Silent: package.json missing/unreadable/malformed — no suggestion. Documented per §I.
  }
}

// ─────────────────────────────────────────────────────────────────────────
// v0.4.a — sealed-test oracle (`mmd --sealed "<dream>"`). SPEC_V04A Bundle B.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Synchronously list FILE paths under `rootDir`, relative to it, skipping any
 * directory whose name is in `skipDirs` AT ANY DEPTH (so a nested `node_modules`
 * is pruned, not just a top-level one). Used both as the sealed-dir lister
 * (fresh each verify) and as the blast-radius candidate lister. Returns [] for a
 * missing dir (never throws — universal §VI).
 */
function listFilesRelSync(rootDir, { skipDirs = [] } = {}) {
  const out = [];
  const skip = new Set(skipDirs);
  const walk = (rel) => {
    let entries;
    try {
      entries = readdirSync(path.join(rootDir, rel), { withFileTypes: true });
    } catch {
      return; // missing / unreadable subtree — skip
    }
    for (const e of entries) {
      const childRel = rel ? path.join(rel, e.name) : e.name;
      if (e.isDirectory()) {
        if (skip.has(e.name)) continue; // prune at any depth
        walk(childRel);
      } else if (e.isFile()) {
        out.push(childRel);
      }
    }
  };
  walk('');
  return out;
}

/**
 * Invoke the TESTER sub-agent via `claude -p`, reusing the same env allowlist
 * and the MMD_AUTODEV_CMD test seam as auto-dev (SPEC_V04A AC-3). Synchronous
 * (one-shot, blocking) — simpler than the coder's streaming spawn and adequate
 * for a single prompt.
 *
 * In CLI mode the prompt rides as `-p <prompt>`; in test mode the FULL prompt is
 * passed as a single positional arg so the fake-claude can branch tester-vs-coder
 * on its SHARED_MARKER (auto-dev's test seam strips to [dream], which is why the
 * tester needs its own spawn here).
 *
 * @returns {{ ok: boolean, status: number|null, message?: string }}
 */
function invokeSealedTester({ demoDir, prompt, logPath, timeoutMs }) {
  const cmd = process.env.MMD_AUTODEV_CMD || 'claude';
  const mode = resolveAutodevMode(process.env);
  const args = mode === 'cli' ? ['-p', prompt] : [prompt];
  const childEnv = buildSubprocessEnv(process.env);

  const r = spawnSync(cmd, args, {
    cwd: demoDir,
    env: childEnv,
    encoding: 'utf8',
    timeout: timeoutMs && timeoutMs > 0 ? timeoutMs : undefined,
  });

  // Forensic trail: tee whatever the tester emitted into the run log dir.
  // Synchronous so the file is flushed before this (sync) helper returns and
  // its caller acts on the tester result (no fire-and-forget race on errors).
  try {
    mkdirSync(path.dirname(logPath), { recursive: true });
    writeFileSync(
      logPath,
      `[tester] cmd=${cmd} mode=${mode} status=${r.status}\n` +
        `--- stdout ---\n${r.stdout || ''}\n--- stderr ---\n${r.stderr || ''}\n`,
      'utf8',
    );
  } catch { /* log is best-effort */ }

  if (r.error) {
    const code = r.error.code === 'ENOENT'
      ? `'${cmd}' not found on PATH. Install Claude Code or set MMD_AUTODEV_CMD.`
      : r.error.message;
    return { ok: false, status: null, message: `tester could not run: ${code}` };
  }
  if (r.status !== 0) {
    return { ok: false, status: r.status, message: `tester exited with code ${r.status}` };
  }
  return { ok: true, status: 0 };
}

/**
 * Surface-agnostic sealed-test pipeline (v0.4.b, SPEC_V04B AC-1):
 *   TESTER → SEAL (+ empty-seal AND incomplete-seal integrity guards)
 *          → CODER (injected callback) → VERIFY → re-run sealed tests → BLAST.
 *
 * The ONLY thing that differs between the greenfield (`mmd --sealed`) and the
 * self/brownfield (`mmd --here --sealed`) surfaces is the CODER step — so the
 * coder is injected as an async callback `coder(sealedDir) -> invokeResult`
 * ({ code }). Everything else (the blind tester, the hash seal, both integrity
 * guards, tamper enforcement, the independent re-run, blast radius, and the
 * honest failStatus/exit-6 handling at every branch) is shared here so the two
 * surfaces never drift (universal §III DRY).
 *
 * Honest at every step (universal §VI): a tester that fails or writes nothing,
 * an empty seal, a partially-hashed seal, a coder error, a tampered/removed
 * sealed file, or a failing sealed test each surface explicitly and mark the
 * slice NOT done — never a silent "sealed OK". A tamper/removal is the whole
 * point (anti-P-04): MMD exits non-zero naming the files and refuses to treat
 * the slice as complete.
 *
 * The two surface-specific status writers are injected so each surface keeps its
 * own status.json shape and reporting:
 *   - failStatus(reason, elapsedSeconds): persist the `failed` state.
 *   - onClean({ sealedCount, verdict, blastRadius, elapsedSeconds }): persist the
 *     `done` state + emit the surface's success reporting.
 *
 * @param {{
 *   targetDir: string,            // cwd for the re-run + blast-radius walk (demoDir | absTargetDir)
 *   sealedDir: string,            // absolute path of the sealed oracle dir
 *   dream: string,
 *   slug: string,
 *   slice: string|null,           // optional spec text to ground the tester (greenfield slice.md; null in --here)
 *   logPath: string,
 *   coder: (sealedDir: string) => Promise<{ code: number|null }>,
 *   failStatus: (reason: string, elapsedSeconds: number) => Promise<void>,
 *   onClean: (info: { sealedCount: number, verdict: object, blastRadius: object, elapsedSeconds: number }) => Promise<void>,
 * }} opts
 * @returns {Promise<number>} exit code (0 clean; 6 for any sealed-pipeline failure)
 */
async function runSealedPipeline({
  targetDir, sealedDir, dream, slug, slice = null, logPath, coder, failStatus, onClean,
}) {
  const startNs = process.hrtime.bigint();
  const elapsed = () => Number(process.hrtime.bigint() - startNs) / 1e9;

  stdout.write('Mode: --sealed (sealed-test oracle — tester writes blind tests, MMD seals them)\n');

  // ── 1. TESTER ────────────────────────────────────────────────────────────
  mkdirSync(sealedDir, { recursive: true });
  const testerPrompt = buildTesterPrompt({ dream, slice, sealedDir });
  const testerLog = logPath.replace(/\.log$/, '.tester.log');
  stdout.write('Sealed step 1/5 — TESTER: deriving acceptance tests (blind to the implementation)...\n');
  const tester = invokeSealedTester({
    demoDir: targetDir, prompt: testerPrompt, logPath: testerLog,
    timeoutMs: env.MMD_TIMEOUT_MS ? Number(env.MMD_TIMEOUT_MS) : 1_800_000,
  });
  if (!tester.ok) {
    await failStatus(`tester failed: ${tester.message}`, elapsed());
    stderr.write(`error: --sealed ${tester.message}. See ${testerLog}\n`);
    return 6;
  }

  // ── 2. SEAL ──────────────────────────────────────────────────────────────
  const readdirFn = (dir) => listFilesRelSync(dir);
  const readFileFn = (dir, rel) => readFileSync(path.join(dir, rel));
  const manifest = buildManifest(sealedDir, readdirFn, readFileFn);
  const sealedCount = Object.keys(manifest).length;
  if (sealedCount === 0) {
    // Empty seal: the tester exited 0 but wrote no tests. NOT a silent pass.
    await failStatus('empty seal: tester wrote no acceptance tests', elapsed());
    stderr.write(
      `error: --sealed empty seal — the tester wrote no test files into ${sealedDir}. ` +
        `Refusing to proceed (an empty oracle proves nothing). See ${testerLog}\n`,
    );
    return 6;
  }
  // Seal-integrity guard: buildManifest silently skips a file it cannot read
  // (manifest.js, by design — never throw). If the on-disk listing has MORE
  // files than the manifest hashed, a sealed file went un-hashed and the seal
  // would not protect it — that is exactly the anti-P-04 hole. Refuse rather
  // than seal a partial oracle (universal §VI: never a silent sealed-OK).
  const sealedOnDisk = listFilesRelSync(sealedDir).length;
  if (sealedOnDisk !== sealedCount) {
    await failStatus(`seal incomplete: ${sealedOnDisk - sealedCount} sealed file(s) could not be hashed`, elapsed());
    stderr.write(
      `error: --sealed seal incomplete — ${sealedOnDisk} file(s) on disk but only ${sealedCount} hashed; ` +
        `an unhashed sealed file would be unprotected. Refusing to proceed. See ${testerLog}\n`,
    );
    return 6;
  }
  stdout.write(`Sealed step 2/5 — SEAL: ${sealedCount} test file(s) hashed (read-only oracle).\n`);

  // ── 3. CODER (injected — greenfield auto-dev or --here auto-dev) ───────────
  stdout.write('Sealed step 3/5 — CODER: running auto-dev against the sealed oracle...\n');
  let invokeResult;
  try {
    invokeResult = await coder(sealedDir);
  } catch (err) {
    await failStatus(`coder invocation failed: ${err.message}`, elapsed());
    stderr.write(`auto-dev (coder) invocation failed: ${err.message}. See ${logPath}\n`);
    return err.mmdExitCode ?? 6;
  }
  if (invokeResult.code !== 0) {
    await failStatus(`coder exited ${invokeResult.code}`, elapsed());
    stderr.write(`auto-dev (coder) exited with code ${invokeResult.code}. See ${logPath}\n`);
    return 6;
  }

  // ── 4. VERIFY the seal (the anti-P-04 enforcement) ─────────────────────────
  const verdict = verifyManifest(sealedDir, manifest, readdirFn, readFileFn);
  if (!sealIntact(verdict)) {
    const tampered = verdict.tampered.map((f) => `tampered: ${f}`);
    const removed = verdict.removed.map((f) => `removed:  ${f}`);
    const named = [...tampered, ...removed].join('\n  ');
    await failStatus(`SEAL BROKEN — ${verdict.tampered.length} tampered, ${verdict.removed.length} removed`, elapsed());
    stderr.write(
      `error: --sealed SEAL BROKEN — the coder modified the read-only oracle (P-04).\n` +
        `  ${named}\n` +
        `The slice is NOT done and will NOT be merged. Re-run, or inspect ${logPath}.\n`,
    );
    return 6;
  }
  const addedNote = verdict.added.length
    ? ` (coder added ${verdict.added.length} non-sealed file(s) — allowed)`
    : '';
  stdout.write(`Sealed step 4/5 — VERIFY: seal intact${addedNote}.\n`);

  // ── 4b. Re-run the sealed tests as the independent oracle ──────────────────
  const sealedFiles = listFilesRelSync(sealedDir).map((rel) => path.join(sealedDir, rel));
  const run = spawnSync('node', ['--test', ...sealedFiles], {
    cwd: targetDir,
    env: buildSubprocessEnv(process.env),
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (run.error) {
    await failStatus(`could not run sealed tests: ${run.error.message}`, elapsed());
    stderr.write(`error: --sealed could not run the sealed tests: ${run.error.message}\n`);
    return 6;
  }
  if (run.status !== 0) {
    await failStatus(`sealed tests failed (exit ${run.status})`, elapsed());
    stderr.write(
      `error: --sealed the sealed tests FAILED (exit ${run.status}) — the implementation does ` +
        `not satisfy the independent oracle. The slice is flagged.\n` +
        `${(run.stdout || '').split('\n').slice(-12).join('\n')}\n`,
    );
    return 6;
  }
  stdout.write('Sealed step 4/5 — ORACLE re-run: sealed tests PASS (independent verification).\n');

  // ── 5. BLAST RADIUS (stub, advisory) → status.json.blast_radius ────────────
  const changedFiles = listFilesRelSync(targetDir, { skipDirs: ['.mmd', 'node_modules', '.git'] });
  const blastRadius = computeBlastRadius(changedFiles, {
    listFiles: () => listFilesRelSync(targetDir, { skipDirs: ['.mmd', 'node_modules', '.git'] }),
    readFile: (rel) => {
      try { return readFileSync(path.join(targetDir, rel), 'utf8'); } catch { return ''; }
    },
  });
  stdout.write(
    `Sealed step 5/5 — BLAST: ${blastRadius.changed.length} changed, ` +
      `${blastRadius.importers.length} direct importer(s) (stub; AST in v0.5).\n`,
  );

  await onClean({ sealedCount, verdict, blastRadius, elapsedSeconds: elapsed() });
  return 0;
}

/**
 * The `mmd --sealed` greenfield orchestration (SPEC_V04A AC-4): a thin wrapper
 * over runSealedPipeline (v0.4.b AC-1) that injects the greenfield CODER
 * (buildCoderPrompt + invokeAutodev on demoDir) and the greenfield status
 * writers. Behaviour is byte-for-byte unchanged from v0.4.a — the v0.4.a
 * greenfield `--sealed` integration tests are the regression guard.
 *
 * Returns an exit code (0 clean; 6 for any sealed-pipeline failure).
 */
async function runSealedGreenfield({
  demoDir, dream, slug, engine, logPath, inProgressStatus, initialEngineRecord, catchProfile,
}) {
  const sealedDir = path.join(demoDir, '.mmd', 'shared', 'sealed-tests');
  // Greenfield grounds the tester on slice.md when present (the dream alone
  // otherwise). The --here surface has no slice.md and passes null.
  let slice = null;
  try {
    slice = readFileSync(path.join(demoDir, '.mmd', 'shared', 'slice.md'), 'utf8');
  } catch { /* no slice spec — the dream alone grounds the tester */ }

  return runSealedPipeline({
    targetDir: demoDir,
    sealedDir,
    dream,
    slug,
    slice,
    logPath,
    coder: (sealedDirArg) => {
      const coderPrompt = buildCoderPrompt({ dream, slug, demoDir, sealedDir: sealedDirArg, engine });
      return invokeAutodev({
        demoDir,
        dream,
        slug,
        promptParts: { dream, slug, demoDir, prompt: coderPrompt },
        logPath,
        timeoutMs: env.MMD_TIMEOUT_MS ? Number(env.MMD_TIMEOUT_MS) : 1_800_000,
        engine,
      });
    },
    failStatus: async (reason, elapsedSeconds) => {
      await writeStatus(demoDir, {
        ...inProgressStatus,
        state: 'failed',
        updated_at: nowIso(),
        reason,
        ...withDuration(initialEngineRecord, elapsedSeconds),
      });
    },
    onClean: async ({ sealedCount, verdict, blastRadius, elapsedSeconds }) => {
      await writeStatus(demoDir, {
        slice_id: slug,
        dream,
        state: 'done',
        created_at: inProgressStatus.created_at,
        updated_at: nowIso(),
        tasks: [{ id: 'auto-dev', state: 'done', log: logPath }],
        ...(catchProfile ? { profile: catchProfile } : {}),
        sealed: { sealed_files: sealedCount, added: verdict.added },
        blast_radius: blastRadius,
        ...withDuration(initialEngineRecord, elapsedSeconds),
      });
      stdout.write(
        `[OK] Sealed run delivered at ${demoDir}. The sealed oracle was intact and passed.\n`,
      );
    },
  });
}

async function main() {
  const rawArgs = argv.slice(2);
  // Subcommand dispatch happens FIRST so that `mmd bench --help` routes to
  // the bench subcommand's help (not the top-level USAGE). Mirrors POSIX
  // `git <subcmd> --help` semantics. v0.2.5 `serve` predates this rule and
  // is also dispatched first per the same logic.
  if (rawArgs[0] === 'serve') {
    const { runServe } = await import('./serve.js');
    return runServe(rawArgs.slice(1));
  }
  if (rawArgs[0] === 'bench') {
    const { runBench } = await import('./bench.js');
    return runBench(rawArgs.slice(1));
  }
  if (rawArgs[0] === 'ship') {
    // v0.2.f AC-3: `mmd ship` subcommand. Dispatched here for the same
    // reasons as `bench` (must not parse as a dream string equal to "ship").
    // v0.2.g: moved to bin/skills/ship.js per the AC-1 refactor.
    const { runShip } = await import('./skills/ship.js');
    return runShip(rawArgs.slice(1));
  }
  if (rawArgs[0] === 'qa') {
    // v0.2.g AC-2: `mmd qa` subcommand. Dispatched here (before checkGate)
    // so AC-5 gate-bypass holds structurally for read-only/advisory commands.
    const { runQa } = await import('./skills/qa.js');
    return runQa(rawArgs.slice(1));
  }
  if (rawArgs[0] === 'cso') {
    // v0.2.g AC-3: `mmd cso` subcommand. Same dispatch contract as qa.
    const { runCso } = await import('./skills/cso.js');
    return runCso(rawArgs.slice(1));
  }
  if (rawArgs[0] === 'document-release') {
    // v0.2.g AC-4: `mmd document-release` subcommand. Same dispatch contract.
    const { runDocumentRelease } = await import('./skills/document-release.js');
    return runDocumentRelease(rawArgs.slice(1));
  }
  if (rawArgs[0] === 'discover') {
    // v0.2c AC-1: `mmd discover` subcommand. Dispatched here for the same
    // reason as `ship`/`bench` (must not parse as a dream string).
    const { runDiscover } = await import('./discover.js');
    return runDiscover(rawArgs.slice(1));
  }
  if (rawArgs[0] === 'lessons') {
    // v0.2e AC-7: `mmd lessons` introspection subcommand. Dispatched here
    // (before checkGate / argv parsing) — read-only, gate-bypassing like
    // qa/cso/document-release.
    const { runLessons } = await import('./lessons.js');
    return runLessons(rawArgs.slice(1));
  }
  if (rawArgs[0] === 'document-lessons') {
    // v0.2.i AC-1: `mmd document-lessons` — Documentalist lite. Dispatched here
    // (before checkGate / argv parsing) for the same reason as the others: it
    // must not parse as a dream string. Increments lesson counters + auto-promotes.
    const { runDocumentLessons } = await import('./documentalist/document-lessons.js');
    return runDocumentLessons(rawArgs.slice(1));
  }
  if (rawArgs[0] === 'unblock') {
    // v0.2.j AC-3: `mmd unblock` subcommand. Dispatched here (before checkGate
    // / argv parsing) for the same reason as ship/qa — must not parse as a
    // dream string equal to "unblock". Runs the 5-Whys stuck-recovery session.
    const { runUnblock } = await import('./conductor/unblock.js');
    return runUnblock(rawArgs.slice(1));
  }
  if (rawArgs[0] === 'handover') {
    // v0.2.p AC-1: `mmd handover` subcommand. Dispatched here (before checkGate
    // / argv parsing) for the same reason as unblock/ship — must not parse as a
    // dream string equal to "handover". Refreshes HANDOVER.md's State block.
    const { runHandover } = await import('./handover.js');
    return runHandover(rawArgs.slice(1));
  }
  if (rawArgs[0] === 'document-readme') {
    // v0.3.d AC-1: `mmd document-readme` subcommand. Dispatched here (before
    // checkGate / argv parsing) for the same reason as handover — must not parse
    // as a dream string equal to "document-readme". Applies the handover pattern
    // to README.md: refreshes the Status + Changelog mechanical blocks in place.
    const { runDocumentReadme } = await import('./documentalist/document-readme.js');
    return runDocumentReadme(rawArgs.slice(1));
  }
  if (rawArgs.includes('--version')) {
    stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    stdout.write(USAGE);
    return 0;
  }

  // v0.2 — POSIX-style argv parsing with mutex + unknown-flag rejection (E13/E14).
  // Note: empty-string positional ('' from `mmd ""`) is preserved by parseArgv
  // so the empty-check below fires with exit 2 (tests assert code 2).
  const { flags, positional, error: argvError } = parseArgv(rawArgs);
  if (argvError) {
    stderr.write(`error: ${argvError.message}\n`);
    return argvError.exitCode;
  }
  const engine = resolveEngine(flags);
  // `dream` is mutable: the v0.3.b Dream Catcher dialogue (greenfield, on a TTY)
  // may replace it with a refined scope before launch (AC-3).
  let dream = positional[0];

  if (dream === undefined) {
    stderr.write('error: dream string required\n' + USAGE);
    return 2;
  }
  if (dream.trim() === '') {
    stderr.write('error: dream string is empty\n' + USAGE);
    return 2;
  }

  const dreamMaxLen = env.MMD_DREAM_MAX_LEN ? Number(env.MMD_DREAM_MAX_LEN) : 500;
  if (dream.length > dreamMaxLen) {
    stderr.write(`error: dream string too long (max ${dreamMaxLen} chars)\n`);
    return 2;
  }

  let slug;
  let branchSlug;
  try {
    slug = slugify(dream);
    // universal.md §VII: the branch name must read like the work, not the
    // dream's preamble. `--label` (if given) wins; else boilerplate is stripped.
    branchSlug = deriveBranchSlug(dream, flags.label);
  } catch (err) {
    stderr.write(`error: ${err.message}\n`);
    return 2;
  }

  // v0.2c: extract --skip-onboarding once; both the --here path and the
  // greenfield-with-existing-package.json path consult it.
  const skipOnboarding = flags['skip-onboarding'] === true;

  // v0.2a: --here dispatches into the self / brownfield-in-place pipeline.
  // No demo/<slug>/ is created; state files live under <cwd>/.mmd/shared/.
  // The greenfield path below is unchanged when --here is absent.
  if (flags.here) {
    return runHereMode({ cwd: cwd(), dream, slug, branchSlug, engine, skipOnboarding });
  }

  // v0.3.b AC-3: `--catch` forces the interactive Dream Catcher dialogue, which
  // needs a real terminal. On a non-TTY it cannot run, so fail fast with a clear
  // message (usage class → exit 2) rather than silently skipping it. This is a
  // pure flag-usage check; the TTY-gated default path is resolved below.
  if (flags.catch && !stdin.isTTY) {
    stderr.write(
      'error: --catch needs an interactive terminal (a TTY) to run the dialogue. ' +
        'Run mmd directly in a terminal, or drop --catch to launch with the verbatim dream.\n',
    );
    return 2;
  }

  // v0.2c AC-7: greenfield path consults the gate too. The greenfield use
  // case is "no demo/<slug>/ yet" but the cwd itself may still be a
  // brownfield (e.g. user runs `mmd "tiny PWA"` from inside their existing
  // project root with a package.json). Gate fires only when cwd looks like
  // brownfield AND no validated report exists.
  if (!skipOnboarding) {
    const gate = await checkGate(cwd());
    if (!gate.ok) {
      stderr.write(`${gate.message}\n`);
      return 5;
    }
  }

  // v0.3.b AC-3: TTY-gated Dream Catcher dialogue (greenfield only — never under
  // --here, which returned above). `shouldCatch` defaults ON when stdin is a TTY,
  // unless --no-catch is given; --catch forces it (the non-TTY case already
  // exited 2 above). When catching, run the SAME session core the web drives,
  // replace the dream with the refined scope, and thread the chosen profile into
  // the build. A non-TTY without --catch skips the dialogue entirely (today's
  // behavior, CI-safe). An aborted dialogue (EOF / restart→EOF) does NOT launch.
  const shouldCatch = resolveShouldCatch(flags, stdin.isTTY);
  let catchProfile = null;
  if (shouldCatch) {
    const io = createReadlineIo();
    let result;
    try {
      result = await runCliDreamCatcher({
        dream,
        io,
        elicit: (ctx) => runElicit({ ...ctx, env }),
      });
    } finally {
      io.close();
    }
    if (!result.confirmed) {
      stdout.write('Dialogue annulé — aucun rêve lancé.\n');
      return 0;
    }
    // The refined scope becomes the dream the pipeline builds.
    dream = result.scope;
    catchProfile = result.profile || 'Curious';
    // Re-derive the slug from the refined scope so demo/<slug>/ matches it.
    try {
      slug = slugify(dream);
    } catch (err) {
      stderr.write(`error: ${err.message}\n`);
      return 2;
    }
    // AC-4: thread the chosen profile into the subprocess. buildSubprocessEnv
    // passes MMD_* through, and buildPrompt (this process AND the nested claude)
    // consumes it. Default Curious — never empty.
    process.env.MMD_PROFILE = catchProfile;
    stdout.write(`Profil : ${catchProfile}\n`);
  }

  let demoDir = path.join(cwd(), 'demo', slug);
  stdout.write(`Catching your dream...\n  dream: ${dream}\n  slug:  ${slug}\n  dir:   ${demoDir}\n`);
  if (engine === 'fast') {
    stdout.write('Engine: FAST (trimmed auto-dev — target <=10 min)\n');
  }

  // AC-7: re-run logic — only if existing state is present.
  // ENOENT = no prior run (legitimate); other errors (EACCES/EISDIR) propagate per §VII.
  let existing = null;
  try {
    existing = await readStatus(demoDir);
  } catch (err) {
    if (err && err.code !== 'ENOENT') throw err;
  }
  if (existing && existing.dream !== dream) {
    // Slug collision: different dream slugifies to the same value.
    const newSlug = await nextAvailableSlug(slug, path.join(cwd(), 'demo'));
    stderr.write(`[mmd] slug collision; using ${newSlug}\n`);
    slug = newSlug;
    demoDir = path.join(cwd(), 'demo', slug);
    existing = null;
  } else if (existing) {
    const choice = await resolveExistingChoice(flags);
    if (choice === 'cancel') return 1;
    if (choice === 'resume') {
      // E7: refuse --resume when demoDir is a symlink. Defends against social
      // engineering where an attacker pre-creates demo/<slug> -> /tmp/fake so
      // `mmd "<dream>" --resume` reports a misleading "state: done" sourced
      // from outside ./demo/. Mirrors the --fresh symlink check.
      const absDemoDir = path.resolve(demoDir);
      const lst = await lstat(absDemoDir).catch(() => null);
      if (lst && lst.isSymbolicLink()) {
        stderr.write(`refusing to --resume from a symlinked demoDir: ${absDemoDir}\n`);
        const e = new Error('symlinked demoDir');
        e.mmdExitCode = 5;
        throw e;
      }
      stdout.write(`Existing dream state: ${existing.state}\n`);
      return 3;
    }
    if (choice === 'fresh') {
      // F2 — path-traversal defense: refuse to rm anything outside ./demo/.
      const absDemoDir = path.resolve(demoDir);
      const demoRoot = path.resolve(cwd(), 'demo');
      if (!absDemoDir.startsWith(demoRoot + path.sep)) {
        const e = new Error(`refusing to rm outside ./demo/: ${absDemoDir}`);
        e.mmdExitCode = 5;
        throw e;
      }
      // F9 round-2 — defense against symlink bypass.
      const lst = await lstat(absDemoDir).catch(() => null);
      if (lst && lst.isSymbolicLink()) {
        const e = new Error(`refusing to rm symlink at demoDir: ${absDemoDir}`);
        e.mmdExitCode = 5;
        throw e;
      }
      await rm(absDemoDir, { recursive: true, force: true });
      existing = null;
    }
  }

  // B8: ensureGitignore lets EACCES propagate to the top-level catch which
  // already maps it to exit 5 with a friendly message. No need for a redundant
  // EACCES short-circuit here.
  await ensureGitignore(cwd());

  await ensureLayout(demoDir);
  await initStateFiles(demoDir, dream, slug);

  // AC-4: FAST mode overwrites slice.md with a 1-page heuristic spec BEFORE
  // auto-dev runs. Without this grounding the trimmed pipeline diverges
  // (scoping §3.1). Standard mode keeps the parse-dream-generated slice.md
  // unchanged — auto-dev's Phase 1 will produce its own richer spec.
  if (engine === 'fast') {
    const slicePath = path.join(demoDir, '.mmd', 'shared', 'slice.md');
    await writeFile(slicePath, deriveSpec({ dream, slug }), 'utf8');
  }

  // F5 round-2 — capture in-progress payload so the failure path preserves the full schema.
  // AC-6: engine + engine_metrics are part of every status.json from the start.
  const initialEngineRecord = buildEngineRecord(engine);
  const inProgressStatus = {
    slice_id: slug,
    dream,
    state: 'in_progress',
    created_at: existing?.created_at || nowIso(),
    updated_at: nowIso(),
    tasks: [{ id: 'auto-dev', state: 'in_progress' }],
    // AC-3: persist the chosen profile when the dialogue ran (parity with the
    // web /api/catch/confirm path). Omitted entirely on the verbatim-dream path
    // so non-catch runs keep their existing status.json shape (back-compat).
    ...(catchProfile ? { profile: catchProfile } : {}),
    ...initialEngineRecord,
  };
  await writeStatus(demoDir, inProgressStatus);

  // F11 — pid suffix to avoid same-ms collisions on the log filename.
  const timestamp = `${nowIso().replace(/[:.]/g, '-')}-${process.pid}`;
  const logPath = path.join(demoDir, '.mmd', 'local', 'runs', `${timestamp}.log`);

  // v0.4.a AC-4: the opt-in sealed-test oracle. When --sealed is set, the
  // greenfield path runs the two-phase tester→seal→coder→verify→re-run→blast
  // flow instead of the plain auto-dev call below. The default path (no
  // --sealed) falls through unchanged — byte-for-byte identical (SPEC_V04A §1).
  if (flags.sealed) {
    return runSealedGreenfield({
      demoDir, dream, slug, engine, logPath,
      inProgressStatus, initialEngineRecord, catchProfile,
    });
  }

  // AC-5 + AC-6: time the auto-dev invocation for engine_metrics.duration_seconds
  // and the FAST soft-budget warning. Use a monotonic clock so wall-clock drift
  // can't produce nonsense durations.
  const startNs = process.hrtime.bigint();
  let invokeResult;
  try {
    invokeResult = await invokeAutodev({
      demoDir,
      dream,
      slug,
      promptParts: { dream, slug, demoDir },
      logPath,
      timeoutMs: env.MMD_TIMEOUT_MS ? Number(env.MMD_TIMEOUT_MS) : 1_800_000,
      engine,
    });
  } catch (err) {
    const elapsedFail = Number(process.hrtime.bigint() - startNs) / 1e9;
    await writeStatus(demoDir, {
      ...inProgressStatus,
      state: 'failed',
      updated_at: nowIso(),
      ...withDuration(initialEngineRecord, elapsedFail),
    });
    stderr.write(`auto-dev invocation failed: ${err.message}. See ${logPath}\n`);
    const e = new Error(err.message);
    e.mmdExitCode = err.mmdExitCode ?? 99;
    throw e;
  }

  const elapsedSeconds = Number(process.hrtime.bigint() - startNs) / 1e9;
  const finalEngineRecord = withDuration(initialEngineRecord, elapsedSeconds);

  // AC-5: soft warning when FAST mode overran its target. Never kill the
  // subprocess — that would lose work. Just nudge the user toward --standard.
  if (engine === 'fast' && fastBudgetExceeded(elapsedSeconds)) {
    const mins = Math.floor(elapsedSeconds / 60);
    const secs = Math.floor(elapsedSeconds % 60);
    stderr.write(
      `Warning: FAST mode is taking longer than expected (${mins}m ${secs}s). ` +
        `This may indicate the dream is too complex for FAST; consider re-running with --standard.\n`,
    );
  }

  const { code } = invokeResult;
  if (code !== 0) {
    await writeStatus(demoDir, {
      ...inProgressStatus,
      state: 'failed',
      updated_at: nowIso(),
      ...finalEngineRecord,
    });
    stderr.write(`auto-dev exited with code ${code}. See ${logPath}\n`);
    const e = new Error(`auto-dev subprocess exited ${code}`);
    e.mmdExitCode = 6;
    throw e;
  }

  // Reality Check — advisory in v0.1, never fails the run.
  try {
    const rc = await realityCheck({
      demoDir,
      screenshotDir: path.join(demoDir, '.mmd', 'local', 'reality-checks'),
    });
    stdout.write(`Reality Check: ${rc.status}${rc.reason ? ' — ' + rc.reason : ''}\n`);
  } catch (err) {
    stderr.write(`Reality Check: error — ${err.message}\n`);
  }

  await writeStatus(demoDir, {
    slice_id: slug,
    dream,
    state: 'done',
    created_at: existing?.created_at || inProgressStatus.created_at,
    updated_at: nowIso(),
    tasks: [{ id: 'auto-dev', state: 'done', log: logPath }],
    ...(catchProfile ? { profile: catchProfile } : {}),
    ...finalEngineRecord,
  });
  stdout.write(`[OK] Delivered at ${demoDir}\n`);
  return 0;
}

main()
  .then((code) => exit(code))
  .catch((err) => {
    if (err && err.code === 'EACCES') {
      stderr.write(`error: permission denied: ${err.message || err}\n`);
      exit(5);
      return;
    }
    stderr.write((err.stack || err.message || String(err)) + '\n');
    exit(err.mmdExitCode ?? 99);
  });
