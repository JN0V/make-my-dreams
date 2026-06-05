// lib/argv-parser.js — POSIX-style argv parser for the mmdream CLI.
//
// v0.2 (FAST engine) introduces engine flags (--fast, --standard, --deep)
// alongside the existing session flags (--resume, --fresh, --cancel). This
// module owns the flag-vs-positional distinction, mutual-exclusion checks,
// the POSIX `--` end-of-flags separator (E13), and unknown-flag rejection
// (E14) — both deferred from v0.1.
//
// Constitution: §I.S (single responsibility — argv only), §X.A03 (no shell
// interpolation: we never spawn from these strings), error-handling.md §II
// (exit 2 = user error with friendly message).
//
// Public API:
//   - parseArgv(rawArgs) -> { flags, positional, error }
//   - resolveEngine(flags) -> 'fast' | 'standard'
//   - ENGINE_FLAGS, SESSION_FLAGS, KNOWN_FLAGS (constants for tests / introspection)

const ENGINE_FLAGS = Object.freeze(['fast', 'standard', 'deep']);
const SESSION_FLAGS = Object.freeze(['resume', 'fresh', 'cancel']);
// v0.2a: MODE_FLAGS is orthogonal to ENGINE_FLAGS. `--here` selects the
// self / brownfield-in-place mode. Future mode flags (e.g. `--target <path>`)
// will live alongside `--here` in this set and mutex against each other.
// v0.2c: `skip-onboarding` joins the family as a top-level bypass for the
// Project Onboarder gate (AC-7). It is orthogonal to --here / engine flags.
const MODE_FLAGS = Object.freeze(['here', 'skip-onboarding']);
// v0.2.o: VALUE_FLAGS take a separate value token (`--label my-thing`), unlike
// every other top-level flag which is boolean. `--label` lets the user give a
// short human-readable branch name for `mmdream --here` instead of letting the slug
// be auto-derived from the dream's preamble (universal.md §VII). KISS: only the
// `--name value` form is supported, never `--name=value` (mirrors the
// subcommand parsers).
const VALUE_FLAGS = Object.freeze(['label']);
// v0.3.b: CATCH_FLAGS gate the interactive Dream Catcher dialogue for greenfield
// `mmdream "<dream>"`. `--catch` forces the dialogue (errors on a non-TTY), `--no-catch`
// suppresses it even on a TTY. They are boolean, default false, and mutually
// exclusive (both set → exit 2). Orthogonal to engine/mode/value flags.
const CATCH_FLAGS = Object.freeze(['catch', 'no-catch']);
// v0.4.a: SEALED_FLAGS gate the opt-in sealed-test oracle for greenfield
// `mmdream "<dream>"`. `--sealed` is a boolean (default false) that COMPOSES with
// every other flag — there is no mutex. It turns the greenfield path into the
// two-phase tester→seal→coder→verify flow (SPEC_V04A AC-1/AC-4); absent, the
// path is byte-for-byte unchanged. Kept in its own group (not MODE_FLAGS) so
// it is clear it does not mutex against --here or the engine flags.
const SEALED_FLAGS = Object.freeze(['sealed']);
// v0.5.b → v0.15.a: MONITOR_FLAGS once gated the opt-in live context monitor for
// `mmd` / `mmdream --here`. As of v0.15.a the monitor is the DEFAULT (transparent
// Conductor), so `--monitor` is an ACCEPTED-BUT-INERT no-op kept for back-compat:
// it parses cleanly (no "unknown flag" error) but changes nothing — the conductor
// mode is resolved from the `MMD_NO_AUTO_HANDOFF` opt-out (resolveConductorMode),
// not from this flag. Kept in KNOWN_FLAGS so old scripts passing `--monitor` do
// not break (SPEC_V015A AC-2). A future major may drop it (out of scope here).
const MONITOR_FLAGS = Object.freeze(['monitor']);
// v0.13.a → v0.15.a: HANDOFF_FLAGS once gated the opt-in auto-handoff at 70%. As
// of v0.15.a the proven v0.14.0 hybrid handoff is the DEFAULT, so `--auto-handoff`
// is likewise an ACCEPTED-BUT-INERT no-op (back-compat): it parses without error
// and changes nothing (the loop already runs by default; `MMD_NO_AUTO_HANDOFF=1`
// is the single opt-out). Kept in KNOWN_FLAGS so old scripts do not break.
const HANDOFF_FLAGS = Object.freeze(['auto-handoff']);
const KNOWN_FLAGS = Object.freeze([
  ...ENGINE_FLAGS, ...SESSION_FLAGS, ...MODE_FLAGS, ...VALUE_FLAGS, ...CATCH_FLAGS,
  ...SEALED_FLAGS, ...MONITOR_FLAGS, ...HANDOFF_FLAGS,
]);

