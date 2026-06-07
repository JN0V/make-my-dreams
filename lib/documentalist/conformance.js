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

import { reconcileRoadmap } from './roadmap-reconcile.js';

// --- Capability-lie conformance (SPEC_V021A AC-1) --------------------------

// A line frames a capability mention as NOT a present-tense claim that it EXISTS —
// it is deferred / planned / future / on the roadmap / aspirational. On such a
// line we never flag a capability mention (the not-a-claim guard, precision-first):
// the doc is correctly describing the capability as not-yet-built. Covers
// "deferred", "planned", "future", "roadmap", "will be", "coming", "TODO",
// "next", "upcoming", "eventually", "someday", "not yet", "to be".
const CAPABILITY_NOT_A_CLAIM =
  /\b(?:deferred|planned|future|roadmap|will\s+(?:be|add|ship|support|gain)|coming|TODO|upcoming|eventually|someday|not\s+yet|to\s+be\b|deprecat\w*|once\b.*\bshipped|when\s+built|aspiration\w*|envision\w*|intend\w*)/i;

// Curated HIGH-confidence unbuilt-capability triggers (SPEC §1.1 / AC-1). Each is
// a distinctive phrase whose present-tense assertion is a known capability-lie on
// MMD today (the worktrees/parallelization case Sébastien spotted). Derived from
// the roadmap's deferred big-rocks; kept small + asserted (the secret-scan/
// deps-gate "high-confidence gates, uncertain advises" shape). Each entry's
// `match` is tested against a line; `capability` is the human label of what is
// being (falsely) claimed.
//
// PRECISION-FIRST: a trigger fires ONLY when the not-a-claim guard did NOT and
// when the line ASSERTS the capability (a present-tense "adds X" / "via X" /
// "supports X" framing the caller checks), never on a bare topic mention.
const CAPABILITY_TRIGGERS = Object.freeze([
  {
    capability: 'local parallelization via git worktrees',
    // "worktrees" as a present capability (the v0.9 Parallel Conductor, deferred).
    // "git worktrees" / "worktree parallelization" / "parallelization via … worktrees".
    match: /\b(?:parallel\w*\b[^.\n]{0,40}?\bworktree|worktree[s]?\b[^.\n]{0,30}?\bparallel|(?:local|git)\s+parallel\w*[^.\n]{0,40}?\bworktree|worktree[s]?\s+parallel\w*)/i,
    confidence: 'high',
  },
]);

// A present-tense ASSERTION cue that turns a capability mention into a "MMD has
// this" claim: "adds", "provides", "supports", "includes", "offers", "via",
// "with", "features", "ships", "now has", "brings", "enables". The capability
// triggers above already embed enough structure; this is the broad gate the
// curated trigger sits behind so a neutral topical mention never trips.
const ASSERTION_CUE =
  /\b(?:adds?|provides?|supports?|includes?|offers?|features?|ships?\b|brings?|enables?|has\b|have\b|with\b|via\b|using\b|does\b|gives?|comes?\s+with|built-in|out of the box)/i;

/**
 * A line carrying a capability trigger is "a whole-line / discrete list-item
 * claim" (cleanly excisable → removable:true) when the ONLY substantive content
 * of the line is that claim — a markdown list item (`- …` / `* …` / `N. …`) or a
 * standalone short line. A trigger buried inside a multi-clause prose sentence
 * (commas, a long line that says other true things too) is NOT a clean excision —
 * removing it would malform the sentence — so it is flagged, not removed
 * (SPEC AC-1 / AC-4 precision-first). Pure, never throws.
 *
 * Two cleanly-excisable shapes:
 *   (a) a pure markdown list item whose body IS the claim
 *       ("- local parallelization via worktrees"), with no comma joining it to
 *       OTHER true items on the same line; remove the whole line.
 *   (b) a TRAILING comma-delimited clause that ends a sentence
 *       ("…, brownfield Project Onboarder, local parallelization via worktrees.");
 *       the claim is the LAST item of a comma list, so removing ", <clause>" and
 *       keeping the period leaves well-formed prose — the planner fixes that one
 *       separator. The claim must reach (near) the end of the line and be preceded
 *       by a comma, with no further comma AFTER it (else it is mid-list, not
 *       trailing → mid-sentence → flagged).
 *
 * @param {string} line the full raw line
 * @param {RegExpExecArray} m the trigger match (m.index = where the claim starts)
 * @returns {{ excisable: boolean, mode: 'whole-line'|'trailing-clause'|null }}
 */
