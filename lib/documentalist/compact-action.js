// lib/documentalist/compact-action.js — the Documentalist's two CONTENT actions
// (SPEC_V021A AC-4): MOVE surplus (true-but-verbose → linked sibling, byte-lossless)
// and DELETE the false/deprecated (high-confidence + cleanly-excisable → removed).
//
// SRP (universal §I.S): these are PURE PLANNERS + the in-text transform. They
// DECIDE what moves where + compute the rewritten doc text — they NEVER touch the
// filesystem or git (the I/O lives in bin/documentalist/document.js). Pure,
// deterministic, never throw (error-handling §III): odd input → an empty plan.
//
// THE CRITICAL CORRECTNESS RULE (SPEC §4 / AC-4 — the v0.21-v1 bug this fixes):
// TRUTHFUL-STUB + CONTENT-MATCHED-DESTINATION. A section's destination filename
// MUST reflect its CONTENT and the stub's link TEXT MUST be the section's own
// heading. A `## History` section → docs/<stem>-history.md with a stub "See
// [History](…) for the full history" — NEVER a file named CHANGELOG.md and NEVER
// a stub that calls it "the changelog". ONLY the genuine changelog (identified by
// its `mmd:readme:changelog` marker or a `## Changelog` heading) targets
// CHANGELOG.md. destinationForSection + stubLineFor make this checkable in tests.

import { splitSections } from './doc-structure.js';

const CHANGELOG_MARKER = 'mmd:readme:changelog';
const CHANGELOG_FILE = 'CHANGELOG.md';

/**
 * Slugify a heading into a filename-safe stem: lowercase, alnum + dashes.
 * "Quick start" → "quick-start"; "Document-readme mode" → "document-readme-mode".
 * @param {string} heading
 * @returns {string}
 */
function slug(heading) {
  return String(heading)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'section';
}

/**
 * The doc's filename stem (without extension), used to name siblings:
 * "README.md" → "readme". A bare/odd path falls back to "doc".
 * @param {string} docPath
 * @returns {string}
 */
function docStem(docPath) {
  if (typeof docPath !== 'string' || !docPath) return 'doc';
  const base = docPath.replace(/\\/g, '/').split('/').pop() || docPath;
  return base.replace(/\.md$/i, '').toLowerCase() || 'doc';
}

/**
 * Is this section the genuine changelog? Identified by its `mmd:readme:changelog`
 * marker OR a `## Changelog` heading — NOT "the first/biggest section" (SPEC §4).
 *
 * @param {{ heading: string }} section
 * @param {string} sectionText the section's full text (to check for the marker)
 * @returns {boolean}
 */
function isChangelogSection(section, sectionText) {
  if (section && /^changelog$/i.test(String(section.heading).trim())) return true;
  if (typeof sectionText === 'string' && sectionText.includes(CHANGELOG_MARKER)) return true;
  return false;
}

/**
 * The CONTENT-MATCHED destination for a section (SPEC §4 — the invariant). The
 * genuine changelog → CHANGELOG.md; every other section → docs/<stem>-<slug>.md
 * named for its OWN heading (a `## History` section → docs/<stem>-history.md,
 * NEVER CHANGELOG.md). Pure, never throws.
 *
 * @param {string} heading the section's heading text
 * @param {string} docPath the source doc path (for the stem)
 * @param {{ isChangelog?: boolean }} [opts]
 * @returns {string} the repo-relative destination path
 */
export function destinationForSection(heading, docPath, opts) {
  const isChangelog = !!(opts && opts.isChangelog);
  if (isChangelog) return CHANGELOG_FILE;
  return `docs/${docStem(docPath)}-${slug(heading)}.md`;
}

/**
 * The one-line link STUB left in the doc where a section was (SPEC §4 — the stub's
 * link TEXT is the section's OWN heading, never a mismatched word). For the
 * changelog the link is to CHANGELOG.md and the prose says "changelog"; for any
 * other section the link text + the prose word are the section's own heading.
 * Pure, never throws.
 *
 * @param {string} heading the section's heading
 * @param {string} dst the destination path
 * @param {{ isChangelog?: boolean }} [opts]
 * @returns {string}
 */
export function stubLineFor(heading, dst, opts) {
  const isChangelog = !!(opts && opts.isChangelog);
  if (isChangelog) {
    return `See [${CHANGELOG_FILE}](${dst}) for the full changelog.`;
  }
  const h = String(heading).trim();
  return `See [${h}](${dst}) for the full ${h.toLowerCase()}.`;
}

/**
 * Extract the FULL text of a section (heading line through the line before the
 * next `##` / EOF) from the doc's lines, given the section's 1-based span.
 * @param {string[]} lines
 * @param {{ startLine: number, endLine: number }} section
 * @returns {string}
 */
function sectionText(lines, section) {
  return lines.slice(section.startLine - 1, section.endLine).join('\n');
}

