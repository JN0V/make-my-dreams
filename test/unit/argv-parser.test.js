// @unit tests for lib/argv-parser.js — POSIX flag parsing, mutex, --, unknown-flag rejection.
// Per testing.md §V: pure logic, < 100 ms total. No I/O, no subprocess.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseArgv,
  resolveEngine,
  ENGINE_FLAGS,
  SESSION_FLAGS,
  MODE_FLAGS,
  KNOWN_FLAGS,
} from '../../lib/argv-parser.js';

test('@unit parseArgv: empty argv → all flags false, no positional, no error', () => {
  const r = parseArgv([]);
  assert.deepEqual(r.flags, {
    fast: false, standard: false, deep: false,
    resume: false, fresh: false, cancel: false,
    here: false,
  });
  assert.deepEqual(r.positional, []);
  assert.equal(r.error, null);
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

test('@unit KNOWN_FLAGS is the union of ENGINE_FLAGS, SESSION_FLAGS, and MODE_FLAGS (v0.2a)', () => {
  assert.deepEqual(
    [...KNOWN_FLAGS].sort(),
    [...ENGINE_FLAGS, ...SESSION_FLAGS, ...MODE_FLAGS].sort(),
  );
  // Defensive: arrays are frozen (immutable contract).
  assert.ok(Object.isFrozen(ENGINE_FLAGS));
  assert.ok(Object.isFrozen(SESSION_FLAGS));
  assert.ok(Object.isFrozen(MODE_FLAGS));
  assert.ok(Object.isFrozen(KNOWN_FLAGS));
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

import { parseBenchArgs, detectSubcommand, SUBCOMMANDS } from '../../lib/argv-parser.js';

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