function excisability(line, m) {
  if (typeof line !== 'string') return { excisable: false, mode: null };
  const trimmed = line.trim();

  // (a) pure list item.
  const listBody = /^(?:[-*]|\d+\.)\s+(.*)$/.exec(trimmed);
  if (listBody && !/[,;]/.test(listBody[1])) {
    return { excisable: true, mode: 'whole-line' };
  }

  // (b) trailing comma-clause ending the sentence. The claim text from the trigger
  // start to EOL must (i) be preceded by ", " and (ii) carry no further comma —
  // i.e. it is the final item. We also require it to end the sentence (optional
  // trailing period / nothing). This keeps it a clean cut; anything else → flag.
  const idx = m && typeof m.index === 'number' ? m.index : -1;
  if (idx > 0) {
    const before = line.slice(0, idx);
    const after = line.slice(idx);
    const commaBefore = /,\s*$/.test(before); // the clause starts at a ", "
    const noTrailingComma = !/,/.test(after); // nothing follows it in the list
    if (commaBefore && noTrailingComma) {
      return { excisable: true, mode: 'trailing-clause' };
    }
  }

  return { excisable: false, mode: null };
}

/**
 * Which prose lines ASSERT (present-tense) a capability the roadmap/inventory says
 * is UNBUILT/unknown? (SPEC_V021A AC-1.) Deterministic, precision-first, removable-
 * aware. Pure, never throws.
 *
 * Method (curated + corroborated):
 *   1. Skip a line framed as not-a-claim (deferred / planned / future / roadmap /
 *      will be / deprecated / …) — the doc is correctly describing a future thing.
 *   2. For each curated HIGH-confidence trigger, if its phrase matches AND the line
 *      also carries a present-tense assertion cue ("adds"/"via"/"supports"/…) →
 *      a capability-lie. `removable:true` only when the claim is cleanly excisable
 *      (a discrete list item / whole-line claim); a mid-sentence falsehood →
 *      removable:false (flagged, never auto-mutilated).
 *
 * The roadmap reconciliation is REUSED (SPEC §4.1, DRY) to corroborate that the
 * curated capability is indeed not-built: a trigger is only emitted when the
 * reconciliation does NOT classify the capability `built` (so if worktrees ever
 * ships, the lie-check goes silent automatically — derive-don't-hardcode).
 *
 * @param {{
 *   docText?: string,
 *   doc?: string,                // the source doc path (for the finding)
 *   inventory?: object,
 *   roadmap?: string,            // MAKE_MY_DREAMS.md text (for reconcileRoadmap)
 *   triggers?: Array<object>,    // override the curated set (tests)
 * }} args
 * @returns {Array<{ doc: string, line: number, claim: string, capability: string, confidence: string, removable: boolean }>}
 */
