// lib/documentalist/conformance.js — the Documentalist's drift checks (SPEC_V07B AC-2).
//
// SRP (universal.md §I.S): given the artifacts a doc CLAIMS exist (from
// doc-refs.js) + the live inventory (from inventory.js), decide which claims no
// longer hold. Two PURE functions, no I/O of their own (the file-existence
// oracle is injected), no rendering. Same inputs → same findings.
//
// HONEST HEURISTICS, NOT AN AUDIT (universal §VI, SPEC §5.3): these are
// deterministic conformance checks, framed as heuristics. They favour PRECISION
// over recall (AC-4): a drift section that cries wolf is useless, so when a
// signal is ambiguous we DON'T flag.
//   • checkArtifactConformance — a dangling reference (a doc points at a file /
//     subcommand / ADR / lib module that is not there) is UNAMBIGUOUS drift.
//   • checkFactConformance — a prose count or current-version claim that
//     disagrees with the inventory, but ONLY for a BOUNDED, low-false-positive
//     set (explicit "N subcommands|ADRs|lessons" + "current/latest version X"),
//     and ONLY when not clearly historical narrative ("as of vX", "in v0.2.x").
//
// NEVER THROWS (error-handling §III): odd / empty input → [].

// --- Artifact conformance --------------------------------------------------

/**
 * Which extracted refs do NOT resolve against reality? (AC-2, artifact half.)
 *
 * @param {{
 *   docRefs?: Array<{ doc: string, line: number, ref: string, kind: string, value: any }>,
 *   inventory?: object,
 *   fileExistsFn?: (relPath: string) => boolean,   // injected oracle; absent → file refs are NOT judged
 *   repoTopDirs?: string[]|Set<string>,            // the analyzed repo's REAL top-level directory names
 * }} args
 * @returns {Array<{ doc: string, line: number, ref: string, kind: string, reason: string }>}
 *   the dangling refs only; resolving refs are omitted.
 *
 * `repoTopDirs` (polyglot precision, universal §VIII): doc-refs.js now extracts
 * file CANDIDATES under ANY top-level directory (so a Python/Rust/Go repo's
 * `src/foo.py` is visible). To stay precise (no crying wolf), a `file` ref is
 * only judged dangling when it is ROOTED at a real top-level directory of the
 * analyzed repo — i.e. its first path segment is in `repoTopDirs`. A token that
 * is NOT repo-rooted (a shorthand like `adapters/javascript.js` whose real path
 * is `lib/…/adapters/…`, a relative markdown link like `adr/020-x.md`, or an
 * illustrative example like `pkg/mod.py`) is NOT a claim that THIS repo has that
 * exact path, so it is skipped. This is the derived-not-hardcoded successor to
 * the old `lib|bin|test|docs` allowlist: same precision, now any repo layout.
 * When `repoTopDirs` is absent/empty the filter is OFF (back-compat: every file
 * ref is judged) — the real caller (bin/documentalist/document-review.js) always
 * supplies it.
 */
export function checkArtifactConformance(args) {
  const docRefs = args && Array.isArray(args.docRefs) ? args.docRefs : [];
  const inventory = args && typeof args.inventory === 'object' && args.inventory ? args.inventory : {};
  const fileExistsFn = args && typeof args.fileExistsFn === 'function' ? args.fileExistsFn : null;
  const topDirsRaw = args && (Array.isArray(args.repoTopDirs) || args.repoTopDirs instanceof Set)
    ? new Set(args.repoTopDirs)
    : null;
  // Empty → filter OFF (judge all), matching "absent/empty" back-compat.
  const topDirs = topDirsRaw && topDirsRaw.size > 0 ? topDirsRaw : null;

  const subcommandSet = new Set(
    Array.isArray(inventory.subcommands)
      ? inventory.subcommands.filter((s) => typeof s === 'string')
      : [],
  );
  const adrNumbers = new Set(
    Array.isArray(inventory.adrs)
      ? inventory.adrs.map((a) => a && a.number).filter((n) => typeof n === 'number')
      : [],
  );
  const libSet = new Set(
    Array.isArray(inventory.libModules)
      ? inventory.libModules.filter((m) => typeof m === 'string')
      : [],
  );

  const findings = [];
  for (const r of docRefs) {
    if (!r || typeof r !== 'object') continue;
    const base = { doc: r.doc, line: r.line, ref: r.ref, kind: r.kind };

    if (r.kind === 'file') {
      // No oracle → cannot judge a file ref. Stay silent (never fabricate a
      // "missing" verdict for a path we couldn't test).
      if (!fileExistsFn) continue;
      // Precision (§VIII): only judge a ref ROOTED at a real top-level dir of the
      // analyzed repo. A non-rooted token (shorthand / relative link / illustrative
      // example) is not a claim about THIS repo's exact path — skip it.
      if (topDirs) {
        const firstSeg = String(r.value).split('/')[0];
        if (!topDirs.has(firstSeg)) continue;
      }
      let exists = false;
      try {
        exists = !!fileExistsFn(r.value);
      } catch {
        exists = true; // an oracle error is not proof of absence — do not flag.
      }
      if (!exists) {
        findings.push({ ...base, reason: 'file not found (renamed/removed?)' });
      }
    } else if (r.kind === 'subcommand') {
      if (!subcommandSet.has(r.value)) {
        findings.push({
          ...base,
          reason: `'${r.value}' is not a known subcommand (renamed/removed/planned?)`,
        });
      }
    } else if (r.kind === 'adr') {
      if (!adrNumbers.has(r.value)) {
        const padded = String(r.value).padStart(3, '0');
        findings.push({ ...base, reason: `no docs/adr/${padded}-*.md for ${r.ref}` });
      }
    } else if (r.kind === 'lib-module') {
      if (!libSet.has(r.value)) {
        findings.push({ ...base, reason: `'${r.value}' not in the lib/ inventory (renamed/removed?)` });
      }
    }
    // Unknown kinds are ignored (conservative — never invent a finding).
  }
  return findings;
}

