// lib/argv-parser.js — POSIX-style argv parser for the mmd CLI.
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
const MODE_FLAGS = Object.freeze(['here']);
const KNOWN_FLAGS = Object.freeze([...ENGINE_FLAGS, ...SESSION_FLAGS, ...MODE_FLAGS]);

// v0.2b: SUBCOMMANDS are recognized BEFORE the "treat positional as dream"
// logic in bin/mmd.js (per SPEC_V02B §5 risk: `mmd bench` must not be parsed
// as a dream string equal to "bench"). New subcommands extend this list and
// own their own arg parsing helper (parseBenchArgs is the v0.2b reference).
// v0.2.f: 'ship' joins the family (SPEC_V02F §2 AC-3). Its parsing helper is
// parseShipArgs below.
const SUBCOMMANDS = Object.freeze(['serve', 'bench', 'ship']);

export { ENGINE_FLAGS, SESSION_FLAGS, MODE_FLAGS, KNOWN_FLAGS, SUBCOMMANDS };

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
 * Parse `mmd bench` subcommand args.
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
        `unknown bench arg: '${tok}'. Run 'mmd bench --help' to see supported flags.`,
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
  };
  const positional = [];
  let afterSeparator = false;

  for (const tok of rawArgs) {
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
 * Parse `mmd ship` subcommand args (SPEC_V02F AC-3, AC-5).
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
        message: `unknown ship arg: '${tok}'. Run 'mmd ship --help' to see supported flags.`,
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
