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

// --- Deprecated-surface conformance (SPEC_V018A AC-3) -----------------------

// A line frames a token as NOT-A-CLAIM (legacy / historical / deprecated / a
// migration narration). On such a line we do NOT flag the deprecated token —
// the doc is correctly describing it AS legacy, not recommending it (the v0.7.b
// not-a-claim guard, precision-first). Covers "legacy `X`", "deprecated", "old
// `X`", "historical", "renamed from X", "was X", "instead of X", "replaced", and
// any negation ("not `X`", "no longer X").
const DEPRECATED_NOT_A_CLAIM =
  /\b(?:legacy|deprecat\w*|obsolete|historical(?:ly)?|formerly|previously|renamed|replaced|superseded|retired|no longer|instead of|rather than|used to|was the|old(?:er)?\b|not\b|never\b|don'?t\b|do not\b|avoid\b)/i;

// A RECOMMENDATION cue that turns a mention into a "do this" — the imperative
// verbs ("try", "run", "use", "launch", "invoke", "start", "type") + a "→"
// recommendation arrow. PRECISION-FIRST: a cue alone on the line is NOT enough
// (a noun "a run writes…" would false-positive), so the caller requires the cue
// to appear in a short window BEFORE the deprecated token — i.e. the cue must be
// GOVERNING that token ("just run `mmd serve`"), not merely co-occurring with it.
const PRIMARY_CUE_GLOBAL =
  /\b(?:try|run|use|using|launch|invoke|start|begin|recommend\w*|simply|type)\b|→/gi;
// How many chars a cue may sit before the token and still be "governing" it.
const CUE_WINDOW = 16;

// The curated deprecated→current token config (small, high-confidence, easy to
// extend). Each entry's `match` is tested against a line; `requiresPrimaryCue`
// keeps precision high (only flag the token when the line also recommends it).
//
// `/bmad-adv-auto-dev` was the install-script's stale "try this" entry; the real
// entry is `mmdream`/`/mmdream` (ADR-039). A bare `mmd <subcommand>` invocation
// is the pre-rename command (the CLI is `mmdream` since v0.9.2); BUT the project
// DELIBERATELY keeps `mmd` in MMD_*/`.mmd/`/`bin/mmd.js`/composer keys, so the
// bare-`mmd` rule is tightly scoped to a COMMAND invocation in a backtick span
// (`mmd <subcommand>` / `mmd --flag` / `mmd "<dream>"`) and never matches MMD_,
// .mmd, mmd.js, or `mmdream` itself (the negative lookbehind/lookahead below).
const DEPRECATED_SURFACE = Object.freeze([
  {
    token: '/bmad-adv-auto-dev',
    replacement: '`mmdream` / `/mmdream`',
    // The literal slash-command, NOT inside a longer word.
    match: /(?<![\w/-])\/bmad-adv-auto-dev\b/,
    requiresPrimaryCue: true,
    reason: 'the `/bmad-adv-auto-dev` skill is MMD\'s internal orchestrator, not the user entry point — recommend `mmdream` / `/mmdream` instead',
  },
  {
    token: 'mmd <command>',
    replacement: '`mmdream`',
    // A bare `mmd` COMMAND token: `mmd` followed by a space then a subcommand-shaped
    // word or a flag/dream — but NOT `mmdream` (lookahead rejects `ream`), NOT
    // `mmd.js`/`mmd_`/`MMD_` (the leading lookbehind rejects a preceding word char;
    // the value-char after `mmd` must be a space, and the next token is a command).
    match: /(?<![\w./-])mmd(?!ream)(?!\.)\s+(?:--?[a-z]|[a-z][a-z0-9-]*\b|")/,
    requiresPrimaryCue: true,
    reason: 'the CLI was renamed to `mmdream` (v0.9.2); a bare `mmd <command>` recommendation is stale — use `mmdream`',
  },
]);

/**
 * Does a recommendation cue ("try"/"run"/"→"/…) sit in the CUE_WINDOW chars just
 * before the matched token, governing it? Precision lever for AC-3: a recommend
 * cue must directly precede the token ("just run `mmd serve`") to count as a
 * recommendation; an incidental noun elsewhere on the line ("a run writes … the
 * mmd state file") does not. Pure, never throws.
 *
 * @param {string} line the full line text
 * @param {number} tokenIndex the start index of the matched deprecated token
 * @returns {boolean}
 */
function cueGovernsToken(line, tokenIndex) {
  if (typeof line !== 'string' || typeof tokenIndex !== 'number') return false;
  const start = Math.max(0, tokenIndex - CUE_WINDOW);
  const window = line.slice(start, tokenIndex);
  PRIMARY_CUE_GLOBAL.lastIndex = 0;
  return PRIMARY_CUE_GLOBAL.test(window);
}

/**
 * Which user-facing texts recommend a KNOWN-DEPRECATED token as the current /
 * primary surface? (SPEC_V018A AC-3.) Deterministic, curated, precision-first.
 *
 * For each text line: skip clearly not-a-claim framings (legacy / historical /
 * deprecated / negated / migration narration); for the remaining lines, flag a
 * curated deprecated token ONLY when the line also carries a "primary/recommend"
 * cue (so a neutral mention is never a false positive). Pure, never throws.
 *
 * @param {Array<{ path: string, text: string }>} texts the broadened UX-text
 *   surface (markdown docs + install-mmd.sh printf strings + CLI --help/USAGE).
 * @param {{ config?: Array<object> }} [opts] override the curated config (tests).
 * @returns {Array<{ doc: string, line: number, token: string, replacement: string, reason: string }>}
 */
export function checkDeprecatedSurface(texts, opts) {
  const list = Array.isArray(texts) ? texts : [];
  const config = opts && Array.isArray(opts.config) ? opts.config : DEPRECATED_SURFACE;
  const findings = [];

  for (const entry of list) {
    if (!entry || typeof entry.text !== 'string') continue;
    const doc = entry.path;
    const lines = entry.text.split('\n');

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const lineNo = i + 1;
      // Not-a-claim guard: the line frames the token as legacy/historical/etc.
      if (DEPRECATED_NOT_A_CLAIM.test(line)) continue;

      for (const rule of config) {
        if (!rule || !(rule.match instanceof RegExp)) continue;
        const m = rule.match.exec(line);
        if (!m) continue;
        // Recommendation guard: a curated token is only drift when PRESENTED as
        // primary — i.e. a recommend cue ("try"/"run"/"→"/…) GOVERNS it (sits in
        // a short window right before it). This rejects a co-occurring noun
        // ("a run writes … the mmd state file") that names the token incidentally.
        if (rule.requiresPrimaryCue && !cueGovernsToken(line, m.index)) continue;
        findings.push({
          doc, line: lineNo, token: rule.token, replacement: rule.replacement, reason: rule.reason,
        });
      }
    }
  }
  return findings;
}

// --- Version-pinned-promise conformance (SPEC_V018A AC-4) -------------------

// A FUTURE promise pinned to a version: "to be added in vX", "coming in vX",
// "TODO by vX", "will be added in vX", "planned for vX", "shipping in vX",
// "available in vX". The version is captured (group 1). PRECISION-FIRST: this is
// deliberately a FORWARD-LOOKING promise vocabulary — a past-tense "added in vX"
// (already covered by the HISTORICAL guard) is NOT a promise. The `to be`/`will
// be`/`coming`/`TODO by`/`planned`/`shipping` framing makes it a commitment.
const PROMISE_PATTERNS = [
  /\b(?:to be (?:added|done|implemented|provided|included|shipped)|will be (?:added|done|implemented|provided|included|shipped))\b[^.\n]{0,40}?\bin\s+(v\d+(?:\.\d+){0,2})\b/i,
  /\bcoming\b[^.\n]{0,20}?\bin\s+(v\d+(?:\.\d+){0,2})\b/i,
  /\bTODO\b[^.\n]{0,30}?\bby\s+(v\d+(?:\.\d+){0,2})\b/i,
  /\b(?:planned|scheduled|slated|shipping|available)\b[^.\n]{0,20}?\b(?:for|in)\s+(v\d+(?:\.\d+){0,2})\b/i,
];

// A line that frames the version mention as already-DONE / historical → NOT a
// live promise. "as of vX", "added in vX", "shipped in vX", "since vX" — the
// promise came AND was kept (or it is narration), so we don't flag it. The
// negative lookbehind `(?<!to be |will be )` is essential: a FORWARD promise
// "to be added in vX" / "will be added in vX" must NOT be swallowed by the
// past-tense "added in vX" fulfilled marker (else the README License case is
// silently suppressed). Precision both ways.
const PROMISE_FULFILLED = /\b(?:as of|shipped in|landed in|since|introduced in|done in|completed in|delivered in)\s+v\d|(?<!to be )(?<!will be )\badded in\s+v\d/i;

/**
 * Parse a 1-to-3-part version ("v0.1", "v0.2.5", "v1") into a comparable tuple,
 * zero-padding the missing minor/patch. Non-version → null.
 * @param {string} v
 * @returns {number[]|null}
 */
function looseVersion(v) {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(typeof v === 'string' ? v : '');
  if (!m) return null;
  return [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)];
}

