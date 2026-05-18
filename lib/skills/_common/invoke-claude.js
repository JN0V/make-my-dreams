// lib/skills/_common/invoke-claude.js — shared spawn layer for gStack skill
// wrappers (SPEC_V02G AC-1 (a)-(f), AC-2b, AC-Long-Running).
//
// Extracted from lib/ship/invoke-claude.js (v0.2.f). Pure function of its
// arguments — does NOT read process.env. Each wrapper (bin/skills/<name>.js)
// is responsible for resolving its env-dependent knobs and passing them
// explicitly. Rationale (SPEC §5 "Per-skill subprocess env vars"):
// keeps the common layer unit-testable without env mutation; keeps each
// wrapper's overridable knobs visible at the call site.
//
// Responsibilities:
//   (a) Race-safe log stream finish (v0.2.f fix commit a9d6011 preserved).
//   (b) ENOENT branch → mmdExitCode=4 with templated message
//       `mmd <skill>: '<command>' not found on PATH (override with MMD_<SKILL>_CMD)`.
//   (c) SIGTERM → SIGKILL escalation after 5s on timeout.
//   (d) PATH-forcing — $HOME/.bun/bin:$PATH prepended idempotently
//       (via buildSkillEnv, exported for unit tests).
//   (e) Tee to .mmd/local/<skill>-runs/<ts>-<pid>.log.
//   (f) Per-skill command override is implemented at the wrapper level
//       (this module accepts an explicit `command` arg — no env read here).
//
// AC-2b: pre-flight skill-installation check (assertSkillInstalled). Called
// from wrappers BEFORE the spawn except when --dry-run is in effect.
//
// AC-Long-Running:
//   (b) Heartbeat scheduler emits one stderr line every `heartbeatIntervalMs`.
//   (c) pgrep warning (`maybeWarnConcurrentClaude`) honored at the wrapper.
//
// Security (security.md §I.A03): spawn with args-array, shell=false. The
// prompt is passed as a single argv element — no shell interpolation.

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

import { buildSubprocessEnv } from '../../invoke-autodev.js';
import { expandSkillPath } from './skill-path.js';
import { composeLessons } from '../../composer/match.js';
import { writeComposerAudit, composerLogHeader } from '../../composer/audit.js';

/**
 * Build the env object to pass to spawn() for a skill invocation.
 *
 * 1. Start from the allowlisted parent env (PATH, HOME, MMD_*, CLAUDE_*, ...).
 * 2. Prepend $HOME/.bun/bin to PATH — guarantees claude -p can resolve bun.
 *
 * Pure-ish (depends only on its argument). Exported for unit testability.
 *
 * @param {string} _skillName    informational (named-param parity with the legacy
 *                               `buildShipEnv` shape — kept for symmetry).
 * @param {NodeJS.ProcessEnv} [parentEnv]
 * @returns {Record<string, string>}
 */
export function buildSkillEnv(_skillName, parentEnv = process.env) {
  const env = buildSubprocessEnv(parentEnv);
  const home = env.HOME || parentEnv.HOME || os.homedir();
  const bunBin = path.join(home, '.bun', 'bin');
  const existingPath = env.PATH || parentEnv.PATH || '';
  if (!existingPath.startsWith(bunBin + path.delimiter) && existingPath !== bunBin) {
    env.PATH = existingPath ? `${bunBin}${path.delimiter}${existingPath}` : bunBin;
  } else {
    env.PATH = existingPath;
  }
  return env;
}

/**
 * Build the argv list passed to spawn(). Exported for tests.
 *
 * The contract matches the SPEC AC-4 invocation:
 *   claude -p --output-format text "<prompt>"
 *
 * @param {string} prompt
 * @returns {string[]}
 */
export function buildSkillArgs(prompt) {
  if (typeof prompt !== 'string' || prompt.length === 0) {
    throw new TypeError('buildSkillArgs: prompt must be a non-empty string');
  }
  return ['-p', '--output-format', 'text', prompt];
}

/**
 * Compute the log path for a skill run. Pure-ish (depends on Date by default,
 * deterministic when `now` is injected).
 *
 * @param {string} repoRoot
 * @param {string} skillName       used for `.mmd/local/<skill>-runs/`
 * @param {() => Date} [now]
 * @returns {string} absolute path
 */
