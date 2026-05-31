// lib/constitution-compose.js — Layer C: runtime profile → constitution-module composer.
//
// Spec: SPEC_V03C.md (AC-1 parseBindings, AC-2 resolveModules, AC-3 composeConstitution).
//
// This is the long-planned "Layer C" of MMD's constitution diffusion (see
// CLAUDE.md "Constitution diffusion mechanisms"). It reads the bindings table
// (.specify/memory/constitution-bindings.yaml), resolves the active profile to
// its bound module list (defaults.always ∪ profiles[profile]), reads those
// .specify/memory/constitution/<name>.md files, and concatenates them into a
// single block ready to inject into the auto-dev prompt. It SUPERSEDES the
// v0.3.b stopgap (a single hardcoded Kid safe-by-default line in buildPrompt):
// the rule now lives in the injected safe-by-default.md + kid.md modules.
//
// Design constraints (universal.md §II KISS, §VI honesty; SPEC_V03C §5):
//   - NO external YAML dependency. A hand-rolled YAML-lite line-by-line state
//     machine handles the table's `key: [a, b]` shape, exactly as
//     lib/bench/load-dreams.js hand-rolls its front-matter parser (vanilla
//     stack). The bindings file is one level deep under section headers, so a
//     small state machine suffices.
//   - parseBindings + resolveModules are PURE (no I/O). File reads are injected
//     via readFileFn into composeConstitution so tests never touch real fs
//     (mirrors the detector/elicit DI style elsewhere in the repo).
//   - GRACEFUL + HONEST: a missing/unreadable bindings file or module never
//     crashes a build. parseBindings never throws; composeConstitution skips an
//     unreadable module with an inline note and returns `null` when NOTHING is
//     composable, signalling the caller (buildPrompt) to fall back to the
//     v0.3.b minimal line.
//
// composeConstitution is SYNCHRONOUS (readFileSync) on purpose: buildPrompt is
// a synchronous prompt assembler, so the composer must compose inline without
// forcing the whole call chain to become async.
//
// Public API:
//   - parseBindings(yamlText)                  -> { defaults:{always:string[],…}, profiles:{[p]:string[]}, … }
//   - resolveModules({profile}, bindings)      -> string[]  (deduped, ordered)
//   - composeConstitution({profile, bindingsPath?, moduleDir?, readFileFn?}) -> string | null

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Repo-root-relative defaults. This file lives in <repo>/lib/, so one level up
// is the repo root. The bindings table and the module dir are read-only inputs.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const DEFAULT_BINDINGS_PATH = path.join(
  REPO_ROOT, '.specify', 'memory', 'constitution-bindings.yaml',
);
const DEFAULT_MODULE_DIR = path.join(
  REPO_ROOT, '.specify', 'memory', 'constitution',
);

/** Default file reader — real fs, UTF-8. Injected away in tests. */
function defaultReadFileFn(p) {
  return readFileSync(p, 'utf8');
}

/** Strip an inline `# comment` tail from a scalar fragment. */
function stripInlineComment(s) {
  const hashIdx = s.indexOf('#');
  return hashIdx === -1 ? s : s.slice(0, hashIdx);
}

/**
 * Reject keys/section-names that would corrupt the prototype chain when used as
 * an assignment target on a plain object. Without this guard a bindings section
 * literally named `__proto__` would make `result['__proto__'][key] = list` write
 * onto `Object.prototype` process-wide — a prototype-pollution defect that would
 * leak into the long-lived `mmd serve` daemon (Phase-4 review F1).
 */
function isUnsafeKey(k) {
  return k === '__proto__' || k === 'prototype' || k === 'constructor';
}

/** A safe constitution-module basename: lowercase alnum + hyphens, no path. */
const SAFE_MODULE_NAME = /^[a-z0-9][a-z0-9-]*$/;