/**
 * Which version-pinned future promises have COME DUE? (SPEC_V018A AC-4.)
 *
 * A promise "to be added in vX" / "coming in vX" / "TODO by vX" is stale when the
 * CURRENT version is >= vX (the deadline passed but the doc still promises it —
 * the README "License — to be added in v0.1" case). BOUNDED + precision-first:
 * only explicit forward-promise vocabulary, never a historical "as of vX" / a
 * past-tense "added in vX", and never a still-FUTURE promise (current < vX).
 * Pure, never throws.
 *
 * @param {Array<{ path: string, text: string }>} texts the UX-text surface.
 * @param {{ currentVersion?: string }} args the repo's current version (e.g. '0.18.0').
 * @returns {Array<{ doc: string, line: number, promise: string, pinnedVersion: string, currentVersion: string }>}
 */
export function checkVersionPinnedPromises(texts, args) {
  const list = Array.isArray(texts) ? texts : [];
  const current = looseVersion(args && typeof args.currentVersion === 'string' ? args.currentVersion : '');
  if (!current) return []; // no current version to compare against → can't judge.
  const currentStr = (args && args.currentVersion) || '';

  const findings = [];
  for (const entry of list) {
    if (!entry || typeof entry.text !== 'string') continue;
    const doc = entry.path;
    const lines = entry.text.split('\n');

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const lineNo = i + 1;
      if (PROMISE_FULFILLED.test(line)) continue; // already-done/historical → not a live promise.

      for (const re of PROMISE_PATTERNS) {
        const m = re.exec(line);
        if (!m) continue;
        const pinnedStr = m[1];
        const pinned = looseVersion(pinnedStr);
        if (!pinned) continue;
        // Came due ⟺ current >= pinned (deadline reached or passed).
        if (cmp(current, pinned) >= 0) {
          findings.push({
            doc, line: lineNo, promise: m[0].trim(), pinnedVersion: pinnedStr, currentVersion: currentStr,
          });
        }
        break; // one promise finding per line is enough.
      }
    }
  }
  return findings;
}