// v0.2b: SUBCOMMANDS are recognized BEFORE the "treat positional as dream"
// logic in bin/mmd.js (per SPEC_V02B §5 risk: `mmdream bench` must not be parsed
// as a dream string equal to "bench"). New subcommands extend this list and
// own their own arg parsing helper (parseBenchArgs is the v0.2b reference).
// v0.2.f: 'ship' joins the family (SPEC_V02F §2 AC-3). Its parsing helper is
// parseShipArgs below. v0.2c: 'discover' joins for the Project Onboarder
// (parseDiscoverArgs below). v0.2.g: 'qa', 'cso', 'document-release' join for
// the Medium-gStack wrappers (parseQaArgs / parseCsoArgs / parseDocumentReleaseArgs).
// v0.2.p: 'handover' joins the family (SPEC_V02P §2 AC-1). Its parsing helper
// is parseHandoverArgs below. It refreshes the mechanical State block in
// HANDOVER.md (latest tag, branch, version, lesson/ADR counts, recent commits)
// from git + repo files, leaving every human-authored section untouched.
// v0.3.d: 'document-readme' joins the family (SPEC_V03D §2 AC-1). Its parsing
// helper is parseDocumentReadmeArgs below. It applies the `mmdream handover` pattern
// to README.md — regenerating two marker-bounded mechanical blocks (a Status
// block and a Changelog block from git tag annotations) while leaving every
// human-authored byte outside the markers untouched, and printing a doc-drift
// report on stdout.
const SUBCOMMANDS = Object.freeze([
  'serve', 'bench', 'ship', 'discover', 'qa', 'cso', 'document-release', 'unblock',
  'document-lessons', 'document', 'handover', 'document-readme', 'document-review',
  'document-compact', 'test-health', 'secret-scan', 'deps-gate',
]);

export { ENGINE_FLAGS, SESSION_FLAGS, MODE_FLAGS, VALUE_FLAGS, CATCH_FLAGS, SEALED_FLAGS, MONITOR_FLAGS, HANDOFF_FLAGS, KNOWN_FLAGS, SUBCOMMANDS };

/**
 * Detect whether the first non-flag token is a registered subcommand.
 *
 * v0.2b — `bench` is the first subcommand to be recognized here (the v0.2.5
 * `serve` predates this helper and is still dispatched directly in bin/mmd.js
 * by a literal `rawArgs[0] === 'serve'` check; future cleanup may converge
 * both paths through this function).
 *
 * @param {string[]} rawArgs argv.slice(2)
 * @returns {string|null}    the subcommand name or null
 */
export function detectSubcommand(rawArgs) {
  if (!Array.isArray(rawArgs) || rawArgs.length === 0) return null;
  if (SUBCOMMANDS.includes(rawArgs[0])) return rawArgs[0];
  return null;
}

/**
 * Parse `mmdream bench` subcommand args.
 *
 * Supports:
 *   --dry-run                 boolean
 *   --help / -h               boolean
 *   --engine <e>              value-bearing, e in {fast, standard, deep}
 *   --dreams <id1,id2,...>    value-bearing, comma-separated
 *   --out-dir <path>          value-bearing
 *
 * v0.2b uses the long-flag-with-separate-value form (e.g. `--engine fast`).
 * The `--name=value` short form is NOT supported — universal.md §II KISS:
 * one form, one parser, no ambiguity.
 *
 * @param {string[]} rawArgs   argv.slice(3) (i.e. AFTER the `bench` token)
 * @returns {{
 *   dryRun: boolean,
 *   help: boolean,
 *   engine: 'fast'|'standard'|'deep',
 *   dreams: string[]|null,
 *   outDir: string|null,
 *   error: {message: string, exitCode: number}|null
 * }}
 */
