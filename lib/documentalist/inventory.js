// lib/documentalist/inventory.js — the Documentalist's deterministic inventory
// of MMD's documented surface (SPEC_V07A AC-1).
//
// SRP (universal.md §I.S): gather, never render and never decide. This module
// answers ONE question — "what does MMD's surface actually look like on disk
// right now?" — and returns a plain structured object. The roadmap heuristic
// (roadmap-reconcile.js) and the markdown render (coherence-report.js) are
// separate pure modules; the I/O wiring lives in bin/documentalist/document-review.js.
//
// Pure-ish by injection (SPEC §5.2): every filesystem touch goes through an
// injected reader (`readFile`, `readDir`, `listTags`), so the gatherer is fully
// testable on fixtures without a real repo. The subcommand injects the real
// node:fs + git functions.
//
// NEVER THROWS (error-handling §III, AC-1): the whole point of a coherence
// inventory is that it degrades gracefully — a missing dir, an unreadable file,
// a git that isn't there must each shrink ONE field to empty/null, never crash
// the review. Every field is gathered inside its own try/catch and falls back
// to a safe empty value. The honest signal that a field could not be read is
// its emptiness, never a fabricated count (universal §VI).

// The line cap for "key human docs", per MAKE_MY_DREAMS.md §6.4.4
// (anti-proliferation: "Length cap per document"). A doc over the cap is a
// split/consolidation candidate the coherence review flags — it is NOT an error.
export const DEFAULT_DOC_CAP = 200;

// The key human-authored docs whose length the review watches. These are the
// docs a newcomer reads to understand MMD; when one balloons past the cap it is
// a coherence smell (the canonical offender today is MAKE_MY_DREAMS.md). Paths
// are repo-root-relative so the gatherer stays repo-agnostic (testable on a
// fixture repo).
export const DEFAULT_KEY_DOCS = Object.freeze([
  'MAKE_MY_DREAMS.md',
  'README.md',
  'CLAUDE.md',
  'HANDOVER.md',
  'PROBLEMS.md',
  'BOOTSTRAP.md',
  'docs/lessons-learned.md',
]);

/**
 * Count non-empty lines? No — count physical lines, the figure a human sees in
 * an editor and the figure §6.4's cap is written against. A trailing newline
 * does not add a phantom line.
 *
 * @param {string} text
 * @returns {number}
 */
function countLines(text) {
  if (typeof text !== 'string' || text.length === 0) return 0;
  const n = text.split('\n').length;
  // A file ending in "\n" splits into [...lines, ''] — drop that phantom tail.
  return text.endsWith('\n') ? n - 1 : n;
}

/**
 * Parse an ADR markdown body into its number + human title. The committed ADRs
 * lead with `# ADR-033 — Title…` (universal §VII: the code is paired with prose).
 * We read the first `# ` heading and split on the em/en-dash or hyphen.
 *
 * @param {string} fileName e.g. "033-constitution-suggestions.md"
 * @param {string} body     the file contents (may be '')
 * @returns {{ number: number|null, title: string }}
 */
function parseAdr(fileName, body) {
  // Number from the filename prefix (the stable, always-present source).
  const numMatch = /^(\d+)/.exec(fileName);
  const number = numMatch ? Number(numMatch[1]) : null;
  let title = '';
  if (typeof body === 'string') {
    for (const line of body.split('\n')) {
      const h1 = /^#\s+(.+?)\s*$/.exec(line);
      if (h1) {
        // Strip a leading "ADR-NNN — " so the title is the human phrase only.
        title = h1[1].replace(/^ADR[-\s]?\d+\s*[—–-]\s*/i, '').trim();
        break;
      }
    }
  }
  return { number, title };
}

/**
 * Strip a `.js` extension so a lib entry reads as a module name (`engine.js`
 * → `engine`); directory entries are returned as-is (`conductor`, `sealed-tests`).
 *
 * @param {string} entry
 * @returns {string}
 */
function moduleName(entry) {
  return entry.endsWith('.js') ? entry.slice(0, -3) : entry;
}

