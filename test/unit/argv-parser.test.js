// @unit tests for lib/argv-parser.js — POSIX flag parsing, mutex, --, unknown-flag rejection.
// Per testing.md §V: pure logic, < 100 ms total. No I/O, no subprocess.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseArgv,
  resolveEngine,
  resolveShouldCatch,
  resolveConductorMode,
  ENGINE_FLAGS,
  SESSION_FLAGS,
  MODE_FLAGS,
  VALUE_FLAGS,
  CATCH_FLAGS,
  SEALED_FLAGS,
  MONITOR_FLAGS,
  HANDOFF_FLAGS,
  KNOWN_FLAGS,
} from '../../lib/argv-parser.js';

test('@unit parseArgv: empty argv → all flags false, no positional, no error', () => {
  const r = parseArgv([]);
  assert.deepEqual(r.flags, {
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
  });
  assert.deepEqual(r.positional, []);
  assert.equal(r.error, null);
});

test('@unit parseArgv (v0.4.a AC-1): --sealed is a recognized boolean flag, default false', () => {
  // Absent → default false.
  assert.equal(parseArgv(['a counter app']).flags.sealed, false);

  // Present → true; positional dream preserved.
  const s = parseArgv(['--sealed', 'a counter app with buttons']);
  assert.equal(s.flags.sealed, true);
  assert.equal(s.error, null);
  assert.deepEqual(s.positional, ['a counter app with buttons']);

  // --sealed is in KNOWN_FLAGS (so it is never rejected as unknown — E14).
  assert.ok(KNOWN_FLAGS.includes('sealed'));
});

test('@unit parseArgv (v0.4.a AC-1): --sealed composes with engine + mode flags (no mutex)', () => {
  const r = parseArgv(['--sealed', '--fast', 'a counter app']);
  assert.equal(r.error, null, `expected no error; got ${r.error && r.error.message}`);
  assert.equal(r.flags.sealed, true);
  assert.equal(r.flags.fast, true);
  assert.equal(resolveEngine(r.flags), 'fast');
  assert.deepEqual(r.positional, ['a counter app']);
});

test('@unit parseArgv (v0.4.b AC-2): --here and --sealed compose (no mutex)', () => {
  // Both orderings parse cleanly with both flags true and the dream preserved.
  const a = parseArgv(['--here', '--sealed', 'add a dark-mode toggle']);
  assert.equal(a.error, null, `expected no error; got ${a.error && a.error.message}`);
  assert.equal(a.flags.here, true);
  assert.equal(a.flags.sealed, true);
  assert.deepEqual(a.positional, ['add a dark-mode toggle']);

  const b = parseArgv(['--sealed', '--here', 'add a dark-mode toggle']);
  assert.equal(b.error, null, `expected no error; got ${b.error && b.error.message}`);
  assert.equal(b.flags.here, true);
  assert.equal(b.flags.sealed, true);

  // And the trio --here --sealed --fast still composes (no mutex anywhere).
  const c = parseArgv(['--here', '--sealed', '--fast', 'add a dark-mode toggle']);
  assert.equal(c.error, null, `expected no error; got ${c.error && c.error.message}`);
  assert.equal(c.flags.here, true);
  assert.equal(c.flags.sealed, true);
  assert.equal(resolveEngine(c.flags), 'fast');
});

test('@unit parseArgv (AC-1): --catch / --no-catch are recognized boolean flags', () => {
  const c = parseArgv(['--catch', 'dessine une appli']);
  assert.equal(c.flags.catch, true);
  assert.equal(c.flags['no-catch'], false);
  assert.equal(c.error, null);
  assert.deepEqual(c.positional, ['dessine une appli']);

  const n = parseArgv(['--no-catch', 'dessine une appli']);
  assert.equal(n.flags['no-catch'], true);
  assert.equal(n.flags.catch, false);
  assert.equal(n.error, null);
});

test('@unit parseArgv (AC-1): --catch defaults to false when absent', () => {
  const r = parseArgv(['dessine une appli']);
  assert.equal(r.flags.catch, false);
  assert.equal(r.flags['no-catch'], false);
});

