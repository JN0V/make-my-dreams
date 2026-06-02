// lib/security/deps-adapters/python.js — the Python (PyPI) deps-gate adapter
// (SPEC_V09B AC-2). The PROOF of genericity: a real second-ecosystem adapter that
// makes `mmdream deps-gate` produce a genuine, honest supply-chain report on a Python
// repo — demonstrating the core is ecosystem-neutral, not secretly npm.
//
// ALL the Python assumptions live HERE, NOT in the core (§VIII):
//   - the requirements.txt + pyproject.toml manifests and how to read their deps
//   - requirements.txt line syntax (comments, options like `-r`/`-e`, extras
//     `pkg[extra]`, version specifiers, env markers `; python_version…`)
//   - pyproject's PEP 621 `[project] dependencies` + Poetry `[tool.poetry.
//     dependencies]` shapes (a pragmatic regex read — zero new deps, no TOML lib)
//   - the PyPI JSON URLs and how to map them → normalized metadata
//
// The fetch is isolated behind the INJECTED `fetchJson` seam (offline tests).
// NEVER throws. pyproject parsing is a documented HEURISTIC (not a full TOML
// parser) — honest about what it does not catch (universal §VI / L-024).

// A static seed of high-traffic PyPI names — the typosquat distance is measured to
// THIS list. A HEURISTIC SEED, not exhaustive.
const POPULAR_PYPI = Object.freeze([
  'requests', 'urllib3', 'setuptools', 'six', 'certifi', 'idna', 'chardet',
  'numpy', 'pandas', 'boto3', 'botocore', 'python-dateutil', 'pyyaml', 'flask',
  'django', 'jinja2', 'click', 'werkzeug', 'pytest', 'pip', 'wheel', 'scipy',
  'matplotlib', 'pillow', 'sqlalchemy', 'cryptography', 'attrs', 'packaging',
  'colorama', 'markupsafe', 'pytz', 'aiohttp', 'tornado', 'redis', 'celery',
  'beautifulsoup4', 'lxml', 'openpyxl', 'scikit-learn', 'tensorflow', 'torch',
  'fastapi', 'pydantic', 'starlette', 'uvicorn', 'httpx', 'rich', 'typer',
  'wrapt', 'protobuf', 'grpcio', 'google-api-core', 'docutils', 'psycopg2',
]);

/** A Python dependency manifest we know how to read. setup.py is NOT parsed (its
 * deps are arbitrary Python code, not data) — it only contributes to STACK
 * DETECTION via the registry, not to this adapter's dependency list. */
function isPyManifest(relPath) {
  const p = String(relPath || '');
  return p === 'requirements.txt' || p.endsWith('/requirements.txt')
    || p === 'pyproject.toml' || p.endsWith('/pyproject.toml');
}

/** Normalize a PyPI name for comparison: PyPI treats `_`/`.`/`-` and case as
 * equivalent for lookup (PEP 503), so we lower-case and collapse separators to '-'. */
export function normalizePyName(name) {
  return String(name || '').trim().toLowerCase().replace(/[-_.]+/g, '-');
}

/** Strip an extras suffix + version/marker tail from a requirement, returning the
 * bare project name (or '' if the line declares no package). */
function nameFromRequirement(line) {
  let s = String(line || '').trim();
  if (s === '' || s.startsWith('#')) return '';
  // Strip an inline comment.
  const hash = s.indexOf(' #');
  if (hash >= 0) s = s.slice(0, hash).trim();
  // Skip pip options / editable / includes / URLs / paths.
  if (s.startsWith('-') || s.includes('://') || s.startsWith('.') || s.startsWith('/')) return '';
  // Drop an environment marker (`; python_version < "3.8"`).
  const semi = s.indexOf(';');
  if (semi >= 0) s = s.slice(0, semi).trim();
  // Drop extras: `requests[security]` → `requests`.
  const bracket = s.indexOf('[');
  if (bracket >= 0) s = s.slice(0, bracket).trim();
  // Drop the version specifier (the first operator char onward).
  const m = /^[A-Za-z0-9][A-Za-z0-9._-]*/.exec(s);
  if (!m) return '';
  const name = m[0];
  // A bare URL/path egg already filtered; a remaining `@` (PEP 508 url req) → skip.
  if (s.includes('@')) return '';
  return name;
}

