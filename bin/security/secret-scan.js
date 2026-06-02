#!/usr/bin/env node
// bin/security/secret-scan.js — `mmd secret-scan` entry point (SPEC_V091 AC-2).
// The first Bundle A Security brick: a security GATE for autonomous dev — catch a
// leaked credential before it is committed.
//
// SRP (universal.md §I.S): this file does the I/O (git + fs) and the gate; the
// detection is the PURE lib/security/secret-scan.js (scanText). Three scan
// surfaces, all READ-ONLY (writes NOTHING):
//   - default        scan every git-tracked text file (binary + gitignored skipped)
//   - --staged       scan ONLY the staged blobs (the pre-commit gate surface)
//   - --since <ref>  scan files changed since <ref> (working-tree content)
//
// GATES: exits NON-ZERO (1) when any HIGH-confidence finding is present; 0 when
// clean. The generic high-entropy heuristic is `medium` confidence — printed as
// ADVISORY and does NOT change the exit code (precision-first: gating a commit on
// the FP-prone entropy rule would train people to bypass the hook — L-023's
// "fight the harness" anti-pattern). Format rules (very specific) gate.
//
// Language-agnostic (universal §VIII): it scans TEXT, so a .py/.rs/.env/.yaml/
// .txt are all scanned identically — no per-language adapter needed.
//
// Exit codes:
//   0  clean (no high-confidence finding; medium advisories may be printed)
//   1  GATE — one or more high-confidence secrets found
//   2  user/argv error
//   5  cannot read the file list from git (not a git repo / git failed / bad ref)

import { cwd as processCwd, stdout, stderr, env } from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

import {
  scanText,
  DEFAULT_ENTROPY_THRESHOLD,
  DEFAULT_MIN_GENERIC_LENGTH,
  ALLOW_MARKER,
} from '../../lib/security/secret-scan.js';

const PKG_PATH = fileURLToPath(new URL('../../package.json', import.meta.url));
let VERSION = '0.0.0';
try {
  VERSION = JSON.parse(readFileSync(PKG_PATH, 'utf8')).version;
} catch {
  // package.json unreadable — version stays a placeholder, never crashes.
}

// Files larger than this are skipped (a tracked blob this big is almost always a
// vendored asset, not source; reading it whole would waste memory for no signal).
const MAX_SCAN_BYTES = 5_000_000;

const USAGE = `mmd secret-scan — scan for leaked credentials (Bundle A Security gate, SPEC_V091)

Usage:
  mmd secret-scan                 Scan every git-tracked text file (default)
  mmd secret-scan --staged        Scan ONLY the staged diff (pre-commit gate)
  mmd secret-scan --since <ref>   Scan files changed since <ref>
  mmd secret-scan --help

Behavior:
  Detects high-confidence secret formats — private keys, AWS access key ids,
  GitHub/Slack/Google tokens, JWTs — plus a generic high-entropy assignment
  heuristic. Every printed match is REDACTED (a few leading chars then asterisks);
  the full secret is NEVER echoed. Binary and gitignored files are skipped.

  Language-agnostic (§VIII): scans text, so .py/.rs/.env/.yaml/.txt are treated
  identically. Precision-first: obvious placeholders/examples are skipped and an
  inline '${ALLOW_MARKER}' comment (same or preceding line) whitelists a known-safe
  fixture.

  READ-ONLY: writes nothing. Deterministic (no LLM).

GATING:
  Exits NON-ZERO (1) when any HIGH-confidence (format-matched) secret is found, so
  it can gate a commit/CI. The generic high-entropy heuristic is MEDIUM confidence:
  printed as advisory, it does NOT change the exit code.

Flags:
  --staged        Scan the staged blobs only (mutually exclusive with --since).
  --since <ref>   Scan files changed since <ref> (mutually exclusive with --staged).
  --help, -h      Print this usage and exit 0.

Environment:
  MMD_SECRET_ENTROPY_THRESHOLD   Generic-rule entropy threshold, bits/char (default ${DEFAULT_ENTROPY_THRESHOLD}).
  MMD_SECRET_MIN_LENGTH          Generic-rule min quoted-value length (default ${DEFAULT_MIN_GENERIC_LENGTH}).
  (A junk / out-of-range value falls back to the default with an honest note.)

Exit codes:
  0  clean (no high-confidence finding)
  1  GATE — high-confidence secret(s) found
  2  user/argv error
  5  cannot read the file list from git (not a git repo / git failed / bad ref)

mmd ${VERSION}
`;

