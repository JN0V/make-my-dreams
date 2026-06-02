// lib/security/deps-assess.js — the PURE, language-NEUTRAL dependency-risk core
// (SPEC_V09B AC-1). The second Bundle A Security brick (MAKE_MY_DREAMS §6.6): catch
// a poisoned dependency BEFORE it is installed.
//
// `assessDependency({ name, declared, metadata, popularNames, opts })` returns
//   { name, findings: [{ rule, severity, detail }] }
// from the NORMALIZED facts an ecosystem adapter produced — a name, the declared
// version, and the registry metadata `{ existsInRegistry, firstPublishedDaysAgo,
// downloads }`. It is:
//   - PURE: no I/O, no network, no globals, no time/random — deterministic. NEVER
//     throws (garbage in → `{ name, findings: [] }`).
//   - §VIII TECHNOLOGY-NEUTRAL (the heart of this slice): it contains NO
//     ecosystem syntax (no `package.json`/`requirements.txt` knowledge) and
//     imports NO adapter. Dependency direction (SPEC §3): core ← adapters ←
//     registry ← bin. The core only ever sees the adapter's normalized facts, so a
//     JS-on-Rust style fabrication is structurally impossible here.
//   - PRECISION-FIRST (a deps gate that cries wolf gets bypassed — L-023): exactly
//     TWO findings GATE (`severity:'high'`): `unresolvable` (the registry has no
//     such package) and `likely-typosquat` (the CONJUNCTION — near a popular name
//     AND brand-new AND barely-downloaded, all three). Each of those three signals
//     ALONE is `severity:'medium'` advisory. This mirrors secret-scan's "format
//     rules gate, generic-entropy stays advisory" precisely.
//   - HONEST DEGRADATION (§VI): a null/failed `metadata` → a single `unverified`
//     `medium` — never a fabricated pass and never a fabricated fail. MMD must
//     neither block a build because the network blinked nor wave a dep through
//     unverified pretending it was checked.
//
// Zero dependencies (the L-024 vanilla-stack bar): edit distance is a small
// hand-rolled Levenshtein; no `semver`, no registry-client lib.

/** Default edit-distance to a popular name that counts as "near" (the typosquat
 * radius). Distance 0 is an EXACT match — a popular package itself, never a squat. */
export const DEFAULT_TYPO_DISTANCE = 2;

/** Default "very new" cutoff: first published fewer than this many days ago. */
export const DEFAULT_MIN_AGE_DAYS = 30;

/** Default "low adoption" cutoff: fewer than this many downloads. */
export const DEFAULT_MIN_DOWNLOADS = 1000;

/** Stable rule ids (also the `rule` field on a finding). The two HIGH (gating)
 * rules are UNRESOLVABLE and LIKELY_TYPOSQUAT; the rest are MEDIUM advisories. */
export const RULES = Object.freeze({
  UNRESOLVABLE: 'unresolvable',
  LIKELY_TYPOSQUAT: 'likely-typosquat',
  NEAR_POPULAR_NAME: 'near-popular-name',
  VERY_NEW: 'very-new',
  LOW_ADOPTION: 'low-adoption',
  UNVERIFIED: 'unverified',
});

/** A strictly-positive integer override, else the fallback. */
function posInt(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

/** A non-negative finite override (0 disables the threshold), else the fallback. */
function nonNegNum(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
}

/**
 * Levenshtein edit distance between `a` and `b`, bounded by `cap`: as soon as the
 * minimum achievable distance exceeds `cap` we return `cap + 1` (so callers can
 * cheaply ask "is it within the typosquat radius?" without the full matrix). A
 * length difference greater than `cap` is an immediate `cap + 1`. PURE; a
 * non-string argument → Infinity (never throws).
 *
 * @param {string} a
 * @param {string} b
 * @param {number} [cap]
 * @returns {number}
 */
export function editDistance(a, b, cap = Infinity) {
  if (typeof a !== 'string' || typeof b !== 'string') return Infinity;
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > cap) return cap + 1;
  if (la === 0) return lb;
  if (lb === 0) return la;
  let prev = new Array(lb + 1);
  let curr = new Array(lb + 1);
  for (let j = 0; j <= lb; j += 1) prev[j] = j;
  for (let i = 1; i <= la; i += 1) {
    curr[0] = i;
    let rowMin = curr[0];
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j += 1) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      const d = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      curr[j] = d;
      if (d < rowMin) rowMin = d;
    }
    if (rowMin > cap) return cap + 1; // bounded early exit — can only grow
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[lb];
}

/**
 * The nearest popular name to `name` within `cap`, or null distance Infinity if
 * none. A blank/odd entry in the seed list is skipped. PURE.
 *
 * @param {string} name
 * @param {string[]} popularNames
 * @param {number} cap
 * @returns {{ name: string|null, distance: number }}
 */
function nearestPopular(name, popularNames, cap) {
  let best = null;
  let bestDist = Infinity;
  for (const p of popularNames) {
    if (typeof p !== 'string' || p.length === 0) continue;
    const d = editDistance(name, p, cap);
    if (d < bestDist) {
      bestDist = d;
      best = p;
      if (d === 0) break; // exact match — cannot do better
    }
  }
  return { name: best, distance: bestDist };
}

