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
import { createWriteStream, existsSync } from 'node:fs';
import { access, stat, constants as fsConstants, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { composeLessons } from './composer/match.js';
import { writeComposerAudit, composerLogHeader } from './composer/audit.js';
import { normalizeProfile, isKid } from './dream-catcher/profile.js';
import { composeConstitution } from './constitution-compose.js';
import {
  parseStreamEvent,
  contextWindowFor,
  contextPct,
} from './conductor/stream-parse.js';

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
 * Build the argv for the auto-dev subprocess. PURE + exported so the
 * bootstrap-safety invariant is unit-testable (SPEC_V05B AC-3): the DEFAULT
 * (non-monitor) args MUST be byte-for-byte the historical shape and carry NO
 * `--output-format` — that is the path `mmd --here` uses to build MMD itself.
 *
 *   CLI, default  → ['-p', '/bmad-adv-auto-dev <prompt>']
 *   CLI, monitor  → [...default, '--output-format', 'stream-json', '--verbose']
 *   test fixture  → ['<dream>']  (MMD_AUTODEV_CMD — args unchanged in both modes;
 *                                 the fake emits canned stream-json on stdout)
 *
 * @param {{ isClaudeCli: boolean, prompt: string, dream: string, monitor?: boolean }} a
 * @returns {string[]}
 */
export function buildAutodevArgs({ isClaudeCli, prompt, dream, monitor = false, model = null }) {
  if (!isClaudeCli) return [dream];
  const base = ['-p', `/bmad-adv-auto-dev ${prompt}`];
  // Optional model override (MMD_AUTODEV_MODEL → claude --model). Appended ONLY
  // when a non-empty model is set, so the DEFAULT args stay byte-for-byte the
  // historical shape (the bootstrap-safe contract — the path `mmd --here` uses to
  // build MMD itself). Lets the operator target a cheap engine (e.g. `haiku`) for
  // a light task or a throwaway validation run instead of the default model.
  const m = typeof model === 'string' ? model.trim() : '';
  if (m) base.push('--model', m);
  if (monitor) base.push('--output-format', 'stream-json', '--verbose');
  return base;
}

/**
 * Factory for the monitored stdout consumer (SPEC_V05B AC-3/AC-5). Returns a
 * `{ onData, flush }` pair: `onData(chunk)` buffers and splits stdout into
 * lines, parses each via parseStreamEvent, and re-renders HUMAN-READABLE
 * progress (assistant text + periodic `[monitor] context X% (tokens/window)`
 * lines — NEVER the raw JSON) to the tee; `flush()` drains a trailing partial
 * line at stream end. It tracks the running MAX context tokens and calls
 * `onContext({model, window, tokens, pct, estimated})` on each new max so the
 * caller owns status.json + the 70% signal.
 *
 * Kept here (not in stream-parse.js) because it touches the tee streams; the
 * math/parse it delegates to stay pure. Extracted as a factory so it is unit-
 * testable without a real spawn.
 *
 * @param {{ write: (s: string) => void }} logStream  the run-log sink (always written)
 * @param {boolean} quiet  MMD_QUIET=1 → terminal tee suppressed, log preserved
 * @param {(ctx: object) => void} [onContext]
 * @returns {{ onData: (chunk: Buffer|string) => void, flush: () => void }}
 */
export function makeMonitorConsumer(logStream, quiet, onContext) {
  let buf = '';
  let maxTokens = -1;
  let model = null;
  // Default window before the system/init event is seen: unknown → 200K estimated.
  let { window, estimated } = contextWindowFor(undefined);

  const tee = (s) => {
    if (!quiet) process.stdout.write(s);
    try { logStream.write(s); } catch { /* stream closed — non-fatal */ }
  };

  const handleLine = (line) => {
    const ev = parseStreamEvent(line);
    if (!ev) return; // non-JSON / partial / blank — never echo raw JSON.
    if (ev.model) {
      model = ev.model;
      ({ window, estimated } = contextWindowFor(model));
    }
    if (ev.text) {
      tee(ev.text.endsWith('\n') ? ev.text : `${ev.text}\n`);
    }
    if (ev.usage) {
      const { tokens, pct } = contextPct(ev.usage, window);
      if (tokens > maxTokens) {
        maxTokens = tokens;
        tee(`[monitor] context ${(pct * 100).toFixed(1)}% (${tokens}/${window})\n`);
        if (typeof onContext === 'function') {
          try {
            onContext({ model, window, tokens, pct, estimated });
          } catch {
            // Caller's status/notify side effects are best-effort — a fault
            // there must never abort the live stream (universal.md §VI).
          }
        }
      }
    }
  };

  return {
    onData(chunk) {
      buf += chunk.toString();
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        handleLine(line);
      }
    },
    flush() {
      if (buf.length > 0) {
        handleLine(buf);
        buf = '';
      }
    },
  };
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
 *
 * v0.3.b — minimal profile consumption (SPEC_V03B AC-5). When `env.MMD_PROFILE`
 * is set, the greenfield prompt STATES the audience profile. v0.3.b injected a
 * single hardcoded Kid safe-by-default line; v0.3.c SUPERSEDES that.
 *
 * v0.3.c — Layer C constitution composition (SPEC_V03C AC-4). When MMD_PROFILE
 * is set, we inject the constitution MODULES bound to that profile via
 * composeConstitution({profile}) — `defaults.always ∪ profiles[profile]` read
 * from .specify/memory/constitution-bindings.yaml + the matching `*.md` files.
 * So a Kid build now carries the FULL safe-by-default.md + kid.md text (and
 * more), not a one-liner; a Pro build carries pro.md. If composeConstitution
 * returns null (bindings/modules unreadable), we FALL BACK to the v0.3.b minimal
 * Kid line — graceful degradation, never a crash over a missing doc (universal
 * §VI honesty; ADR-024). We do NOT double-inject: the hardcoded line is the
 * fallback path only. An UNSET MMD_PROFILE leaves the prompt byte-for-byte
 * unchanged (back-compat: every existing greenfield/CI run is unaffected). The
 * custom-prompt short-circuit above means --here is intentionally NOT affected
 * (a dev flow, not an end-user dream).
 *
 * v0.10.a — technology-agnostic generation (SPEC_V010A AC-1/AC-2; ADR-048,
 * universal §VIII applied to the GENERATION path). The three hardcoded
 * drawing-camera lines (vanilla HTML/CSS/JS + Canvas + getUserMedia; the fixed
 * index.html/style.css/app.js/manifest.json file list; the camera-permission
 * safe-default) are REPLACED by a stack-DERIVING directive: the agent derives
 * the simplest stack/structure/entry from .mmd/shared/slice.md, keeps a SOFT
 * (never hard) preference for a no-build browser-previewable web app, and writes
 * the run descriptor (.mmd/shared/run.json) the preview path reads. The §VIII
 * change touches ONLY these stack lines: the `prompt`-provided early return
 * (--here) and the profile/Layer-C block above/below are byte-for-byte
 * unchanged (AC-2 regression lock).
 */
export function buildPrompt({
  dream,
  slug,
  demoDir,
  engine = 'standard',
  prompt = undefined,
  env = process.env,
  // v0.3.c: the composer is injected (defaulting to the real Layer C composer)
  // so the unit suite can exercise both the inject-success and the
  // null→fallback paths without touching real fs (DI convention, L-022).
  composeFn = composeConstitution,
}) {
  if (typeof prompt === 'string' && prompt.length > 0) {
    return prompt;
  }
  const absDemoDir = path.resolve(demoDir);
  const lines = [
    'You are running inside the MMD walking skeleton.',
    `Target directory: ${absDemoDir}`,
    // The dream/scope is NOT inlined here: a Dream Catcher scope is a
    // multi-paragraph product brief, and inlining it after `/bmad-adv-auto-dev`
    // as the slash-command argument mangles it (newlines / length / markdown).
    // It is already written verbatim to .mmd/shared/slice.md + vision.md by
    // initStateFiles (via writeFile — no escaping/arg-parsing in play there), so
    // we tell the agent to READ it from the file. (field-bug fix.)
    'Dream/scope: READ the full dream from .mmd/shared/slice.md before anything '
      + 'else — it may be a multi-paragraph product brief. (.mmd/shared/vision.md '
      + 'holds the long-term vision.)',
    `Slug: ${slug}`,
    'Vision: see .mmd/shared/vision.md',
    'Slice: see .mmd/shared/slice.md',
    // v0.10.a (§VIII applied to GENERATION; ADR-048): NO hardcoded stack. The
    // pre-v0.10 prompt forced vanilla HTML/CSS/JS + Canvas + getUserMedia +
    // index.html/style.css/app.js/manifest.json — correct ONLY for the original
    // drawing-camera demo, actively wrong for a PDF editor, a CLI, a service.
    // The agent now DERIVES the stack from the dream; MMD imposes only KISS, a
    // SOFT (never hard) preference for a no-build browser-previewable web app,
    // and the run-descriptor contract the preview path reads downstream.
    'Stack: DERIVE the simplest technology, project structure and entry point '
      + 'that fulfils the dream from the scope in .mmd/shared/slice.md. There is '
      + 'NO imposed stack, framework, language or file layout — choose what fits '
      + 'the dream (a web app, a CLI, a service, a library, whatever is right).',
    'KISS: keep it as simple as the dream allows — the smallest thing that '
      + 'truly fulfils the scope. Do NOT add a build step, framework or '
      + 'dependency the dream does not require.',
    'Preview preference (SOFT, not a constraint): the person who dreamt this may '
      + 'be non-technical and will try to open the result in a browser. So WHEN '
      + 'the dream allows it, PREFER a web app that runs directly in a browser '
      + 'with NO build step (open-and-run static HTML/JS, ES modules / CDN imports '
      + 'are fine). If the dream does not suit a no-build web app, build the right '
      + 'kind of project instead — this preference NEVER overrides fitting the dream.',
    'Run descriptor (REQUIRED): when the build is finished, write '
      + '.mmd/shared/run.json describing what you built, as JSON: '
      + '{"kind": "web-static" | "cli" | "service" | "library" | "other", '
      + '"entry": "<the entry file, e.g. index.html, for a web-static build>", '
      + '"run": "<a one-line human instruction to run/use it, e.g. open index.html '
      + 'in a browser, or: node rename.js <dir>>"}. Use "web-static" with '
      + '"entry":"index.html" ONLY for a no-build browser-openable web app; use the '
      + 'honest kind otherwise. The downstream preview reads this descriptor, so it '
      + 'must reflect what you actually produced.',
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
  // v0.3.b/v0.3.c: consume MMD_PROFILE. Gate on PRESENCE first (a non-empty
  // string) so an unset var leaves the prompt unchanged; normalize the present
  // value to a canonical profile so e.g. `kid`/`enfant` still resolve to Kid.
  const rawProfile = typeof env?.MMD_PROFILE === 'string' ? env.MMD_PROFILE.trim() : '';
  if (rawProfile.length > 0) {
    const profile = normalizeProfile(rawProfile);
    lines.push('', `Audience profile: ${profile}. Tailor tone and scope to this audience.`);

    // v0.3.c Layer C: inject the constitution modules bound to this profile,
    // superseding v0.3.b's single hardcoded Kid line (now inside the injected
    // safe-by-default.md + kid.md). composeConstitution is wrapped defensively
    // — a composer fault must never break a build (universal §VI).
    let composed = null;
    try {
      composed = composeFn({ profile });
    } catch {
      composed = null;
    }

    if (composed) {
      lines.push(
        '',
        'Project constitution modules bound to this profile ' +
          '(NON-NEGOTIABLE — comply with every principle):',
        '',
        composed,
      );
    } else if (isKid(profile)) {
      // Graceful fallback to the v0.3.b minimal Kid line when the bindings file
      // or every module is unreadable (composeConstitution returned null).
      lines.push(
        'Kid safe-by-default (NON-NEGOTIABLE): the generated app MUST NOT use the network or any ' +
          'third-party service; it MUST work fully offline; NO accounts, sign-up, login, or ' +
          'user-generated-content sharing; content and language MUST be age-appropriate.',
      );
    }
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
 * v0.14.b — opt-in ABORT seam (SPEC_V014B AC-1, ADR-053). When `abortPredicate`
 * is a function it is checked on each monitor tick (each new context reading).
 * When it fires, MMD does NOT terminate immediately: it waits a `graceMs` window
 * (a last chance for the agent to exit cooperatively — Path A), and only if the
 * child is STILL ALIVE after the grace does it terminate the child PROCESS GROUP
 * (SIGTERM, escalating to SIGKILL after a short grace — no orphans) and resolve
 * with a distinct `{ aborted: 'handoff', code: null }`. The grace is the heart of
 * "incite first, enforce second". When `abortPredicate` is absent, never fires,
 * or the child exits first (incl. a cooperative exit DURING the grace), behavior
 * is exactly as today (the normal `{code}` resolution) — and the spawn stays
 * UNDETACHED (the default build-MMD path is byte-for-byte unchanged; the process
 * group + detached spawn only exist when an abort predicate is supplied).
 *
 * @returns {Promise<{code: number|null, log: string, aborted?: 'handoff'}>}
 */
export async function invokeAutodev({
  demoDir,
  dream,
  slug,
  promptParts,
  logPath,
  timeoutMs,
  engine = 'standard',
  lessonsPath,
  // v0.5.b — opt-in live context monitor (SPEC_V05B AC-3/AC-5). When `monitor`
  // is true the subprocess is spawned in stream-json and its stdout is parsed
  // line-by-line; `onContext({model, window, tokens, pct, estimated})` is called
  // on each new running-max context reading so the caller can write status.json
  // and fire the 70% signal. Both default off → the spawn is unchanged.
  monitor = false,
  onContext,
  // v0.14.b — opt-in abort seam (SPEC_V014B AC-1). `abortPredicate(ctx)` is a
  // caller predicate checked on each monitor tick with the latest context
  // reading; truthy → arm the grace, then terminate the process group if still
  // alive. `graceMs` is the cooperative-exit grace before termination (default
  // 15s). Absent abortPredicate → the abort machinery is entirely inert and the
  // spawn is undetached (default path unchanged).
  abortPredicate,
  graceMs = 15000,
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
  // v0.3.b: pass the live env explicitly so buildPrompt's MMD_PROFILE consumption
  // reads the same env this subprocess will spawn with (the default is process.env,
  // but threading it makes the data-flow obvious rather than relying on the global).
  const rawPrompt = buildPrompt(
    promptParts
      ? { ...promptParts, engine, env: process.env }
      : { dream, slug, demoDir: absDemoDir, engine, env: process.env },
  );

  // SPEC_V02E AC-4: compose lessons into the prompt BEFORE spawning.
  //
  // Resolution order (F20 + F21 Phase-4 review — honor explicit caller
  // intent, prevent cross-project lessons-file bleed):
  //   1. Explicit caller-supplied `lessonsPath`: used VERBATIM. If the
  //      caller pointed at a missing file, composeLessons returns
  //      { missing: true } — the caller's intent is respected.
  //   2. No caller override → <absDemoDir>/docs/lessons-learned.md. This
  //      covers --here mode (absDemoDir IS the target repo root) AND it
  //      covers the legitimate greenfield case where demo/<slug>/ has its
  //      own lessons file (rare, but supported).
  //   3. No caller override AND no file at #2 AND absDemoDir lives inside
  //      a demo/<slug>/ directory → walk one level up. This is the
  //      greenfield convention (cwd/demo/<slug> → cwd has the MMD-project
  //      lessons). The walk is RESTRICTED to the `demo/<slug>` pattern to
  //      prevent picking up a sibling-project's lessons when --here is
  //      used on a brownfield without its own lessons file (F20 HIGH).
  //
  // Composer errors are non-fatal: best-effort observability. ENOENT
  // bubbles through composeLessons → returns missing:true.
  let resolvedLessonsPath;
  if (typeof lessonsPath === 'string' && lessonsPath.length > 0) {
    // F21: explicit caller wins, even if the file is missing.
    resolvedLessonsPath = lessonsPath;
  } else {
    const own = path.join(absDemoDir, 'docs', 'lessons-learned.md');
    // F23 (Phase-4 re-review): existsSync is used here for DISCOVERY
    // ("where might the project-scoped lessons file live?"), not as a
    // gate against content races (which is what F7 forbade in
    // composeLessonsSync). composeLessons handles ENOENT gracefully if the
    // file disappears between this probe and the read.
    if (existsSync(own)) {
      resolvedLessonsPath = own;
    } else if (path.basename(path.dirname(absDemoDir)) === 'demo') {
      // F20: only walk up when the demo/<slug> convention is detected.
      const greenfieldParent = path.join(
        path.dirname(path.dirname(absDemoDir)),
        'docs',
        'lessons-learned.md',
      );
      resolvedLessonsPath = greenfieldParent;
    } else {
      // No project-local lessons file; let composeLessons report missing:true.
      resolvedLessonsPath = own;
    }
  }
  let composerResult;
  let composerError = null;
  try {
    // SPEC_V02L AC-4: pass the invocation context so the composer filters
    // lessons by `Applies to` before keyword matching. `mmd --here` is the
    // subcommand; the engine (fast/standard) rides along for future use.
    composerResult = await composeLessons(rawPrompt, resolvedLessonsPath, {
      context: { subcommand: 'mmd --here', engine },
    });
  } catch (err) {
    composerError = err;
    composerResult = {
      composedPrompt: rawPrompt,
      injectedLessons: [],
      lessonsFileSha: null,
      elapsedMs: 0,
      composerVersion: 'v0.2e',
      totalActiveLessons: 0,
      error: err.message,
    };
  }
  const prompt = composerResult.composedPrompt;

  // AC-6: ensure the log's parent dir exists so createWriteStream below
  // never EBADF on a brand-new demoDir/.mmd/local/runs/ path. composer.json
  // is persisted later (after the log stream is established) so we don't
  // leave orphan composer.json sidecars when the spawn fails immediately
  // (F4 Phase-4 review).
  try {
    await mkdir(path.dirname(logPath), { recursive: true });
  } catch {
    // Swallow: if the dir cannot be created, the createWriteStream below
    // will surface the failure with the proper exit-code mapping.
  }
  // v0.5.b: the default (non-monitor) args are byte-for-byte the historical
  // shape; --monitor appends `--output-format stream-json --verbose` to the CLI
  // form ONLY. buildAutodevArgs centralizes this so a unit test can assert the
  // default args carry no `--output-format` (bootstrap safety, SPEC_V05B AC-3).
  const args = buildAutodevArgs({
    isClaudeCli, prompt, dream, monitor, model: process.env.MMD_AUTODEV_MODEL,
  });

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

  // v0.14.b — the abort seam is active only when a predicate is supplied (the
  // --auto-handoff path). Capturing it as a boolean keeps the default path
  // provably untouched: no detached spawn, no group kill, no abort timers.
  const abortable = typeof abortPredicate === 'function';
  // The grace between SIGTERM and the SIGKILL escalation (mirrors the timeout
  // path's 5s). Distinct from `graceMs` (the cooperative-exit window BEFORE we
  // terminate at all).
  const ABORT_SIGKILL_GRACE_MS = 5000;

  return new Promise((resolve, reject) => {
    let child;
    let logStream;
    let timedOut = false;
    let killTimer = null;
    let sigkillTimer = null;
    let settled = false;
    // v0.14.b abort state (SPEC_V014B AC-1). `abortArmed`: the predicate fired
    // and the cooperative-exit grace is pending. `terminated`: the grace elapsed
    // with the child still alive and WE sent the kill — so the eventual exit
    // resolves as `{ aborted: 'handoff' }`. A cooperative exit DURING the grace
    // leaves `terminated` false → it resolves normally (Path A), so the caller's
    // post-exit decideHandoff owns it.
    let abortArmed = false;
    let terminated = false;
    let abortGraceTimer = null;
    let abortKillTimer = null;
    // F27 (Phase-4 re-review): track the in-flight composer.json write so
    // callers that synchronously read composer.json after `await invokeAutodev`
    // observe a flushed file.
    let auditWritePromise = Promise.resolve();
    // v0.5.b: the monitored stdout consumer (when --monitor). Flushed
    // SYNCHRONOUSLY inside safeResolve — BEFORE the promise resolves — so a
    // running-max reading carried in a trailing newline-less line is delivered
    // to onContext (and chained onto the caller's status writes) before the
    // caller awaits drain() and writes its final status. Relying on the
    // separate stdout 'end' event would race child.on('exit') (F1 Phase-4
    // review): 'end' is not guaranteed to precede 'exit', so a late flush could
    // schedule an in_progress write after the final done write.
    let monitorConsumer = null;

    const safeResolve = (val) => {
      if (settled) return;
      settled = true;
      if (monitorConsumer) {
        try { monitorConsumer.flush(); } catch { /* best-effort */ }
      }
      if (killTimer) clearTimeout(killTimer);
      if (sigkillTimer) clearTimeout(sigkillTimer);
      if (abortGraceTimer) clearTimeout(abortGraceTimer);
      if (abortKillTimer) clearTimeout(abortKillTimer);
      if (logStream) logStream.end();
      auditWritePromise.then(() => resolve(val), () => resolve(val));
    };
    const safeReject = (err) => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      if (sigkillTimer) clearTimeout(sigkillTimer);
      if (abortGraceTimer) clearTimeout(abortGraceTimer);
      if (abortKillTimer) clearTimeout(abortKillTimer);
      if (logStream) logStream.end();
      auditWritePromise.then(() => reject(err), () => reject(err));
    };

    try {
      logStream = createWriteStream(logPath, { flags: 'a' });
    } catch (err) {
      err.mmdExitCode = err.mmdExitCode ?? 99;
      return reject(err);
    }

    // AC-6: emit the [composer] header as the first line of the run log so
    // post-hoc grep finds composition activity without parsing JSON. The
    // composer.json sidecar is written here too so it co-occurs with the
    // log file (F4 Phase-4 review: no orphan composer.json files when
    // spawn fails — we have either both or neither). F27 Phase-4 re-review:
    // the audit write is tracked via auditWritePromise so safeResolve()
    // awaits it before resolving — eliminates the read-after-await race.
    try {
      logStream.write(composerLogHeader(composerResult));
      if (composerError) {
        logStream.write(`[composer] warning: ${composerError.message}\n`);
      }
      auditWritePromise = writeComposerAudit(logPath, composerResult).catch(() => {
        // Swallow: composer.json is observability, never load-bearing.
      });
    } catch { /* stream closed somehow — non-fatal */ }

    try {
      child = spawn(cmd, args, {
        cwd: absDemoDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: childEnv,
        shell: false, // constitution §V/A03 — explicit
        // v0.14.b — detach ONLY when the abort seam is active, so the child is
        // its own process-group leader and `process.kill(-pid, …)` can terminate
        // the WHOLE group (auto-dev's `claude -p` spawns sub-process children —
        // SIGTERM on the bare leader would orphan them). The default path stays
        // undetached → byte-for-byte today's spawn (the build-MMD bootstrap).
        detached: abortable,
      });
    } catch (err) {
      err.mmdExitCode = 4;
      // F28 (Phase-4 re-review): use safeReject so the in-flight
      // auditWritePromise is flushed before the promise rejects.
      return safeReject(err);
    }

    // v0.14.b — terminate the child. When the abort seam detached the child, a
    // NEGATIVE pid signals the whole process group (no orphans); otherwise the
    // bare child (the default path, unchanged). Never throws (already-dead is a
    // no-op).
    const killChild = (sig) => {
      try {
        if (abortable && typeof child.pid === 'number') {
          process.kill(-child.pid, sig);
        } else {
          child.kill(sig);
        }
      } catch { /* already dead / no such group — non-fatal */ }
    };

    // v0.14.b — the abort check (SPEC_V014B AC-1). Checked on each monitor tick
    // with the latest context reading. On the FIRST truthy fire it arms a grace:
    // a window for the agent to exit cooperatively (Path A); only if the child is
    // still alive after the grace do we terminate the group (Path B). Idempotent
    // (`abortArmed` guard) — a later tick never re-arms.
    const maybeAbort = (ctx) => {
      if (settled || abortArmed || !abortable) return;
      let fire = false;
      try {
        fire = abortPredicate(ctx) === true;
      } catch {
        fire = false; // a predicate fault must never crash the live stream (§VI)
      }
      if (!fire) return;
      abortArmed = true;
      try {
        logStream.write(
          `\n[handoff] enforce: orchestrator over the context threshold AND reached a NEW ` +
            `phase boundary while still alive (it did not exit cooperatively). Waiting ` +
            `${Math.max(0, graceMs)}ms for a clean exit, then terminating the process group.\n`,
        );
      } catch { /* stream closed — non-fatal */ }
      abortGraceTimer = setTimeout(() => {
        // If the child already exited (cooperatively, Path A) the promise is
        // settled — do nothing; the normal resolution stands.
        if (settled) return;
        terminated = true;
        try {
          logStream.write('[handoff] grace elapsed, agent still alive — SIGTERM the process group.\n');
        } catch { /* non-fatal */ }
        killChild('SIGTERM');
        abortKillTimer = setTimeout(() => {
          if (settled) return;
          try { logStream.write('[handoff] still alive — escalating to SIGKILL.\n'); } catch { /* non-fatal */ }
          killChild('SIGKILL');
        }, ABORT_SIGKILL_GRACE_MS);
        // We do NOT resolve here: the exit handler resolves once the child is
        // actually gone (with `terminated` true → the aborted result), so the
        // "no orphan + no overlap with a relaunched successor" guarantee is real.
      }, Math.max(0, graceMs));
    };

    // Tee child stdout/stderr to terminal AND to the log file.
    // B4: when MMD_QUIET=1, drop the terminal tee but keep the log-file tee
    // so post-hoc inspection is unaffected.
    //
    // v0.5.b: in --monitor mode the stdout is stream-json, so we do NOT echo
    // raw chunks — a monitor consumer parses each line and re-renders readable
    // progress (assistant text + periodic context-% lines). The DEFAULT path
    // below is byte-for-byte the historical tee (bootstrap safety, AC-3).
    if (monitor) {
      // v0.14.b — when the abort seam is active, wrap onContext so each monitor
      // tick (a new running-max context reading) ALSO checks the abort predicate
      // with the fresh reading. The caller's onContext runs first (it updates the
      // live pct the predicate reads), in its own try/catch so a fault there
      // never skips the abort check. Without abortPredicate this is the bare
      // caller onContext — unchanged (the plain --monitor path).
      const tickOnContext = abortable
        ? (ctx) => {
            if (typeof onContext === 'function') {
              try { onContext(ctx); } catch { /* caller side effects are best-effort */ }
            }
            maybeAbort(ctx);
          }
        : onContext;
      monitorConsumer = makeMonitorConsumer(logStream, quiet, tickOnContext);
      child.stdout.on('data', monitorConsumer.onData);
      // flush() is invoked from safeResolve (before resolve) — see F1 note above.
    } else {
      child.stdout.on('data', (chunk) => {
        if (!quiet) process.stdout.write(chunk);
        logStream.write(chunk);
      });
    }
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
        // v0.14.b — use killChild so a detached (abortable) run kills the whole
        // group on timeout too, never orphaning. Undetached → child.kill, today's
        // behavior exactly.
        killChild('SIGTERM');
        sigkillTimer = setTimeout(() => {
          killChild('SIGKILL');
        }, 5000);
        try {
          logStream.write('\n[mmd] subprocess timed out\n');
        } catch { /* stream closed */ }
      }, timeoutMs);
    }

    child.on('exit', (exitCode, signal) => {
      // v0.14.b — WE terminated it as an enforced handoff (Path B): resolve with
      // the distinct aborted result so the caller relaunches resume. Checked
      // BEFORE timedOut so an abort is never misread as a timeout.
      if (terminated) {
        return safeResolve({ code: null, log: logPath, signal, aborted: 'handoff' });
      }
      if (timedOut) {
        // Resolve with code:null to signal "killed by timeout".
        return safeResolve({ code: null, log: logPath, signal });
      }
      // Includes the cooperative-exit-during-grace case (abortArmed true but
      // terminated false) → a normal resolution, so the caller's post-exit
      // decideHandoff owns the marker (Path A).
      safeResolve({ code: exitCode, log: logPath, signal });
    });
  });
}