/**
 * Parse the secret-scan flags. Boolean flags + the one value flag --since; an
 * unknown token or --staged+--since together → exit 2.
 *
 * @param {string[]} rawArgs everything AFTER 'secret-scan'
 * @returns {{ staged: boolean, since: string|null, help: boolean, error: { message: string, exitCode: number }|null }}
 */
export function parseSecretScanArgs(rawArgs) {
  const out = { staged: false, since: null, help: false, error: null };
  if (!Array.isArray(rawArgs)) {
    out.error = { message: 'parseSecretScanArgs: rawArgs must be an array', exitCode: 2 };
    return out;
  }
  for (let i = 0; i < rawArgs.length; i++) {
    const tok = rawArgs[i];
    if (tok === '--staged') out.staged = true;
    else if (tok === '--since') {
      const val = rawArgs[i + 1];
      if (val === undefined || val.startsWith('--')) {
        out.error = { message: '--since requires a <ref> value (e.g. --since main).', exitCode: 2 };
        return out;
      }
      out.since = val;
      i++; // consume the value
    } else if (tok === '--help' || tok === '-h') out.help = true;
    else {
      out.error = {
        message: `unknown secret-scan arg: '${tok}'. Run 'mmd secret-scan --help' to see supported flags.`,
        exitCode: 2,
      };
      return out;
    }
  }
  if (out.staged && out.since !== null) {
    out.error = { message: '--staged and --since are mutually exclusive.', exitCode: 2 };
  }
  return out;
}

/**
 * Resolve an env-overridable numeric threshold with a graceful, HONEST fallback.
 * @returns {{ value: number, ignored: boolean }}
 */
export function resolveNumber(raw, fallback, { min = 0, max = Infinity } = {}) {
  if (raw == null || raw === '') return { value: fallback, ignored: false };
  const n = Number(raw);
  if (Number.isFinite(n) && n > min && n <= max) return { value: n, ignored: false };
  return { value: fallback, ignored: true };
}

/** A buffer is "binary" if it contains a NUL byte in its first chunk. */
function isBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

// stdio: ['ignore','pipe','ignore'] captures stdout but SILENCES git's own
// stderr (e.g. `fatal: not a git repository`) so only MMD's honest exit-5
// message surfaces — no confusing double-report (F5).
const GIT_STDIO = ['ignore', 'pipe', 'ignore'];

/** NUL-delimited `git` listing → string[]; null on git failure. */
function gitListZ(root, args) {
  let out;
  try {
    out = execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 64 * 1024 * 1024, stdio: GIT_STDIO });
  } catch {
    return null;
  }
  return out.split('\0').map((s) => s.trim()).filter(Boolean);
}

/** Read the STAGED (index) blob for a path as a Buffer; null if unreadable. */
function readStagedBlob(root, file) {
  try {
    return execFileSync('git', ['show', `:${file}`], { cwd: root, maxBuffer: 64 * 1024 * 1024, timeout: 30000, stdio: GIT_STDIO });
  } catch {
    return null;
  }
}

/** Read a working-tree file as a Buffer; null if unreadable (e.g. deleted). */
function readWorkingBlob(root, file) {
  try {
    return readFileSync(path.join(root, file));
  } catch {
    return null;
  }
}

/**
 * Gather (file, buffer) pairs for the chosen surface. Returns null on a git
 * failure so the caller can exit 5 honestly.
 *
 * @returns {Array<{file:string, buf:Buffer}>|null}
 */