export function checkCapabilityClaims(args) {
  const a = args && typeof args === 'object' ? args : {};
  const docText = typeof a.docText === 'string' ? a.docText : '';
  const doc = typeof a.doc === 'string' ? a.doc : '';
  const triggers = Array.isArray(a.triggers) ? a.triggers : CAPABILITY_TRIGGERS;
  if (docText.length === 0) return [];

  // Reuse the roadmap reconciliation to know which capabilities are NOT built (so
  // the curated trigger goes silent the day a capability ships — derive-don't-
  // hardcode, v0.7.d golden rule). Never throws: a missing roadmap → no built set
  // → every curated trigger is eligible (it is a known-unbuilt phrase regardless).
  let builtCapabilityTokens = new Set();
  if (typeof a.roadmap === 'string' && a.inventory) {
    try {
      const rec = reconcileRoadmap({ roadmapText: a.roadmap, inventory: a.inventory });
      for (const e of rec.entries) {
        if (e && e.status === 'built') {
          for (const t of String(e.capability).toLowerCase().split(/[^a-z0-9]+/)) {
            if (t.length > 2) builtCapabilityTokens.add(t);
          }
        }
      }
    } catch {
      builtCapabilityTokens = new Set();
    }
  }

  const findings = [];
  const lines = docText.split('\n');
  let inFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const lineNo = i + 1;

    if (CAPABILITY_NOT_A_CLAIM.test(line)) continue; // deferred/planned/future → not a claim.
    if (!ASSERTION_CUE.test(line)) continue; // no present-tense assertion → not a claim.

    for (const rule of triggers) {
      if (!rule || !(rule.match instanceof RegExp)) continue;
      const m = rule.match.exec(line);
      if (!m) continue;
      // Corroboration: if the reconciliation says this capability IS built (its
      // distinctive token appears in a built entry), it is not a lie → skip.
      // "worktrees" is the distinctive token; it must NOT be in the built set.
      const capTokens = String(rule.capability).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 4);
      const looksBuilt = capTokens.length > 0 && capTokens.every((t) => builtCapabilityTokens.has(t));
      if (looksBuilt) continue;

      const exc = excisability(line, m);
      findings.push({
        doc, line: lineNo,
        claim: line.trim(),
        capability: rule.capability,
        confidence: rule.confidence || 'high',
        removable: exc.excisable,
        removalMode: exc.mode, // 'whole-line' | 'trailing-clause' | null
        matchText: m[0],        // the matched falsehood span (for trailing-clause excision)
      });
    }
  }
  return findings;
}

// --- Obsolete-forward-narrative conformance (SPEC_V022A AC-1) ---------------
//
// The INVERSE of checkCapabilityClaims above:
//   • checkCapabilityClaims flags a PRESENT-TENSE claim of an UNBUILT capability
//     ("MMD adds … git worktrees" while worktrees is the deferred Parallel
//     Conductor) — a "done"-claim of a not-built thing.
//   • checkObsoleteForwardClaims flags a FORWARD-LOOKING claim ("next / coming /
//     planned / then vX / on the roadmap") of an ALREADY-BUILT capability (or a
//     version <= the current version) — a roadmap line the project has overtaken,
//     a "future"-claim of an already-done thing. (The README line-73 case: "Next
//     on the roadmap: … v0.4 stateless Orchestrator + auto-handoff, v0.5
//     Conductor, v0.5b full Documentalist" — all shipped, we are at v0.21+.)
//
// HONEST HEURISTIC, NOT AN AUDIT (universal §VI). PRECISION-FIRST (v0.7.b): a
// forward cue governing a genuinely-UNBUILT capability ("next: voice mode" while
// voice is unbuilt) is the CORRECT roadmap and is NOT flagged; a past-tense /
// historical framing ("was on the roadmap", "originally planned", "used to be
// next") is NOT a live forward claim and is suppressed. Pure, never throws.
//
// DERIVE, DON'T HAND-CURATE (v0.7.d): "is it built?" comes from reconcileRoadmap /
// the inventory (REUSED — no second classifier) and "is the version past?" comes
// from a real version compare against the analyzed repo's package.json version, so
// a feature that later ships auto-converts its stale "next: X" mention into a
// finding (and a future item that ships stops being a false positive).