export function skillLogPath(repoRoot, skillName, now = () => new Date()) {
  if (typeof repoRoot !== 'string' || repoRoot.length === 0) {
    throw new TypeError('skillLogPath: repoRoot must be a non-empty string');
  }
  if (typeof skillName !== 'string' || skillName.length === 0) {
    throw new TypeError('skillLogPath: skillName must be a non-empty string');
  }
  const ts = now().toISOString().replace(/[:.]/g, '-');
  // F15 (Phase-4 review): same-process rapid reruns can produce identical
  // `${ts}-${pid}.log` filenames; the `flags: 'a'` append mode then
  // interleaves logs from two runs into one file. A 2-byte hex suffix
  // (4 random hex chars) makes accidental collision essentially impossible.
  const rnd = randomBytes(2).toString('hex');
  return path.join(repoRoot, '.mmd', 'local', `${skillName}-runs`, `${ts}-${process.pid}-${rnd}.log`);
}

/**
 * Pre-flight (AC-2b): verify the resolved SKILL.md path exists on disk.
 *
 * Returns an error object — never throws — so wrappers can format their own
 * error message in their own style. Skipped by the wrapper when `--dry-run`.
 *
 * @param {{ skillName: string, skillPath: string, existsSyncFn?: (p: string) => boolean }} opts
 * @returns {{ ok: true } | { ok: false, exitCode: 4, message: string, missingPath: string }}
 */
export function assertSkillInstalled({ skillName, skillPath, existsSyncFn = existsSync }) {
  if (typeof skillName !== 'string' || skillName.length === 0) {
    throw new TypeError('assertSkillInstalled: skillName must be a non-empty string');
  }
  if (typeof skillPath !== 'string' || skillPath.length === 0) {
    throw new TypeError('assertSkillInstalled: skillPath must be a non-empty string');
  }
  const abs = expandSkillPath(skillPath);
  if (existsSyncFn(abs)) return { ok: true };
  return {
    ok: false,
    exitCode: 4,
    missingPath: abs,
    message:
      `mmd ${skillName}: gStack '${skillName}' skill not found at ${abs}.\n` +
      `  Install gStack first — see https://github.com/SinghDev/gstack#install\n` +
      `  Override the search root with MMD_GSTACK_SKILLS_DIR=<dir> for testing.`,
  };
}

/**
 * AC-Long-Running (c): emit a non-fatal warning if another `claude -p`
 * process is currently running. Best-effort — silent on unsupported hosts.
 * Disabled when `disabled` is true (used by hermetic tests).
 *
 * @param {{
 *   skillName: string,
 *   disabled?: boolean,
 *   write?: (msg: string) => void,
 *   spawnSyncFn?: typeof spawnSync,
 *   selfPid?: number,
 * }} opts
 * @returns {void}
 */
export function maybeWarnConcurrentClaude(opts = {}) {
  const { skillName, disabled = false, write = (m) => process.stderr.write(m) } = opts;
  if (disabled) return;
  if (typeof skillName !== 'string' || skillName.length === 0) return;
  const fn = opts.spawnSyncFn || spawnSync;
  const selfPid = opts.selfPid || process.pid;
  let r;
  try {
    r = fn('pgrep', ['-af', 'claude -p'], { encoding: 'utf8', timeout: 2000 });
  } catch {
    return; // pgrep unavailable / EACCES — silent per error-handling.md §III.
  }
  if (!r || r.status !== 0 || typeof r.stdout !== 'string') return;
  const lines = r.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const m = line.match(/^(\d+)\s/);
    if (!m) continue;
    const pid = Number(m[1]);
    if (Number.isFinite(pid) && pid !== selfPid) {
      write(
        `[mmd ${skillName}] warning: another 'claude -p' process appears to ` +
        `be running (pid=${pid}). Proceeding anyway; see docs/lessons-learned.md L-006.\n`,
      );
      return;
    }
  }
}