/**
 * Assess one normalized dependency for supply-chain risk. PURE; never throws.
 *
 * @param {{
 *   name?: string,
 *   declared?: string,                // the declared version/spec (informational)
 *   metadata?: { existsInRegistry?: boolean, firstPublishedDaysAgo?: number|null, downloads?: number|null } | null,
 *   popularNames?: string[],          // the ecosystem's popular-name seed (from the adapter)
 *   opts?: { typoDistance?: number, minAgeDays?: number, minDownloads?: number },
 * }} input
 * @returns {{ name: string, findings: Array<{rule:string, severity:'high'|'medium', detail:string}> }}
 */
export function assessDependency(input) {
  const out = { name: '', findings: [] };
  if (!input || typeof input !== 'object') return out;
  const name = typeof input.name === 'string' ? input.name : '';
  out.name = name;
  if (name === '') return out;

  const opts = input.opts && typeof input.opts === 'object' ? input.opts : {};
  const typoDistance = posInt(opts.typoDistance, DEFAULT_TYPO_DISTANCE);
  const minAgeDays = nonNegNum(opts.minAgeDays, DEFAULT_MIN_AGE_DAYS);
  const minDownloads = nonNegNum(opts.minDownloads, DEFAULT_MIN_DOWNLOADS);
  const popularNames = Array.isArray(input.popularNames) ? input.popularNames : [];

  const metadata = input.metadata;

  // ── Honest degradation (§VI): a null/failed metadata is UNVERIFIED, not a pass.
  if (metadata == null || typeof metadata !== 'object') {
    out.findings.push({
      rule: RULES.UNVERIFIED,
      severity: 'medium',
      detail: `registry metadata unavailable for "${name}" — NOT verified (fetch failed, timed out, or offline). Advisory, not a pass.`,
    });
    return out;
  }

  // ── The package does not exist in its registry → unresolvable (HIGH, gates).
  if (metadata.existsInRegistry === false) {
    out.findings.push({
      rule: RULES.UNRESOLVABLE,
      severity: 'high',
      detail: `"${name}" does not exist in its ecosystem registry — unresolvable (a broken, removed, or never-published dependency).`,
    });
    return out;
  }

  // Anything other than an explicit `true` means the registry did not confirm
  // existence → honest UNVERIFIED (never invent a confirmation we don't have).
  if (metadata.existsInRegistry !== true) {
    out.findings.push({
      rule: RULES.UNVERIFIED,
      severity: 'medium',
      detail: `registry did not confirm "${name}" exists — NOT verified. Advisory, not a pass.`,
    });
    return out;
  }

  // ── Exists: evaluate the three typosquat signals. ──────────────────────────
  const { name: nearest, distance } = nearestPopular(name, popularNames, typoDistance);
  // "near" = within the radius but NOT an exact match (distance 0 = a popular
  // package itself, which is healthy, never a squat).
  const nearPopular = nearest !== null && distance >= 1 && distance <= typoDistance;

  const age =
    typeof metadata.firstPublishedDaysAgo === 'number' && Number.isFinite(metadata.firstPublishedDaysAgo)
      ? metadata.firstPublishedDaysAgo
      : null;
  const dls =
    typeof metadata.downloads === 'number' && Number.isFinite(metadata.downloads)
      ? metadata.downloads
      : null;
  const veryNew = age !== null && age < minAgeDays;
  const lowAdoption = dls !== null && dls < minDownloads;

  // The CONJUNCTION (all three) → likely-typosquat (HIGH, gates). This is the
  // single high-confidence slopsquat signal; one signal alone is too FP-prone.
  if (nearPopular && veryNew && lowAdoption) {
    out.findings.push({
      rule: RULES.LIKELY_TYPOSQUAT,
      severity: 'high',
      detail: `"${name}" is edit-distance ${distance} from the popular package "${nearest}", first published ${age} day(s) ago with only ${dls} download(s) — a likely typosquat/slopsquat (near-popular AND new AND low-adoption).`,
    });
    return out;
  }

  // Otherwise each PRESENT signal alone is a MEDIUM advisory (does not gate).
  if (nearPopular) {
    out.findings.push({
      rule: RULES.NEAR_POPULAR_NAME,
      severity: 'medium',
      detail: `"${name}" is edit-distance ${distance} from the popular package "${nearest}" — advisory (name-similarity alone is FP-prone; not gating).`,
    });
  }
  if (veryNew) {
    out.findings.push({
      rule: RULES.VERY_NEW,
      severity: 'medium',
      detail: `"${name}" was first published ${age} day(s) ago (< ${minAgeDays}) — advisory (newness alone is not gating).`,
    });
  }
  if (lowAdoption) {
    out.findings.push({
      rule: RULES.LOW_ADOPTION,
      severity: 'medium',
      detail: `"${name}" has ${dls} download(s) (< ${minDownloads}) — advisory (low adoption alone is not gating).`,
    });
  }
  return out;
}

/**
 * Gate decision over a list of per-dependency results: exit 1 iff ANY finding is
 * `high`, else 0. Mirrors secret-scan: the high-confidence rules gate; the medium
 * advisories never change the exit code. PURE; non-array → 0.
 *
 * @param {Array<{findings?: Array<{severity?: string}>}>} results
 * @returns {0|1}
 */
export function gateExit(results) {
  if (!Array.isArray(results)) return 0;
  for (const r of results) {
    const findings = r && Array.isArray(r.findings) ? r.findings : [];
    for (const f of findings) {
      if (f && f.severity === 'high') return 1;
    }
  }
  return 0;
}