/**
 * Has this section ALREADY been extracted (idempotency, SPEC §4)? True when the
 * doc holds only a stub at this heading — i.e. the heading is immediately
 * followed (within a few lines) by a "See [...](...)" link line and nothing
 * substantial else. A short section that is essentially the stub is a no-op.
 * @param {string} body the section body (after the heading line)
 * @returns {boolean}
 */
function isAlreadyStub(body) {
  const meaningful = body.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (meaningful.length === 0) return false;
  // Already a stub when every meaningful line is a "See [..](..)" link (or there
  // is exactly one such link line).
  return meaningful.length <= 2 && meaningful.every((l) => /^See \[.+\]\(.+\)/.test(l));
}

/**
 * Plan the MOVE of oversized sections of a CONCISE-role doc into linked siblings
 * (SPEC_V021A AC-4). PURE, byte-lossless, idempotent, never throws.
 *
 * REFERENCE-role docs are NEVER planned (role-aware). For each oversized `##`
 * section: the genuine changelog moves its MARKERS + content to CHANGELOG.md with
 * a "See CHANGELOG.md" link; every other section moves to a CONTENT-MATCHED
 * docs/<stem>-<slug>.md with a truthful stub naming its OWN heading. The doc text
 * is rewritten in place (the section replaced by the stub line). Already-extracted
 * sections (just a stub) are skipped (idempotent → no-op).
 *
 * @param {{
 *   docPath?: string,
 *   docText?: string,
 *   role?: 'concise'|'reference',
 *   sections?: Array<{ heading: string, startLine: number, endLine: number, lines: number }>,
 *     the OVERSIZED sections to move (from assessDocStructure). When absent, the
 *     planner does nothing (the caller decides which sections are surplus).
 *   existingSiblings?: string[],  // sibling files that already exist (for honest reporting)
 * }} args
 * @returns {{
 *   moves: Array<{ heading: string, dst: string, content: string, stub: string, isChangelog: boolean }>,
 *   newDocText: string,
 *   skipped: Array<{ heading: string, reason: string }>,
 * }}
 */
export function planExtraction(args) {
  const a = args && typeof args === 'object' ? args : {};
  const docPath = typeof a.docPath === 'string' ? a.docPath : '';
  const docText = typeof a.docText === 'string' ? a.docText : '';
  const role = a.role === 'reference' ? 'reference' : 'concise';
  const empty = { moves: [], newDocText: docText, skipped: [] };

  if (role === 'reference') return empty;          // role-aware: never move a reference doc
  if (docText.length === 0) return empty;
  const wantedSections = Array.isArray(a.sections) ? a.sections : [];
  if (wantedSections.length === 0) return empty;

  const lines = docText.split('\n');
  const allSections = splitSections(docText);
  // Resolve the requested sections against the freshly-split sections by heading,
  // so the spans are exact even if the caller passed stale spans. Match on heading.
  const moves = [];
  const skipped = [];
  // We rewrite by removing section line-ranges + inserting a stub; collect the
  // ranges first, then rebuild (so multiple moves don't shift each other's spans).
  const replacements = []; // { startLine, endLine, stubLine }

  for (const want of wantedSections) {
    const heading = want && typeof want.heading === 'string' ? want.heading.trim() : '';
    if (!heading) continue;
    const sec = allSections.find((s) => s.heading.trim() === heading);
    if (!sec) { skipped.push({ heading, reason: 'section not found' }); continue; }

    const fullText = sectionText(lines, sec);
    const bodyLines = lines.slice(sec.startLine, sec.endLine); // after the heading line
    const body = bodyLines.join('\n');
    if (isAlreadyStub(body)) { skipped.push({ heading, reason: 'already extracted (stub present)' }); continue; }

    const isChangelog = isChangelogSection(sec, fullText);
    const dst = destinationForSection(heading, docPath, { isChangelog });
    const stub = stubLineFor(heading, dst, { isChangelog });

    moves.push({ heading, dst, content: fullText, stub, isChangelog });
    // Replace the section span with: the heading line + a blank + the stub + a
    // trailing blank (so the next `##` heading is separated — valid markdown).
    const stubBlock = [`## ${heading}`, '', stub, ''];
    replacements.push({ startLine: sec.startLine, endLine: sec.endLine, stubBlock });
  }

  if (moves.length === 0) return { moves: [], newDocText: docText, skipped };

  // Rebuild the doc: walk lines, when a replacement's startLine is hit emit the
  // stub block and skip to its endLine. Replacements are non-overlapping `##`
  // sections; process in line order.
  replacements.sort((x, y) => x.startLine - y.startLine);
  const out = [];
  let i = 0; // 0-based
  let r = 0;
  while (i < lines.length) {
    const lineNo = i + 1;
    if (r < replacements.length && replacements[r].startLine === lineNo) {
      out.push(...replacements[r].stubBlock);
      i = replacements[r].endLine; // skip to end (0-based index = endLine since endLine is 1-based inclusive)
      r += 1;
      continue;
    }
    out.push(lines[i]);
    i += 1;
  }

  return { moves, newDocText: out.join('\n'), skipped };
}

