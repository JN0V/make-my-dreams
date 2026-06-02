// lib/security/deps-adapters/npm.js — the npm (JavaScript/TypeScript) deps-gate
// adapter (SPEC_V09B AC-2). Parses package.json dependencies + devDependencies and
// fetches per-package metadata from the public npm registry. One of the two REAL
// adapters that prove the polyglot shape (the v0.8.x JS-then-Python pattern).
//
// ALL the npm assumptions live HERE, NOT in the core (§VIII):
//   - the package.json manifest + its deps/devDeps fields
//   - which version specifiers are NON-registry (file:/link:/workspace:/git/path/
//     URL/github-shorthand) and so must be SKIPPED (no `unresolvable` false
//     positive, AC-4)
//   - the registry URLs (registry.npmjs.org for existence+age, api.npmjs.org for
//     last-month downloads) and how to map their JSON → the normalized metadata
//
// The fetch is isolated behind the INJECTED `fetchJson` seam — adapters never call
// `fetch` directly, so every test runs offline. NEVER throws.

// A small, static seed of high-traffic npm names. The typosquat distance is
// measured to THIS list. It is a HEURISTIC SEED, deliberately NOT an exhaustive
// index (documented in the ADR) — adding to it only widens the squat radar.
const POPULAR_NPM = Object.freeze([
  'react', 'react-dom', 'lodash', 'express', 'chalk', 'commander', 'axios',
  'request', 'debug', 'async', 'moment', 'webpack', 'babel-core', 'eslint',
  'typescript', 'jest', 'mocha', 'chai', 'vue', 'angular', 'rxjs', 'redux',
  'next', 'dotenv', 'uuid', 'classnames', 'prop-types', 'styled-components',
  'cross-env', 'rimraf', 'glob', 'minimist', 'yargs', 'semver', 'colors',
  'underscore', 'bluebird', 'node-fetch', 'cheerio', 'socket.io', 'mongoose',
  'mysql', 'pg', 'redis', 'jsonwebtoken', 'bcrypt', 'passport', 'cors',
  'body-parser', 'morgan', 'nodemon', 'prettier', 'ws', 'fastify', 'koa',
]);

/** A package.json file among the tracked paths (root or nested). node_modules is
 * never git-tracked, so we needn't exclude it explicitly. */
function isPackageJson(relPath) {
  const p = String(relPath || '');
  return p === 'package.json' || p.endsWith('/package.json');
}

/** A valid npm registry package name (scoped `@scope/name` or plain). We use this
 * to skip obviously-non-package keys; the registry is the real authority. */
function isRegistryName(name) {
  if (typeof name !== 'string' || name.length === 0 || name.length > 214) return false;
  return /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i.test(name);
}

/** True if the version specifier is NOT a plain registry version — a local path,
 * a workspace/file/link protocol, a git/URL/github-shorthand source. These are not
 * registry packages, so we skip them (no `unresolvable` false positive, AC-4). */
