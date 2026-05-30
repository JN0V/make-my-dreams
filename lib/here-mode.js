// lib/here-mode.js — `--here` mode plumbing for v0.2a (self / brownfield-in-place).
//
// SRP (constitution §I.S): owns ONLY the --here-mode concerns:
//   - validating cwd is a clean git repo (AC-2: exit 3 / exit 4)
//   - generating a slice branch name `slice/here-<slug>-<unix-ts>` (AC-3)
//   - creating + switching to that slice branch (AC-3: exit 5)
//   - reading the base branch + base SHA (AC-5)
//   - building the auto-dev prompt body for --here mode (AC-4)
//
// Security (§I.A03): all git invocations use spawn with an args-array — no
// shell=true, no template interpolation into a shell string. We pass the
// slice branch name as a separate argv element, which is safe even with
// adversarial input.
//
// Failure honesty (universal.md §VI): every error path returns a typed
// result `{ ok: false, exitCode, message }` so the caller can map it to the
// spec'd exit codes and a friendly stderr message. We never silently swallow
// a git error.
//
// Public API:
//   - validateHereTarget(cwd)                  -> Promise<{ ok, exitCode?, message?, baseBranch?, baseSha? }>
//   - generateSliceBranchName(slug, now?)      -> string  (deterministic with injected `now`)
//   - createSliceBranch(cwd, branchName)       -> Promise<{ ok, exitCode?, message?, sliceBranch? }>
//   - checkPromptGrounding(opts)               -> Promise<{ ok, skipped?, warning?, files?, missing?, exitCode?, message? }>
//   - buildHerePrompt(opts)                    -> string
//   - PROTECTED_BRANCHES_DEFAULT               -> string[]
//   - parseProtectedBranches(envValue)         -> string[]

import { spawn } from 'node:child_process';
import path from 'node:path';

import { extractFileRefs } from './here-mode/extract-file-refs.js';
import { verifyGrounding } from './here-mode/verify-grounding.js';

export const PROTECTED_BRANCHES_DEFAULT = Object.freeze(['main', 'master']);

/**
 * Parse the MMD_HERE_PROTECTED_BRANCHES env var (comma-separated list).
 *
 * Graceful degradation (error-handling.md §III): an empty/malformed value
 * falls back to the default. We never throw — the caller already has a
 * reasonable default and a malformed env var should not crash mmd.
 *
 * v0.2a runtime behavior (bin/mmd.js): the protected-branch case is
 * "always permissive, never blocking" per SPEC_V02A AC-2 — the slice
 * branch is created regardless. When the base branch IS in the protected
 * list, the CLI emits an informational stderr note acknowledging that the
 * protected branch was not modified. The v0.5 Conductor (MAKE_MY_DREAMS
 * §6.4) is expected to upgrade this to a policy gate (e.g. require an
 * explicit confirmation, or restrict who can run `mmd --here` from main).
 *
 * @param {string|undefined} envValue
 * @returns {string[]}
 */
export function parseProtectedBranches(envValue) {
  if (typeof envValue !== 'string') return [...PROTECTED_BRANCHES_DEFAULT];
  const items = envValue
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (items.length === 0) return [...PROTECTED_BRANCHES_DEFAULT];
  return items;
}

/**
 * Minimal git runner used by every validator. Always spawn with
 * shell=false + args-array (security §I.A03).
 *
 * F3 (Phase 4 review): NEVER rejects. Returns a typed result so callers
 * can map any failure (spawn error, signal, exit non-zero) to a friendly
 * exit code without bypassing the spec'd 3/4/5 codes via the top-level
 * exit-99 catch (error-handling.md §II).
 *
 * Result shape:
 *   - `{ ok: true,  code, stdout, stderr }`  — process exited (may still have non-zero `code`)
 *   - `{ ok: false, error, stderr }`         — could not run at all (ENOENT, signal, etc.)
 *
 * Callers MUST check both `ok === true` AND `code === 0` for success.
 *
 * @param {string[]} args
 * @param {string} cwd
 * @returns {Promise<
 *   | { ok: true,  code: number|null, stdout: string, stderr: string }
 *   | { ok: false, error: Error, stderr: string }
 * >}
 */
function runGit(args, cwd) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('git', args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });
    } catch (err) {
      const wrapped = new Error(`failed to spawn git: ${err.message}`);
      wrapped.cause = err;
      resolve({ ok: false, error: wrapped, stderr: '' });
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    // `error` fires for spawn failures (ENOENT) AFTER the spawn() call
    // succeeded synchronously — e.g. git binary missing from PATH but the
    // spawn syscall did not throw.
    child.on('error', (err) => {
      const wrapped = new Error(`git invocation failed: ${err.message}`);
      wrapped.cause = err;
      settle({ ok: false, error: wrapped, stderr });
    });
    child.on('exit', (code, signal) => {
      if (signal) {
        const err = new Error(`git terminated by signal: ${signal}`);
        settle({ ok: false, error: err, stderr });
        return;
      }
      settle({ ok: true, code, stdout, stderr });
    });
  });
}