/** Parse a requirements.txt body → bare project names (order-preserving, de-duped). */
function parseRequirements(content) {
  const names = [];
  const seen = new Set();
  for (const raw of String(content || '').split('\n')) {
    const name = nameFromRequirement(raw);
    if (name === '') continue;
    const key = normalizePyName(name);
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

/**
 * Heuristic pyproject.toml dependency extraction (NO TOML lib — zero new deps,
 * L-024). Reads two shapes: PEP 621 `[project] dependencies = ["requests>=2", …]`
 * and Poetry `[tool.poetry.dependencies]` table lines (`requests = "^2"`). Skips
 * the implicit `python` Poetry pin and local/path/git entries. Documented
 * residual: it does not resolve `[project.optional-dependencies]` group tables or
 * dynamic deps (honest about the gap, §VI).
 *
 * @param {string} content
 * @returns {string[]} bare names, de-duped
 */
function parsePyproject(content) {
  const text = String(content || '');
  const lines = text.split('\n');
  const names = [];
  const seen = new Set();
  const add = (n) => {
    if (!n) return;
    const key = normalizePyName(n);
    if (key === 'python') return; // Poetry's interpreter pin, not a package
    if (seen.has(key)) return;
    seen.add(key);
    names.push(n);
  };

  // ── PEP 621: a `dependencies = [ ... ]` array (possibly multi-line). ──
  // We capture from `dependencies = [` to the matching `]` and read each quoted
  // requirement string. Restricted to the [project] table is ideal, but a simple
  // span capture is good enough (Poetry uses a table, not this array form).
  const depArrayRe = /(?:^|\n)\s*dependencies\s*=\s*\[([\s\S]*?)\]/g;
  let m;
  while ((m = depArrayRe.exec(text)) !== null) {
    const body = m[1];
    const strRe = /["']([^"']+)["']/g;
    let s;
    while ((s = strRe.exec(body)) !== null) {
      const n = nameFromRequirement(s[1]);
      if (n) add(n);
    }
  }

  // ── Poetry: a `[tool.poetry.dependencies]` (or .dev-dependencies / .group.*)
  // table of `name = "spec"` lines until the next table header. ──
  let inPoetryDeps = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^\[/.test(line)) {
      inPoetryDeps = /^\[tool\.poetry(?:\.group\.[^\].]+)?\.(?:dev-)?dependencies\]/.test(line)
        || line === '[tool.poetry.dependencies]';
      continue;
    }
    if (!inPoetryDeps || line === '' || line.startsWith('#')) continue;
    const dm = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*=/.exec(line);
    if (!dm) continue;
    // Skip a table/path/git form: `pkg = { path = "…" }` / `{ git = "…" }`.
    const rhs = line.slice(line.indexOf('=') + 1).trim();
    if (/\b(?:path|git|url)\s*=/.test(rhs)) continue;
    add(dm[1]);
  }

  return names;
}

/** ISO/Date string → whole days between then and `now` (ms epoch); null if unparseable. */
function daysAgo(dateStr, now) {
  if (typeof dateStr !== 'string' || dateStr.length === 0) return null;
  const t = Date.parse(dateStr);
  if (!Number.isFinite(t)) return null;
  const ref = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
  const d = Math.floor((ref - t) / 86_400_000);
  return d >= 0 ? d : 0;
}

/** Earliest `upload_time_iso_8601`/`upload_time` across all releases in a PyPI doc
 * → days ago; null if none parseable. */
function earliestReleaseDaysAgo(body, now) {
  const releases = body && typeof body.releases === 'object' && body.releases ? body.releases : null;
  if (!releases) return null;
  let min = Infinity;
  for (const files of Object.values(releases)) {
    if (!Array.isArray(files)) continue;
    for (const f of files) {
      const iso = f && (f.upload_time_iso_8601 || f.upload_time);
      const t = typeof iso === 'string' ? Date.parse(iso) : NaN;
      if (Number.isFinite(t) && t < min) min = t;
    }
  }
  if (!Number.isFinite(min)) return null;
  return daysAgo(new Date(min).toISOString(), now);
}