test('@unit parseArgv (AC-1): --catch + --no-catch are mutually exclusive (exit 2)', () => {
  const r = parseArgv(['--catch', '--no-catch', 'dream']);
  assert.notEqual(r.error, null);
  assert.equal(r.error.exitCode, 2);
  assert.match(r.error.message, /mutually exclusive/i);
});

test('@unit parseArgv (AC-1): --catch composes with engine + mode flags', () => {
  const r = parseArgv(['--fast', '--catch', 'dream']);
  assert.equal(r.error, null);
  assert.equal(r.flags.fast, true);
  assert.equal(r.flags.catch, true);
});

test('@unit KNOWN_FLAGS includes catch and no-catch', () => {
  assert.ok(KNOWN_FLAGS.includes('catch'));
  assert.ok(KNOWN_FLAGS.includes('no-catch'));
});

test('@unit AC-3 resolveShouldCatch: TTY default ON, --no-catch opts out, --catch forces', () => {
  const none = { catch: false, 'no-catch': false };
  // TTY-gated default: on a TTY → catch; non-TTY → skip.
  assert.equal(resolveShouldCatch(none, true), true);
  assert.equal(resolveShouldCatch(none, false), false);
  // --no-catch suppresses even on a TTY.
  assert.equal(resolveShouldCatch({ catch: false, 'no-catch': true }, true), false);
  // --catch forces it regardless of isTTY (the non-TTY error is bin/mmd's job).
  assert.equal(resolveShouldCatch({ catch: true, 'no-catch': false }, false), true);
  assert.equal(resolveShouldCatch({ catch: true, 'no-catch': false }, true), true);
});

// ── v0.15.a — resolveConductorMode: transparent Conductor default-on + opt-out ──

test('@unit v0.15.a AC-1: resolveConductorMode default → monitor + autoHandoff ON', () => {
  // No opt-out env → the transparent Conductor is active by default.
  assert.deepEqual(resolveConductorMode({}), { monitor: true, autoHandoff: true });
  assert.deepEqual(resolveConductorMode({ MMD_OTHER: 'x' }), { monitor: true, autoHandoff: true });
});

test('@unit v0.15.a AC-1: MMD_NO_AUTO_HANDOFF=1 → both OFF (the single opt-out)', () => {
  assert.deepEqual(resolveConductorMode({ MMD_NO_AUTO_HANDOFF: '1' }), { monitor: false, autoHandoff: false });
});

test('@unit v0.15.a AC-1: only the exact value "1" opts out (anything else stays default-on)', () => {
  // Mirrors the strict MMD_SKIP_* / MMD_QUIET convention — junk never silently opts out.
  assert.deepEqual(resolveConductorMode({ MMD_NO_AUTO_HANDOFF: '0' }), { monitor: true, autoHandoff: true });
  assert.deepEqual(resolveConductorMode({ MMD_NO_AUTO_HANDOFF: 'true' }), { monitor: true, autoHandoff: true });
  assert.deepEqual(resolveConductorMode({ MMD_NO_AUTO_HANDOFF: '' }), { monitor: true, autoHandoff: true });
});

test('@unit v0.15.a AC-2: resolveConductorMode ignores the legacy --monitor / --auto-handoff flags (env-only)', () => {
  // The resolver reads ONLY the env opt-out, so the legacy flags are inert: the
  // result is identical whether or not a caller would have parsed them. (The
  // flags still parse cleanly — pinned by the conductor-handoff-spawn-pin tests.)
  assert.deepEqual(resolveConductorMode({}), { monitor: true, autoHandoff: true });
});

test('@unit parseArgv: lone dream → positional only', () => {
  const r = parseArgv(['a tiny dream']);
  assert.deepEqual(r.positional, ['a tiny dream']);
  assert.equal(r.error, null);
  assert.equal(r.flags.fast, false);
});

test('@unit parseArgv: --fast before dream → flags.fast=true', () => {
  const r = parseArgv(['--fast', 'add a red button']);
  assert.equal(r.flags.fast, true);
  assert.deepEqual(r.positional, ['add a red button']);
  assert.equal(r.error, null);
});

test('@unit parseArgv: --fast after dream → flags.fast=true (position-independent)', () => {
  const r = parseArgv(['add a red button', '--fast']);
  assert.equal(r.flags.fast, true);
  assert.deepEqual(r.positional, ['add a red button']);
  assert.equal(r.error, null);
});

