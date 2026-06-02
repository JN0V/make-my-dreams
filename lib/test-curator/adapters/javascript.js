// lib/test-curator/adapters/javascript.js — the JavaScript/TypeScript Test
// Curator adapter (SPEC_V080 AC-2). This is the EXISTING scan / extract-bodies /
// `@`-tag / target logic, moved behind the polyglot adapter contract with NO
// behavior change for a JS repo: it delegates to the unchanged JS-internal
// scanner (../scan.js, which uses ../extract-bodies.js) and normalizes the output
// to the language-neutral entry shape the core consumes.
//
// ALL the JavaScript assumptions live HERE (and in its JS-internal helpers
// ../scan.js + ../extract-bodies.js), NOT in the core (§VIII / DoD #4):
//   - `test(` / `it(` call detection                  → ../scan.js
//   - the `@smoke/@unit/@integration/@e2e` tag convention → ../scan.js
//   - `import` / `require` module syntax + lib/bin targets → ../extract-bodies.js
//   - brace-matched test bodies                        → ../extract-bodies.js
//   - the `*.test.js` glob + the test/fixtures/ exclusion (below)
//
// scan.js / extract-bodies.js are now JS-ADAPTER-INTERNAL (SPEC §3): only this
// adapter imports them. The core (../redundancy.js, ../report.js) imports neither.
//
// AC-2 regression lock: discovering MMD's own corpus through this adapter yields
// the SAME tests/strata/targets/bodies as the v0.7.8 scanner — the only change is
// the field rename (`tag` → `stratum`, where 'untagged' becomes null), which the
// core understands generically.

import { scanTestCorpus } from '../scan.js';

// JS test files are `*.test.js`. The test/fixtures/ tree is EXCLUDED — those are
// inputs to the discover tests, not MMD's own corpus (v0.7.6 contract, preserved
// byte-for-byte for AC-2). This glob is a JavaScript concern, so it lives in the
// adapter, not the core.
function isJsTestFile(relPath) {
  const p = String(relPath || '');
  return p.endsWith('.test.js') && !p.includes('test/fixtures/');
}

/**
 * Map the JS scanner's `tag` (one of the four strata or the string 'untagged')
 * to the normalized `stratum` (the stratum value, or null for untagged). This is
 * the ONLY shape change between the legacy scan and the polyglot entry — the core
 * treats `stratum === null` as untagged for ANY adapter.
 *
 * @param {string} tag
 * @returns {string|null}
 */
function stratumOf(tag) {
  return tag === 'untagged' || tag == null ? null : tag;
}

const javascriptAdapter = {
  id: 'javascript',
  displayName: 'JavaScript/TypeScript',

  // Capability flags (the §VI honesty mechanism). The JS adapter can extract
  // bodies (brace-matched) and stratify (`@`-tags). Coverage is deferred for ALL
  // adapters in v0.8.0 (will be polyglot per the ADR), so it is false here too.
  supportsBodies: true,
  supportsStratification: true,
  supportsCoverage: false,

  /**
   * Does this repo use JavaScript/TypeScript? Decided from manifest presence
   * (package.json), per AC-1. PURE.
   * @param {{ manifests?: string[] }} signals
   * @returns {boolean}
   */
  matches(signals) {
    const manifests = signals && Array.isArray(signals.manifests) ? signals.manifests : [];
    return manifests.includes('package.json');
  },

  /**
   * Discover the JS test corpus. Filters the tracked-file list to `*.test.js`
   * (fixtures excluded), reads each via the injected reader, runs the unchanged
   * JS scanner, and normalizes to the contract entry shape. NEVER throws.
   *
   * @param {{ repoRoot?: string, files?: string[], readFile?: (rel: string) => (string|null) }} args
   * @returns {{ entries: object[], files: object[] }}
   */
  discoverTests({ files, readFile } = {}) {
    const all = Array.isArray(files) ? files : [];
    const read = typeof readFile === 'function' ? readFile : () => null;

    const rels = all
      .map((f) => (typeof f === 'string' ? f : (f && f.path)))
      .filter((p) => typeof p === 'string' && isJsTestFile(p))
      .sort(); // deterministic order (matches the v0.7.6 git ls-files + sort)

    const pairs = rels.map((rel) => {
      let content = null;
      try {
        content = read(rel);
      } catch {
        content = null; // unreadable → scan records a zero-metric file (honest)
      }
      return { path: rel, content: typeof content === 'string' ? content : null };
    });

    const scan = scanTestCorpus(pairs);

    const entries = scan.tests.map((t) => ({
      file: t.file,
      line: t.line,
      title: t.title,
      stratum: stratumOf(t.tag),
      body: typeof t.body === 'string' ? t.body : null,
      targets: Array.isArray(t.targets) ? t.targets : null,
    }));
    const fileMetrics = scan.files.map((f) => ({
      path: f.path,
      lineCount: f.lineCount,
      testCount: f.testCount,
      targets: Array.isArray(f.targets) ? f.targets : [],
    }));

    return { entries, files: fileMetrics };
  },
};

export default javascriptAdapter;