function isNonRegistrySpecifier(version) {
  const v = String(version == null ? '' : version).trim();
  if (v === '') return false; // empty → let the registry decide (rare)
  if (/^(?:file|link|workspace|portal|git|git\+\w+|github|gitlab|bitbucket|http|https|npm):/i.test(v)) return true;
  if (v.startsWith('.') || v.startsWith('/') || v.startsWith('~/')) return true;
  if (v.includes('://')) return true;
  // `user/repo` github shorthand (a slash with no protocol and no version operators).
  if (/^[\w.-]+\/[\w.-]+(?:#.+)?$/.test(v) && !v.startsWith('@')) return true;
  return false;
}

/** ISO/Date string → whole days between then and `now` (ms epoch); null if unparseable. */
function daysAgo(dateStr, now) {
  if (typeof dateStr !== 'string' || dateStr.length === 0) return null;
  const t = Date.parse(dateStr);
  if (!Number.isFinite(t)) return null;
  const ref = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
  const d = Math.floor((ref - t) / 86_400_000);
  return d >= 0 ? d : 0; // a clock-skew future date → 0, never negative
}

const npmAdapter = {
  id: 'npm',
  displayName: 'npm (JavaScript/TypeScript)',
  registryName: 'registry.npmjs.org',
  popularNames: POPULAR_NPM,

  // npm reports both an age (registry `time.created`) and downloads (the
  // api.npmjs.org point endpoint), so both signals are available.
  supportsAge: true,
  supportsDownloads: true,

  /**
   * Does this repo use npm? Manifest presence: package.json. PURE.
   * @param {{ manifests?: string[] }} signals
   * @returns {boolean}
   */
  matches(signals) {
    const manifests = signals && Array.isArray(signals.manifests) ? signals.manifests : [];
    return manifests.includes('package.json');
  },

  /**
   * Parse every package.json's dependencies + devDependencies into normalized
   * {name, version, manifestFile}, skipping non-registry specifiers. NEVER throws.
   *
   * @param {{ files?: string[], readFile?: (rel: string) => (string|null) }} args
   * @returns {Array<{name:string, version:string, manifestFile:string}>}
   */
  parseDependencies({ files, readFile } = {}) {
    const all = Array.isArray(files) ? files : [];
    const read = typeof readFile === 'function' ? readFile : () => null;
    const manifests = all
      .map((f) => (typeof f === 'string' ? f : (f && f.path)))
      .filter((p) => typeof p === 'string' && isPackageJson(p))
      .sort();

    const seen = new Set(); // de-dupe by name|manifest
    const out = [];
    for (const mf of manifests) {
      let content = null;
      try {
        content = read(mf);
      } catch {
        content = null;
      }
      if (typeof content !== 'string') continue;
      let json;
      try {
        json = JSON.parse(content);
      } catch {
        continue; // a malformed manifest is not parseable — skip it (honest, no crash)
      }
      if (!json || typeof json !== 'object') continue;
      for (const field of ['dependencies', 'devDependencies']) {
        const deps = json[field];
        if (!deps || typeof deps !== 'object') continue;
        for (const name of Object.keys(deps)) {
          if (!isRegistryName(name)) continue;
          const version = deps[name];
          if (isNonRegistrySpecifier(version)) continue;
          const key = `${name}|${mf}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ name, version: String(version == null ? '' : version), manifestFile: mf });
        }
      }
    }
    return out;
  },

  /**
   * Fetch normalized registry metadata for `name`. NEVER throws — a fetch failure
   * resolves to null (the core then emits an honest `unverified`).
   *
   * @param {string} name
   * @param {{ fetchJson?: Function, now?: number, timeoutMs?: number }} deps
   * @returns {Promise<{existsInRegistry:boolean, firstPublishedDaysAgo:number|null, downloads:number|null}|null>}
   */
  async fetchMetadata(name, { fetchJson, now, timeoutMs = 5000 } = {}) {
    if (typeof fetchJson !== 'function' || typeof name !== 'string' || name === '') return null;
    const enc = encodeURIComponent(name).replace(/^%40/, '@'); // keep a leading @scope readable
    let doc;
    try {
      doc = await fetchJson(`https://registry.npmjs.org/${enc}`, { timeoutMs });
    } catch {
      return null; // network failure / timeout → unverified, never a fabricated pass
    }
    if (!doc || typeof doc !== 'object') return null;
    if (doc.status === 404) return { existsInRegistry: false, firstPublishedDaysAgo: null, downloads: null };
    if (doc.status !== 200 || !doc.body || typeof doc.body !== 'object') return null;

    const created = doc.body.time && typeof doc.body.time === 'object' ? doc.body.time.created : null;
    const firstPublishedDaysAgo = daysAgo(created, now);

    // Adoption (best-effort second call): a failure here leaves downloads null but
    // the package still exists — we don't lose the existence signal over it.
    let downloads = null;
    try {
      const dl = await fetchJson(`https://api.npmjs.org/downloads/point/last-month/${enc}`, { timeoutMs });
      if (dl && dl.status === 200 && dl.body && typeof dl.body.downloads === 'number') {
        downloads = dl.body.downloads;
      }
    } catch {
      downloads = null;
    }
    return { existsInRegistry: true, firstPublishedDaysAgo, downloads };
  },
};

export default npmAdapter;