/** Strip surrounding single/double quotes from a token, if present. */
function stripQuotes(s) {
  if (
    s.length >= 2 &&
    ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * Parse a `[a, b, c]` inline list from the part of a line after the `:`.
 * Anything before `[` or after `]` (e.g. a trailing `# comment`) is ignored.
 * A line with no `[...]` yields an empty list (tolerant, never throws).
 *
 * Known YAML-lite limitation (Phase-4 review F5, accepted): a `]` inside a
 * quoted token truncates the list early — the bindings file uses only bare
 * module-name tokens, so this never bites. Revisit if values gain brackets.
 *
 * @param {string} rest  the substring of the line after the first ':'
 * @returns {string[]}
 */
function parseInlineList(rest) {
  const open = rest.indexOf('[');
  const close = rest.indexOf(']');
  if (open === -1 || close === -1 || close < open) return [];
  const inner = rest.slice(open + 1, close);
  return inner
    .split(',')
    .map((tok) => stripQuotes(tok.trim()))
    .filter((tok) => tok.length > 0);
}

/**
 * AC-1 — hand-rolled YAML-lite parser for constitution-bindings.yaml.
 *
 * Recognizes the file's actual shape: top-level section headers (`defaults:`,
 * `profiles:`, `skills:`, …) followed by indented `key: [a, b]` list lines.
 * Top-level scalars (e.g. `version: "2.0.0"`) are ignored. Comments (`#`),
 * blank lines, and inline `# comment` tails are tolerated.
 *
 * Guarantees `defaults.always` (string[]) and `profiles` (map) always exist on
 * the result. Other sections (skills/workers/engines/contexts/cli) are captured
 * generically so the resolver can extend to them in a future slice (Open/Closed,
 * universal §I.O) — v0.3.c only consumes the profile dimension.
 *
 * NEVER throws (AC-1): malformed input yields empty lists, not an exception.
 *
 * @param {string} yamlText
 * @returns {{ defaults: { always: string[] }, profiles: Record<string,string[]> }}
 */
export function parseBindings(yamlText) {
  const result = { defaults: { always: [] }, profiles: {} };
  if (typeof yamlText !== 'string' || yamlText.length === 0) return result;

  try {
    const lines = yamlText.split(/\r?\n/);
    let section = null; // the current top-level section name, or null

    for (const rawLine of lines) {
      // Normalize tabs defensively, then classify by trimmed content.
      const line = rawLine.replace(/\t/g, '  ');
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('#')) continue;

      const isIndented = /^\s/.test(line);
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue; // not a key line — skip

      if (!isIndented) {
        // Top-level: a section header (no inline value) or a scalar. A header
        // has no value on the same line; a scalar (e.g. `version: "2.0.0"`)
        // does and ends the current section. NOTE: a one-line `section: [a,b]`
        // shape is therefore read as a scalar and its block ignored — the
        // bindings file never uses that shape (Phase-4 review F4, accepted).
        const key = line.slice(0, colonIdx).trim();
        const after = stripInlineComment(line.slice(colonIdx + 1)).trim();
        section = after === '' ? key : null;
        continue;
      }

      // Indented `key: [list]` belonging to the current section.
      if (section == null) continue;
      const key = stripQuotes(line.slice(0, colonIdx).trim());
      // Prototype-pollution guard (F1): never use a dangerous name as an
      // assignment target — on the section (the generic branch creates
      // result[section]) or on the key.
      if (isUnsafeKey(section) || isUnsafeKey(key)) continue;
      const list = parseInlineList(line.slice(colonIdx + 1));

      if (section === 'defaults') {
        result.defaults[key] = list;
      } else if (section === 'profiles') {
        result.profiles[key] = list;
      } else {
        // Forward-compat capture of the other dimensions (not consumed yet).
        if (!result[section] || typeof result[section] !== 'object') {
          result[section] = {};
        }
        result[section][key] = list;
      }
    }
  } catch {
    // Honor AC-1's "never throws": return whatever we accumulated. A partial
    // table is more useful than a crash and the caller degrades gracefully.
  }

  if (!Array.isArray(result.defaults.always)) result.defaults.always = [];
  if (!result.profiles || typeof result.profiles !== 'object') result.profiles = {};
  return result;
}

/**
 * AC-2 — resolve a profile to its module list. PURE, never throws.
 *
 * Returns `defaults.always ∪ profiles[profile]`, DEDUPLICATED, in a
 * DETERMINISTIC order: defaults first (in listed order), then the profile's
 * additions (in listed order), each module appearing once. An unknown/absent
 * profile resolves to `defaults.always` only.
 *
 *   resolveModules({profile:'Kid'}, realBindings)
 *     → ['universal', 'ai-coding', 'safe-by-default', 'kid']
 *
 * @param {{ profile?: string }} sel
 * @param {object} bindings  result of parseBindings
 * @returns {string[]}
 */
export function resolveModules({ profile } = {}, bindings = {}) {
  const defaults = Array.isArray(bindings?.defaults?.always)
    ? bindings.defaults.always
    : [];
  const profiles =
    bindings?.profiles && typeof bindings.profiles === 'object'
      ? bindings.profiles
      : {};
  const additions =
    typeof profile === 'string' && Array.isArray(profiles[profile])
      ? profiles[profile]
      : [];

  const ordered = [];
  const seen = new Set();
  for (const name of [...defaults, ...additions]) {
    if (typeof name !== 'string') continue;
    const n = name.trim();
    if (n.length === 0 || seen.has(n)) continue;
    seen.add(n);
    ordered.push(n);
  }
  return ordered;
}

/**
 * AC-3 — compose the constitution block for a profile.
 *
 * Reads + parses the bindings, resolves the module list, reads each
 * `<moduleDir>/<name>.md`, and concatenates them with a clear per-module header
 * (`## Constitution — <name>`). A missing/unreadable module is SKIPPED with an
 * inline note (never crashes). Returns `null` when NOTHING is composable — the
 * bindings file is unreadable, the profile resolves to no modules, or every
 * module file fails to read — which is the caller's signal to fall back to the
 * v0.3.b minimal line (graceful degradation, universal §VI).
 *
 * SYNCHRONOUS so buildPrompt can compose inline. `readFileFn` is injected in
 * tests so the unit suite never touches real fs.
 *
 * @param {object}   opts
 * @param {string}   opts.profile        canonical profile (e.g. 'Kid','Pro')
 * @param {string}   [opts.bindingsPath] override the bindings file path
 * @param {string}   [opts.moduleDir]    override the module directory
 * @param {(p:string)=>string} [opts.readFileFn]  injected sync reader
 * @returns {string | null}
 */
export function composeConstitution({
  profile,
  bindingsPath,
  moduleDir,
  readFileFn,
} = {}) {
  const readFn = typeof readFileFn === 'function' ? readFileFn : defaultReadFileFn;
  const bindFile = bindingsPath || DEFAULT_BINDINGS_PATH;
  const modDir = moduleDir || DEFAULT_MODULE_DIR;

  // 1. Read + parse the bindings. Unreadable bindings → nothing to resolve.
  let bindingsText;
  try {
    bindingsText = readFn(bindFile);
  } catch {
    return null;
  }
  const bindings = parseBindings(bindingsText);
  const modules = resolveModules({ profile }, bindings);
  if (modules.length === 0) return null;

  // 2. Read each module; skip unreadable ones with an honest inline note.
  const blocks = [];
  let composedCount = 0;
  for (const name of modules) {
    // Path-traversal guard (F1/F3): a module name must be a safe basename, so a
    // bindings entry like `../../etc/passwd` cannot make us read outside modDir.
    if (!SAFE_MODULE_NAME.test(name)) {
      blocks.push(
        `## Constitution — ${name}\n\n_(module '${name}' skipped — invalid module name)_`,
      );
      continue;
    }
    const filePath = path.join(modDir, `${name}.md`);
    let body;
    try {
      body = readFn(filePath);
    } catch {
      blocks.push(
        `## Constitution — ${name}\n\n_(module '${name}.md' unavailable — skipped)_`,
      );
      continue;
    }
    blocks.push(`## Constitution — ${name}\n\n${String(body).trim()}`);
    composedCount += 1;
  }

  // Nothing actually composed (all modules unreadable) → fall back signal.
  if (composedCount === 0) return null;
  return blocks.join('\n\n---\n\n');
}