test('@unit parseArgv: session flags (--resume/--fresh/--cancel) recognized', () => {
  for (const f of SESSION_FLAGS) {
    const r = parseArgv(['dream', `--${f}`]);
    assert.equal(r.flags[f], true, `${f} should be true`);
    assert.equal(r.error, null);
  }
});

test('@unit parseArgv (AC-2): --fast + --standard rejected with mutex error (exit 2)', () => {
  const r = parseArgv(['--fast', '--standard', 'dream']);
  assert.ok(r.error);
  assert.equal(r.error.exitCode, 2);
  assert.match(
    r.error.message,
    /mutually exclusive.*--fast.*--standard.*--deep/,
  );
});

test('@unit parseArgv (AC-2): --fast + --deep rejected with mutex error', () => {
  const r = parseArgv(['--fast', '--deep', 'dream']);
  assert.ok(r.error);
  assert.equal(r.error.exitCode, 2);
});

test('@unit parseArgv (AC-2): --standard + --deep rejected (forward-compat scaffolding still mutex)', () => {
  const r = parseArgv(['--standard', '--deep', 'dream']);
  assert.ok(r.error);
  assert.equal(r.error.exitCode, 2);
});

test('@unit parseArgv (E14): unknown flag --foo rejected with exit 2', () => {
  const r = parseArgv(['--foo', 'dream']);
  assert.ok(r.error);
  assert.equal(r.error.exitCode, 2);
  assert.match(r.error.message, /unknown flag: --foo/);
  // Helpful pointer to the escape hatch.
  assert.match(r.error.message, /--/);
});

test('@unit parseArgv (E14): typo --vresion does NOT silently match anything', () => {
  const r = parseArgv(['--vresion']);
  assert.ok(r.error);
  assert.match(r.error.message, /unknown flag: --vresion/);
});

test('@unit parseArgv (E13): `--` separator turns subsequent flag-like tokens into positional', () => {
  const r = parseArgv(['--', '--this-is-not-a-flag', '--neither-is-this']);
  assert.equal(r.error, null);
  assert.deepEqual(r.positional, ['--this-is-not-a-flag', '--neither-is-this']);
  assert.equal(r.flags.fast, false);
});

test('@unit parseArgv (E13): --fast BEFORE -- still parsed; tokens AFTER -- are positional', () => {
  const r = parseArgv(['--fast', '--', '--literal-dream']);
  assert.equal(r.error, null);
  assert.equal(r.flags.fast, true);
  assert.deepEqual(r.positional, ['--literal-dream']);
});

test('@unit parseArgv (E13): two `--` tokens — only the first acts as separator', () => {
  const r = parseArgv(['--', '--', 'dream']);
  assert.equal(r.error, null);
  // Second `--` becomes positional after the first.
  assert.deepEqual(r.positional, ['--', 'dream']);
});

test('@unit parseArgv: --fast alone (no dream) parses cleanly — caller handles empty positional', () => {
  const r = parseArgv(['--fast']);
  assert.equal(r.error, null);
  assert.equal(r.flags.fast, true);
  assert.deepEqual(r.positional, []);
});

test('@unit parseArgv: multiple session flags coexist (--resume --fast)', () => {
  const r = parseArgv(['--fast', '--resume', 'dream']);
  assert.equal(r.error, null);
  assert.equal(r.flags.fast, true);
  assert.equal(r.flags.resume, true);
});

test('@unit resolveEngine: --fast → "fast"', () => {
  assert.equal(resolveEngine({ fast: true, standard: false, deep: false }), 'fast');
});

test('@unit resolveEngine: no engine flag → "standard" (v0.1 baseline preserved)', () => {
  assert.equal(resolveEngine({ fast: false, standard: false, deep: false }), 'standard');
});

test('@unit resolveEngine: --standard alone (forward-compat) resolves to "standard"', () => {
  // v0.2 does not differentiate --standard from default. v0.2d will.
  assert.equal(resolveEngine({ fast: false, standard: true, deep: false }), 'standard');
});

test('@unit resolveEngine: --deep alone (forward-compat) resolves to "standard" in v0.2', () => {
  assert.equal(resolveEngine({ fast: false, standard: false, deep: true }), 'standard');
});