function gatherFiles(root, { staged, since }) {
  let files;
  let read;
  if (staged) {
    files = gitListZ(root, ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACM']);
    read = (f) => readStagedBlob(root, f);
  } else if (since !== null) {
    files = gitListZ(root, ['diff', '--name-only', '-z', '--diff-filter=ACM', since]);
    read = (f) => readWorkingBlob(root, f);
  } else {
    files = gitListZ(root, ['ls-files', '-z']);
    read = (f) => readWorkingBlob(root, f);
  }
  if (files === null) return null;
  const pairs = [];
  for (const file of files) {
    const buf = read(file);
    if (buf === null) continue; // unreadable/deleted → skip silently
    pairs.push({ file, buf });
  }
  return pairs;
}

/**
 * Entry point invoked by bin/mmd.js when argv[0] === 'secret-scan'.
 *
 * @param {string[]} rawArgs everything AFTER 'secret-scan'
 * @returns {Promise<number>} exit code
 */
export async function runSecretScan(rawArgs) {
  const parsed = parseSecretScanArgs(rawArgs);
  if (parsed.help) {
    stdout.write(USAGE);
    return 0;
  }
  if (parsed.error) {
    stderr.write(`error: ${parsed.error.message}\n`);
    stderr.write(USAGE);
    return parsed.error.exitCode;
  }

  const root = processCwd();

  const et = resolveNumber(env.MMD_SECRET_ENTROPY_THRESHOLD, DEFAULT_ENTROPY_THRESHOLD, { min: 0, max: 8 });
  const ml = resolveNumber(env.MMD_SECRET_MIN_LENGTH, DEFAULT_MIN_GENERIC_LENGTH, { min: 0, max: 4096 });
  if (et.ignored) {
    stderr.write(`note: MMD_SECRET_ENTROPY_THRESHOLD='${env.MMD_SECRET_ENTROPY_THRESHOLD}' is not in (0,8] — using default ${DEFAULT_ENTROPY_THRESHOLD}.\n`);
  }
  if (ml.ignored) {
    stderr.write(`note: MMD_SECRET_MIN_LENGTH='${env.MMD_SECRET_MIN_LENGTH}' is not a positive number — using default ${DEFAULT_MIN_GENERIC_LENGTH}.\n`);
  }

  const pairs = gatherFiles(root, { staged: parsed.staged, since: parsed.since });
  if (pairs === null) {
    const surface = parsed.staged ? '--staged diff' : parsed.since !== null ? `--since ${parsed.since}` : 'git ls-files';
    stderr.write(
      `error: cannot read the file list (${surface}) at ${root}.\n` +
      '  mmd secret-scan needs a git repo' +
      (parsed.since !== null ? ` and a valid ref ('${parsed.since}').\n` : '.\n'),
    );
    return 5;
  }

  const scanOpts = { entropyThreshold: et.value, minGenericLength: ml.value };
  const all = []; // { file, ...finding }
  let scannedCount = 0;
  let skippedBinary = 0;
  for (const { file, buf } of pairs) {
    if (buf.length > MAX_SCAN_BYTES) continue; // oversized vendored asset
    if (isBinary(buf)) {
      skippedBinary++;
      continue;
    }
    scannedCount++;
    const findings = scanText(buf.toString('utf8'), scanOpts);
    for (const f of findings) all.push({ file, ...f });
  }

  // Sort deterministically: file, then line, then column.
  all.sort((a, b) => a.file.localeCompare(b.file) || (a.line - b.line) || (a.column - b.column));

  const high = all.filter((f) => f.confidence === 'high');
  const medium = all.filter((f) => f.confidence !== 'high');

  const surfaceLabel = parsed.staged
    ? 'staged diff'
    : parsed.since !== null
      ? `changes since ${parsed.since}`
      : 'git-tracked files';

  if (all.length === 0) {
    stdout.write(`✓ secret-scan: no secrets found in ${scannedCount} ${surfaceLabel} (${skippedBinary} binary skipped).\n`);
    return 0;
  }

  // Print HIGH (gating) first, then MEDIUM (advisory).
  if (high.length > 0) {
    stdout.write(`✗ secret-scan: ${high.length} high-confidence secret(s) found — GATE TRIGGERED:\n`);
    for (const f of high) {
      stdout.write(`  ${f.file}:${f.line}:${f.column}  [${f.rule}] high  ${f.redactedMatch}\n`);
    }
  }
  if (medium.length > 0) {
    stdout.write(`\n⚠ secret-scan: ${medium.length} advisory (medium-confidence) finding(s) — review, NOT gating:\n`);
    for (const f of medium) {
      stdout.write(`  ${f.file}:${f.line}:${f.column}  [${f.rule}] medium  ${f.redactedMatch}\n`);
    }
  }
  stdout.write(
    `\nScanned ${scannedCount} ${surfaceLabel} (${skippedBinary} binary skipped). ` +
    `Add an inline '${ALLOW_MARKER}' comment to whitelist a known-safe fixture.\n`,
  );

  // Gate: a high-confidence finding fails (exit 1); medium-only is advisory (0).
  return high.length > 0 ? 1 : 0;
}