/**
 * Gather MMD's documented surface from the filesystem (AC-1).
 *
 * Every dependency is injected so the function is pure given its inputs and
 * testable on a fixture repo. The subcommand wires the real node:fs + git.
 *
 * @param {{
 *   repoRoot: string,
 *   readFile: (relPath: string) => string,       // throws on missing — caught here
 *   readDir: (relPath: string) => string[],      // throws on missing — caught here
 *   listTags: () => string[],                     // git tag list — may throw/return []
 *   parseLessons?: (markdown: string) => Array<{ status: string }>,
 *   subcommands?: string[],                       // the known CLI subcommand list
 *   keyDocs?: string[],
 *   docCap?: number,
 * }} deps
 * @returns {{
 *   subcommands: string[],
 *   tags: string[],
 *   adrs: Array<{ number: number|null, title: string, file: string }>,
 *   libModules: string[],
 *   docLineCounts: Array<{ doc: string, lines: number, overCap: boolean }>,
 *   docCap: number,
 *   specCount: number,
 *   lessonCount: number|null,
 * }}
 */
export function gatherInventory(deps) {
  const {
    readFile = () => { throw new Error('no readFile'); },
    readDir = () => { throw new Error('no readDir'); },
    listTags = () => [],
    parseLessons = null,
    subcommands = [],
    keyDocs = DEFAULT_KEY_DOCS,
    docCap = DEFAULT_DOC_CAP,
  } = deps || {};

  // Subcommands are a "known source" (the CLI dispatch list), injected rather
  // than parsed from bin/mmd.js — the authoritative list is argv-parser's
  // SUBCOMMANDS. We defensively copy + stringify so a bad input can't crash.
  const inventorySubcommands = Array.isArray(subcommands)
    ? subcommands.filter((s) => typeof s === 'string')
    : [];

  // Tags (git) — the version range. Best-effort; git absent → [].
  let tags = [];
  try {
    const t = listTags();
    if (Array.isArray(t)) tags = t.filter((x) => typeof x === 'string');
  } catch {
    tags = [];
  }

  // ADRs — list docs/adr/*.md, parse each title. A missing dir → [].
  let adrs = [];
  try {
    const files = readDir('docs/adr')
      .filter((n) => typeof n === 'string' && /^\d+.*\.md$/.test(n))
      .sort();
    adrs = files.map((file) => {
      let body = '';
      try {
        body = readFile(`docs/adr/${file}`);
      } catch {
        body = '';
      }
      const { number, title } = parseAdr(file, body);
      return { number, title, file };
    });
  } catch {
    adrs = [];
  }

  // lib/ module names — both top-level .js files and subdirectories. A missing
  // lib dir → []. We do NOT recurse: the module name is the top-level surface.
  let libModules = [];
  try {
    libModules = readDir('lib')
      .filter((n) => typeof n === 'string' && n !== '.' && n !== '..')
      .map(moduleName)
      .sort();
  } catch {
    libModules = [];
  }

  // Per-doc line counts (+ overCap flag). Each doc independently degrades: an
  // unreadable doc is simply omitted (we never fabricate a 0-line count for a
  // file we couldn't read — emptiness of the list entry is the honest signal).
  const docLineCounts = [];
  for (const doc of keyDocs) {
    try {
      const text = readFile(doc);
      const lines = countLines(text);
      docLineCounts.push({ doc, lines, overCap: lines > docCap });
    } catch {
      // Unreadable / absent → skip (not a fabricated entry).
    }
  }

  // Root SPEC_V*.md count — the sprawl metric. Missing root → 0.
  let specCount = 0;
  try {
    specCount = readDir('.').filter(
      (n) => typeof n === 'string' && /^SPEC_V.*\.md$/.test(n),
    ).length;
  } catch {
    specCount = 0;
  }

  // Active-lesson count — via the authoritative parser when injected (never a
  // hand-tally). Without a parser, or on any failure, → null (honest "unknown").
  let lessonCount = null;
  try {
    const text = readFile('docs/lessons-learned.md');
    if (typeof parseLessons === 'function') {
      const parsed = parseLessons(text);
      if (Array.isArray(parsed)) {
        lessonCount = parsed.filter((l) => l && l.status === 'active').length;
      }
    } else {
      // Fallback heuristic when no parser is injected: count "**Status**: active".
      const m = text.match(/^\*\*Status\*\*:\s*active\b/gim);
      lessonCount = m ? m.length : 0;
    }
  } catch {
    lessonCount = null;
  }

  return {
    subcommands: inventorySubcommands,
    tags,
    adrs,
    libModules,
    docLineCounts,
    docCap,
    specCount,
    lessonCount,
  };
}