test('@unit KNOWN_FLAGS is the union of ENGINE_FLAGS, SESSION_FLAGS, MODE_FLAGS, VALUE_FLAGS, CATCH_FLAGS, SEALED_FLAGS, MONITOR_FLAGS, and HANDOFF_FLAGS (v0.13.a)', () => {
  assert.deepEqual(
    [...KNOWN_FLAGS].sort(),
    [...ENGINE_FLAGS, ...SESSION_FLAGS, ...MODE_FLAGS, ...VALUE_FLAGS, ...CATCH_FLAGS, ...SEALED_FLAGS, ...MONITOR_FLAGS, ...HANDOFF_FLAGS].sort(),
  );
  // Defensive: arrays are frozen (immutable contract).
  assert.ok(Object.isFrozen(ENGINE_FLAGS));
  assert.ok(Object.isFrozen(SESSION_FLAGS));
  assert.ok(Object.isFrozen(MODE_FLAGS));
  assert.ok(Object.isFrozen(VALUE_FLAGS));
  assert.ok(Object.isFrozen(CATCH_FLAGS));
  assert.ok(Object.isFrozen(SEALED_FLAGS));
  assert.ok(Object.isFrozen(MONITOR_FLAGS));
  assert.ok(Object.isFrozen(HANDOFF_FLAGS));
  assert.ok(Object.isFrozen(KNOWN_FLAGS));
});

// v0.2.o — `--label <value>` value-bearing flag (human-readable branch names,
// universal.md §VII).

test('@unit parseArgv: --label <value> captures the value into flags.label', () => {
  const r = parseArgv(['--here', '--label', 'wip-salvage-stall-signal', 'a dream']);
  assert.equal(r.error, null);
  assert.equal(r.flags.label, 'wip-salvage-stall-signal');
  assert.equal(r.flags.here, true);
  assert.deepEqual(r.positional, ['a dream']);
});

test('@unit parseArgv: --label with a quoted multi-word value', () => {
  const r = parseArgv(['--label', 'wip salvage stall signal', 'a dream']);
  assert.equal(r.error, null);
  assert.equal(r.flags.label, 'wip salvage stall signal');
  assert.deepEqual(r.positional, ['a dream']);
});

test('@unit parseArgv: --label with no value → exit 2 error', () => {
  const r = parseArgv(['a dream', '--label']);
  assert.equal(r.flags.label, null);
  assert.equal(r.error.exitCode, 2);
  assert.match(r.error.message, /--label.*requires a value/);
});

test('@unit parseArgv: --label followed by another flag → exit 2 (value cannot look like a flag)', () => {
  const r = parseArgv(['--label', '--fast', 'a dream']);
  assert.equal(r.error.exitCode, 2);
  assert.match(r.error.message, /--label.*requires a value/);
});

test('@unit parseArgv: dream text after -- is not consumed as a --label value', () => {
  const r = parseArgv(['--label', 'my-label', '--', '--label-looking-dream']);
  assert.equal(r.error, null);
  assert.equal(r.flags.label, 'my-label');
  assert.deepEqual(r.positional, ['--label-looking-dream']);
});

test('@unit VALUE_FLAGS exports a frozen array containing "label"', () => {
  assert.ok(Array.isArray(VALUE_FLAGS));
  assert.ok(VALUE_FLAGS.includes('label'));
  assert.ok(Object.isFrozen(VALUE_FLAGS));
});

// v0.2a — AC-1 + AC-2 argv-level coverage for --here.

test('@unit parseArgv (v0.2a AC-1): --here before dream → flags.here=true', () => {
  const r = parseArgv(['--here', 'add a banner']);
  assert.equal(r.error, null);
  assert.equal(r.flags.here, true);
  assert.deepEqual(r.positional, ['add a banner']);
});

test('@unit parseArgv (v0.2a AC-1): --here after dream → flags.here=true (position-independent)', () => {
  const r = parseArgv(['add a banner', '--here']);
  assert.equal(r.error, null);
  assert.equal(r.flags.here, true);
  assert.deepEqual(r.positional, ['add a banner']);
});

test('@unit parseArgv (v0.2a AC-2): --here composes with --fast (engine flag — orthogonal)', () => {
  const r = parseArgv(['--here', '--fast', 'add a banner']);
  assert.equal(r.error, null);
  assert.equal(r.flags.here, true);
  assert.equal(r.flags.fast, true);
});