// A FORWARD-LOOKING cue: the line frames what follows as future/upcoming work.
// "next" / "coming" / "planned" / "upcoming" / "on the roadmap" / "to be built|
// added|done|shipped" / "then vX" / "future". Captured anywhere on the line; the
// HISTORICAL guard below suppresses a past-tense framing of the same words.
const FORWARD_CUE =
  /\b(?:next\b|coming\b|upcoming\b|planned\b|on the roadmap\b|to be (?:built|added|done|shipped|implemented|provided)\b|then\s+v\d|future\b|soon\b|will\s+(?:come|ship|land|follow))/i;

// A line that frames the forward words as PAST / already-happened → NOT a live
// forward claim (the not-a-claim guard family, precision-first). "was next",
// "was on the roadmap", "originally planned", "used to be next", "was planned",
// "was coming", "formerly/previously planned", "once planned". Past-tense markers
// only — a live "is next" must still flag.
const FORWARD_HISTORICAL =
  /\b(?:was\b|were\b|originally\b|used to\b|formerly\b|previously\b|once\b|had been\b|no longer\b|already\b)/i;

// A version token on the line: v0.4 / v0.5b / v1.2.3. Capture all occurrences.
const VERSION_TOKEN_GLOBAL = /\bv(\d+)\.(\d+)(?:\.(\d+))?[a-z]?\b/gi;

/**
 * Is `pinned` <= `current`? (A forward claim of an already-shipped version is
 * stale.) REUSES the v0.18 `cmp` 3-tuple comparator (DRY §III) — both tuples are
 * always 3-element (from looseVersion / an explicit `[maj, min, patch||0]`).
 *
 * @param {number[]} pinned [major, minor, patch]
 * @param {number[]} current [major, minor, patch]
 * @returns {boolean}
 */
function versionAtOrBelow(pinned, current) {
  return cmp(pinned, current) <= 0;
}

// Descriptive words that decorate a roadmap capability title but are NOT its
// distinctive NAME — requiring them to appear on a doc line would miss a stale
// "next: the full Documentalist" (where only "documentalist" is the real name).
// A built capability's distinctive token-set is its title tokens MINUS these.
const CAPABILITY_DESCRIPTOR_WORDS = new Set([
  'full', 'lite', 'real', 'mode', 'modes', 'agent', 'agents', 'autonomous',
  'orchestrator', 'orchestration', 'auto', 'handoff', 'the', 'and', 'with',
  'speak', 'your', 'dream', 'doc', 'docs', 'system', 'support', 'stateless',
]);

/**
 * Build, per BUILT roadmap capability, its distinctive NAME token-set (REUSE
 * reconcileRoadmap — DRY §III, no second classifier). The distinctive tokens are
 * the capability title's tokens (len > 4) MINUS descriptor words, so "Conductor
 * (orchestration + auto-handoff)" → {conductor} and "Documentalist (autonomous
 * doc agent)" → {documentalist}. A forward line is stale-by-capability when ALL
 * of SOME built capability's distinctive tokens appear on it. Never throws: a
 * missing roadmap/inventory → an empty map (the check then relies on the version
 * signal alone, the high-confidence one).
 *
 * @param {string|null} roadmap MAKE_MY_DREAMS.md text
 * @param {object|null} inventory
 * @returns {Map<string, string[]>} capability title → its distinctive tokens
 */
function builtCapabilityTokenSets(roadmap, inventory) {
  const map = new Map();
  if (typeof roadmap !== 'string' || !inventory) return map;
  try {
    const rec = reconcileRoadmap({ roadmapText: roadmap, inventory });
    for (const e of rec.entries) {
      if (!e || e.status !== 'built') continue;
      const tks = String(e.capability)
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 4 && !CAPABILITY_DESCRIPTOR_WORDS.has(t));
      const distinctive = [...new Set(tks)];
      if (distinctive.length > 0) map.set(e.capability, distinctive);
    }
  } catch {
    return new Map();
  }
  return map;
}

