// lib/skills/_common/redact-env.js — redact sensitive env-var values before
// they are printed by `--dry-run` previews (F1, Phase-4 adversarial review).
//
// SRP (universal.md §I.S): pure transformation — takes a string→string map,
// returns a new map with sensitive values replaced by '<redacted>'. No I/O,
// no env reads — the caller supplies the object.
//
// Security (security.md §I.A03 + the F1 finding): users routinely paste
// dry-run output into bug reports / Slack / GitHub issues. ANTHROPIC_API_KEY
// is allowlisted by buildSubprocessEnv() (so the CHILD claude process can
// authenticate), but its VALUE must never appear in dry-run stdout. Same
// goes for any *_TOKEN / *_SECRET / *_KEY / *_PASSWORD / *_PASS / *API_KEY*
// / *SECRET* / *TOKEN* / *PASSWORD* variable that happens to be passed
// through (e.g. CLAUDE_AUTH_TOKEN, MMD_USER_API_KEY, ...).
//
// Matching is CASE-INSENSITIVE — POSIX env vars are conventionally uppercase
// but we don't rely on that.

const SENSITIVE_EXACT = new Set(['ANTHROPIC_API_KEY']);

// Suffix matchers (`endsWith`, case-insensitive) — covers most secret naming
// conventions: GITHUB_TOKEN, NPM_TOKEN, FOO_SECRET, BAR_API_KEY, MY_PASSWORD,
// SUDO_PASS, ...
const SENSITIVE_SUFFIXES = ['_TOKEN', '_SECRET', '_KEY', '_PASSWORD', '_PASS'];

// Substring matchers (`includes`, case-insensitive) — catches awkward names
// that don't follow the suffix convention (e.g. APIKEY_PROD, SECRETS_BUNDLE).
const SENSITIVE_SUBSTRINGS = ['API_KEY', 'SECRET', 'TOKEN', 'PASSWORD'];

/**
 * Return true iff `name` should be redacted.
 *
 * @param {string} name
 * @returns {boolean}
 */
export function isSensitiveEnvKey(name) {
  if (typeof name !== 'string' || name.length === 0) return false;
  const upper = name.toUpperCase();
  if (SENSITIVE_EXACT.has(upper)) return true;
  for (const sfx of SENSITIVE_SUFFIXES) {
    if (upper.endsWith(sfx)) return true;
  }
  for (const sub of SENSITIVE_SUBSTRINGS) {
    if (upper.includes(sub)) return true;
  }
  return false;
}

/**
 * Produce a shallow copy of `envObject` with sensitive VALUES replaced by
 * `<redacted>`. Non-sensitive keys (PATH, HOME, MMD_*, CLAUDE_* without a
 * secret-shaped name, ...) pass through verbatim.
 *
 * Defensive: when `envObject` is null/undefined/non-object, returns `{}`.
 *
 * @param {Record<string, string> | null | undefined} envObject
 * @returns {Record<string, string>}
 */
export function redactSensitiveEnv(envObject) {
  if (!envObject || typeof envObject !== 'object') return {};
  const out = {};
  for (const k of Object.keys(envObject)) {
    out[k] = isSensitiveEnvKey(k) ? '<redacted>' : envObject[k];
  }
  return out;
}