test('@unit parseArgv (v0.2a AC-2): --here composes with --standard', () => {
  const r = parseArgv(['--here', '--standard', 'add a banner']);
  assert.equal(r.error, null);
  assert.equal(r.flags.here, true);
  assert.equal(r.flags.standard, true);
});

test('@unit parseArgv (v0.2a AC-2): --here composes with session flags (--fresh/--cancel/--resume)', () => {
  for (const f of SESSION_FLAGS) {
    const r = parseArgv(['--here', `--${f}`, 'dream']);
    assert.equal(r.error, null, `--here + --${f} should compose`);
    assert.equal(r.flags.here, true);
    assert.equal(r.flags[f], true);
  }
});

test('@unit MODE_FLAGS exports a frozen array containing "here"', () => {
  assert.ok(Array.isArray(MODE_FLAGS));
  assert.ok(MODE_FLAGS.includes('here'));
  assert.ok(Object.isFrozen(MODE_FLAGS));
});

test('@unit parseArgv: dream containing -- in the middle is preserved as a single positional', () => {
  // The dream "use -- to escape flags" should pass through as one positional —
  // not be split by us.
  const r = parseArgv(['use a -- in the dream literally']);
  assert.equal(r.error, null);
  assert.deepEqual(r.positional, ['use a -- in the dream literally']);
});

// v0.2b — parseBenchArgs + detectSubcommand coverage (SPEC_V02B AC-1).

import { parseBenchArgs, detectSubcommand, SUBCOMMANDS, parseShipArgs } from '../../lib/argv-parser.js';

test('@unit detectSubcommand: bench is recognized as a subcommand', () => {
  assert.equal(detectSubcommand(['bench', '--dry-run']), 'bench');
  assert.equal(detectSubcommand(['serve']), 'serve');
  assert.equal(detectSubcommand(['"a dream"']), null);
  assert.equal(detectSubcommand([]), null);
});

test('@unit SUBCOMMANDS is frozen and contains bench + serve', () => {
  assert.ok(Object.isFrozen(SUBCOMMANDS));
  assert.ok(SUBCOMMANDS.includes('bench'));
  assert.ok(SUBCOMMANDS.includes('serve'));
});

test('@unit parseBenchArgs: defaults (no flags)', () => {
  const r = parseBenchArgs([]);
  assert.equal(r.error, null);
  assert.equal(r.dryRun, false);
  assert.equal(r.help, false);
  assert.equal(r.engine, 'standard');
  assert.equal(r.dreams, null);
  assert.equal(r.outDir, null);
});

test('@unit parseBenchArgs: --dry-run', () => {
  const r = parseBenchArgs(['--dry-run']);
  assert.equal(r.dryRun, true);
});

test('@unit parseBenchArgs: --help and -h', () => {
  assert.equal(parseBenchArgs(['--help']).help, true);
  assert.equal(parseBenchArgs(['-h']).help, true);
});

test('@unit parseBenchArgs: --engine fast accepted', () => {
  const r = parseBenchArgs(['--engine', 'fast']);
  assert.equal(r.engine, 'fast');
});

test('@unit parseBenchArgs: --engine wat rejected with exit 2', () => {
  const r = parseBenchArgs(['--engine', 'wat']);
  assert.ok(r.error);
  assert.equal(r.error.exitCode, 2);
  assert.match(r.error.message, /--engine must be one of/);
});

test('@unit parseBenchArgs: --dreams parses CSV into array', () => {
  const r = parseBenchArgs(['--dreams', 'kid-01,kid-02 , pro-01']);
  assert.deepEqual(r.dreams, ['kid-01', 'kid-02', 'pro-01']);
});

test('@unit parseBenchArgs: --dreams empty string rejected', () => {
  const r = parseBenchArgs(['--dreams', '']);
  assert.ok(r.error);
});

test('@unit parseBenchArgs: value flag without value rejected', () => {
  const r = parseBenchArgs(['--engine']);
  assert.ok(r.error);
  assert.match(r.error.message, /requires a value/);
});

test('@unit parseBenchArgs: value flag followed by another flag rejected (no missing value)', () => {
  const r = parseBenchArgs(['--engine', '--dry-run']);
  assert.ok(r.error);
});