/**
 * AC-2 — validate that the target cwd is a clean git repo, and capture the
 * base branch + SHA for status.json (AC-5).
 *
 * Return contract (failure honesty):
 *   - `{ ok: true, baseBranch, baseSha }` when the cwd is a clean git repo.
 *   - `{ ok: false, exitCode: 3, message }` when cwd is NOT a git repo,
 *      OR when `git` itself is not installed (graceful degradation).
 *   - `{ ok: false, exitCode: 4, message }` when the working tree is dirty.
 *
 * Per AC-2 the protected-branch case does NOT fail — it's handled at the
 * branch-creation step (the slice branch is created anyway). That decision
 * is preserved here: validateHereTarget never returns exit 5.
 *
 * @param {string} cwd absolute path of the target repo (we never resolve
 *   relative paths here — that's bin/mmd.js's job).
 * @returns {Promise<
 *   | { ok: true, baseBranch: string, baseSha: string }
 *   | { ok: false, exitCode: 3|4, message: string }
 * >}
 */
export async function validateHereTarget(cwd) {
  // 1. git repo? `git rev-parse --is-inside-work-tree` is the canonical probe.
  // F3 (Phase 4 review): runGit is typed-result, never rejects. We map every
  // failure mode (ok:false from runGit OR non-zero code) to the spec'd exit
  // codes 3/4 — never let an unexpected rejection escape and trigger the
  // top-level exit-99 catch (error-handling.md §II).
  const inside = await runGit(['rev-parse', '--is-inside-work-tree'], cwd);
  if (!inside.ok) {
    return {
      ok: false,
      exitCode: 3,
      message:
        `--here requires the current directory to be a git repository, ` +
        `but git could not run: ${inside.error.message}. ` +
        `Install git or cd into a git repo first.`,
    };
  }
  if (inside.code !== 0 || inside.stdout.trim() !== 'true') {
    return {
      ok: false,
      exitCode: 3,
      message:
        '--here requires the current directory to be a git repository ' +
        '(run `git init` first or cd into one).',
    };
  }

  // 2. clean working tree? `git status --porcelain=v1` is non-empty when dirty.
  const status = await runGit(['status', '--porcelain=v1'], cwd);
  if (!status.ok) {
    return {
      ok: false,
      exitCode: 3,
      message: `--here: 'git status' could not run: ${status.error.message}`,
    };
  }
  if (status.code !== 0) {
    return {
      ok: false,
      exitCode: 3,
      message: `--here: 'git status' failed: ${status.stderr.trim() || 'unknown error'}`,
    };
  }
  if (status.stdout.length > 0) {
    return {
      ok: false,
      exitCode: 4,
      message:
        '--here requires a clean working tree ' +
        '(commit, stash, or .gitignore your changes first).',
    };
  }

  // 3. capture base branch + SHA (AC-5).
  //    `git symbolic-ref --short HEAD` returns the branch name. If HEAD is
  //    detached, the command exits non-zero — we then fall back to the SHA
  //    only (baseBranch becomes 'HEAD (detached)' for traceability).
  let baseBranch = 'HEAD (detached)';
  const sym = await runGit(['symbolic-ref', '--short', 'HEAD'], cwd);
  if (!sym.ok) {
    return {
      ok: false,
      exitCode: 3,
      message: `--here: 'git symbolic-ref' could not run: ${sym.error.message}`,
    };
  }
  if (sym.code === 0) {
    baseBranch = sym.stdout.trim();
  }
  const rev = await runGit(['rev-parse', 'HEAD'], cwd);
  if (!rev.ok) {
    return {
      ok: false,
      exitCode: 3,
      message: `--here: 'git rev-parse HEAD' could not run: ${rev.error.message}`,
    };
  }
  if (rev.code !== 0) {
    // Edge case: a repo with zero commits. We treat this as a usability error
    // (exit 3) rather than crashing — the user almost certainly meant to
    // create commits before running --here on an empty repo.
    return {
      ok: false,
      exitCode: 3,
      message:
        '--here: cannot read HEAD (is this a freshly-initialized repo with no commits? ' +
        'run `git commit --allow-empty -m init` to seed it).',
    };
  }
  const baseSha = rev.stdout.trim();

  return { ok: true, baseBranch, baseSha };
}

