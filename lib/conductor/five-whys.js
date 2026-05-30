// lib/conductor/five-whys.js — 5-Whys session runner (SPEC_V02J AC-2, AC-4).
//
// SRP (universal.md §I.S): orchestrate ONE 5-Whys session — build prompt,
// compose lessons, spawn claude -p, tee, parse. The pure pieces live in
// five-whys-prompt.js (prompt) and five-whys-parser.js (parse); the spawn/tee/
// PATH-forcing reuses lib/skills/_common/invoke-claude.js (DRY, universal §III).
//
// AC-4 (composer): the prompt is passed through composeLessons(prompt,
// lessonsPath) BEFORE the spawn. We do this explicitly here (rather than
// relying on invokeClaudeSkill's prompt-path composition) so the runner owns
// the composer result for its own session log / return value, and because the
// lessonsPath must be the repo's docs/lessons-learned.md regardless of cwd.
// MMD_COMPOSER_DISABLED=1 is honored by composeLessons itself.
//
// L-002/L-006 (claude -p buffers + may hang): a timeout is ALWAYS set (default
// 30 min, overridable via MMD_FIVEWHYS_TIMEOUT_MS).
// L-016 (sacred fallback): parse failures never crash — parseFiveWhys returns
// the escalate-to-user fallback.

import path from 'node:path';
import { readFileSync } from 'node:fs';

import { composeLessons } from '../composer/match.js';
import {
  buildSkillEnv,
  invokeClaudeSkill,
  skillLogPath,
} from '../skills/_common/invoke-claude.js';
import { writeComposerAuditSync } from '../composer/audit.js';
import { buildFiveWhysPrompt } from './five-whys-prompt.js';
import { parseFiveWhys, fallbackResult } from './five-whys-parser.js';

const DEFAULT_TIMEOUT_MS = 1_800_000; // 30 min (L-006: always bounded).
const SKILL_NAME = 'five-whys';

/**
 * Resolve the subprocess timeout from a raw (string|number|undefined) value.
 *
 * F1 (Phase-4 review): a garbage env value (e.g. MMD_FIVEWHYS_TIMEOUT_MS=abc)
 * used to coerce to NaN, and `NaN > 0` is false in invokeClaudeSkill's guard —
 * so NO timeout timer was armed and the load-bearing hang protection (L-006:
 * `claude -p` can sleep forever) was silently defeated. We now fall back to the
 * 30-min default on any non-finite or negative value. A literal `0` is honored
 * as the caller's explicit "no timeout" (consistent with the MMD_TIMEOUT_MS
 * convention in bin/mmd.js), since that is a deliberate, documented choice
 * rather than a parse accident.
 *
 * @param {string|number|undefined|null} raw
 * @param {number} [fallback]
 * @returns {number}
 */
export function resolveTimeoutMs(raw, fallback = DEFAULT_TIMEOUT_MS) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

/**
 * Run a single 5-Whys session.
 *
 * @param {{
 *   context: object,                 // StallContext for buildFiveWhysPrompt
 *   repoRoot: string,                // used for lessonsPath + log dir + cwd
 *   claudePath?: string,             // command to spawn (default 'claude'); test fixture override
 *   env?: NodeJS.ProcessEnv,
 *   timeoutMs?: number,
 *   quiet?: boolean,
 *   now?: () => Date,                // injectable clock for the log filename
 * }} opts
 * @returns {Promise<{
 *   sessionLog: string,
 *   logPath: string,
 *   parsed: object,
 *   parseOk: boolean,
 *   composer: object|null,
 *   spawnError: string|null,
 * }>}
 */
