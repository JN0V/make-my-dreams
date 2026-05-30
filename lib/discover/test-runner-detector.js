// lib/discover/test-runner-detector.js — pure test-runner detection from a
// package.json `scripts` block (SPEC_V02K AC-1, L-017).
//
// SRP (universal.md §I.S): map a `scripts` object → a canonical runner name, or
// null. No I/O, no env, no Date — pure and fully unit-testable.
//
// L-017 genesis: `mmd discover` reported "test runner: none" on the MMD repo
// itself because detection only looked at devDependencies + a non-recursive
// top-level test/ heuristic, never at `package.json.scripts` (where MMD declares
// `"test": "node --test ..."`). This closes that false-negative.

/**
 * Ordered (specific → generic) list of [pattern, canonical-name]. The first
 * pattern that matches ANY script value wins. `node --test` is checked first so
 * a repo that runs `node --test` is named precisely. All patterns use word
 * boundaries so a substring inside an unrelated word (e.g. "ava" in "java")
 * never produces a false positive.
 *
 * @type {ReadonlyArray<readonly [RegExp, string]>}
 */
export const RUNNER_PATTERNS = Object.freeze([
  [/\bnode\s+--test\b/, 'node --test'],
  [/\bjest\b/, 'jest'],
  [/\bvitest\b/, 'vitest'],
  [/\bmocha\b/, 'mocha'],
  [/\bplaywright\b/, 'playwright'],
  [/\bcypress\b/, 'cypress'],
  [/\bpytest\b/, 'pytest'],
  [/\bava\b/, 'ava'],
  [/\btape\b/, 'tape'],
  [/\btap\b/, 'tap'],
]);

/**
 * Detect a test runner from a package.json `scripts` object.
 *
 * @param {unknown} scripts  the `scripts` block (any shape — defensively typed)
 * @returns {string|null}    canonical runner name, or null when none matches
 */
export function detectTestRunnerFromScripts(scripts) {
  if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) return null;
  const values = Object.values(scripts).filter((v) => typeof v === 'string');
  for (const [re, name] of RUNNER_PATTERNS) {
    if (values.some((v) => re.test(v))) return name;
  }
  return null;
}