/**
 * AC-3 — generate the slice branch name.
 *
 * Format: `slice/here-<slug>-<unix-timestamp>`. The unix timestamp avoids
 * collisions on re-runs (per AC-3 / spec §3 architecture).
 *
 * Deterministic: accepts an injected `now` function for tests (defaults to
 * `Date.now`). Mirrors the same pattern used elsewhere in the codebase for
 * timestamp injection (see invokeAutodev).
 *
 * @param {string} slug
 * @param {() => number} [now]
 * @returns {string}
 */
export function generateSliceBranchName(slug, now = Date.now) {
  if (typeof slug !== 'string' || slug.length === 0) {
    throw new TypeError('generateSliceBranchName: slug must be a non-empty string');
  }
  const unix = Math.floor(now() / 1000);
  return `slice/here-${slug}-${unix}`;
}

/**
 * AC-3 — create and switch to the slice branch.
 *
 * Returns `{ ok: true, sliceBranch }` on success, or
 * `{ ok: false, exitCode: 5, message }` on failure (branch already exists,
 * git error, etc.). The git error stderr is included verbatim per AC-3.
 *
 * @param {string} cwd
 * @param {string} branchName
 * @returns {Promise<
 *   | { ok: true, sliceBranch: string }
 *   | { ok: false, exitCode: 5, message: string }
 * >}
 */
export async function createSliceBranch(cwd, branchName) {
  if (typeof branchName !== 'string' || branchName.length === 0) {
    throw new TypeError('createSliceBranch: branchName must be a non-empty string');
  }
  // Defensive: refuse any branch name that contains a space or starts with `-`.
  // Both would confuse downstream git invocations even though our argv-array
  // is shell-safe. Keep the gate small and explicit.
  if (/\s/.test(branchName) || branchName.startsWith('-')) {
    return {
      ok: false,
      exitCode: 5,
      message: `--here: refusing to create branch with suspicious name: ${branchName}`,
    };
  }
  // F3 (Phase 4 review): runGit is typed-result, never rejects. Map both
  // failure shapes (could-not-run / non-zero exit) to exit code 5 per AC-3.
  const result = await runGit(['checkout', '-b', branchName], cwd);
  if (!result.ok) {
    return {
      ok: false,
      exitCode: 5,
      message: `--here: 'git checkout -b ${branchName}' could not run: ${result.error.message}`,
    };
  }
  if (result.code !== 0) {
    return {
      ok: false,
      exitCode: 5,
      message:
        `--here: 'git checkout -b ${branchName}' failed: ` +
        `${(result.stderr || result.stdout).trim() || 'unknown error'}`,
    };
  }
  return { ok: true, sliceBranch: branchName };
}

/**
 * SPEC_V02H AC-3 + AC-4 — prompt-grounding precheck (the v0.2.h Conductor
 * precondition, closing L-015).
 *
 * Orchestrates the two pure pieces (extractFileRefs → verifyGrounding) and maps
 * the outcome to a typed result the caller (bin/mmd.js) maps to exit codes,
 * exactly like validateHereTarget / createSliceBranch. Wired BETWEEN the
 * clean-tree check and slice-branch creation (cheap, fail-fast, no point
 * creating a branch we are about to error out of).
 *
 * Escape hatch (AC-4): when `MMD_SKIP_GROUNDING=1` the check is skipped
 * ENTIRELY — no extractor call, no verifier call — and a warning is surfaced so
 * the bypass is observable. The slice proceeds (the caller writes the warning
 * to stderr and continues).
 *
 * Result shapes:
 *   - `{ ok: true,  skipped: true, warning }`              — escape hatch active
 *   - `{ ok: true,  files: [] }`                           — no documented refs
 *   - `{ ok: true,  files }`                               — all refs grounded
 *   - `{ ok: false, exitCode: 6, message, missing, files }`— ≥1 ref missing
 *
 * @param {{
 *   dream: string,
 *   baseSha: string,
 *   repoRoot: string,
 *   baseBranch?: string,
 *   env?: NodeJS.ProcessEnv,
 *   runGit?: (args: string[], cwd: string) => ({ code: number } | Promise<{ code: number }>),
 * }} opts
 * @returns {Promise<object>}
 */