export async function runFiveWhys(opts) {
  if (!opts || typeof opts !== 'object') {
    throw new TypeError('runFiveWhys: opts must be an object');
  }
  const {
    context,
    repoRoot,
    claudePath = 'claude',
    env = process.env,
    timeoutMs = resolveTimeoutMs(env.MMD_FIVEWHYS_TIMEOUT_MS),
    quiet = env.MMD_QUIET === '1',
    now = () => new Date(),
  } = opts;
  if (typeof repoRoot !== 'string' || repoRoot.length === 0) {
    throw new TypeError('runFiveWhys: repoRoot must be a non-empty string');
  }

  // 1) Build the pure prompt.
  const basePrompt = buildFiveWhysPrompt(context);

  // 2) AC-4: compose lessons into the prompt BEFORE spawning. Best-effort —
  // a composer failure must not abort the session (it is observability/uplift,
  // never load-bearing). composeLessons honors MMD_COMPOSER_DISABLED=1 itself.
  const lessonsPath = path.join(repoRoot, 'docs', 'lessons-learned.md');
  let composer = null;
  let prompt = basePrompt;
  try {
    // SPEC_V02L AC-4: the 5-Whys session is the `mmd unblock` subcommand,
    // running in the review phase. Context filters lessons by `Applies to`.
    composer = await composeLessons(basePrompt, lessonsPath, {
      env,
      context: { subcommand: 'mmd unblock', phase: 'review' },
    });
    prompt = composer.composedPrompt;
  } catch {
    // Degrade gracefully: use the un-composed prompt (error-handling.md §III).
    composer = null;
    prompt = basePrompt;
  }

  // 3) Spawn claude -p --output-format text with PATH forced to include
  // $HOME/.bun/bin (buildSkillEnv) and tee to .mmd/local/five-whys-runs/<ts>.log.
  // We pass `args:[]` (built locally) so invokeClaudeSkill does NOT re-compose
  // (F10 in _common: args[] bypasses its composition) — composition already
  // happened above and owns the audit trail for this session.
  const logPath = skillLogPath(repoRoot, SKILL_NAME, now);
  const childEnv = buildSkillEnv(SKILL_NAME, env);
  const args = ['-p', '--output-format', 'text', prompt];

  let spawnError = null;
  let runResult = null;
  try {
    runResult = await invokeClaudeSkill({
      skillName: SKILL_NAME,
      command: claudePath,
      args,
      env: childEnv,
      cwd: repoRoot,
      logPath,
      timeoutMs,
      quiet,
      heartbeatIntervalMs: 0, // single short session — no heartbeat needed.
    });
  } catch (err) {
    // L-016 spirit: a spawn failure (claude missing, ENOENT) must not crash
    // the runner. Read whatever was tee'd, fall back to escalate-to-user.
    spawnError = err && err.message ? err.message : String(err);
  }

  // AC-6 (v0.2.k) / L-006: invokeClaudeSkill RESOLVES with code:null when the
  // hang-protection timeout fired and the child was killed (SIGTERM/SIGKILL).
  // Treat that as a failure so the parse step falls back to the sacred
  // escalate-to-user verdict with a "timeout" reason in evidence — rather than
  // parsing a truncated/empty session log and silently returning a confident
  // answer the model never actually produced.
  if (!spawnError && runResult && runResult.code === null) {
    spawnError =
      `claude -p timed out (no result within the ${timeoutMs}ms timeout; ` +
      `process killed, signal=${runResult.signal || 'unknown'})`;
  }

  // AC-4 (F7 Phase-4 review): persist the canonical composer.json sidecar next
  // to the run log — same format + location as every other `claude -p` spawn
  // (audit.js convention), so `audit-pillars.sh --with-composer` globs it too.
  // We must write it here because we pass `args:[]` to invokeClaudeSkill, which
  // bypasses its built-in sidecar writer (it can't know which arg is the
  // prompt). Best-effort: a sidecar write failure is observability-only.
  if (composer) {
    try {
      writeComposerAuditSync(logPath, composer);
    } catch {
      // Non-fatal: the composer audit is observability, never load-bearing.
    }
  }

  // 4) Read the tee'd session log (the parse source).
  let sessionLog = '';
  try {
    sessionLog = readFileSync(logPath, 'utf8');
  } catch {
    sessionLog = '';
  }

  // 5) Parse — sacred fallback on any failure.
  let parseResult;
  if (spawnError) {
    parseResult = {
      parsed: fallbackResult(`claude -p spawn failed: ${spawnError}`),
      parseOk: false,
    };
  } else {
    parseResult = parseFiveWhys(sessionLog);
  }

  return {
    sessionLog,
    logPath,
    parsed: parseResult.parsed,
    parseOk: parseResult.parseOk,
    composer,
    spawnError,
  };
}
