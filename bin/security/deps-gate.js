#!/usr/bin/env node
// bin/security/deps-gate.js — `mmdream deps-gate` entry point (SPEC_V09B AC-3). The
// second Bundle A Security brick: a read-only, polyglot supply-chain GATE — catch a
// POISONED dependency before it is installed (a typosquat/slopsquat or an
// unresolvable package).
//
// SRP (universal.md §I.S): this file does the I/O (git + fs + the network seam) and
// the gate; the risk assessment is the PURE lib/security/deps-assess.js and the
// manifest parse + registry fetch are the per-ecosystem adapters. Dependency
// direction (§VIII): core ← adapters ← registry ← THIS bin. The CORE never touches
// the network; the network lives ONLY here, behind the injected `fetchJson` seam.
//
// READ-ONLY: writes NOTHING (asserted by a clean `git status` test). Deterministic
// output (results sorted by name); the only non-determinism is the live registry,
// isolated behind the seam so tests run offline.
//
// GATES like secret-scan: a HIGH finding (unresolvable OR the likely-typosquat
// conjunction) exits 1; MEDIUM advisories (single squat signals, unverified) are
// printed but do NOT change the exit. A fetch failure → `unverified` advisory +
// exit 0 (never a fabricated pass, never a network-blink hard-block — §VI / AC-4).
//
// Exit codes:
//   0  clean / advisory-only / nothing to gate
//   1  GATE — one or more HIGH supply-chain findings
//   2  user/argv error
//   5  cannot read the file list / ref from git (not a git repo / bad ref)
//   6  only unsupported stacks present (refuse: name stacks + supported list, no report)

import { cwd as processCwd, stdout, stderr, env } from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

import {
  assessDependency,
  gateExit,
  DEFAULT_TYPO_DISTANCE,
  DEFAULT_MIN_AGE_DAYS,
  DEFAULT_MIN_DOWNLOADS,
} from '../../lib/security/deps-assess.js';
import {
  resolveAdapters,
  detectStackNames,
  supportedStackNames,
  MANIFEST_STACKS,
} from '../../lib/security/deps-adapters/index.js';

const PKG_PATH = fileURLToPath(new URL('../../package.json', import.meta.url));
let VERSION = '0.0.0';
try {
  VERSION = JSON.parse(readFileSync(PKG_PATH, 'utf8')).version;
} catch {
  // package.json unreadable — version stays a placeholder, never crashes.
}

// The known dependency manifests we derive stack signals from.
const KNOWN_MANIFESTS = Object.keys(MANIFEST_STACKS);

// Per-request network timeout (ms) and the per-run dependency cap. The cap keeps a
// run bounded (a huge monorepo lockfile won't fire thousands of requests); if it
// bites we log it HONESTLY (no silent truncation, universal §VI / SPEC §4).
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_DEPS = 200;
// Concurrency for the registry fetches — bounded so we never flood a registry.
const FETCH_CONCURRENCY = 6;
// How many lines per severity group before we cap with an honest "+N more".
const MAX_LINES_PER_GROUP = 50;

