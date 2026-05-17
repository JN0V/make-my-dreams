// lib/invoke-autodev.js — wraps the auto-dev subprocess invocation.
// Constitution: §V/A03 (no shell=true with user input — always args-array),
//               §XII (env allowlist — never inherit full env),
//               §VII (no silent catches — every error surfaces with an mmdExitCode).
//
// v0.2 additions:
//   - engine arg ('fast' | 'standard'): switches the prompt body + injects
//     MMD_AUTODEV_QUICK=1 into the subprocess env when engine === 'fast'
//     (AC-3 + AC-6 plumbing).
//   - resolveAutodevMode(): explicit MMD_AUTODEV_MODE env var replaces the
//     v0.1 heuristic that special-cased `claude` / `*/claude` paths. Wrappers
//     like `claude-wrapper` can now opt into CLI semantics cleanly (B2).
//   - MMD_QUIET=1: suppresses terminal tee for CI / `node --test` while
//     preserving the log-file tee (B4).
//
// Public API:
//   - buildSubprocessEnv(parentEnv)        -> allowlisted env object for spawn
//   - resolveAutodevMode(env)              -> 'cli' | 'test'
//   - buildPrompt({dream, slug, demoDir, engine?})
//   - invokeAutodev({demoDir, dream, slug, promptParts?, logPath, timeoutMs, engine?})
//       Resolves with {code, log}. Rejects with err.mmdExitCode set on infra failure.

import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, stat, constants as fsConstants } from 'node:fs/promises';
import path from 'node:path';

/**
 * Build an allowlisted environment for the spawned subprocess.
 * Constitution §XII (Least Privilege).
 *
 *   Whitelist (exact name): PATH, HOME, TMPDIR, LANG, LC_ALL, TZ, USER, LOGNAME, SHELL,
 *                           ANTHROPIC_API_KEY
 *   Whitelist (prefix):     CLAUDE_*, MMD_*
 *
 * Everything else (AWS_*, GITHUB_TOKEN, random user vars, …) is stripped.
 */
export function buildSubprocessEnv(parentEnv = process.env) {
  const allow = new Set([
    'PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'TZ',
    'USER', 'LOGNAME', 'SHELL', 'ANTHROPIC_API_KEY',
  ]);
  const prefixes = ['CLAUDE_', 'MMD_'];
  const out = {};
  for (const k of Object.keys(parentEnv)) {
    if (allow.has(k) || prefixes.some((p) => k.startsWith(p))) {
      const v = parentEnv[k];
      if (v !== undefined) out[k] = v;
    }
  }
  return out;
}

/**
 * Resolve the auto-dev invocation mode (B2). Replaces the v0.1 heuristic
 * that special-cased the "claude" basename and silently misclassified
 * wrappers like "claude-wrapper".
 *
 * Resolution order:
 *   1. MMD_AUTODEV_MODE explicit ('cli' | 'test') wins — the new clean API.
 *   2. MMD_AUTODEV_CMD set (testing-only override) -> infer 'test' for
 *      backward compatibility with the existing fixture-based test suite.
 *   3. Default -> 'cli' (production claude CLI).
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {'cli'|'test'}
 */
export function resolveAutodevMode(env = process.env) {
  if (env.MMD_AUTODEV_MODE === 'cli' || env.MMD_AUTODEV_MODE === 'test') {
    return env.MMD_AUTODEV_MODE;
  }
  if (env.MMD_AUTODEV_CMD) return 'test';
  return 'cli';
}

/**
 * Assemble the natural-language prompt body for the auto-dev subprocess.
 * Exported for unit-testability (constitution §IV REFACTOR step in 4.4.3).
 *
 * When `engine === 'fast'`, an additional block instructs auto-dev to honor
 * MMD_AUTODEV_QUICK=1: 1× Party Mode (not 3×), Phase 2 opportunistically
 * skipped, Phases 3 + 4 kept full (AC-3).
 *
 * v0.2a — if a pre-built `prompt` string is provided in promptParts (e.g. for
 * --here mode where lib/here-mode.js#buildHerePrompt assembles a different
 * body), it short-circuits the greenfield prompt assembly and returns the
 * caller's string verbatim. This keeps the engine-flag plumbing here while
 * letting modes (here, future --target) own their own prompt shape.
 */