// --- DELETE (planRemovals) -------------------------------------------------

/**
 * Plan the precise removal of HIGH-confidence + removable findings (SPEC_V021A
 * AC-4 / the DELETE action). PURE, idempotent, never throws.
 *
 * For each finding that is `confidence:'high'` AND `removable:true`:
 *   • whole-line   → remove the entire line.
 *   • trailing-clause → strip the trailing ", <falsehood-clause>" from the line,
 *     keeping the sentence well-formed (fix the separator).
 * A finding that is NOT cleanly excisable (removable:false / no removal mode) is
 * RETURNED as `flagged`, never edited (a mid-sentence falsehood stays for human
 * review — precision-first, never mutilate prose).
 *
 * @param {{
 *   docText?: string,
 *   findings?: Array<{
 *     line: number, confidence?: string, removable?: boolean,
 *     removalMode?: 'whole-line'|'trailing-clause'|null,
 *     matchText?: string, claim?: string, capability?: string, token?: string,
 *   }>,
 * }} args
 * @returns {{
 *   removals: Array<{ line: number, mode: string, what: string }>,
 *   flagged: Array<object>,
 *   newDocText: string,
 * }}
 */
export function planRemovals(args) {
  const a = args && typeof args === 'object' ? args : {};
  const docText = typeof a.docText === 'string' ? a.docText : '';
  const findings = Array.isArray(a.findings) ? a.findings : [];
  if (docText.length === 0) return { removals: [], flagged: [], newDocText: docText };

  const lines = docText.split('\n');
  const removals = [];
  const flagged = [];
  // Map line-number → action, so multiple findings on one line are coherent.
  const lineActions = new Map(); // 1-based lineNo → { mode, matchText, what }
  const deletedLines = new Set();

  for (const f of findings) {
    if (!f || typeof f.line !== 'number') continue;
    const isHigh = f.confidence === 'high';
    const removable = f.removable === true;
    if (!isHigh || !removable) { flagged.push(f); continue; }

    const mode = f.removalMode === 'whole-line' || f.removalMode === 'trailing-clause'
      ? f.removalMode
      : 'whole-line'; // a removable finding with no mode → safest whole-line cut
    const what = f.capability || f.token || f.claim || 'finding';
    lineActions.set(f.line, { mode, matchText: f.matchText, what });
  }

  for (const [lineNo, act] of lineActions) {
    const idx = lineNo - 1;
    if (idx < 0 || idx >= lines.length) {
      // Out-of-range (already removed / stale) → idempotent no-op, honest skip.
      continue;
    }
    const original = lines[idx];

    if (act.mode === 'trailing-clause' && act.matchText) {
      // Strip ", <falsehood>" up to EOL (keeping a trailing period). The clause is
      // the LAST comma-item of the sentence; remove from its leading comma.
      const matchIdx = original.indexOf(act.matchText);
      if (matchIdx > 0) {
        const before = original.slice(0, matchIdx);
        // Drop the trailing ", " (and any whitespace) before the clause; keep a
        // sentence-final period if the removed clause carried one.
        const trimmedBefore = before.replace(/,\s*$/, '');
        const hadPeriod = /\.\s*$/.test(original.trimEnd());
        const rebuilt = hadPeriod ? `${trimmedBefore.replace(/\.\s*$/, '')}.` : trimmedBefore;
        if (rebuilt !== original) {
          lines[idx] = rebuilt;
          removals.push({ line: lineNo, mode: 'trailing-clause', what: act.what });
          continue;
        }
      }
      // Couldn't cleanly strip → idempotent (already removed) or flag-safe skip.
      continue;
    }

    // whole-line removal.
    deletedLines.add(idx);
    removals.push({ line: lineNo, mode: 'whole-line', what: act.what });
  }

  // Rebuild, dropping whole-line removals. Also collapse a resulting double-blank
  // so the markdown stays well-formed (no triple blank lines from a removed line
  // between two blanks).
  const rebuilt = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (deletedLines.has(i)) continue;
    rebuilt.push(lines[i]);
  }
  const collapsed = collapseBlankRuns(rebuilt);

  return { removals, flagged, newDocText: collapsed.join('\n') };
}

/**
 * Collapse a run of 3+ consecutive blank lines down to 2 (a removed line between
 * blanks would otherwise leave an ugly gap). Pure.
 * @param {string[]} lines
 * @returns {string[]}
 */
function collapseBlankRuns(lines) {
  const out = [];
  let blanks = 0;
  for (const l of lines) {
    if (l.trim() === '') {
      blanks += 1;
      if (blanks <= 2) out.push(l);
    } else {
      blanks = 0;
      out.push(l);
    }
  }
  return out;
}

export { isChangelogSection, CHANGELOG_FILE, CHANGELOG_MARKER };