const pythonAdapter = {
  id: 'python',
  displayName: 'Python (PyPI)',
  registryName: 'pypi.org',
  popularNames: POPULAR_PYPI,

  // PyPI's JSON gives release upload times (age); download stats come from the
  // pypistats endpoint (best-effort). Both signals are attempted.
  supportsAge: true,
  supportsDownloads: true,

  /**
   * Does this repo use Python? Manifest presence: requirements.txt / pyproject.toml
   * / setup.py. PURE.
   * @param {{ manifests?: string[] }} signals
   * @returns {boolean}
   */
  matches(signals) {
    const manifests = signals && Array.isArray(signals.manifests) ? signals.manifests : [];
    return ['requirements.txt', 'pyproject.toml', 'setup.py'].some((m) => manifests.includes(m));
  },

  /**
   * Parse requirements.txt + pyproject.toml into normalized {name, version,
   * manifestFile}. (version is informational; the squat check is name-based.)
   * NEVER throws.
   *
   * @param {{ files?: string[], readFile?: (rel: string) => (string|null) }} args
   * @returns {Array<{name:string, version:string, manifestFile:string}>}
   */
  parseDependencies({ files, readFile } = {}) {
    const all = Array.isArray(files) ? files : [];
    const read = typeof readFile === 'function' ? readFile : () => null;
    const manifests = all
      .map((f) => (typeof f === 'string' ? f : (f && f.path)))
      .filter((p) => typeof p === 'string' && isPyManifest(p))
      .sort();

    const seen = new Set(); // de-dupe by normalized-name|manifest
    const out = [];
    for (const mf of manifests) {
      let content = null;
      try {
        content = read(mf);
      } catch {
        content = null;
      }
      if (typeof content !== 'string') continue;
      const names = mf.endsWith('pyproject.toml') ? parsePyproject(content) : parseRequirements(content);
      for (const name of names) {
        const key = `${normalizePyName(name)}|${mf}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ name, version: '', manifestFile: mf });
      }
    }
    return out;
  },

  /**
   * Fetch normalized PyPI metadata for `name`. NEVER throws — a fetch failure
   * resolves to null (→ honest `unverified`).
   *
   * @param {string} name
   * @param {{ fetchJson?: Function, now?: number, timeoutMs?: number }} deps
   * @returns {Promise<{existsInRegistry:boolean, firstPublishedDaysAgo:number|null, downloads:number|null}|null>}
   */
  async fetchMetadata(name, { fetchJson, now, timeoutMs = 5000 } = {}) {
    if (typeof fetchJson !== 'function' || typeof name !== 'string' || name === '') return null;
    const enc = encodeURIComponent(name);
    let doc;
    try {
      doc = await fetchJson(`https://pypi.org/pypi/${enc}/json`, { timeoutMs });
    } catch {
      return null; // network failure → unverified, never a fabricated pass
    }
    if (!doc || typeof doc !== 'object') return null;
    if (doc.status === 404) return { existsInRegistry: false, firstPublishedDaysAgo: null, downloads: null };
    if (doc.status !== 200 || !doc.body || typeof doc.body !== 'object') return null;

    const firstPublishedDaysAgo = earliestReleaseDaysAgo(doc.body, now);

    // Adoption (best-effort): pypistats recent last-month downloads.
    let downloads = null;
    try {
      const dl = await fetchJson(`https://pypistats.org/api/packages/${enc}/recent`, { timeoutMs });
      const d = dl && dl.status === 200 && dl.body && dl.body.data ? dl.body.data.last_month : null;
      if (typeof d === 'number') downloads = d;
    } catch {
      downloads = null;
    }
    return { existsInRegistry: true, firstPublishedDaysAgo, downloads };
  },
};

export default pythonAdapter;