export function parseBenchArgs(rawArgs) {
  const out = {
    dryRun: false,
    help: false,
    engine: 'standard',
    dreams: null,
    outDir: null,
    error: null,
  };
  const VALUE_FLAGS = new Set(['--engine', '--dreams', '--out-dir']);
  const BOOL_FLAGS = new Set(['--dry-run', '--help', '-h']);
  for (let i = 0; i < rawArgs.length; i += 1) {
    const tok = rawArgs[i];
    if (BOOL_FLAGS.has(tok)) {
      if (tok === '--dry-run') out.dryRun = true;
      else if (tok === '--help' || tok === '-h') out.help = true;
      continue;
    }
    if (VALUE_FLAGS.has(tok)) {
      const value = rawArgs[i + 1];
      if (value === undefined || value.startsWith('--')) {
        out.error = {
          message: `flag '${tok}' requires a value`,
          exitCode: 2,
        };
        return out;
      }
      if (tok === '--engine') {
        if (!ENGINE_FLAGS.includes(value)) {
          out.error = {
            message: `--engine must be one of ${ENGINE_FLAGS.join('|')}, got '${value}'`,
            exitCode: 2,
          };
          return out;
        }
        out.engine = value;
      } else if (tok === '--dreams') {
        out.dreams = value.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
        if (out.dreams.length === 0) {
          out.error = { message: '--dreams must be a non-empty comma list', exitCode: 2 };
          return out;
        }
      } else if (tok === '--out-dir') {
        out.outDir = value;
      }
      i += 1;
      continue;
    }
    out.error = {
      message:
        `unknown bench arg: '${tok}'. Run 'mmdream bench --help' to see supported flags.`,
      exitCode: 2,
    };
    return out;
  }
  return out;
}

/**
 * Parse argv with POSIX semantics:
 *  - Long flags only: `--name` (no values, no `--name=value` form in v0.2).
 *  - `--` separator: every subsequent token is positional, even if it starts with `--`.
 *  - Unknown flags BEFORE `--` are rejected (E14, exit 2).
 *  - Engine flags (--fast / --standard / --deep) are mutually exclusive (AC-2, exit 2).
 *
 * The parser does NOT handle `--version` / `--help` / `-h` / `serve` — those
 * are dispatched earlier in bin/mmd.js so this module stays single-purpose.
 *
 * @param {string[]} rawArgs       argv.slice(2) typically
 * @returns {{
 *   flags: { fast: boolean, standard: boolean, deep: boolean, resume: boolean, fresh: boolean, cancel: boolean },
 *   positional: string[],
 *   error: { message: string, exitCode: number } | null
 * }}
 */
export function parseArgv(rawArgs) {
  const flags = {
    fast: false, standard: false, deep: false,
    resume: false, fresh: false, cancel: false,
    here: false,
    'skip-onboarding': false,
    label: null,
    catch: false,
    'no-catch': false,
    sealed: false,
    monitor: false,
    'auto-handoff': false,
  };
  const positional = [];
  let afterSeparator = false;

  for (let i = 0; i < rawArgs.length; i += 1) {
    const tok = rawArgs[i];
    if (afterSeparator) {
      positional.push(tok);
      continue;
    }
    if (tok === '--') {
      afterSeparator = true;
      continue;
    }
    if (tok.startsWith('--')) {
      const name = tok.slice(2);
      // E14: reject unknown flags. The hint about `--` lets users feed
      // dream text that legitimately starts with `--` through the separator.
      if (!KNOWN_FLAGS.includes(name)) {
        return {
          flags,
          positional,
          error: {
            message:
              `unknown flag: --${name}. ` +
              `Pass --help to list supported flags, or use -- to separate dream text from flags.`,
            exitCode: 2,
          },
        };
      }
      // Value-bearing flags (e.g. --label) consume the next token. KISS: the
      // `--name value` form only; a missing value or one that looks like a flag
      // is a user error (exit 2), mirroring the subcommand parsers.
      if (VALUE_FLAGS.includes(name)) {
        const value = rawArgs[i + 1];
        if (value === undefined || value.startsWith('--')) {
          return {
            flags,
            positional,
            error: { message: `flag '--${name}' requires a value`, exitCode: 2 },
          };
        }
        flags[name] = value;
        i += 1;
        continue;
      }
      flags[name] = true;
      continue;
    }
    positional.push(tok);
  }

  // AC-2: engine flags are mutually exclusive.
  const enginesSet = ENGINE_FLAGS.filter((e) => flags[e]);
  if (enginesSet.length > 1) {
    return {
      flags,
      positional,
      error: {
        message:
          'Engine flags are mutually exclusive: pass at most one of --fast, --standard, --deep',
        exitCode: 2,
      },
    };
  }

  // v0.3.b AC-1: --catch and --no-catch are mutually exclusive. Asking to both
  // force and suppress the Dream Catcher dialogue is a contradiction → exit 2.
  if (flags.catch && flags['no-catch']) {
    return {
      flags,
      positional,
      error: {
        message: '--catch and --no-catch are mutually exclusive: pass at most one',
        exitCode: 2,
      },
    };
  }

  return { flags, positional, error: null };
}

