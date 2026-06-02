// lib/test-curator/adapters/index.js — the Test Curator's POLYGLOT adapter
// contract + registry (SPEC_V080 AC-1). This is the §VIII fix: MMD's mission is
// to analyze ANY technology, so the Test Curator is a language-NEUTRAL core plus
// per-technology adapters, NOT a JavaScript scanner pretending to be universal.
//
// SRP (universal.md §I.S): this module owns ONLY the contract and the registry —
// which adapter(s) a repo's signals select. The actual discovery lives in each
// adapter (adapters/javascript.js, adapters/python.js …); the analysis lives in
// the core (../redundancy.js, ../report.js). Dependency direction (SPEC §3, DoD
// #4): **core ← adapters ← this index ← the bin**. The core imports NO adapter;
// this index imports the adapters; the bin imports this index. An adapter never
// imports the core.
//
// Pure where possible (AC-1): adapter selection is computed from a passed-in
// `signals` object (manifest presence), so the registry resolution is a pure
// function — no I/O. Each adapter's discoverTests takes an INJECTED file reader,
// so discovery is unit-testable without touching the real filesystem.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE ADAPTER CONTRACT
// ─────────────────────────────────────────────────────────────────────────────
// Every adapter is a plain object implementing:
//
//   id            {string}  stable machine id, e.g. 'javascript', 'python'.
//   displayName   {string}  human stack name, e.g. 'JavaScript/TypeScript'.
//
//   matches(signals) → boolean
//       Does this repo use my stack? Decided from `signals` (manifest presence),
//       NOT from scanning source. PURE.
//
//   discoverTests({ repoRoot, files, readFile }) → {
//       entries: Array<{
//         file:    string,            // repo-relative path
//         line:    number,            // 1-based line of the test declaration
//         title:   string,            // human title / function name
//         stratum: string|null,       // 'smoke'|'unit'|'integration'|'e2e' or null (untagged)
//         body:    string|null,       // test body for similarity, or null if the adapter can't extract it
//         targets: string[]|null,     // repo-relative production modules this test exercises, or null
//       }>,
//       files: Array<{                // per-file metrics
//         path:      string,
//         lineCount: number,
//         testCount: number,
//         targets:   string[],
//       }>,
//   }
//       `files` is the list of ALL git-tracked repo-relative paths; the adapter
//       filters to its OWN test files (its glob is a language concern, so it
//       lives in the adapter). `readFile(relPath) → string|null` is injected by
//       the bin (backed by fs); a test passes a fake. NEVER throws — junk in →
//       empty-ish out (ai-coding §I: a discovery that threw on one odd file would
//       hide the whole corpus's signal).
//
//   CAPABILITY FLAGS (the §VI honesty mechanism — SPEC AC-3):
//   supportsBodies          {boolean}  can it extract a test body for near-duplicate
//                                       (body-similarity) detection?
//   supportsStratification  {boolean}  does the stack have a stratification convention
//                                       the adapter reads into `stratum`?
//   supportsCoverage        {boolean}  can it produce coverage? (deferred for ALL
//                                       adapters in v0.8.0 — see ADR; will be polyglot)
//
//   When an adapter declares a capability `false`, the core renders an HONEST
//   "not available for the <stack> adapter" note for that section — never a
//   silent empty that reads as "clean" (§VI).

// ── Manifest → human stack name ──────────────────────────────────────────────
// Used for HONEST detection naming, independent of whether an adapter exists for
// the stack. This is what lets AC-4's refusal say "no adapter for Rust yet" by
// NAME even though there is no Rust adapter to ask. A manifest absent here is an
// unknown stack (named generically at the call site).
export const MANIFEST_STACKS = Object.freeze({
  'package.json': 'JavaScript/TypeScript',
  'pyproject.toml': 'Python',
  'setup.py': 'Python',
  'requirements.txt': 'Python',
  'Cargo.toml': 'Rust',
  'go.mod': 'Go',
});

// The capability flags every adapter declares (documented + iterable, so the
// core/report can ask each adapter uniformly — DRY).
export const CAPABILITY_FLAGS = Object.freeze([
  'supportsBodies',
  'supportsStratification',
  'supportsCoverage',
]);

// Lazily-loaded adapter modules. We import them here (this index is part of the
// adapter layer, so importing siblings respects core ← adapters): the registry
// must know which adapters exist to resolve them.
import javascriptAdapter from './javascript.js';
import pythonAdapter from './python.js';

// The registry: every IMPLEMENTED adapter, in a deterministic order (JS first —
// it is the dogfood stack and the AC-2 regression lock). Adding a stack = adding
// one file + one entry here; the core never changes (the whole point of §VIII).
export const ADAPTERS = Object.freeze([javascriptAdapter, pythonAdapter]);

/**
 * Normalize a `signals` argument into a Set of present manifest filenames.
 * Accepts either { manifests: string[] } or a bare string[]; anything else → an
 * empty set (never throws — junk in → no matches out).
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
 * none match. PURE — selection is a function of the passed-in signals only.
 *
 * @param {{ manifests?: string[] }|string[]} signals  manifest presence
 * @param {Array<object>} [adapters]  the registry (overridable for tests)
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
 * Name every stack DETECTED from a repo's manifests — including stacks with NO
 * implemented adapter (Rust, Go, …). This is the honest-refusal naming source
 * (AC-4): "detected Rust, no adapter yet". Sorted-unique display names. PURE.
 *
 * @param {{ manifests?: string[] }|string[]} signals
 * @returns {string[]} sorted unique human stack names
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