const USAGE = `mmdream deps-gate — polyglot supply-chain dependency gate (Bundle A Security, SPEC_V09B)

Usage:
  mmdream deps-gate                  Check every declared dependency across supported manifests
  mmdream deps-gate --since <ref>    Check only the dependencies ADDED since <ref>
  mmdream deps-gate --help

Behavior:
  For each declared dependency, asks its ecosystem registry "does this exist, how
  old is it, how adopted is it, and is its name suspiciously close to a popular
  package?". Two HIGH (gating) findings: 'unresolvable' (no such package) and
  'likely-typosquat' (the CONJUNCTION — near a popular name AND brand-new AND
  barely-downloaded). Single squat signals stay MEDIUM advisory.

  POLYGLOT (§VIII): a language-neutral risk core + per-ecosystem adapters. Supported
  today: ${supportedStackNames().join(', ')}. When the ONLY manifest present is an
  unsupported stack (e.g. a Rust-only repo), it REFUSES honestly — names the stack +
  the supported list, exit 6, NO report, NO fabricated numbers.

  Network is bounded (~${DEFAULT_TIMEOUT_MS / 1000}s/request) and EXPLICIT — the report names which
  registries were queried. Offline / a registry blink degrades each dep to an honest
  'unverified' advisory and exit 0 — never a fabricated pass, never a network-blink
  block. It is a HEURISTIC, not an audit.

  READ-ONLY: writes nothing. Deterministic output (no LLM).

GATING:
  Exits 1 when any HIGH finding is present (unresolvable or the typosquat
  conjunction). MEDIUM advisories (single signals, unverified) do NOT change the exit.

Flags:
  --since <ref>   Only dependencies ADDED in 'git diff <ref> -- <manifest>'.
  --help, -h      Print this usage and exit 0.

Environment:
  MMD_DEPS_TYPO_DISTANCE   Typosquat edit-distance radius, >0 (default ${DEFAULT_TYPO_DISTANCE}).
  MMD_DEPS_MIN_AGE_DAYS    "very new" cutoff in days (default ${DEFAULT_MIN_AGE_DAYS}).
  MMD_DEPS_MIN_DOWNLOADS   "low adoption" cutoff in downloads (default ${DEFAULT_MIN_DOWNLOADS}).
  (A junk / out-of-range value falls back to the default with an honest note.)

Exit codes:
  0  clean / advisory-only / nothing to gate
  1  GATE — HIGH supply-chain finding(s)
  2  user/argv error
  5  not a git repo / bad ref
  6  only unsupported stacks present (honest §VIII refusal)

mmdream ${VERSION}
`;

// stdio: capture stdout, SILENCE git's own stderr so only MMD's honest message
// surfaces (mirrors secret-scan's GIT_STDIO).
const GIT_STDIO = ['ignore', 'pipe', 'ignore'];

/**
 * Parse the deps-gate flags: the one value flag --since + --help. Unknown token or
 * --since with no value → exit 2.
 *
 * @param {string[]} rawArgs everything AFTER 'deps-gate'
 * @returns {{ since: string|null, help: boolean, error: { message: string, exitCode: number }|null }}
 */
export function parseDepsGateArgs(rawArgs) {
  const out = { since: null, help: false, error: null };
  if (!Array.isArray(rawArgs)) {
    out.error = { message: 'parseDepsGateArgs: rawArgs must be an array', exitCode: 2 };
    return out;
  }
  for (let i = 0; i < rawArgs.length; i += 1) {
    const tok = rawArgs[i];
    if (tok === '--since') {
      const val = rawArgs[i + 1];
      if (val === undefined || val.startsWith('--')) {
        out.error = { message: '--since requires a <ref> value (e.g. --since HEAD).', exitCode: 2 };
        return out;
      }
      out.since = val;
      i += 1;
    } else if (tok === '--help' || tok === '-h') out.help = true;
    else {
      out.error = {
        message: `unknown deps-gate arg: '${tok}'. Run 'mmdream deps-gate --help' to see supported flags.`,
        exitCode: 2,
      };
      return out;
    }
  }
  return out;
}

/**
 * Env-overridable numeric threshold with an HONEST fallback. `min` is exclusive.
 * @returns {{ value: number, ignored: boolean }}
 */
export function resolveNumber(raw, fallback, { min = 0, max = Infinity } = {}) {
  if (raw == null || raw === '') return { value: fallback, ignored: false };
  const n = Number(raw);
  if (Number.isFinite(n) && n > min && n <= max) return { value: n, ignored: false };
  return { value: fallback, ignored: true };
}

/**
 * The REAL network seam: GET a URL, return { status, body } with the parsed JSON
 * body (null if unparseable). Bounded by an AbortController timeout. REJECTS only
 * on a network error / timeout — a 404 resolves normally (status 404). Used only in
 * production; tests inject a fake.
 *
 * @param {string} url
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<{status:number, body:any}>}
 */
export async function realFetchJson(url, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { accept: 'application/json', 'user-agent': `mmd-deps-gate/${VERSION}` },
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

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

/** Read a tracked file at a git ref (`git show <ref>:<path>`); null if absent there. */
function gitShow(root, ref, file) {
  try {
    return execFileSync('git', ['show', `${ref}:${file}`], { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 64 * 1024 * 1024, stdio: GIT_STDIO });
  } catch {
    return null; // file did not exist at <ref> → caller treats every current dep as added
  }
}

/** Validate that <ref> resolves to a commit. False on a bad ref / not a git repo. */
function refIsValid(root, ref) {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: root, timeout: 20000, stdio: GIT_STDIO });
    return true;
  } catch {
    return false;
  }
}

