// lib/security/deps-adapters/index.js — the deps-gate POLYGLOT adapter contract +
// pure registry (SPEC_V09B AC-2). Dependency declaration and registry metadata are
// genuinely PER-ECOSYSTEM (npm's package.json + registry.npmjs.org, PyPI's
// requirements.txt/pyproject.toml + pypi.org, crates.io, the Go proxy) — so unlike
// secret-scan (where a secret is a language-neutral textual pattern needing NO
// adapter), deps-gate is the ADAPTER-based §VIII shape, copied from the Test
// Curator (ADR-042) and the import graph (ADR-043).
//
// SRP (universal.md §I.S): this module owns ONLY the contract + the registry —
// which adapter(s) a repo's manifests select. The manifest parse + registry fetch
// live in each adapter (npm.js, python.js); the risk assessment lives in the core
// (../deps-assess.js). Dependency direction (SPEC §3): **core ← adapters ← this
// index ← the bin**. The CORE imports NO adapter; an adapter imports NO core; this
// index imports the adapters; the bin imports this index.
//
// Pure where possible: adapter selection is computed from a passed-in `signals`
// object (manifest presence), so the registry resolution is a pure function — no
// I/O. Each adapter's parseDependencies takes an INJECTED file reader and
// fetchMetadata takes an INJECTED fetchJson seam, so both are testable offline.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE ADAPTER CONTRACT
// ─────────────────────────────────────────────────────────────────────────────
// Every adapter is a plain object implementing:
//
//   id            {string}  stable machine id, e.g. 'npm', 'python'.
//   displayName   {string}  human stack name, e.g. 'npm (JavaScript/TypeScript)'.
//   registryName  {string}  the registry it queries, e.g. 'registry.npmjs.org'
//                            (named in the report — explicit egress, §VI / security.md).
//
//   matches(signals) → boolean
//       Does this repo use my ecosystem? Decided from `signals` (manifest
//       presence), NOT from scanning source. PURE.
//
//   parseDependencies({ repoRoot, files, readFile }) → Array<{
//       name:         string,   // the package name (the registry key)
//       version:      string,   // the declared version/spec (informational)
//       manifestFile: string,   // the repo-relative manifest it was declared in
//   }>
//       `files` is the list of ALL git-tracked repo-relative paths; the adapter
//       filters to its OWN manifest(s). `readFile(relPath) → string|null` is
//       injected by the bin (backed by fs); a test passes a fake. Local / path /
//       workspace / git / placeholder specifiers are SKIPPED (they are not
//       registry packages — skipping them avoids `unresolvable` false positives,
//       AC-4). NEVER throws — junk in → empty-ish out.
//
//   fetchMetadata(name, { fetchJson, now, timeoutMs }) → Promise<
//       { existsInRegistry: boolean, firstPublishedDaysAgo: number|null, downloads: number|null }
//       | null>
//       The ONLY network touch-point. `fetchJson(url, { timeoutMs }) →
//       Promise<{ status, body }>` is INJECTED (real fetch in the bin, a fake map
//       in tests); it REJECTS only on a network error / timeout. Mapping:
//         registry 404            → { existsInRegistry: false, … }
//         registry 200            → { existsInRegistry: true, age/downloads from the body }
//         fetch threw / timed out → null   (→ the core emits an honest `unverified`,
//                                            NEVER a fabricated pass — §VI / AC-4)
//       `now` (ms epoch) is injected so age-in-days is testable without mocking
//       time. NEVER throws (a fetch failure resolves to null, it does not reject).
//
//   popularNames  {string[]}  a STATIC top-N seed of the ecosystem's most-adopted
//                             names (the typosquat distance is measured to THIS
//                             seed). Documented as a seed/heuristic, NOT an
//                             exhaustive index.
//
//   CAPABILITY FLAGS (the §VI honesty mechanism):
//   supportsAge        {boolean}  can it report a first-published age?
//   supportsDownloads  {boolean}  can it report an adoption (download) figure?
//   When a flag is false the bin's report says so honestly rather than implying a
//   signal it never measured.