// --- Fact conformance ------------------------------------------------------

// A line is "clearly historical" when it frames a number/version as a past
// state, not a current claim. We skip ALL fact checks on such a line — precision
// over recall. Covers "as of vX", "in v0.2.x", "shipped in vX", "since vX", etc.
// Past-tense framings only — "by vX" / "until vX" / "up to vX" are too broad
// (a current claim can legitimately say "by v0.5 standards"), so they are NOT
// historical markers here.
const HISTORICAL = /\b(?:as of|shipped in|since|back in|prior to|introduced in|added in)\s+v\d|\bin\s+v\d+\.\d/i;

// Bounded count claims — the noun MUST be present (so "5 ACs" / "1561 tests"
// never trip these). Each maps to an inventory field.
//
// The leading lookbehind `(?<!['"`\w-])` rejects a digit glued to a preceding
// word char, hyphen, or quote — so "top-5 lessons" (compound), "L-21 lessons",
// and a QUOTED historical value (`claimed "17 active lessons"`) are NOT read as
// a current count claim. Precision-first (AC-4): the author quoting an old
// number is not asserting it now.
const COUNT_PATTERNS = [
  { re: /(?<!['"`\w-])(\d{1,4})\s+subcommands?\b/i, field: 'subcommands', noun: 'subcommands' },
  { re: /(?<!['"`\w-])(\d{1,4})\s+ADRs?\b/i, field: 'adrs', noun: 'ADRs' },
  { re: /(?<!['"`\w-])(\d{1,4})\s+(?:active\s+)?lessons?\b/i, field: 'lessons', noun: 'lessons' },
];

// "current/latest version X" in either order. The same-sentence proximity keeps
// it bounded (we don't grab a stray version elsewhere on a long line).
const VERSION_CURRENT = [
  /\b(?:current|latest)\b[^.\n]{0,40}?\b(v\d+\.\d+\.\d+)\b/i,
  /\b(v\d+\.\d+\.\d+)\b[^.\n]{0,20}?\b(?:current|latest)\b/i,
];

/**
 * Parse a `vX.Y.Z` tag/claim into a comparable numeric tuple. Non-semver → null.
 * @param {string} v
 * @returns {number[]|null}
 */
function semver(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(typeof v === 'string' ? v : '');
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** @returns {number} -1 / 0 / 1 comparing two semver tuples. */
function cmp(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/**
 * The inventory's count for a bounded field, or null when it can't be known.
 * @param {object} inventory
 * @param {string} field
 * @returns {number|null}
 */
function inventoryCount(inventory, field) {
  if (field === 'subcommands') return Array.isArray(inventory.subcommands) ? inventory.subcommands.length : null;
  if (field === 'adrs') return Array.isArray(inventory.adrs) ? inventory.adrs.length : null;
  if (field === 'lessons') return typeof inventory.lessonCount === 'number' ? inventory.lessonCount : null;
  return null;
}

/** The latest released version from the inventory tags (semver-sorted last). */
function latestVersion(inventory) {
  const tags = Array.isArray(inventory.tags) ? inventory.tags.filter((t) => typeof t === 'string') : [];
  let best = null;
  for (const t of tags) {
    const s = semver(t);
    if (s && (!best || cmp(s, best.tuple) > 0)) best = { tuple: s, tag: t };
  }
  return best; // { tuple, tag } | null
}

/**
 * Which prose facts disagree with the live inventory? (AC-2, fact half.)
 *
 * BOUNDED + conservative: only explicit "N subcommands|ADRs|lessons" counts and
 * "current/latest version X" claims, only on non-historical lines. A current-
 * version claim is flagged ONLY when it is BEHIND the latest tag (a doc naming
 * the in-flight version is not stale — precision over recall, avoids self-noise).
 *
 * @param {{ docs?: Array<{ doc: string, text: string }>, inventory?: object }} args
 * @returns {Array<{ doc: string, line: number, claim: string, actual: any, kind: string }>}
 */
export function checkFactConformance(args) {
  const docs = args && Array.isArray(args.docs) ? args.docs : [];
  const inventory = args && typeof args.inventory === 'object' && args.inventory ? args.inventory : {};
  const latest = latestVersion(inventory);

  const findings = [];
  for (const entry of docs) {
    if (!entry || typeof entry.text !== 'string') continue;
    const doc = entry.doc;
    const lines = entry.text.split('\n');

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const lineNo = i + 1;
      if (HISTORICAL.test(line)) continue; // clearly-historical → not drift.

      // Bounded counts.
      for (const { re, field, noun } of COUNT_PATTERNS) {
        const m = re.exec(line);
        if (!m) continue;
        const claimed = Number(m[1]);
        const actual = inventoryCount(inventory, field);
        if (actual == null) continue; // can't know → don't flag.
        if (claimed !== actual) {
          findings.push({
            doc, line: lineNo, claim: `${claimed} ${noun}`, actual, kind: 'count',
          });
        }
      }

      // Current/latest version — flag only when behind the latest tag.
      if (latest) {
        for (const re of VERSION_CURRENT) {
          const m = re.exec(line);
          if (!m) continue;
          const claimedStr = m[1];
          const claimed = semver(claimedStr);
          if (claimed && cmp(claimed, latest.tuple) < 0) {
            findings.push({
              doc, line: lineNo, claim: `current version ${claimedStr}`, actual: latest.tag, kind: 'version',
            });
          }
          break; // one version finding per line is enough.
        }
      }
    }
  }
  return findings;
}