/**
 * Is the forward-looking line stale (it names a BUILT capability or a version
 * <= current)? Returns the matched evidence, or null when the line is a genuine
 * future item (precision-first — NOT flagged).
 *
 * Two stale signals, EITHER suffices:
 *   (a) a version token on the line is <= the current version (high-confidence,
 *       deterministic — "then v0.4 …" while we are at v0.21).
 *   (b) the line names a BUILT capability — i.e. ALL of the distinctive NAME
 *       tokens of SOME built roadmap capability appear on the line. (A weak
 *       single-token overlap is not enough — that would cry wolf; we require a
 *       built capability's whole distinctive token-set, mirroring the
 *       roadmap-reconcile STRONG-match discipline.)
 *
 * @param {string} line
 * @param {number[]} current the current version tuple
 * @param {Map<string, string[]>} builtCapTokenSets per built capability: its
 *   distinctive token list — for the all-present test
 * @returns {{ reason: string, capability: string|null, version: string|null }|null}
 */
function forwardStaleEvidence(line, current, builtCapTokenSets) {
  // (a) version <= current.
  if (current) {
    VERSION_TOKEN_GLOBAL.lastIndex = 0;
    let m;
    while ((m = VERSION_TOKEN_GLOBAL.exec(line)) !== null) {
      const pinned = [Number(m[1]), Number(m[2]), Number(m[3] || 0)];
      if (versionAtOrBelow(pinned, current)) {
        return {
          reason: `forward cue names ${m[0]}, at or below the current version`,
          capability: null,
          version: m[0],
        };
      }
    }
  }

  // (b) names a BUILT capability (all its distinctive tokens present on the line).
  const lineTokens = new Set(line.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2));
  for (const [capName, tks] of builtCapTokenSets) {
    if (tks.length > 0 && tks.every((t) => lineTokens.has(t))) {
      return {
        reason: `forward cue names the already-built capability "${capName}"`,
        capability: capName,
        version: null,
      };
    }
  }

  return null;
}

/**
 * Which prose lines describe an ALREADY-BUILT capability (or an already-shipped
 * version) as FUTURE work? (SPEC_V022A AC-1 — the inverse of checkCapabilityClaims.)
 * Deterministic, precision-first, removable-aware. Pure, never throws.
 *
 * Method:
 *   1. Skip fenced code blocks (precision — a doc may show an old roadmap snippet).
 *   2. Skip a line with NO forward cue (only forward-looking claims are in scope).
 *   3. Skip a line framed as PAST/historical ("was next", "originally planned") —
 *      the not-a-claim guard (it correctly narrates a past plan).
 *   4. Flag a line whose forward cue governs a BUILT capability OR a version
 *      <= the current version (forwardStaleEvidence). A forward cue + an UNBUILT
 *      capability and no past version → NOT flagged (a real future item, AC-4).
 *   5. `removable:true` ONLY for a discrete list item / whole line where every
 *      named version on the line is <= current and no genuinely-future signal
 *      survives — i.e. cleanly excisable without losing a real future plan. A
 *      multi-clause prose sentence → removable:false (FLAGGED, never auto-cut).
 *
 * @param {{
 *   docText?: string,
 *   doc?: string,
 *   inventory?: object,
 *   roadmap?: string,            // MAKE_MY_DREAMS.md text (for reconcileRoadmap)
 *   currentVersion?: string,     // the repo's package.json version (e.g. '0.22.0')
 * }} args
 * @returns {Array<{ doc: string, line: number, claim: string, capability: string|null,
 *   reason: string, confidence: string, removable: boolean }>}
 */
