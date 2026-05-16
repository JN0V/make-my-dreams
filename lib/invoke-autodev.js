// lib/invoke-autodev.js — wraps the auto-dev subprocess invocation.
// Constitution: §V/A03 (no shell=true with user input — always args-array),
//               §XII (env allowlist — never inherit full env),
//               §VII (no silent catches — every error surfaces with an mmdExitCode).
//
// Public API:
//   - buildSubprocessEnv(parentEnv)        -> allowlisted env object for spawn
//   - invokeAutodev({demoDir, dream, slug, promptParts?, logPath, timeoutMs})
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
 * Assemble the natural-language prompt body for the auto-dev subprocess.
 * Exported for unit-testability (constitution §IV REFACTOR step in 4.4.3).
 */
export function buildPrompt({ dream, slug, demoDir }) {
  const absDemoDir = path.resolve(demoDir);
  return [
    'You are running inside the MMD v0.1 walking skeleton.',
    `Target directory: ${absDemoDir}`,
    `Dream: ${dream}`,
    `Slug: ${slug}`,
    'Vision: see .mmd/shared/vision.md',
    'Slice: see .mmd/shared/slice.md',
    'Stack constraint: vanilla HTML/CSS/JS + Canvas API + getUserMedia. NO framework, NO bundler.',
    'Generate index.html, style.css, app.js, manifest.json in the target directory.',
    'Bundle B safe-default: camera permission MUST be requested on user gesture only, not on page load.',
  ].join('\n');
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
export async function invokeAutodev({ demoDir, dream, slug, promptParts, logPath, timeoutMs }) {
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
  const isClaudeCli = cmd === 'claude' || /\/claude$/.test(cmd);
  const prompt = buildPrompt(promptParts || { dream, slug, demoDir: absDemoDir });
  const args = isClaudeCli
    ? ['-p', `/bmad-adv-auto-dev ${prompt}`]
    : [dream];

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
        env: buildSubprocessEnv(process.env),
        shell: false, // constitution §V/A03 — explicit
      });
    } catch (err) {
      err.mmdExitCode = 4;
      if (logStream) logStream.end();
      return reject(err);
    }

    // Tee child stdout/stderr to terminal AND to the log file.
    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      logStream.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
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