/**
 * Resolve the effective engine from the parsed flags.
 *
 * v0.2 only IMPLEMENTS --fast. --standard / --deep are forward-compat
 * scaffolding: they parse cleanly and pass mutex (alone), but resolve to
 * 'standard' in v0.2 (the v0.1 baseline behavior). Their real semantics
 * land in v0.2d, gated by the same flag plumbing.
 *
 * @param {{ fast: boolean, standard: boolean, deep: boolean }} flags
 * @returns {'fast'|'standard'}
 */
export function resolveEngine(flags) {
  if (flags.fast) return 'fast';
  return 'standard';
}

/**
 * v0.15.a — resolve the TRANSPARENT Conductor mode (SPEC_V015A AC-1/AC-2,
 * ADR-054). The monitored spawn + the proven v0.14.0 hybrid auto-handoff loop are
 * now the DEFAULT (transparent): a non-technical `serve`/greenfield user — or a
 * plain `mmdream --here` — gets the Conductor with NO flag. The single opt-out
 * `MMD_NO_AUTO_HANDOFF=1` restores the pre-v0.15 behavior EXACTLY (text spawn, one
 * un-looped invocation, no monitor) — the bootstrap/cost escape hatch.
 *
 * The legacy `--auto-handoff` / `--monitor` flags are now accepted-but-INERT
 * no-ops (back-compat): this resolver reads ONLY the env opt-out, so a script
 * passing the old flags neither errors nor changes anything (the default is
 * already on; the opt-out still wins). The flags remain in KNOWN_FLAGS so the
 * argv parser accepts them without an "unknown flag" error.
 *
 * Pure: takes the env object so the default-on / opt-out decision is unit-testable
 * without spawning. Returns BOTH booleans (they move together — autoHandoff
 * implies monitor since the handoff needs the stream-json spawn's context usage)
 * so the caller threads them into runHereMode / the greenfield path identically.
 *
 * @param {Record<string,string|undefined>} [envObj]
 * @returns {{ monitor: boolean, autoHandoff: boolean }}
 */
export function resolveConductorMode(envObj = process.env) {
  const optedOut = envObj && envObj.MMD_NO_AUTO_HANDOFF === '1';
  return { monitor: !optedOut, autoHandoff: !optedOut };
}

/**
 * v0.3.b AC-3 — resolve whether the greenfield `mmdream "<dream>"` path should run
 * the interactive Dream Catcher dialogue.
 *
 * Rule: `flags.catch || (isTTY && !flags['no-catch'])`. The dialogue is ON by
 * default when stdin is a TTY (so a Pro at a terminal gets the conversation),
 * unless `--no-catch` opts out; `--catch` forces it regardless of the default.
 * NEVER call this on the `--here` path — that mode returns before the greenfield
 * branch (brownfield self-modification is a dev flow, not an end-user dream).
 *
 * Pure: takes the parsed flags + a boolean isTTY so the decision is unit-testable
 * without a real terminal. The non-TTY-with-`--catch` error (exit 2) is the
 * caller's concern (bin/mmd.js) — it needs a terminal the dialogue can't fake.
 *
 * @param {{catch?: boolean, 'no-catch'?: boolean}} flags
 * @param {boolean} isTTY  whether stdin is an interactive terminal
 * @returns {boolean}
 */
export function resolveShouldCatch(flags, isTTY) {
  return Boolean(flags.catch) || (Boolean(isTTY) && !flags['no-catch']);
}

/**
 * Parse `mmdream ship` subcommand args (SPEC_V02F AC-3, AC-5).
 *
 * Recognized tokens:
 *   --dry-run         boolean   build prompt + env but do NOT spawn claude
 *   --help / -h       boolean   print usage and exit 0
 *   <branch>          positional optional slice branch (default: current branch)
 *
 * Forbidden:
 *   - `--name=value` form (KISS: one form only)
 *   - more than one positional (the slice branch is the only positional)
 *   - unknown flags (E14: explicit rejection with hint about --help)
 *
 * @param {string[]} rawArgs argv.slice(3) (i.e. AFTER the 'ship' token)
 * @returns {{
 *   dryRun: boolean,
 *   help: boolean,
 *   branch: string|null,
 *   error: { message: string, exitCode: number } | null
 * }}
 */