export function buildPrompt({ dream, slug, demoDir, engine = 'standard', prompt = undefined }) {
  if (typeof prompt === 'string' && prompt.length > 0) {
    return prompt;
  }
  const absDemoDir = path.resolve(demoDir);
  const lines = [
    'You are running inside the MMD walking skeleton.',
    `Target directory: ${absDemoDir}`,
    `Dream: ${dream}`,
    `Slug: ${slug}`,
    'Vision: see .mmd/shared/vision.md',
    'Slice: see .mmd/shared/slice.md',
    'Stack constraint: vanilla HTML/CSS/JS + Canvas API + getUserMedia. NO framework, NO bundler.',
    'Generate index.html, style.css, app.js, manifest.json in the target directory.',
    'Bundle B safe-default: camera permission MUST be requested on user gesture only, not on page load.',
  ];
  if (engine === 'fast') {
    lines.push(
      '',
      'Engine: FAST (trimmed auto-dev — target <= 10 min). Honor MMD_AUTODEV_QUICK=1:',
      '- Phase 1: ONE Party Mode round (covering scope + investigation + spec in a single pass), NOT 3 rounds.',
      '- Phase 2 (adversarial spec review): SKIP if the spec at .mmd/shared/slice.md is < 200 lines AND contains < 5 TODO/TBD markers; otherwise run normally.',
      '- Phase 3 (Implementation with 3-reviewer review): keep full — correctness is non-negotiable.',
      '- Phase 4 (final adversarial code review): keep full — cheaper to run than to retroactively audit.',
    );
  }
  return lines.join('\n');
}

/**
 * Spawn the auto-dev backend (real `claude` CLI or test fixture).
 *
 * Rejection contract (err.mmdExitCode):
 *   4 — executable missing (ENOENT on cmd) OR MMD_AUTODEV_CMD points to non-executable
 *   5 — cwd missing (ENOENT on absDemoDir)
 *   6 — subprocess exited with a non-zero code  (resolution path: r.code !== 0)
 *
 * NOTE: per the existing RED tests, non-zero subprocess exit RESOLVES with {code} —
 * it does NOT reject. The exit-6 mapping is applied by bin/mmd.js when it observes
 * the non-zero resolution. We follow the same contract here.
 *
 * @returns {Promise<{code: number|null, log: string}>}
 */
