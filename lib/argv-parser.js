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

export { ENGINE_FLAGS, SESSION_FLAGS, MODE_FLAGS, KNOWN_FLAGS };

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
