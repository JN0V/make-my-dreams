// @unit tests for lib/argv-parser.js — SPEC_V02G AC-2/3/4 parser additions:
// parseQaArgs, parseCsoArgs, parseDocumentReleaseArgs.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseQaArgs,
  parseCsoArgs,
  parseDocumentReleaseArgs,
  SUBCOMMANDS,
  detectSubcommand,
} from '../../lib/argv-parser.js';

// ─── SUBCOMMANDS registry (AC-2/3/4 ensure qa/cso/document-release registered) ──

test('@unit SUBCOMMANDS includes qa', () => {
  assert.ok(SUBCOMMANDS.includes('qa'));
});

test('@unit SUBCOMMANDS includes cso', () => {
  assert.ok(SUBCOMMANDS.includes('cso'));
});

test('@unit SUBCOMMANDS includes document-release', () => {
  assert.ok(SUBCOMMANDS.includes('document-release'));
});

test('@unit detectSubcommand recognizes the new subcommands', () => {
  assert.equal(detectSubcommand(['qa']), 'qa');
  assert.equal(detectSubcommand(['cso']), 'cso');
  assert.equal(detectSubcommand(['document-release']), 'document-release');
});

// ─── parseQaArgs ─────────────────────────────────────────────────────────

test('@unit parseQaArgs: empty args → defaults', () => {
  const r = parseQaArgs([]);
  assert.equal(r.help, false);
  assert.equal(r.dryRun, false);
  assert.equal(r.branch, null);
  assert.equal(r.error, null);
});

test('@unit parseQaArgs: --help sets help=true', () => {
  assert.equal(parseQaArgs(['--help']).help, true);
  assert.equal(parseQaArgs(['-h']).help, true);
});

test('@unit parseQaArgs: --dry-run sets dryRun=true', () => {
  assert.equal(parseQaArgs(['--dry-run']).dryRun, true);
});

test('@unit parseQaArgs: positional <branch> is captured', () => {
  assert.equal(parseQaArgs(['feat/foo']).branch, 'feat/foo');
});

test('@unit parseQaArgs: unknown flag → exit 2', () => {
  const r = parseQaArgs(['--bogus']);
  assert.ok(r.error);
  assert.equal(r.error.exitCode, 2);
  assert.match(r.error.message, /unknown qa arg/);
});

test('@unit parseQaArgs: two positionals → exit 2', () => {
  const r = parseQaArgs(['feat/a', 'feat/b']);
  assert.ok(r.error);
  assert.equal(r.error.exitCode, 2);
});

test('@unit parseQaArgs: non-array input → typed error', () => {
  const r = parseQaArgs(null);
  assert.ok(r.error);
});

// ─── parseCsoArgs (same kernel) ──────────────────────────────────────────

test('@unit parseCsoArgs: --dry-run + <branch> both honored', () => {
  const r = parseCsoArgs(['--dry-run', 'slice/test']);
  assert.equal(r.dryRun, true);
  assert.equal(r.branch, 'slice/test');
  assert.equal(r.error, null);
});

test('@unit parseCsoArgs: unknown flag mentions cso, not qa', () => {
  const r = parseCsoArgs(['--bogus']);
  assert.ok(r.error);
  assert.match(r.error.message, /unknown cso arg/);
  assert.doesNotMatch(r.error.message, /unknown qa arg/);
});

// ─── parseDocumentReleaseArgs (two-positional shape) ─────────────────────

test('@unit parseDocumentReleaseArgs: no args → defaults', () => {
  const r = parseDocumentReleaseArgs([]);
  assert.equal(r.help, false);
  assert.equal(r.dryRun, false);
  assert.equal(r.from, null);
  assert.equal(r.to, null);
  assert.equal(r.error, null);
});

test('@unit parseDocumentReleaseArgs: <from> only', () => {
  const r = parseDocumentReleaseArgs(['v0.2.4']);
  assert.equal(r.from, 'v0.2.4');
  assert.equal(r.to, null);
});

test('@unit parseDocumentReleaseArgs: <from> <to>', () => {
  const r = parseDocumentReleaseArgs(['v0.2.4', 'v0.2.5']);
  assert.equal(r.from, 'v0.2.4');
  assert.equal(r.to, 'v0.2.5');
});

test('@unit parseDocumentReleaseArgs: --dry-run between positionals', () => {
  const r = parseDocumentReleaseArgs(['v0.2.4', '--dry-run', 'v0.2.5']);
  assert.equal(r.dryRun, true);
  assert.equal(r.from, 'v0.2.4');
  assert.equal(r.to, 'v0.2.5');
});

test('@unit parseDocumentReleaseArgs: --help / -h', () => {
  assert.equal(parseDocumentReleaseArgs(['--help']).help, true);
  assert.equal(parseDocumentReleaseArgs(['-h']).help, true);
});

test('@unit parseDocumentReleaseArgs: unknown flag → exit 2', () => {
  const r = parseDocumentReleaseArgs(['--bogus']);
  assert.ok(r.error);
  assert.equal(r.error.exitCode, 2);
  assert.match(r.error.message, /unknown document-release arg/);
});

test('@unit parseDocumentReleaseArgs: too many positionals → exit 2', () => {
  const r = parseDocumentReleaseArgs(['a', 'b', 'c']);
  assert.ok(r.error);
  assert.equal(r.error.exitCode, 2);
  assert.match(r.error.message, /at most two/);
});

test('@unit parseDocumentReleaseArgs: non-array → typed error', () => {
  const r = parseDocumentReleaseArgs(null);
  assert.ok(r.error);
});