export function checkObsoleteForwardClaims(args) {
  const a = args && typeof args === 'object' ? args : {};
  const docText = typeof a.docText === 'string' ? a.docText : '';
  const doc = typeof a.doc === 'string' ? a.doc : '';
  if (docText.length === 0) return [];

  const current = looseVersion(typeof a.currentVersion === 'string' ? a.currentVersion : '');

  // Per built capability: its distinctive NAME token-set (REUSE reconcileRoadmap —
  // DRY). A forward line is stale-by-capability when ALL of SOME built capability's
  // distinctive tokens appear on it.
  const builtCapTokenSets = builtCapabilityTokenSets(
    typeof a.roadmap === 'string' ? a.roadmap : null,
    a.inventory || null,
  );

  const findings = [];
  const lines = docText.split('\n');
  let inFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const lineNo = i + 1;

    if (!FORWARD_CUE.test(line)) continue;           // not a forward-looking line.
    if (FORWARD_HISTORICAL.test(line)) continue;     // past-tense narration → not a live claim.

    const evidence = forwardStaleEvidence(line, current, builtCapTokenSets);
    if (!evidence) continue; // a genuine future item (unbuilt, no past version) → not flagged.

    // Removable ONLY when the line is a discrete excisable shape AND it carries no
    // genuinely-future version (a future version on a list item means the item
    // still names a real plan — flag, don't delete). The excisability check reuses
    // the same shapes as the capability-lie path (a pure list item / a trailing
    // comma-clause). For obsolete-forward we additionally require that EVERY version
    // token on the line is <= current (no surviving future plan to preserve).
    const everyVersionPast = allVersionsAtOrBelow(line, current);
    const exc = forwardExcisability(line);
    const removable = exc.excisable && everyVersionPast;

    findings.push({
      doc, line: lineNo,
      claim: line.trim(),
      capability: evidence.capability,
      reason: evidence.reason,
      confidence: 'high',
      removable,
      removalMode: removable ? exc.mode : null,
    });
  }
  return findings;
}

/**
 * Are ALL version tokens on the line <= the current version? (If a line names a
 * future version too, deleting it would drop a real plan → not cleanly removable.)
 * No version tokens at all → true (a pure built-capability forward claim with no
 * version is cleanly removable when it is a discrete item). Pure, never throws.
 *
 * @param {string} line
 * @param {number[]|null} current
 * @returns {boolean}
 */
function allVersionsAtOrBelow(line, current) {
  if (!current) return false; // can't judge versions → conservative: not removable.
  VERSION_TOKEN_GLOBAL.lastIndex = 0;
  let m;
  while ((m = VERSION_TOKEN_GLOBAL.exec(line)) !== null) {
    const pinned = [Number(m[1]), Number(m[2]), Number(m[3] || 0)];
    if (!versionAtOrBelow(pinned, current)) return false; // a future version survives.
  }
  // Reaching here: no version token was greater than current. Either there were
  // none (a pure built-capability claim) or all are past — both cleanly removable.
  return true;
}

/**
 * Is the forward-looking line a discrete, cleanly-excisable shape (a pure markdown
 * list item, or a standalone short line that IS the forward claim)? Mirrors the
 * capability-lie excisability shapes but simpler — for obsolete-forward we only
 * auto-DELETE a whole-line list item (the high-confidence safe cut); a forward
 * claim buried in a multi-clause sentence (the README line-73 case) → flagged,
 * NEVER auto-rewritten (rewriting a roadmap to the CURRENT roadmap is semantic,
 * deferred — SPEC §3). Pure, never throws.
 *
 * @param {string} line
 * @returns {{ excisable: boolean, mode: 'whole-line'|null }}
 */
function forwardExcisability(line) {
  if (typeof line !== 'string') return { excisable: false, mode: null };
  const trimmed = line.trim();
  // A pure markdown list item whose body is the forward claim, with no comma
  // joining it to OTHER items on the same line.
  const listBody = /^(?:[-*]|\d+\.)\s+(.*)$/.exec(trimmed);
  if (listBody && !/[,;]/.test(listBody[1])) {
    return { excisable: true, mode: 'whole-line' };
  }
  return { excisable: false, mode: null };
}

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