test('@unit parseBenchArgs: --out-dir accepts a path value', () => {
  const r = parseBenchArgs(['--out-dir', '/tmp/foo']);
  assert.equal(r.outDir, '/tmp/foo');
});

test('@unit parseBenchArgs: unknown flag rejected with helpful message', () => {
  const r = parseBenchArgs(['--bogus']);
  assert.ok(r.error);
  assert.equal(r.error.exitCode, 2);
  assert.match(r.error.message, /unknown bench arg/);
});

test('@unit parseBenchArgs: flags compose (--dry-run --engine fast --dreams kid-01,kid-02)', () => {
  const r = parseBenchArgs([
    '--dry-run',
    '--engine', 'fast',
    '--dreams', 'kid-01,kid-02',
  ]);
  assert.equal(r.error, null);
  assert.equal(r.dryRun, true);
  assert.equal(r.engine, 'fast');
  assert.deepEqual(r.dreams, ['kid-01', 'kid-02']);
});

// v0.2.f — parseShipArgs + ship subcommand recognition (SPEC_V02F AC-3).

test('@unit detectSubcommand: ship is recognized as a subcommand', () => {
  assert.equal(detectSubcommand(['ship']), 'ship');
  assert.equal(detectSubcommand(['ship', '--dry-run']), 'ship');
});

test('@unit SUBCOMMANDS contains ship (in addition to bench + serve)', () => {
  assert.ok(SUBCOMMANDS.includes('ship'));
});

test('@unit parseShipArgs: defaults — no flags, no positional', () => {
  const r = parseShipArgs([]);
  assert.equal(r.error, null);
  assert.equal(r.dryRun, false);
  assert.equal(r.help, false);
  assert.equal(r.branch, null);
});

test('@unit parseShipArgs: --dry-run', () => {
  const r = parseShipArgs(['--dry-run']);
  assert.equal(r.error, null);
  assert.equal(r.dryRun, true);
});

test('@unit parseShipArgs: --help and -h', () => {
  assert.equal(parseShipArgs(['--help']).help, true);
  assert.equal(parseShipArgs(['-h']).help, true);
});

test('@unit parseShipArgs: positional <branch>', () => {
  const r = parseShipArgs(['slice/foo']);
  assert.equal(r.error, null);
  assert.equal(r.branch, 'slice/foo');
});

test('@unit parseShipArgs: --dry-run + positional <branch> compose', () => {
  const r = parseShipArgs(['--dry-run', 'slice/foo']);
  assert.equal(r.error, null);
  assert.equal(r.dryRun, true);
  assert.equal(r.branch, 'slice/foo');
});

test('@unit parseShipArgs: positional + --dry-run (order-independent)', () => {
  const r = parseShipArgs(['slice/foo', '--dry-run']);
  assert.equal(r.error, null);
  assert.equal(r.dryRun, true);
  assert.equal(r.branch, 'slice/foo');
});

test('@unit parseShipArgs: second positional rejected with exit 2', () => {
  const r = parseShipArgs(['slice/foo', 'slice/bar']);
  assert.ok(r.error);
  assert.equal(r.error.exitCode, 2);
  assert.match(r.error.message, /at most one positional/);
});

test('@unit parseShipArgs: unknown flag rejected with exit 2', () => {
  const r = parseShipArgs(['--bogus']);
  assert.ok(r.error);
  assert.equal(r.error.exitCode, 2);
  assert.match(r.error.message, /unknown ship arg/);
});

test('@unit parseShipArgs: non-array rejected', () => {
  const r = parseShipArgs(null);
  assert.ok(r.error);
});

// v0.2c — parseDiscoverArgs + discover subcommand + --skip-onboarding.

import { parseDiscoverArgs } from '../../lib/argv-parser.js';

test('@unit detectSubcommand: discover is recognized as a subcommand (v0.2c)', () => {
  assert.equal(detectSubcommand(['discover']), 'discover');
  assert.equal(detectSubcommand(['discover', '.']), 'discover');
});

test('@unit SUBCOMMANDS contains discover (v0.2c)', () => {
  assert.ok(SUBCOMMANDS.includes('discover'));
});