export function parseShipArgs(rawArgs) {
  const out = {
    dryRun: false,
    help: false,
    branch: null,
    error: null,
  };
  if (!Array.isArray(rawArgs)) {
    out.error = { message: 'parseShipArgs: rawArgs must be an array', exitCode: 2 };
    return out;
  }
  const BOOL_FLAGS = new Set(['--dry-run', '--help', '-h']);
  for (let i = 0; i < rawArgs.length; i += 1) {
    const tok = rawArgs[i];
    if (BOOL_FLAGS.has(tok)) {
      if (tok === '--dry-run') out.dryRun = true;
      else if (tok === '--help' || tok === '-h') out.help = true;
      continue;
    }
    if (tok.startsWith('--')) {
      out.error = {
        message: `unknown ship arg: '${tok}'. Run 'mmdream ship --help' to see supported flags.`,
        exitCode: 2,
      };
      return out;
    }
    // Positional: the slice branch. Only one allowed.
    if (out.branch !== null) {
      out.error = {
        message: `ship accepts at most one positional <branch>; got a second one: '${tok}'`,
        exitCode: 2,
      };
      return out;
    }
    out.branch = tok;
  }
  return out;
}

/**
 * Parse `mmdream unblock` subcommand args (SPEC_V02J AC-3).
 *
 * Recognized tokens:
 *   --dry-run         boolean   run the detector only; never spawn claude
 *   --force           boolean   skip the detector; run the 5-Whys session anyway
 *   --help / -h       boolean   print usage and exit 0
 *   <branch>          positional optional slice branch (default: current branch)
 *
 * Mirrors parseShipArgs's shape ({ branch, dryRun, force, help, error }) so the
 * unblock entry point reads exactly like ship's (DRY, universal.md §III).
 * `--dry-run` and `--force` are NOT mutually exclusive at the parse level —
 * the entry point (bin/conductor/unblock.js) resolves the precedence (dry-run
 * wins: detector-only, never spawn).
 *
 * Forbidden:
 *   - `--name=value` form (KISS — same rule as bench/ship/discover)
 *   - more than one positional (the slice branch is the only positional)
 *   - unknown flags (E14 — rejected with a hint about --help)
 *
 * @param {string[]} rawArgs argv tokens AFTER the 'unblock' token
 * @returns {{
 *   dryRun: boolean,
 *   force: boolean,
 *   help: boolean,
 *   branch: string|null,
 *   error: { message: string, exitCode: number } | null
 * }}
 */
export function parseUnblockArgs(rawArgs) {
  const out = {
    dryRun: false,
    force: false,
    help: false,
    branch: null,
    error: null,
  };
  if (!Array.isArray(rawArgs)) {
    out.error = { message: 'parseUnblockArgs: rawArgs must be an array', exitCode: 2 };
    return out;
  }
  const BOOL_FLAGS = new Set(['--dry-run', '--force', '--help', '-h']);
  for (let i = 0; i < rawArgs.length; i += 1) {
    const tok = rawArgs[i];
    if (BOOL_FLAGS.has(tok)) {
      if (tok === '--dry-run') out.dryRun = true;
      else if (tok === '--force') out.force = true;
      else if (tok === '--help' || tok === '-h') out.help = true;
      continue;
    }
    if (typeof tok === 'string' && tok.startsWith('--')) {
      out.error = {
        message: `unknown unblock arg: '${tok}'. Run 'mmdream unblock --help' to see supported flags.`,
        exitCode: 2,
      };
      return out;
    }
    if (out.branch !== null) {
      out.error = {
        message: `unblock accepts at most one positional <branch>; got a second one: '${tok}'`,
        exitCode: 2,
      };
      return out;
    }
    out.branch = tok;
  }
  return out;
}