// SPEC_V021A AC-2 — DERIVE the deprecated set from the real `[DEPRECATED]` notices
// the CLI emits, rather than only a hand-curated list (the v0.7.d golden rule:
// derive, don't hand-maintain — when a command is un-deprecated or a new one is
// deprecated, the doc-check follows the code automatically). The notices live in
// the alias bin files (bin/handover.js, bin/documentalist/document-*.js) as a
// stderr line of the exact form:
//   [DEPRECATED] mmdream <command> is deprecated — use: mmdream document …
// We parse the `<command>` out of each notice. Pure, never throws.
const DEPRECATED_NOTICE_RE = /\[DEPRECATED\]\s+mmdream\s+([a-z][a-z0-9-]*)\s+is\s+deprecated/gi;

/**
 * Parse the deprecated COMMAND NAMES out of the CLI's real `[DEPRECATED]` notices.
 * (SPEC_V021A AC-2 — derive, don't hand-curate.) Pure, never throws.
 *
 * @param {string|string[]} binSources the bin source text(s) emitting the notices
 *   (the alias files' stderr lines). A single string or an array is accepted.
 * @returns {string[]} the deduped deprecated command names (e.g. ['handover',
 *   'document-readme', 'document-review', 'document-compact'])
 */
export function deriveDeprecatedCommands(binSources) {
  const sources = Array.isArray(binSources)
    ? binSources.filter((s) => typeof s === 'string')
    : typeof binSources === 'string' ? [binSources] : [];
  const found = new Set();
  for (const src of sources) {
    DEPRECATED_NOTICE_RE.lastIndex = 0;
    let m;
    while ((m = DEPRECATED_NOTICE_RE.exec(src)) !== null) {
      if (m[1]) found.add(m[1]);
    }
  }
  return [...found];
}

/**
 * Build deprecated-surface RULES for a list of derived command names (SPEC_V021A
 * AC-2). Each rule matches an instructional `mmdream <command>` token presented as
 * primary. The match is the literal `mmdream <command>` invocation (in a fence, a
 * heading, or prose) — but NOT a longer command (the lookahead rejects a trailing
 * word char so `document` never matches `document-review`'s prefix, and vice-versa
 * the boundary keeps `document-review` from also firing the bare `document` rule).
 * Pure, never throws. `removable` defaults false (most are whole-section teaching,
 * flagged-not-cut); a discrete usage line CAN be removable (decided by the caller).
 *
 * @param {string[]} commands deprecated command names
 * @returns {Array<{ token, replacement, match: RegExp, requiresPrimaryCue, reason, derived: true }>}
 */
export function buildDeprecatedSurfaceRules(commands) {
  const list = Array.isArray(commands) ? commands.filter((c) => typeof c === 'string' && c.length > 0) : [];
  return list.map((cmd) => {
    const esc = cmd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return {
      token: `mmdream ${cmd}`,
      replacement: '`mmdream document`',
      // `mmdream <cmd>` as a command invocation — the trailing boundary `(?![\w-])`
      // keeps `document` from matching inside `document-review` and keeps each
      // command's rule firing only on its own exact name.
      match: new RegExp(`\\bmmdream\\s+${esc}(?![\\w-])`),
      // A derived deprecated command is "primary" when the line is an instruction
      // to run it — a usage line where the invocation leads the line (`mmdream
      // document-readme --tests N`) or a recommend cue governs it. A mere
      // comparative reference ("like `mmdream handover`, it…") mid-prose is NOT
      // primary teaching → not flagged (precision-first).
      requiresPrimaryCue: true,
      instructional: true, // a leading usage invocation also counts as primary
      reason: `\`mmdream ${cmd}\` is deprecated (the CLI emits a [DEPRECATED] notice) — use \`mmdream document\``,
      derived: true,
    };
  });
}

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
 * @param {{ config?: Array<object>, derivedCommands?: string[] }} [opts]
 *   `config` overrides the whole curated config (tests). `derivedCommands` (the
 *   real `[DEPRECATED]` command names from deriveDeprecatedCommands) ADDS derived
 *   rules to the curated set (AC-2 — derive + curate, union).
 * @returns {Array<{ doc: string, line: number, token: string, replacement: string,
 *   reason: string, confidence: string, removable: boolean }>}
 */