test('@unit parseDiscoverArgs: defaults', () => {
  const r = parseDiscoverArgs([]);
  assert.equal(r.error, null);
  assert.equal(r.approve, false);
  assert.equal(r.refresh, false);
  assert.equal(r.inferWithClaude, false);
  assert.equal(r.noReportUpdate, false);
  assert.equal(r.forceNonGit, false);
  assert.equal(r.help, false);
  assert.equal(r.path, null);
});

test('@unit parseDiscoverArgs: every boolean flag is recognized', () => {
  for (const [flag, key] of [
    ['--approve', 'approve'],
    ['--refresh', 'refresh'],
    ['--infer-with-claude', 'inferWithClaude'],
    ['--no-report-update', 'noReportUpdate'],
    ['--force-non-git', 'forceNonGit'],
    ['--help', 'help'],
    ['-h', 'help'],
  ]) {
    const r = parseDiscoverArgs([flag]);
    assert.equal(r.error, null, `parse failed for ${flag}: ${r.error && r.error.message}`);
    assert.equal(r[key], true, `${flag} should set ${key}=true`);
  }
});

test('@unit parseDiscoverArgs: positional <path>', () => {
  const r = parseDiscoverArgs(['/some/path']);
  assert.equal(r.error, null);
  assert.equal(r.path, '/some/path');
});

test('@unit parseDiscoverArgs: flags + positional compose (any order)', () => {
  const a = parseDiscoverArgs(['--refresh', '/x']);
  assert.equal(a.refresh, true);
  assert.equal(a.path, '/x');
  const b = parseDiscoverArgs(['/x', '--refresh']);
  assert.equal(b.refresh, true);
  assert.equal(b.path, '/x');
});

test('@unit parseDiscoverArgs: second positional rejected', () => {
  const r = parseDiscoverArgs(['/x', '/y']);
  assert.ok(r.error);
  assert.equal(r.error.exitCode, 2);
  assert.match(r.error.message, /at most one positional/);
});

test('@unit parseDiscoverArgs: unknown flag rejected with helpful message', () => {
  const r = parseDiscoverArgs(['--bogus']);
  assert.ok(r.error);
  assert.equal(r.error.exitCode, 2);
  assert.match(r.error.message, /unknown discover arg/);
});

test('@unit parseDiscoverArgs: non-array rejected', () => {
  const r = parseDiscoverArgs(null);
  assert.ok(r.error);
});

test('@unit parseArgv (v0.2c): --skip-onboarding sets flags["skip-onboarding"]=true', () => {
  const r = parseArgv(['--skip-onboarding', 'dream']);
  assert.equal(r.error, null);
  assert.equal(r.flags['skip-onboarding'], true);
});

test('@unit parseArgv (v0.2c): --skip-onboarding composes with --here', () => {
  const r = parseArgv(['--here', '--skip-onboarding', 'change']);
  assert.equal(r.error, null);
  assert.equal(r.flags.here, true);
  assert.equal(r.flags['skip-onboarding'], true);
});

test('@unit MODE_FLAGS contains skip-onboarding (v0.2c)', () => {
  assert.ok(MODE_FLAGS.includes('skip-onboarding'));
});

// ── v0.5.b — the opt-in live context monitor flag (SPEC_V05B AC-1) ──────────
test('@unit parseArgv (v0.5.b AC-1): --monitor is a recognized boolean, default false', () => {
  // default false
  assert.equal(parseArgv(['a counter app']).flags.monitor, false);
  // set true when present
  const r = parseArgv(['--monitor', 'a counter app']);
  assert.equal(r.error, null);
  assert.equal(r.flags.monitor, true);
});

test('@unit parseArgv (v0.5.b AC-1): --monitor is in KNOWN_FLAGS (never rejected as unknown)', () => {
  assert.ok(KNOWN_FLAGS.includes('monitor'));
});

test('@unit parseArgv (v0.5.b AC-1): --monitor composes with engine / mode / sealed flags (no mutex)', () => {
  const r = parseArgv(['--monitor', '--here', '--fast', '--sealed', 'a change']);
  assert.equal(r.error, null, `unexpected error: ${r.error && r.error.message}`);
  assert.equal(r.flags.monitor, true);
  assert.equal(r.flags.here, true);
  assert.equal(r.flags.fast, true);
  assert.equal(r.flags.sealed, true);
});