/** Repo-relative signals: which KNOWN manifest basenames appear among tracked files. */
function signalsFromFiles(files) {
  const present = new Set();
  for (const f of files) {
    const base = f.split('/').pop();
    if (KNOWN_MANIFESTS.includes(base)) present.add(base);
  }
  return { manifests: [...present] };
}

/** Run `fn` over `items` with bounded concurrency; results preserve input order. */
async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const lanes = new Array(Math.min(Math.max(1, limit), items.length || 1)).fill(0).map(async () => {
    while (next < items.length) {
      const idx = next;
      next += 1;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(lanes);
  return results;
}

/**
 * Entry point invoked by bin/mmd.js when argv[0] === 'deps-gate'. The `deps` object
 * makes the bin fully testable OFFLINE: tests inject { cwd, fetchJson, now, out,
 * err }; production uses the real cwd / fetch / time / streams.
 *
 * @param {string[]} rawArgs everything AFTER 'deps-gate'
 * @param {{ cwd?: string, fetchJson?: Function, now?: number, out?: {write:Function}, err?: {write:Function}, timeoutMs?: number }} [deps]
 * @returns {Promise<number>} exit code
 */
export async function runDepsGate(rawArgs, deps = {}) {
  const out = deps.out || stdout;
  const err = deps.err || stderr;
  const root = deps.cwd || processCwd();
  const fetchJson = typeof deps.fetchJson === 'function' ? deps.fetchJson : realFetchJson;
  const now = typeof deps.now === 'number' ? deps.now : Date.now();
  const timeoutMs = typeof deps.timeoutMs === 'number' ? deps.timeoutMs : DEFAULT_TIMEOUT_MS;

  const parsed = parseDepsGateArgs(rawArgs);
  if (parsed.help) {
    out.write(USAGE);
    return 0;
  }
  if (parsed.error) {
    err.write(`error: ${parsed.error.message}\n`);
    err.write(USAGE);
    return parsed.error.exitCode;
  }

  // Resolve env-overridable thresholds with graceful, HONEST fallback.
  const td = resolveNumber(env.MMD_DEPS_TYPO_DISTANCE, DEFAULT_TYPO_DISTANCE, { min: 0, max: 10 });
  const ma = resolveNumber(env.MMD_DEPS_MIN_AGE_DAYS, DEFAULT_MIN_AGE_DAYS, { min: -1, max: 100000 });
  const mdl = resolveNumber(env.MMD_DEPS_MIN_DOWNLOADS, DEFAULT_MIN_DOWNLOADS, { min: -1, max: 1e12 });
  if (td.ignored) err.write(`note: MMD_DEPS_TYPO_DISTANCE='${env.MMD_DEPS_TYPO_DISTANCE}' is not in (0,10] — using default ${DEFAULT_TYPO_DISTANCE}.\n`);
  if (ma.ignored) err.write(`note: MMD_DEPS_MIN_AGE_DAYS='${env.MMD_DEPS_MIN_AGE_DAYS}' is not a valid number — using default ${DEFAULT_MIN_AGE_DAYS}.\n`);
  if (mdl.ignored) err.write(`note: MMD_DEPS_MIN_DOWNLOADS='${env.MMD_DEPS_MIN_DOWNLOADS}' is not a valid number — using default ${DEFAULT_MIN_DOWNLOADS}.\n`);
  const assessOpts = { typoDistance: td.value, minAgeDays: ma.value, minDownloads: mdl.value };

  // The tracked file list (the adapters filter it). Not a git repo → exit 5.
  const trackedFiles = gitListZ(root, ['ls-files', '-z']);
  if (trackedFiles === null) {
    err.write(
      `error: cannot list git-tracked files at ${root} (not a git repo, or git failed).\n` +
      '  mmdream deps-gate reads dependency manifests via git; it needs a git repo.\n',
    );
    return 5;
  }

  // --since needs a valid ref.
  if (parsed.since !== null && !refIsValid(root, parsed.since)) {
    err.write(
      `error: '${parsed.since}' is not a valid git ref at ${root}.\n` +
      '  mmdream deps-gate --since needs a ref that resolves to a commit (e.g. HEAD, main, a SHA).\n',
    );
    return 5;
  }

  // ── §VIII gate: detect the stack(s), resolve adapters, or REFUSE honestly. ──
  const signals = signalsFromFiles(trackedFiles);
  const matched = resolveAdapters(signals);
  const detected = detectStackNames(signals);
  const supported = supportedStackNames();

  if (matched.length === 0) {
    if (detected.length > 0) {
      // Unsupported stack(s) present, no adapter → honest refusal (§VIII / §VI). NO
      // report, NO fabricated numbers — the rule that stops the JS-on-Rust bug.
      err.write(
        `error: no deps-gate adapter for the detected stack — not analyzing.\n` +
        `  detected stack: ${detected.join(', ')}.\n` +
        `  Supported stacks: ${supported.join(', ')}.\n` +
        '  Refusing rather than running a stack-mismatched analyzer that would fabricate numbers\n' +
        '  (constitution §VIII technology-agnostic analysis / §VI failure honesty). No report written.\n' +
        '  Adding a stack is a new adapter (lib/security/deps-adapters/), not a rewrite.\n',
      );
      return 6;
    }
    // No recognized dependency manifest at all → nothing to gate (honest, exit 0;
    // deps-gate must not block a build for a repo with no dependencies to check).
    out.write('✓ deps-gate: no supported dependency manifest found — nothing to gate.\n');
    return 0;
  }

  const readFile = (rel) => {
    try {
      return readFileSync(path.join(root, rel), 'utf8');
    } catch {
      return null;
    }
  };

  // ── Parse declared dependencies from every matching adapter. ──
  /** @type {Array<{name:string, version:string, manifestFile:string, adapter:object}>} */
  let declared = [];
  const analyzedNames = [];
  const registries = [];
  for (const adapter of matched) {
    let list = [];
    try {
      list = adapter.parseDependencies({ repoRoot: root, files: trackedFiles, readFile }) || [];
    } catch (e) {
      err.write(`note: the ${adapter.displayName} adapter failed to parse dependencies (${e.message}); skipping it.\n`);
      continue;
    }
    for (const d of list) {
      if (d && typeof d.name === 'string' && d.name) declared.push({ ...d, adapter });
    }
    analyzedNames.push(adapter.displayName);
    if (typeof adapter.registryName === 'string') registries.push(adapter.registryName);
  }

  // ── --since: restrict to dependencies ADDED relative to <ref>. ──
  if (parsed.since !== null) {
    declared = restrictToAdded(declared, root, parsed.since, readFile);
  }

  // De-dupe by name (a dep declared in several manifests is queried once; we keep
  // the first manifestFile for the report).
  const byName = new Map();
  for (const d of declared) {
    if (!byName.has(d.name)) byName.set(d.name, d);
  }
  let queue = [...byName.values()];

  // Bounded scan (§4): cap the number of deps queried, log honestly if it bites.
  let capped = 0;
  if (queue.length > MAX_DEPS) {
    capped = queue.length - MAX_DEPS;
    queue = queue.slice(0, MAX_DEPS);
  }

  // ── Fetch metadata (bounded, concurrent, behind the seam) + assess (pure). ──
  const results = await mapPool(queue, FETCH_CONCURRENCY, async (d) => {
    let metadata = null;
    try {
      metadata = await d.adapter.fetchMetadata(d.name, { fetchJson, now, timeoutMs });
    } catch {
      metadata = null; // an adapter that threw → unverified (honest, never a pass)
    }
    const assessed = assessDependency({
      name: d.name,
      declared: d.version,
      metadata,
      popularNames: Array.isArray(d.adapter.popularNames) ? d.adapter.popularNames : [],
      opts: assessOpts,
    });
    return { name: d.name, manifestFile: d.manifestFile, registry: d.adapter.registryName, findings: assessed.findings };
  });

  // Honestly note any DETECTED-but-unsupported stacks (a mixed repo).
  const unsupported = detected.filter((dn) => !analyzedNames.includes(dn));

  const exit = render({
    out, results, queue, registries, analyzedNames, unsupported, supported,
    since: parsed.since, capped, totalDeclared: byName.size,
  });
  return exit;
}

/**
 * Restrict a declared-dependency list to those ADDED relative to <ref>: for each
 * manifest, parse the version-at-ref's dependency NAMES and keep only current deps
 * whose name is not in that old set. A manifest absent at <ref> → all its deps are
 * "added".
 */
function restrictToAdded(declared, root, ref, readFile) {
  // Group current deps by manifest, and remember each manifest's adapter.
  const byManifest = new Map();
  for (const d of declared) {
    if (!byManifest.has(d.manifestFile)) byManifest.set(d.manifestFile, { adapter: d.adapter, deps: [] });
    byManifest.get(d.manifestFile).deps.push(d);
  }
  const kept = [];
  for (const [mf, { adapter, deps }] of byManifest) {
    const oldContent = gitShow(root, ref, mf);
    let oldNames = new Set();
    if (typeof oldContent === 'string') {
      // Re-parse the OLD manifest content through the same adapter, in isolation.
      const oldList = adapter.parseDependencies({
        repoRoot: root,
        files: [mf],
        readFile: (rel) => (rel === mf ? oldContent : null),
      }) || [];
      oldNames = new Set(oldList.map((d) => d.name));
    }
    for (const d of deps) {
      if (!oldNames.has(d.name)) kept.push(d);
    }
  }
  return kept;
}

/**
 * Render the grouped findings + summary to `out`, return the gate exit code.
 * Read-only — writes only to the provided stream.
 */
function render({ out, results, queue, registries, analyzedNames, unsupported, supported, since, capped, totalDeclared }) {
  // Flatten findings, sorted deterministically by name then rule.
  const flat = [];
  for (const r of results) {
    for (const f of r.findings) flat.push({ name: r.name, manifestFile: r.manifestFile, ...f });
  }
  flat.sort((a, b) => a.name.localeCompare(b.name) || a.rule.localeCompare(b.rule));
  const high = flat.filter((f) => f.severity === 'high');
  const medium = flat.filter((f) => f.severity !== 'high');

  const regList = [...new Set(registries)].join(', ') || 'none';
  const sinceLabel = since !== null ? ` added since ${since}` : '';
  const cleanCount = results.filter((r) => r.findings.length === 0).length;

  if (flat.length === 0) {
    out.write(
      `✓ deps-gate: no supply-chain risks found in ${queue.length} dependenc${queue.length === 1 ? 'y' : 'ies'}${sinceLabel} ` +
      `(${analyzedNames.join(', ')}; queried ${regList}).\n`,
    );
  } else {
    if (high.length > 0) {
      out.write(`✗ deps-gate: ${high.length} high-confidence supply-chain finding(s) — GATE TRIGGERED:\n`);
      writeGroup(out, high);
    }
    if (medium.length > 0) {
      out.write(`${high.length > 0 ? '\n' : ''}⚠ deps-gate: ${medium.length} advisory (medium) finding(s) — review, NOT gating:\n`);
      writeGroup(out, medium);
    }
    out.write(
      `\nScanned ${queue.length} dependenc${queue.length === 1 ? 'y' : 'ies'}${sinceLabel} ` +
      `(${cleanCount} clean) across ${analyzedNames.join(', ')}. Registries queried: ${regList}.\n` +
      'This is a HEURISTIC supply-chain check (existence / age / adoption / typosquat-distance), NOT an audit.\n',
    );
  }
  if (capped > 0) {
    out.write(`note: ${totalDeclared} dependencies declared; capped at ${MAX_DEPS} per run — ${capped} not queried.\n`);
  }
  if (unsupported.length > 0) {
    out.write(`note: detected but UNSUPPORTED (no adapter yet, not analyzed): ${unsupported.join(', ')}. Supported: ${supported.join(', ')}.\n`);
  }

  return gateExit(results);
}

/** Write up to MAX_LINES_PER_GROUP finding lines, then an honest "+N more". */
function writeGroup(out, findings) {
  const shown = findings.slice(0, MAX_LINES_PER_GROUP);
  for (const f of shown) {
    out.write(`  ${f.name}  [${f.rule}] ${f.severity}  (${f.manifestFile})\n    ${f.detail}\n`);
  }
  const rest = findings.length - shown.length;
  if (rest > 0) out.write(`  … +${rest} more (capped; re-run after addressing these)\n`);
}