// ── Manifest → human stack name ──────────────────────────────────────────────
// Used for HONEST detection naming, independent of whether an adapter exists for
// the stack — this is what lets AC-2's refusal say "detected Rust, no adapter yet"
// by NAME even though there is no Rust adapter to ask.
export const MANIFEST_STACKS = Object.freeze({
  'package.json': 'npm (JavaScript/TypeScript)',
  'requirements.txt': 'Python (PyPI)',
  'pyproject.toml': 'Python (PyPI)',
  'setup.py': 'Python (PyPI)',
  'Cargo.toml': 'Rust (crates.io)',
  'go.mod': 'Go (module proxy)',
});

// The capability flags every adapter declares (documented + iterable).
export const CAPABILITY_FLAGS = Object.freeze(['supportsAge', 'supportsDownloads']);

// Lazily-loaded adapter modules. This index is part of the adapter layer, so
// importing siblings respects core ← adapters: the registry must know which
// adapters exist to resolve them.
import npmAdapter from './npm.js';
import pythonAdapter from './python.js';

// The registry: every IMPLEMENTED adapter, in a deterministic order (npm first —
// the dogfood stack). Adding a stack = adding one file + one entry here; the core
// never changes (the whole point of §VIII).
export const ADAPTERS = Object.freeze([npmAdapter, pythonAdapter]);

/**
 * Normalize a `signals` argument into a Set of present manifest filenames. Accepts
 * either { manifests: string[] } or a bare string[]; anything else → an empty set
 * (never throws — junk in → no matches out).
 *
 * @param {{ manifests?: string[] }|string[]|*} signals
 * @returns {Set<string>}
 */
function manifestSet(signals) {
  if (Array.isArray(signals)) return new Set(signals.map(String));
  if (signals && typeof signals === 'object' && Array.isArray(signals.manifests)) {
    return new Set(signals.manifests.map(String));
  }
  return new Set();
}

/**
 * Resolve which IMPLEMENTED adapters match a repo's signals. Returns ALL adapters
 * whose `matches(signals)` is true (a polyglot repo → multiple), and `[]` when
 * none match. PURE.
 *
 * @param {{ manifests?: string[] }|string[]} signals
 * @param {Array<object>} [adapters]
 * @returns {Array<object>} matching adapters in registry order
 */
export function resolveAdapters(signals, adapters = ADAPTERS) {
  const set = manifestSet(signals);
  const sig = { manifests: [...set] };
  const list = Array.isArray(adapters) ? adapters : ADAPTERS;
  const out = [];
  for (const a of list) {
    if (!a || typeof a.matches !== 'function') continue;
    let ok = false;
    try {
      ok = a.matches(sig) === true;
    } catch {
      ok = false; // a misbehaving adapter must not crash resolution (ai-coding §I)
    }
    if (ok) out.push(a);
  }
  return out;
}

/**
 * Name every stack DETECTED from a repo's manifests — INCLUDING stacks with NO
 * implemented adapter (Rust, Go, …). This is the honest-refusal naming source:
 * "detected Rust, no adapter yet". Sorted-unique display names. PURE.
 *
 * @param {{ manifests?: string[] }|string[]} signals
 * @returns {string[]}
 */
export function detectStackNames(signals) {
  const set = manifestSet(signals);
  const names = new Set();
  for (const m of set) {
    if (MANIFEST_STACKS[m]) names.add(MANIFEST_STACKS[m]);
  }
  return [...names].sort();
}

/**
 * The display names of every stack that HAS an implemented adapter (the
 * "supported list" the honest refusal prints). Sorted-unique. PURE.
 *
 * @param {Array<object>} [adapters]
 * @returns {string[]}
 */
export function supportedStackNames(adapters = ADAPTERS) {
  const list = Array.isArray(adapters) ? adapters : ADAPTERS;
  const names = new Set();
  for (const a of list) {
    if (a && typeof a.displayName === 'string') names.add(a.displayName);
  }
  return [...names].sort();
}