export async function invokeAutodev({
  demoDir,
  dream,
  slug,
  promptParts,
  logPath,
  timeoutMs,
  engine = 'standard',
}) {
  const cmdRaw = process.env.MMD_AUTODEV_CMD || 'claude';
  const cmd = cmdRaw;

  // F7 — MMD_AUTODEV_CMD validation (testing-only env var).
  // Path-separator heuristic: if the value looks like a path (contains '/' or path.sep),
  // verify the file exists and is executable. Unqualified names rely on PATH resolution
  // (and surface as ENOENT in child.on('error') below).
  if (process.env.MMD_AUTODEV_CMD) {
    const isPathLike = cmd.includes('/') || cmd.includes(path.sep);
    if (isPathLike) {
      try {
        await access(cmd, fsConstants.X_OK);
      } catch {
        const e = new Error(
          `MMD_AUTODEV_CMD points to '${cmd}' which is not executable. ` +
            `This env-var is for testing only, not production redirection.`
        );
        e.mmdExitCode = 4;
        throw e;
      }
    }
  }

  // F4 — absolute demoDir for both cwd (process-level) and prompt (LLM-level).
  const absDemoDir = path.resolve(demoDir);

  // F4 + F15 — pre-check cwd existence to disambiguate ENOENT class.
  // Node's spawn currently surfaces ENOENT with `err.path === cmd` (not the cwd)
  // when only the cwd is missing, making err.path-based disambiguation unreliable.
  // An explicit pre-check is the canonical way to get exit-code 5 vs 4 right.
  try {
    await stat(absDemoDir);
  } catch (statErr) {
    if (statErr && statErr.code === 'ENOENT') {
      const e = new Error(`mmd: cwd '${absDemoDir}' does not exist`);
      e.mmdExitCode = 5;
      e.path = absDemoDir;
      e.code = 'ENOENT';
      throw e;
    }
    throw statErr;
  }

  // The real `claude` CLI receives `-p "/bmad-adv-auto-dev <prompt>"` (full prompt body).
  // Test fixtures receive the dream string as a single positional arg (mirrors the
  // echo-env / fake-autodev contracts in test/fixtures/*.sh).
  //
  // B2: mode resolution is now explicit — MMD_AUTODEV_MODE wins, else infer
  // 'test' when MMD_AUTODEV_CMD is set, else default 'cli'. The v0.1 path
  // suffix heuristic is gone — wrappers like `claude-wrapper` now route to
  // 'cli' by default instead of being silently treated as test fixtures.
  const mode = resolveAutodevMode(process.env);
  const isClaudeCli = mode === 'cli';
  const prompt = buildPrompt(
    promptParts ? { ...promptParts, engine } : { dream, slug, demoDir: absDemoDir, engine },
  );
  const args = isClaudeCli
    ? ['-p', `/bmad-adv-auto-dev ${prompt}`]
    : [dream];

  // AC-3: inject MMD_AUTODEV_QUICK=1 for FAST mode. Already passes through
  // buildSubprocessEnv via the MMD_ prefix allowlist, so the subprocess (and
  // any nested `claude -p` invocation it spawns) sees it.
  //
  // Defensive: actively delete MMD_AUTODEV_QUICK in non-FAST mode so a parent
  // shell that exported it (intentionally or otherwise) cannot leak the
  // quick-mode directive into a STANDARD run. The engine arg is the single
  // source of truth for quick-mode.
  const childEnv = buildSubprocessEnv(process.env);
  if (engine === 'fast') {
    childEnv.MMD_AUTODEV_QUICK = '1';
  } else {
    delete childEnv.MMD_AUTODEV_QUICK;
  }

  // B4: MMD_QUIET=1 silences the terminal tee. Log-file tee preserved so the
  // forensic trail under .mmd/local/runs/ stays intact.
  const quiet = process.env.MMD_QUIET === '1';

  return new Promise((resolve, reject) => {
    let child;
    let logStream;
    let timedOut = false;
    let killTimer = null;
    let sigkillTimer = null;
    let settled = false;

    const safeResolve = (val) => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      if (sigkillTimer) clearTimeout(sigkillTimer);
      if (logStream) logStream.end();
      resolve(val);
    };
    const safeReject = (err) => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      if (sigkillTimer) clearTimeout(sigkillTimer);
      if (logStream) logStream.end();
      reject(err);
    };

    try {
      logStream = createWriteStream(logPath, { flags: 'a' });
    } catch (err) {
      err.mmdExitCode = err.mmdExitCode ?? 99;
      return reject(err);
    }

    try {
      child = spawn(cmd, args, {
        cwd: absDemoDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: childEnv,
        shell: false, // constitution §V/A03 — explicit
      });
    } catch (err) {
      err.mmdExitCode = 4;
      if (logStream) logStream.end();
      return reject(err);
    }

    // Tee child stdout/stderr to terminal AND to the log file.
    // B4: when MMD_QUIET=1, drop the terminal tee but keep the log-file tee
    // so post-hoc inspection is unaffected.
    child.stdout.on('data', (chunk) => {
      if (!quiet) process.stdout.write(chunk);
      logStream.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      if (!quiet) process.stderr.write(chunk);
      logStream.write(chunk);
    });

    child.on('error', (err) => {
      if (err && err.code === 'ENOENT') {
        // Disambiguate exe-missing vs cwd-missing via err.path (F15 round-2).
        if (err.path && err.path === absDemoDir) {
          err.mmdExitCode = 5;
          err.message = `mmd: cwd '${absDemoDir}' does not exist`;
        } else {
          err.mmdExitCode = 4;
          err.message = `mmd: '${cmd}' not found on PATH. Install Claude Code or set MMD_AUTODEV_CMD.`;
        }
        return safeReject(err);
      }
      err.mmdExitCode = err.mmdExitCode ?? 99;
      safeReject(err);
    });

    if (timeoutMs && timeoutMs > 0) {
      killTimer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill('SIGTERM');
        } catch { /* already dead */ }
        sigkillTimer = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch { /* already dead */ }
        }, 5000);
        try {
          logStream.write('\n[mmd] subprocess timed out\n');
        } catch { /* stream closed */ }
      }, timeoutMs);
    }

    child.on('exit', (exitCode, signal) => {
      if (timedOut) {
        // Resolve with code:null to signal "killed by timeout".
        return safeResolve({ code: null, log: logPath, signal });
      }
      safeResolve({ code: exitCode, log: logPath, signal });
    });
  });
}
