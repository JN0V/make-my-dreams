// lib/dream-catcher/elicit.js — the ONE autonomous BMAD elicitation call.
//
// SRP (constitution §I.S): build a profile-aware autonomous `bmad-product-brief`
// prompt and run `claude -p` headless, returning a usable scope or an explicit
// honest fallback (universal §VI). It reuses the env-allowlist + timeout pattern
// proven in lib/invoke-autodev.js — same Least-Privilege spawn (§XII), same
// args-array / shell:false (§V/A03).
//
// Why "stateless single call": a headless `claude -p` subprocess has NO stdin,
// so BMAD's own interactive loop cannot run — the smoke test (SPEC_V03A §1)
// confirmed it converges fully autonomously when told to ask no questions. The
// multi-turn ("guidé") modes therefore live at the MMD layer (v0.3.a-2) as N
// stateless calls; this slice ships the proven 1-call autonomous path. See
// L-021.
//
// Honest fallback (AC-2): on ANY failure — spawn error, non-zero exit, timeout,
// empty/unparseable reply — runElicit resolves (never rejects) with
// { ok:false, fallback:true, reason, scope:<verbatim dream> }. We hand back the
// user's own words rather than fabricate a scope (mirrors the 5-Whys sacred
// escalate-to-user fallback).
//
// Test seam: like invoke-autodev.js, MMD_AUTODEV_CMD redirects the spawn to a
// fake-claude fixture (@integration), and the `spawn` dependency is injectable
// for pure @unit tests — the real `claude` is NEVER called from tests.

import { spawn as nodeSpawn } from 'node:child_process';

import { buildSubprocessEnv } from '../invoke-autodev.js';
import { parseReply } from './parse-reply.js';
import { normalizeProfile, isKid, toneHint } from './profile.js';

/**
 * Default headless-elicitation timeout. The autonomous brief smoke test
 * returned in seconds; 120 s is a generous ceiling. Overridable per-call and
 * via MMD_CATCH_TIMEOUT_MS by the server layer.
 */
export const DEFAULT_ELICIT_TIMEOUT_MS = 120_000;

/**
 * Build the autonomous, profile-aware `bmad-product-brief` prompt.
 * Pure — exported for unit-testability (no spawn, no env).
 *
 * The instructions encode exactly what the smoke test proved works:
 *   headless + autonomous + "ask no questions" + walking-skeleton cap
 *   (one primary capability + at most 2 small extras) + profile awareness,
 *   and the Kid safe-by-default framing when the profile is Kid.
 *
 * @param {{dream: string, profile?: unknown}} args
 * @returns {string}
 */
export function buildElicitPrompt({ dream, profile }) {
  const p = normalizeProfile(profile);
  const cleanDream = typeof dream === 'string' ? dream.trim() : '';
  const lines = [
    `/bmad-product-brief ${cleanDream}`,
    '',
    'You are running HEADLESS and AUTONOMOUS: there is no stdin and no interactive loop.',
    'Ask NO questions. Make reasonable assumptions and converge directly to ONE scope.',
    'Walking-skeleton cap: exactly ONE primary capability plus AT MOST 2 small extras.',
    'Do NOT exceed that cap — narrow toward a tiny, buildable scope, never brainstorm more features.',
    'Output ONLY the scope, as a short friendly plain-text or markdown summary on stdout.',
    'No preamble, no questions, no follow-up — just the scope a builder can act on.',
    `Audience profile: ${p}. ${toneHint(p)}`,
  ];
  if (isKid(p)) {
    lines.push(
      'Kid safe-by-default: no network, no third-party services, no signup, works offline; plain words only.',
    );
  }
  return lines.join('\n');
}

/**
 * Resolve the elicitation spawn mode. Mirrors resolveAutodevMode in
 * invoke-autodev.js so a single env switch governs both subprocess families.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {'cli'|'test'}
 */
export function resolveElicitMode(env) {
  if (env.MMD_AUTODEV_MODE === 'cli' || env.MMD_AUTODEV_MODE === 'test') {
    return env.MMD_AUTODEV_MODE;
  }
  if (env.MMD_AUTODEV_CMD) return 'test';
  return 'cli';
}

/**
 * Run the one autonomous elicitation call.
 *
 * Resolves (NEVER rejects — failure is data, not an exception) with:
 *   { ok: true,  fallback: false, scope, raw }                  — synthesized scope
 *   { ok: false, fallback: true,  scope:<verbatim dream>, reason, raw } — honest fallback
 *
 * @param {Object}   opts
 * @param {string}   opts.dream                  the (already-collected) dream text
 * @param {unknown}  [opts.profile]              raw profile (normalized internally)
 * @param {NodeJS.ProcessEnv} [opts.env]         env source (allowlisted before spawn)
 * @param {Function} [opts.spawn]                injected spawn (default node:child_process spawn)
 * @param {number}   [opts.timeoutMs]            kill ceiling for the subprocess
 * @returns {Promise<{ok:boolean, fallback:boolean, scope:string, reason?:string, raw:string}>}
 */
export function runElicit({
  dream,
  profile,
  env = process.env,
  spawn = nodeSpawn,
  timeoutMs = DEFAULT_ELICIT_TIMEOUT_MS,
} = {}) {
  const cleanDream = typeof dream === 'string' ? dream.trim() : '';

  // Honest fallback factory — always hands back the verbatim dream, never a
  // fabricated scope (universal §VI; AC-2).
  const fallback = (reason) => ({
    ok: false,
    fallback: true,
    scope: cleanDream,
    reason,
    raw: '',
  });

  if (cleanDream.length === 0) {
    return Promise.resolve(fallback('empty dream — nothing to elicit'));
  }

  const prompt = buildElicitPrompt({ dream: cleanDream, profile });
  const cmd = env.MMD_AUTODEV_CMD || 'claude';
  const mode = resolveElicitMode(env);
  // CLI: `claude -p "<prompt>"`. Test fixture: receives the prompt as one arg
  // (mirrors the fixture contract — it inspects/echoes a canned scope).
  const args = mode === 'cli' ? ['-p', prompt] : [prompt];
  const childEnv = buildSubprocessEnv(env);

  return new Promise((resolve) => {
    let child;
    let out = '';
    let err = '';
    let settled = false;
    let killTimer = null;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      resolve(value);
    };

    try {
      child = spawn(cmd, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: childEnv,
        shell: false, // constitution §V/A03 — explicit
      });
    } catch (e) {
      return finish(fallback(`spawn failed: ${e.message}`));
    }

    if (timeoutMs && timeoutMs > 0) {
      killTimer = setTimeout(() => {
        try { child.kill('SIGTERM'); } catch { /* already dead */ }
        finish(fallback(`elicitation timed out after ${timeoutMs} ms`));
      }, timeoutMs);
    }

    if (child.stdout) child.stdout.on('data', (c) => { out += c; });
    if (child.stderr) child.stderr.on('data', (c) => { err += c; });

    child.on('error', (e) => finish(fallback(`subprocess error: ${e.message}`)));

    child.on('exit', (code) => {
      if (code !== 0) {
        const tail = err.trim().slice(-200);
        return finish(fallback(`elicitation exited with code ${code}${tail ? `: ${tail}` : ''}`));
      }
      const parsed = parseReply(out);
      if (parsed.unparseable) {
        return finish(fallback(`unparseable reply: ${parsed.reason}`));
      }
      finish({ ok: true, fallback: false, scope: parsed.scope, raw: out });
    });
  });
}