export function checkDeprecatedSurface(texts, opts) {
  const list = Array.isArray(texts) ? texts : [];
  const baseConfig = opts && Array.isArray(opts.config) ? opts.config : DEPRECATED_SURFACE;
  const derivedRules = opts && Array.isArray(opts.derivedCommands)
    ? buildDeprecatedSurfaceRules(opts.derivedCommands)
    : [];
  // Union, deduped by token (a derived command never collides with the curated
  // /bmad-adv-auto-dev / bare-mmd tokens, but dedup is cheap insurance).
  const seen = new Set();
  const config = [...baseConfig, ...derivedRules].filter((r) => {
    if (!r || typeof r.token !== 'string') return false;
    if (seen.has(r.token)) return false;
    seen.add(r.token);
    return true;
  });
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
        // Recommendation guard: a token is only drift when PRESENTED as primary —
        // a recommend cue ("try"/"run"/"→"/…) GOVERNS it (sits just before it),
        // OR (for an `instructional` derived rule) the invocation LEADS the line
        // (a usage line `mmdream document-readme --tests N`). This rejects a mere
        // co-occurring / comparative mention ("like `mmdream handover`, it…").
        const primary = (rule.requiresPrimaryCue && cueGovernsToken(line, m.index))
          || (rule.instructional && leadsLine(line, m.index));
        if (rule.requiresPrimaryCue && !primary) continue;

        // Removable when the WHOLE line is just that invocation (a discrete usage
        // line / list item the planner can excise cleanly); a token buried in a
        // heading or prose sentence → flagged, not auto-cut (precision-first).
        const removable = isDiscreteUsageLine(line, rule.match);
        findings.push({
          doc, line: lineNo, token: rule.token, replacement: rule.replacement,
          reason: rule.reason, confidence: 'high', removable,
        });
      }
    }
  }
  return findings;
}

/**
 * Does the deprecated invocation LEAD the line (a usage line)? Precision lever for
 * the derived `instructional` rules: a line whose first non-fence, non-bullet
 * content is the `mmdream <cmd>` invocation is primary teaching. Pure.
 *
 * @param {string} line
 * @param {number} tokenIndex
 * @returns {boolean}
 */
function leadsLine(line, tokenIndex) {
  if (typeof line !== 'string' || typeof tokenIndex !== 'number') return false;
  const prefix = line.slice(0, tokenIndex);
  // Allow only leading whitespace, a list bullet, or a backtick before the token.
  return /^[\s>`]*(?:[-*]\s+|\d+\.\s+)?[`]?$/.test(prefix);
}

/**
 * Is the line a DISCRETE usage line whose substantive content is ONLY this
 * invocation (so it can be cleanly removed)? A code-fence usage line like
 * `mmdream document-readme --tests N   # comment` qualifies; a heading or a prose
 * sentence does not. Pure, never throws.
 *
 * @param {string} line
 * @param {RegExp} match the rule's match regex
 * @returns {boolean}
 */
function isDiscreteUsageLine(line, match) {
  if (typeof line !== 'string') return false;
  const trimmed = line.trim();
  if (/^#{1,6}\s/.test(trimmed)) return false; // a heading — never a clean cut
  // The line must START with the invocation (optionally after a bullet) and not be
  // a prose sentence (no sentence-final period mid-line followed by more prose).
  const body = trimmed.replace(/^(?:[-*]\s+|\d+\.\s+)/, '');
  if (!(match instanceof RegExp)) return false;
  const m = match.exec(body);
  if (!m || m.index !== 0) return false;
  // No sentence punctuation that would indicate prose continuation before EOL,
  // other than a trailing shell comment (`# …`).
  const afterCmd = body.slice(m.index);
  return !/[.!?]\s+\S/.test(afterCmd.replace(/#.*$/, ''));
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