/**
 * Parse `mmdream discover` subcommand args (SPEC_V02C AC-1).
 *
 * Recognized tokens:
 *   --approve              boolean    flip an existing report's Status: line
 *   --refresh              boolean    re-run from scratch (overwrite last.md)
 *   --infer-with-claude    boolean    LLM-augmented inference (stub in v0.2c)
 *   --no-report-update     boolean    scan only; do not touch the root report
 *   --force-non-git        boolean    accept a non-git directory
 *   --help / -h            boolean    print usage
 *   <path>                 optional positional target dir (default cwd)
 *
 * Forbidden:
 *   - `--name=value` form (KISS — bench/ship use the same rule)
 *   - more than one positional (we only accept one path)
 *   - unknown flags (E14 — rejected with hint about --help)
 *
 * @param {string[]} rawArgs argv tokens AFTER the 'discover' token
 * @returns {{
 *   approve: boolean,
 *   refresh: boolean,
 *   inferWithClaude: boolean,
 *   noReportUpdate: boolean,
 *   forceNonGit: boolean,
 *   help: boolean,
 *   path: string|null,
 *   error: { message: string, exitCode: number } | null
 * }}
 */
export function parseDiscoverArgs(rawArgs) {
  const out = {
    approve: false,
    refresh: false,
    inferWithClaude: false,
    noReportUpdate: false,
    forceNonGit: false,
    help: false,
    path: null,
    error: null,
  };
  if (!Array.isArray(rawArgs)) {
    out.error = { message: 'parseDiscoverArgs: rawArgs must be an array', exitCode: 2 };
    return out;
  }
  const BOOL_FLAGS = new Set([
    '--approve', '--refresh', '--infer-with-claude', '--no-report-update',
    '--force-non-git', '--help', '-h',
  ]);
  for (let i = 0; i < rawArgs.length; i += 1) {
    const tok = rawArgs[i];
    if (BOOL_FLAGS.has(tok)) {
      if (tok === '--approve') out.approve = true;
      else if (tok === '--refresh') out.refresh = true;
      else if (tok === '--infer-with-claude') out.inferWithClaude = true;
      else if (tok === '--no-report-update') out.noReportUpdate = true;
      else if (tok === '--force-non-git') out.forceNonGit = true;
      else if (tok === '--help' || tok === '-h') out.help = true;
      continue;
    }
    if (typeof tok === 'string' && tok.startsWith('--')) {
      out.error = {
        message: `unknown discover arg: '${tok}'. Run 'mmdream discover --help' to see supported flags.`,
        exitCode: 2,
      };
      return out;
    }
    if (out.path !== null) {
      out.error = {
        message: `discover accepts at most one positional <path>; got a second one: '${tok}'`,
        exitCode: 2,
      };
      return out;
    }
    out.path = tok;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// v0.2.g — Medium gStack subcommand parsers (SPEC_V02G AC-2/3/4).
// ─────────────────────────────────────────────────────────────────────────
//
// qa / cso share the exact same shape as ship (optional <branch> positional,
// --dry-run, --help). DRY (universal.md §III): parseBranchedSkillArgs is the
// reusable kernel; the named wrappers exist so callers get a stable, typed
// import + a helpful error prefix in messages.
//
// document-release accepts TWO optional positionals (<from> <to>) so it has
// its own parser.

/**
 * Shared kernel: parse a subcommand of the form `mmdream <name> [<branch>]
 * [--dry-run] [--help]`. Returned `error.message` is prefixed with the skill
 * name so the user gets `unknown qa arg: ...` (not the generic `ship` text).
 *
 * @param {string[]} rawArgs
 * @param {string}   skillName  used in error messages
 * @returns {{
 *   dryRun: boolean,
 *   help: boolean,
 *   branch: string|null,
 *   error: { message: string, exitCode: number } | null
 * }}
 */
function parseBranchedSkillArgs(rawArgs, skillName) {
  const out = { dryRun: false, help: false, branch: null, error: null };
  if (!Array.isArray(rawArgs)) {
    out.error = {
      message: `parse${skillName}Args: rawArgs must be an array`,
      exitCode: 2,
    };
    return out;
  }
  const BOOL_FLAGS = new Set(['--dry-run', '--help', '-h']);
  for (let i = 0; i < rawArgs.length; i += 1) {
    const tok = rawArgs[i];
    if (BOOL_FLAGS.has(tok)) {
      if (tok === '--dry-run') out.dryRun = true;
      else if (tok === '--help' || tok === '-h') out.help = true;
      continue;
    }
    if (typeof tok === 'string' && tok.startsWith('--')) {
      out.error = {
        message:
          `unknown ${skillName} arg: '${tok}'. Run 'mmdream ${skillName} --help' to see supported flags.`,
        exitCode: 2,
      };
      return out;
    }
    if (out.branch !== null) {
      out.error = {
        message:
          `${skillName} accepts at most one positional <branch>; got a second one: '${tok}'`,
        exitCode: 2,
      };
      return out;
    }
    out.branch = tok;
  }
  return out;
}

/**
 * Parse `mmdream qa` subcommand args (SPEC_V02G AC-2).
 *
 * Same shape as `mmdream ship`: optional <branch>, --dry-run, --help.
 *
 * @param {string[]} rawArgs argv tokens AFTER the 'qa' token
 * @returns {ReturnType<typeof parseBranchedSkillArgs>}
 */
export function parseQaArgs(rawArgs) {
  return parseBranchedSkillArgs(rawArgs, 'qa');
}

/**
 * Parse `mmdream cso` subcommand args (SPEC_V02G AC-3).
 *
 * Same shape as `mmdream ship`: optional <branch>, --dry-run, --help.
 *
 * @param {string[]} rawArgs argv tokens AFTER the 'cso' token
 * @returns {ReturnType<typeof parseBranchedSkillArgs>}
 */
export function parseCsoArgs(rawArgs) {
  return parseBranchedSkillArgs(rawArgs, 'cso');
}

/**
 * Parse `mmdream document-release` subcommand args (SPEC_V02G AC-4).
 *
 * Accepts TWO optional positionals: <from> <to>. Defaults (resolved later by
 * the validator):
 *   <from> = `git describe --tags --abbrev=0`
 *   <to>   = HEAD
 *
 * Tokens:
 *   --dry-run     boolean
 *   --help / -h   boolean
 *   <from>        positional 1 — optional ref
 *   <to>          positional 2 — optional ref
 *
 * @param {string[]} rawArgs argv tokens AFTER the 'document-release' token
 * @returns {{
 *   dryRun: boolean,
 *   help: boolean,
 *   from: string|null,
 *   to: string|null,
 *   error: { message: string, exitCode: number } | null
 * }}
 */
export function parseDocumentReleaseArgs(rawArgs) {
  const out = { dryRun: false, help: false, from: null, to: null, error: null };
  if (!Array.isArray(rawArgs)) {
    out.error = {
      message: 'parseDocumentReleaseArgs: rawArgs must be an array',
      exitCode: 2,
    };
    return out;
  }
  const BOOL_FLAGS = new Set(['--dry-run', '--help', '-h']);
  const positionals = [];
  for (let i = 0; i < rawArgs.length; i += 1) {
    const tok = rawArgs[i];
    if (BOOL_FLAGS.has(tok)) {
      if (tok === '--dry-run') out.dryRun = true;
      else if (tok === '--help' || tok === '-h') out.help = true;
      continue;
    }
    if (typeof tok === 'string' && tok.startsWith('--')) {
      out.error = {
        message:
          `unknown document-release arg: '${tok}'. Run 'mmdream document-release --help' to see supported flags.`,
        exitCode: 2,
      };
      return out;
    }
    if (positionals.length >= 2) {
      // F11 (Phase-4 review): align error shape with qa/cso/ship —
      // name the offending one rather than dumping all positionals.
      out.error = {
        message:
          `document-release accepts at most two positional refs (<from> <to>); got a third one: '${tok}'`,
        exitCode: 2,
      };
      return out;
    }
    positionals.push(tok);
  }
  if (positionals.length >= 1) out.from = positionals[0];
  if (positionals.length >= 2) out.to = positionals[1];
  return out;
}

/**
 * Parse `mmdream handover` subcommand args (SPEC_V02P AC-1).
 *
 * Recognized tokens:
 *   --tests <N>   value-bearing — honest passing-test count for the State block.
 *                 Accepts only a NON-NEGATIVE INTEGER; anything else → exit 2.
 *                 Omitted → the block renders an explicit "refresh me" placeholder
 *                 (the command never invents or copies a stale count — §VI honesty).
 *   --dry-run     boolean — print the rewritten HANDOVER.md to stdout, write nothing.
 *   --help / -h   boolean — print usage and exit 0.
 *
 * Forbidden (E14 — KISS, mirrors bench/ship/unblock):
 *   - `--name=value` form (only `--tests N`, the separate-value form)
 *   - any positional argument (handover takes none)
 *   - unknown flags (rejected with a hint about --help)
 *
 * @param {string[]} rawArgs argv tokens AFTER the 'handover' token
 * @returns {{
 *   tests: number|null,
 *   dryRun: boolean,
 *   help: boolean,
 *   error: { message: string, exitCode: number } | null
 * }}
 */
export function parseHandoverArgs(rawArgs) {
  const out = { tests: null, dryRun: false, help: false, error: null };
  if (!Array.isArray(rawArgs)) {
    out.error = { message: 'parseHandoverArgs: rawArgs must be an array', exitCode: 2 };
    return out;
  }
  const BOOL_FLAGS = new Set(['--dry-run', '--help', '-h']);
  const VALUE_FLAGS = new Set(['--tests']);
  for (let i = 0; i < rawArgs.length; i += 1) {
    const tok = rawArgs[i];
    if (BOOL_FLAGS.has(tok)) {
      if (tok === '--dry-run') out.dryRun = true;
      else if (tok === '--help' || tok === '-h') out.help = true;
      continue;
    }
    if (VALUE_FLAGS.has(tok)) {
      const value = rawArgs[i + 1];
      if (value === undefined || (typeof value === 'string' && value.startsWith('--'))) {
        out.error = { message: `flag '${tok}' requires a value`, exitCode: 2 };
        return out;
      }
      // --tests accepts only a non-negative integer (AC-4 honesty: a test count
      // is a whole number of passing tests; a float / negative / non-numeric is
      // a user error, never silently coerced).
      if (!/^\d+$/.test(value)) {
        out.error = {
          message: `--tests must be a non-negative integer, got '${value}'`,
          exitCode: 2,
        };
        return out;
      }
      out.tests = Number(value);
      i += 1;
      continue;
    }
    out.error = {
      message:
        `unknown handover arg: '${tok}'. Run 'mmdream handover --help' to see supported flags.`,
      exitCode: 2,
    };
    return out;
  }
  return out;
}

/**
 * Parse `mmdream document-readme` subcommand args (SPEC_V03D AC-1).
 *
 * `mmdream document-readme` is `mmdream handover` applied to README.md, so its argv is
 * the same shape as parseHandoverArgs (DRY in spirit — same flags, same honesty
 * rule on `--tests`):
 *   --tests <N>   value-bearing — honest passing-test count for the Status block.
 *                 Accepts only a NON-NEGATIVE INTEGER; anything else → exit 2.
 *                 Omitted → the block renders an explicit "run `npm test`"
 *                 placeholder (never an invented or stale number — §VI honesty).
 *   --dry-run     boolean — print the rewritten README.md to stdout, write nothing.
 *   --help / -h   boolean — print usage and exit 0.
 *
 * Forbidden (E14 — KISS, mirrors handover):
 *   - `--name=value` form (only `--tests N`, the separate-value form)
 *   - any positional argument (document-readme takes none)
 *   - unknown flags (rejected with a hint about --help)
 *
 * @param {string[]} rawArgs argv tokens AFTER the 'document-readme' token
 * @returns {{
 *   tests: number|null,
 *   dryRun: boolean,
 *   help: boolean,
 *   error: { message: string, exitCode: number } | null
 * }}
 */
export function parseDocumentReadmeArgs(rawArgs) {
  const out = { tests: null, dryRun: false, help: false, error: null };
  if (!Array.isArray(rawArgs)) {
    out.error = { message: 'parseDocumentReadmeArgs: rawArgs must be an array', exitCode: 2 };
    return out;
  }
  const BOOL_FLAGS = new Set(['--dry-run', '--help', '-h']);
  const VALUE_FLAGS = new Set(['--tests']);
  for (let i = 0; i < rawArgs.length; i += 1) {
    const tok = rawArgs[i];
    if (BOOL_FLAGS.has(tok)) {
      if (tok === '--dry-run') out.dryRun = true;
      else if (tok === '--help' || tok === '-h') out.help = true;
      continue;
    }
    if (VALUE_FLAGS.has(tok)) {
      const value = rawArgs[i + 1];
      if (value === undefined || (typeof value === 'string' && value.startsWith('--'))) {
        out.error = { message: `flag '${tok}' requires a value`, exitCode: 2 };
        return out;
      }
      // --tests accepts only a non-negative integer (AC-1 honesty: a test count
      // is a whole number of passing tests; a float / negative / non-numeric is
      // a user error, never silently coerced).
      if (!/^\d+$/.test(value)) {
        out.error = {
          message: `--tests must be a non-negative integer, got '${value}'`,
          exitCode: 2,
        };
        return out;
      }
      out.tests = Number(value);
      i += 1;
      continue;
    }
    out.error = {
      message:
        `unknown document-readme arg: '${tok}'. Run 'mmdream document-readme --help' to see supported flags.`,
      exitCode: 2,
    };
    return out;
  }
  return out;
}