export async function checkPromptGrounding({
  dream,
  baseSha,
  repoRoot,
  baseBranch = 'main',
  env = process.env,
  runGit,
}) {
  if (typeof dream !== 'string' || dream.length === 0) {
    throw new TypeError('checkPromptGrounding: dream must be a non-empty string');
  }
  if (typeof baseSha !== 'string' || baseSha.length === 0) {
    throw new TypeError('checkPromptGrounding: baseSha must be a non-empty string');
  }
  if (typeof repoRoot !== 'string' || repoRoot.length === 0) {
    throw new TypeError('checkPromptGrounding: repoRoot must be a non-empty string');
  }

  // AC-4: escape hatch FIRST — bypass the check entirely (no extractor/verifier).
  if (env && env.MMD_SKIP_GROUNDING === '1') {
    return {
      ok: true,
      skipped: true,
      warning:
        '[mmd] grounding check skipped (MMD_SKIP_GROUNDING=1) — proceeding with ' +
        "possibly nonsense prompt at user's risk.",
    };
  }

  const files = extractFileRefs(dream);
  // AC-3: no documented references → nothing to verify, continue normally.
  if (files.length === 0) {
    return { ok: true, files: [] };
  }

  const verifyArgs = { files, baseSha, repoRoot };
  if (runGit) verifyArgs.runGit = runGit;
  const { missing } = await verifyGrounding(verifyArgs);

  if (missing.length === 0) {
    return { ok: true, files };
  }

  // AC-3: ≥1 referenced file is absent on the base → exit 6 with a multi-line,
  // remediation-oriented message listing each missing path (per L-015 origin).
  const bulletList = missing.map((f) => `  - ${f}`).join('\n');
  const message =
    `Prompt-grounding failed (per L-015) — the following files referenced in ` +
    `your dream do not exist on this slice's base (${baseBranch} @ ${baseSha}):\n` +
    `${bulletList}\n` +
    `Either commit them to ${baseBranch} first, or remove the references from the dream.\n` +
    `To bypass this check (NOT RECOMMENDED), set MMD_SKIP_GROUNDING=1.`;

  return { ok: false, exitCode: 6, message, missing, files };
}

/**
 * AC-4 — build the auto-dev prompt body for --here mode.
 *
 * The prompt MUST contain the literal lines spec'd in AC-4:
 *   - `Mode: --here — modify the current repository in place. Do NOT create a demo/ directory. Do NOT scaffold a new PWA.`
 *   - `Slice branch: <slice-branch>. All commits MUST land on this branch.`
 *   - `Target repo: <cwd absolute path>. Working directory is the repo root.`
 *   - The dream verbatim.
 *   - Pointers to MAKE_MY_DREAMS.md / .specify/memory/constitution.md / docs/lessons-learned.md.
 *
 * The prompt MUST NOT reference `demo/<slug>/`, vision.md (for a new product),
 * or slice.md (for a new feature).
 *
 * @param {{ dream: string, sliceBranch: string, targetDir: string, engine?: 'fast'|'standard' }} opts
 * @returns {string}
 */
export function buildHerePrompt({ dream, sliceBranch, targetDir, engine = 'standard' }) {
  if (typeof dream !== 'string' || dream.length === 0) {
    throw new TypeError('buildHerePrompt: dream must be a non-empty string');
  }
  if (typeof sliceBranch !== 'string' || sliceBranch.length === 0) {
    throw new TypeError('buildHerePrompt: sliceBranch must be a non-empty string');
  }
  if (typeof targetDir !== 'string' || targetDir.length === 0) {
    throw new TypeError('buildHerePrompt: targetDir must be a non-empty string');
  }
  const absTargetDir = path.resolve(targetDir);

  const lines = [
    'You are running inside MMD --here mode (v0.2a self / brownfield-in-place).',
    'Mode: --here — modify the current repository in place. Do NOT create a demo/ directory. Do NOT scaffold a new PWA.',
    `Slice branch: ${sliceBranch}. All commits MUST land on this branch.`,
    `Target repo: ${absTargetDir}. Working directory is the repo root.`,
    `Change requested (verbatim): ${dream}`,
    '',
    'Context to load BEFORE editing:',
    '- MAKE_MY_DREAMS.md (project intent + reflexive bootstrap §7)',
    '- .specify/memory/constitution.md (module index + bindings)',
    '- docs/lessons-learned.md (L-001..L-009 — apply them)',
    '',
    'Operating rules:',
    '- This is a brownfield edit on an existing repository. Respect existing patterns (constitution brownfield.md §I).',
    '- Every meaningful change is committed atomically per commit-git.md §III.',
    '- Stay on the slice branch — never checkout main, never merge.',
    '- Run the auto-dev pipeline (/bmad-adv-auto-dev) for the change above. Phase 4 adversarial review is mandatory.',
  ];
  if (engine === 'fast') {
    lines.push(
      '',
      'Engine: FAST (trimmed auto-dev — target <= 10 min). Honor MMD_AUTODEV_QUICK=1:',
      '- Phase 1: ONE Party Mode round (not 3).',
      '- Phase 2: SKIP if the change is small (1-2 files, < 50 LOC) AND no security surface; otherwise run.',
      '- Phase 3 + Phase 4: keep full — correctness is non-negotiable.',
    );
  }
  return lines.join('\n');
}