/**
 * Spawn `<command> <args>` (typically `claude -p ...`) with the supplied env
 * and tee its stdout/stderr to `logPath`.
 *
 * Pure function of its arguments — does NOT read process.env. Each wrapper
 * resolves its env-dependent knobs (command, timeout, quiet, heartbeat) and
 * passes them explicitly.
 *
 * Resolves with `{ code, signal, logPath, durationSeconds }`. Per L-006 we do
 * NOT translate exit-code null (timeout/killed) into a rejection — the caller
 * decides what to do.
 *
 * @param {{
 *   skillName: string,
 *   command: string,
 *   args?: string[],            // optional — if omitted, prompt is wrapped via buildSkillArgs
 *   prompt?: string,            // ditto — caller passes one of {args} or {prompt}
 *   env: Record<string, string>,
 *   cwd: string,
 *   logPath: string,
 *   timeoutMs?: number,
 *   quiet?: boolean,
 *   heartbeatIntervalMs?: number, // 0 disables heartbeat
 * }} opts
 * @returns {Promise<{
 *   code: number | null,
 *   signal: string | null,
 *   logPath: string,
 *   durationSeconds: number,
 * }>}
 */
export async function invokeClaudeSkill(opts) {
  if (!opts || typeof opts !== 'object') {
    throw new TypeError('invokeClaudeSkill: opts must be an object');
  }
  const {
    skillName,
    command,
    env: childEnv,
    cwd,
    logPath,
    timeoutMs,
    quiet = false,
    heartbeatIntervalMs = 60_000,
  } = opts;
  if (typeof skillName !== 'string' || skillName.length === 0) {
    throw new TypeError('invokeClaudeSkill: skillName must be a non-empty string');
  }
  if (typeof command !== 'string' || command.length === 0) {
    throw new TypeError('invokeClaudeSkill: command must be a non-empty string');
  }
  if (!childEnv || typeof childEnv !== 'object') {
    throw new TypeError('invokeClaudeSkill: env must be an object');
  }
  if (typeof cwd !== 'string' || cwd.length === 0) {
    throw new TypeError('invokeClaudeSkill: cwd must be a non-empty string');
  }
  if (typeof logPath !== 'string' || logPath.length === 0) {
    throw new TypeError('invokeClaudeSkill: logPath must be a non-empty string');
  }
  // SPEC_V02E AC-5: compose lessons into the prompt BEFORE deriving args.
  // The composer is best-effort; failures fall back to the raw prompt.
  //
  // F10 (Phase-4 review): callers passing raw `args:[]` directly (e.g.
  // custom argv shapes, legacy tests) BYPASS composition because we can't
  // know which arg holds the prompt. All production wrappers (ship, qa,
  // cso, document-release) use `prompt:` so they get composition. If a
  // future wrapper needs `args:[]`, it MUST call composeLessons() at the
  // wrapper level or accept that lessons are NOT auto-injected.
  let composerResult = null;
  let composerError = null;
  let promptForArgs = opts.prompt;
  if (!Array.isArray(opts.args) && typeof opts.prompt === 'string' && opts.prompt.length > 0) {
    // F11 (Phase-4 review): resolve relative to the function-argument cwd,
    // never process.cwd() — keeps the layer pure with respect to mutable
    // ambient state. Callers can override via opts.lessonsPath.
    const lessonsPath =
      opts.lessonsPath || path.join(cwd, 'docs', 'lessons-learned.md');
    try {
      composerResult = await composeLessons(opts.prompt, lessonsPath);
      promptForArgs = composerResult.composedPrompt;
    } catch (err) {
      composerError = err;
      composerResult = null;
    }
  }

  let args = opts.args;
  if (!Array.isArray(args)) {
    if (typeof promptForArgs !== 'string' || promptForArgs.length === 0) {
      throw new TypeError('invokeClaudeSkill: pass either args[] or a non-empty prompt');
    }
    args = buildSkillArgs(promptForArgs);
  }
  const skillUpper = skillName.toUpperCase().replace(/-/g, '_');

  await mkdir(path.dirname(logPath), { recursive: true });

  // AC-6: composer.json sidecar is persisted INSIDE the Promise body,
  // after the log stream is established, so we never leave orphan
  // composer.json files when the spawn fails immediately (F4 Phase-4
  // review). See logStream.write(composerLogHeader(...)) below.

  return new Promise((resolve, reject) => {
    let child;
    let logStream;
    let killTimer = null;
    let sigkillTimer = null;
    let heartbeatTimer = null;
    let settled = false;
    let timedOut = false;
    // F27 (Phase-4 re-review): track the in-flight composer.json write so
    // settle() / fail() await it before resolving — eliminates the
    // read-after-await race a caller would otherwise hit.
    let auditWritePromise = Promise.resolve();
    const startNs = process.hrtime.bigint();

    // Race-safe finish (AC-1 (a)): wait for log stream to finish writing
    // before resolving, otherwise a caller that reads logPath synchronously
    // after the promise resolves may read a truncated file.
    const settle = (val) => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      if (sigkillTimer) clearTimeout(sigkillTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      const resolveOnce = () => resolve(val);
      if (logStream) {
        logStream.once('finish', () => auditWritePromise.then(resolveOnce, resolveOnce));
        logStream.end();
      } else {
        auditWritePromise.then(resolveOnce, resolveOnce);
      }
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      if (sigkillTimer) clearTimeout(sigkillTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      const rejectOnce = () => reject(err);
      if (logStream) {
        logStream.once('finish', () => auditWritePromise.then(rejectOnce, rejectOnce));
        logStream.end();
      } else {
        auditWritePromise.then(rejectOnce, rejectOnce);
      }
    };

    try {
      logStream = createWriteStream(logPath, { flags: 'a' });
    } catch (err) {
      err.mmdExitCode = err.mmdExitCode ?? 99;
      reject(err);
      return;
    }

    // AC-6: emit composer header as first log line + persist composer.json
    // sidecar (mirrors invoke-autodev). The sidecar write is scheduled
    // here so it co-occurs with the log file (F4 Phase-4 review: no orphan
    // composer.json files when spawn fails — we have either both or neither).
    // F27 Phase-4 re-review: tracked via auditWritePromise so settle()/fail()
    // await it before resolving.
    if (composerResult) {
      try {
        logStream.write(composerLogHeader(composerResult));
        auditWritePromise = writeComposerAudit(logPath, composerResult).catch(() => {
          // Swallow: composer.json is observability, never load-bearing.
        });
      } catch { /* stream closed — non-fatal */ }
    }
    if (composerError) {
      try {
        logStream.write(`[composer] warning: ${composerError.message}\n`);
      } catch { /* non-fatal */ }
    }

    try {
      child = spawn(command, args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: childEnv,
        shell: false,
      });
    } catch (err) {
      err.mmdExitCode = 4;
      err.message =
        `mmd ${skillName}: failed to spawn '${command}': ${err.message}. ` +
        `Install Claude Code or set MMD_${skillUpper}_CMD to a test fixture.`;
      if (logStream) logStream.end();
      reject(err);
      return;
    }

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
        err.mmdExitCode = 4;
        err.message =
          `mmd ${skillName}: '${command}' not found on PATH ` +
          `(override with MMD_${skillUpper}_CMD)`;
      } else {
        err.mmdExitCode = err.mmdExitCode ?? 99;
      }
      fail(err);
    });

    // AC-Long-Running (b): stderr heartbeat.
    if (typeof heartbeatIntervalMs === 'number' && heartbeatIntervalMs > 0) {
      heartbeatTimer = setInterval(() => {
        try {
          const elapsedS = Math.floor(
            Number(process.hrtime.bigint() - startNs) / 1e9,
          );
          const line = `[mmd ${skillName}] still running, pid=${child.pid}, ` +
            `log=${logPath} (${elapsedS}s elapsed)\n`;
          process.stderr.write(line);
        } catch {
          // Ignore: stderr write failures are non-fatal.
        }
      }, heartbeatIntervalMs);
      // Unref so the timer doesn't keep the event loop alive if the test
      // exits without explicit cleanup.
      heartbeatTimer.unref?.();
    }

    if (typeof timeoutMs === 'number' && timeoutMs > 0) {
      killTimer = setTimeout(() => {
        timedOut = true;
        try { child.kill('SIGTERM'); } catch { /* already dead */ }
        sigkillTimer = setTimeout(() => {
          try { child.kill('SIGKILL'); } catch { /* already dead */ }
        }, 5000);
        try { logStream.write(`\n[mmd ${skillName}] subprocess timed out\n`); }
        catch { /* stream closed */ }
      }, timeoutMs);
    }

    child.on('exit', (code, signal) => {
      const durationSeconds = Number(process.hrtime.bigint() - startNs) / 1e9;
      if (timedOut) {
        settle({ code: null, signal: signal || 'SIGTERM', logPath, durationSeconds });
        return;
      }
      settle({ code, signal, logPath, durationSeconds });
    });
  });
}
